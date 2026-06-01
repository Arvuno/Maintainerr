import { MetadataProviderPreference } from '@maintainerr/contracts';
import {
  createMediaItem,
  createMetadataProviderMock,
  createMockLogger,
  metadataLookupServiceTestCases,
  MetadataProviderMockConfig,
} from '../../../test/utils/data';
import { MaintainerrLogger } from '../logging/logs.service';
import { IMetadataProvider } from './interfaces/metadata-provider.interface';
import { MetadataService } from './metadata.service';

describe('MetadataService', () => {
  const createService = ({
    tmdbDetails,
    tvdbDetails,
    tvdbMovieId = 202,
    mediaServer = {
      getMetadata: jest.fn(),
    },
    providerMocks,
  }: {
    tmdbDetails?: {
      title?: string;
      year?: number;
      type?: 'movie' | 'tv';
      externalIds?: {
        tmdb?: number;
        imdb?: string;
        tvdb?: number;
        type: 'movie' | 'tv';
      };
    };
    tvdbDetails?: {
      title?: string;
      year?: number;
      type?: 'movie' | 'tv';
      externalIds?: {
        tmdb?: number;
        imdb?: string;
        tvdb?: number;
        type: 'movie' | 'tv';
      };
    };
    mediaServer?: {
      getMetadata: jest.Mock;
    };
    tvdbMovieId?: number;
    providerMocks?: MetadataProviderMockConfig[];
  }) => {
    const providers = (
      providerMocks ?? [
        {
          name: 'TMDB',
          idKey: 'tmdb',
          details: tmdbDetails,
          detailsId: 101,
          posterUrl: 'https://tmdb/poster.jpg',
          backdropUrl: 'https://tmdb/backdrop.jpg',
        },
        {
          name: 'TVDB',
          idKey: 'tvdb',
          details: tvdbDetails,
          detailsId: tvdbMovieId,
          posterUrl: 'https://tvdb/poster.jpg',
          backdropUrl: 'https://tvdb/backdrop.jpg',
          findByExternalId: async (externalId, type) => {
            if (type === 'imdb' && externalId === 'tt0099785') {
              return [{ movieId: tvdbMovieId }];
            }

            return undefined;
          },
        },
      ]
    ).map((config) => createMetadataProviderMock(config));

    const providerByKey = Object.fromEntries(
      providers.map((provider) => [provider.idKey, provider]),
    ) as Record<string, jest.Mocked<IMetadataProvider>>;

    const tmdbProvider = providerByKey.tmdb;
    const tvdbProvider = providerByKey.tvdb;
    const logger = createMockLogger() as unknown as MaintainerrLogger;
    const mediaServerFactory = {
      getService: jest.fn().mockResolvedValue(mediaServer),
    };

    const service = new MetadataService(
      providers,
      mediaServerFactory as never,
      {
        metadata_provider_preference: MetadataProviderPreference.TVDB_PRIMARY,
      } as never,
      logger,
    );
    service.onApplicationBootstrap();

    return {
      service,
      providers,
      providerByKey,
      tmdbProvider,
      tvdbProvider,
      logger,
      mediaServer,
      mediaServerFactory,
    };
  };

  it('resolves a missing TVDB movie id from imdb before selecting the preferred poster provider', async () => {
    const ids = {
      tmdb: 771,
      imdb: 'tt0099785',
    };
    const { service, tmdbProvider, tvdbProvider } = createService({
      tmdbDetails: {
        externalIds: {
          tmdb: 771,
          imdb: 'tt0099785',
          type: 'movie',
        },
      },
    });

    const result = await service.getPosterUrl(ids, 'movie');

    expect(result).toEqual({
      url: 'https://tvdb/poster.jpg',
      provider: 'TVDB',
      id: 202,
    });
    expect(ids).toEqual({
      tmdb: 771,
      imdb: 'tt0099785',
      tvdb: 202,
    });
    expect(tvdbProvider.findByExternalId).toHaveBeenCalledWith(
      'tt0099785',
      'imdb',
    );
    expect(tvdbProvider.getPosterUrl).toHaveBeenCalledWith(
      202,
      'movie',
      'w500',
    );
    expect(tmdbProvider.getPosterUrl).not.toHaveBeenCalled();
  });

  it('resolves parent show IDs when a season mediaServerItemId is provided', async () => {
    const seasonItem = createMediaItem({
      id: 'season-42',
      type: 'season',
      parentId: 'show-1',
      providerIds: { tmdb: ['9999'], tvdb: ['8888'] },
    });
    const showItem = createMediaItem({
      id: 'show-1',
      type: 'show',
      providerIds: { tmdb: ['100'], tvdb: ['200'] },
    });
    const mediaServer = {
      getMetadata: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === 'season-42' ? seasonItem : showItem),
        ),
    };
    const { service, tvdbProvider } = createService({ mediaServer });

    const result = await service.getPosterUrl(
      { tmdb: 9999, tvdb: 8888 },
      'tv',
      'w500',
      'season-42',
    );

    expect(mediaServer.getMetadata).toHaveBeenCalledWith('season-42');
    expect(mediaServer.getMetadata).toHaveBeenCalledWith('show-1');
    expect(result).toBeDefined();
    expect(tvdbProvider.getPosterUrl).toHaveBeenCalledWith(200, 'tv', 'w500');
  });

  it('resolves parent show IDs when an episode mediaServerItemId is provided', async () => {
    const episodeItem = createMediaItem({
      id: 'episode-7',
      type: 'episode',
      parentId: 'season-3',
      grandparentId: 'show-1',
      providerIds: { tmdb: ['5555'] },
    });
    const showItem = createMediaItem({
      id: 'show-1',
      type: 'show',
      providerIds: { tmdb: ['100'], tvdb: ['200'] },
    });
    const mediaServer = {
      getMetadata: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === 'episode-7' ? episodeItem : showItem),
        ),
    };
    const { service, tvdbProvider } = createService({ mediaServer });

    const result = await service.getBackdropUrl(
      { tmdb: 5555 },
      'tv',
      'w1280',
      'episode-7',
    );

    expect(mediaServer.getMetadata).toHaveBeenCalledWith('episode-7');
    expect(mediaServer.getMetadata).toHaveBeenCalledWith('show-1');
    expect(result).toBeDefined();
    expect(tvdbProvider.getBackdropUrl).toHaveBeenCalledWith(
      200,
      'tv',
      'w1280',
    );
  });

  it('falls back to original IDs when mediaServer lookup fails', async () => {
    const mediaServer = {
      getMetadata: jest.fn().mockRejectedValue(new Error('connection failed')),
    };
    const { service, tvdbProvider } = createService({ mediaServer });

    const result = await service.getPosterUrl(
      { tvdb: 200 },
      'tv',
      'w500',
      'season-42',
    );

    expect(result).toBeDefined();
    expect(tvdbProvider.getPosterUrl).toHaveBeenCalledWith(200, 'tv', 'w500');
  });

  it('skips show ID resolution for movies even when mediaServerItemId is provided', async () => {
    const mediaServer = {
      getMetadata: jest.fn(),
    };
    const { service, tvdbProvider } = createService({ mediaServer });

    await service.getPosterUrl({ tvdb: 200 }, 'movie', 'w500', 'movie-1');

    expect(mediaServer.getMetadata).not.toHaveBeenCalled();
    expect(tvdbProvider.getPosterUrl).toHaveBeenCalledWith(
      200,
      'movie',
      'w500',
    );
  });

  it.each(metadataLookupServiceTestCases)(
    '$title',
    async ({
      service: targetService,
      lookupPolicy,
      libraryItem,
      providerMocks,
      expectedCandidates,
    }) => {
      const { service } = createService({
        providerMocks,
      });
      const item = createMediaItem(libraryItem);

      await expect(
        service.resolveLookupCandidatesFromMediaItem(item, lookupPolicy),
      ).resolves.toEqual(expectedCandidates);
      await expect(
        service.resolveLookupCandidatesFromMediaItemForService(
          item,
          targetService,
        ),
      ).resolves.toEqual(expectedCandidates);
    },
  );

  it('resolves a Seerr TMDB id from a direct TVDB id when the TVDB provider is unavailable', async () => {
    const { service, providerByKey } = createService({
      providerMocks: [
        {
          name: 'TMDB',
          idKey: 'tmdb',
          findByExternalId: async (externalId, type) => {
            if (type === 'tvdb' && externalId === 303) {
              return [{ tvShowId: 404 }];
            }

            return undefined;
          },
        },
        {
          name: 'TVDB',
          idKey: 'tvdb',
          isAvailable: false,
        },
      ],
    });
    const item = createMediaItem({
      id: 'show-seerr-1',
      type: 'show',
      title: 'Fixture Story',
      providerIds: {
        tmdb: [],
        imdb: [],
        tvdb: ['303'],
      },
    });

    await expect(
      service.resolveIdsFromMediaItemForService(item, 'seerr'),
    ).resolves.toMatchObject({
      tmdb: 404,
      tvdb: 303,
      type: 'tv',
    });
    expect(providerByKey.tmdb.findByExternalId).toHaveBeenCalledWith(
      303,
      'tvdb',
    );
  });

  it('fails closed when a lookup policy only references unsupported providers', async () => {
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Story',
        type: 'movie',
        externalIds: {
          tmdb: 771,
          type: 'movie',
        },
      },
    });
    const item = createMediaItem({
      id: 'movie-invalid-policy-1',
      type: 'movie',
      title: 'Fixture Story',
      providerIds: {
        tmdb: ['771'],
        imdb: [],
        tvdb: [],
      },
    });
    const invalidLookupPolicy = {
      providerKeys: ['invalid-provider'],
      providerMatchMode: 'any' as const,
    };

    await expect(
      service.resolveLookupCandidatesFromMediaItem(item, invalidLookupPolicy),
    ).resolves.toEqual([]);
    await expect(
      service.resolveIdsFromMediaItemWithLookupPolicy(
        item,
        invalidLookupPolicy,
      ),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Metadata lookup policy references only unsupported providers: invalid-provider',
    );
  });

  it('resolves ids from hierarchy metadata when a child media item is provided', async () => {
    const episodeItem = createMediaItem({
      id: 'episode-1',
      type: 'episode',
      parentId: 'season-1',
      grandparentId: 'show-1',
      providerIds: {},
    });
    const showItem = createMediaItem({
      id: 'show-1',
      type: 'show',
      title: 'Fixture Story',
      providerIds: { tmdb: ['771'] },
    });
    const mediaServer = {
      getMetadata: jest.fn().mockImplementation(async (id: string) => {
        if (id === 'show-1') {
          return showItem;
        }

        return undefined;
      }),
    };
    const { service } = createService({
      mediaServer,
      tmdbDetails: {
        externalIds: {
          tmdb: 771,
          imdb: 'tt0099785',
          type: 'tv',
        },
      },
    });

    const result = await service.resolveIdsFromHierarchyMediaItem(episodeItem);

    expect(mediaServer.getMetadata).toHaveBeenCalledWith('show-1');
    expect(result).toMatchObject({
      tmdb: 771,
      type: 'tv',
    });
  });

  it('accepts direct provider ids when titles differ but release years agree', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-1',
      type: 'movie',
      year: 2025,
      title: 'The Fixture Quartet: Prologue',
      providerIds: {
        tmdb: ['900001'],
        imdb: [],
        tvdb: [],
      },
    });
    const { service, logger, mediaServer } = createService({
      tmdbDetails: {
        title: 'The Fixture 4: Prologue',
        year: 2025,
        type: 'movie',
        externalIds: {
          tmdb: 900001,
          type: 'movie',
        },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(mediaServer.getMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      tmdb: 900001,
      type: 'movie',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects direct provider ids when no configured provider confirms the release year', async () => {
    const libraryItem = createMediaItem({
      id: 'show-1',
      type: 'show',
      year: 2025,
      title: 'Fixture Chronicle',
      providerIds: {
        tmdb: ['771'],
        imdb: [],
        tvdb: [],
      },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Unrelated Series',
        year: 2014,
        type: 'tv',
        externalIds: {
          tmdb: 771,
          type: 'tv',
        },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected direct provider IDs for media server item "Fixture Chronicle" (2025) because no configured metadata provider confirmed the release year. Disagreements: TMDB returned 2014. The media server likely has incorrect metadata for this item, so no external IDs will be returned from this resolution attempt.',
    );
  });

  it('accepts direct provider ids when the media server item has no year signal to reject with', async () => {
    const libraryItem = createMediaItem({
      id: 'show-1',
      type: 'show',
      year: undefined,
      title: 'Fixture Localized',
      providerIds: {
        tmdb: ['771'],
        imdb: [],
        tvdb: [],
      },
    });
    const { service, logger, mediaServer } = createService({
      tmdbDetails: {
        title: 'Fixture Chronicle',
        year: 2025,
        type: 'tv',
        externalIds: {
          tmdb: 771,
          type: 'tv',
        },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(mediaServer.getMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      tmdb: 771,
      type: 'tv',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when the provider has no release year but still accepts the ids', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-provider-missing-year',
      type: 'movie',
      year: 2099,
      title: 'Fixture Orbit',
      providerIds: { tmdb: ['808001'], imdb: [], tvdb: [] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Orbit',
        year: undefined,
        type: 'movie',
        externalIds: { tmdb: 808001, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toMatchObject({ tmdb: 808001, type: 'movie' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TMDB returned no release year'),
    );
  });

  it('accepts direct provider ids when a parenthesized year in the title matches the provider year', async () => {
    const libraryItem = createMediaItem({
      id: 'show-1',
      type: 'show',
      year: 2025,
      title: 'Fixture Chronicle (2025)',
      providerIds: {
        tmdb: ['771'],
        imdb: [],
        tvdb: [],
      },
    });
    const { service, logger, mediaServer } = createService({
      tmdbDetails: {
        title: 'Fixture Chronicle',
        year: 2025,
        type: 'tv',
        externalIds: {
          tmdb: 771,
          type: 'tv',
        },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(mediaServer.getMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      tmdb: 771,
      type: 'tv',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips the detail lookup when the title already matches', async () => {
    const libraryItem = createMediaItem({
      id: 'show-1',
      type: 'show',
      title: 'Fixture Chronicle',
      providerIds: {
        tmdb: ['771'],
        imdb: [],
        tvdb: [],
      },
    });
    const { service, mediaServer } = createService({
      tmdbDetails: {
        title: 'Fixture Chronicle',
        type: 'tv',
        externalIds: {
          tmdb: 771,
          type: 'tv',
        },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(mediaServer.getMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      tmdb: 771,
      type: 'tv',
    });
  });

  // Cross-provider fallback: when the primary provider disagrees with the
  // media server year, the next configured provider gets a chance to vouch
  // for the ID before we reject.
  it('accepts direct ids via the secondary provider when the primary disagrees on year', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-fallback-1',
      type: 'movie',
      year: 2099,
      title: 'Fixture Runners',
      providerIds: { tmdb: ['777001'], imdb: [], tvdb: ['888001'] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Runners',
        year: 2096,
        type: 'movie',
        externalIds: { tmdb: 777001, type: 'movie' },
      },
      tvdbDetails: {
        title: 'Fixture Runners',
        year: 2099,
        type: 'movie',
        externalIds: { tvdb: 888001, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toMatchObject({ tvdb: 888001, type: 'movie' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects direct ids when every configured provider disagrees on year', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-fallback-2',
      type: 'movie',
      year: 2099,
      title: 'Fixture Runners',
      providerIds: { tmdb: ['777002'], imdb: [], tvdb: ['888002'] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Runners',
        year: 2096,
        type: 'movie',
        externalIds: { tmdb: 777002, type: 'movie' },
      },
      tvdbDetails: {
        title: 'Fixture Runners',
        year: 2096,
        type: 'movie',
        externalIds: { tvdb: 888002, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TMDB returned 2096'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TVDB returned 2096'),
    );
  });

  // Re-scan mixup: a newer library item wrongly tagged with an older entry's
  // id. Titles are literally identical — only the year distinguishes them.
  // This is the case a title-first policy would silently accept.
  it('rejects a rescan id mixup where titles match exactly but years differ', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-rescan-mixup',
      type: 'movie',
      year: 2099,
      title: 'Fixture Road',
      providerIds: { tmdb: ['444111'], imdb: [], tvdb: [] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Road',
        year: 2091,
        type: 'movie',
        externalIds: { tmdb: 444111, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('(2099)'));
  });

  // When the provider's returned externalIds expose a different value for
  // that same provider (e.g. a merged/redirected TMDB entry, or — per #3010 —
  // simply wrong external_ids editor data), the media-server id is kept as
  // the primary and the canonical id is recorded as an alternate. Downstream
  // lookups try the primary first and fall back to the alternate.
  it('records a disagreeing canonical id as a fallback alternate (keeps the media-server primary)', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-stale-id',
      type: 'movie',
      year: 2099,
      title: 'Fixture Harbor',
      providerIds: { tmdb: ['111'], imdb: [], tvdb: [] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Harbor',
        year: 2099,
        type: 'movie',
        externalIds: { tmdb: 222, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    // Primary remains the media-server's id.
    expect(result).toMatchObject({ tmdb: 111, type: 'movie' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'TMDB cross-reference reports TMDB ID for "Fixture Harbor" as 222',
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Keeping 111 and trying 222 as a fallback'),
    );

    // Downstream candidate ordering: primary first, alternate second.
    const candidates = await service.resolveLookupCandidatesFromMediaItem(
      libraryItem,
      { providerKeys: ['tmdb'] },
    );
    expect(candidates).toEqual([
      { providerKey: 'tmdb', id: 111 },
      { providerKey: 'tmdb', id: 222 },
    ]);
  });

  it('records simultaneous disagreements from multiple providers as parallel alternates', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-multi-disagree',
      type: 'movie',
      year: 2099,
      title: 'Fixture Multi',
      providerIds: { tmdb: ['111'], tvdb: ['333'], imdb: [] },
    });
    const { service } = createService({
      tmdbDetails: {
        title: 'Fixture Multi',
        year: 2099,
        type: 'movie',
        externalIds: { tmdb: 222, tvdb: 444, type: 'movie' },
      },
    });

    const candidates = await service.resolveLookupCandidatesFromMediaItem(
      libraryItem,
      { providerKeys: ['tmdb', 'tvdb'] },
    );

    // Each provider emits primary-then-alternate; ordering follows the policy.
    expect(candidates).toEqual([
      { providerKey: 'tmdb', id: 111 },
      { providerKey: 'tmdb', id: 222 },
      { providerKey: 'tvdb', id: 333 },
      { providerKey: 'tvdb', id: 444 },
    ]);
  });

  it('only warns once when the same disagreement is reported repeatedly on the same ids object', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-dup-warn',
      type: 'movie',
      year: 2099,
      title: 'Fixture Dup',
      providerIds: { tmdb: ['111'], imdb: [], tvdb: [] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Dup',
        year: 2099,
        type: 'movie',
        externalIds: { tmdb: 222, type: 'movie' },
      },
    });

    await service.resolveLookupCandidatesFromMediaItem(libraryItem, {
      providerKeys: ['tmdb'],
    });

    // resolveIds + buildCandidates flow visits applyIdCorrections more than
    // once for the same ids object; the dedup guard ensures only one warn.
    const driftWarns = (logger.warn as jest.Mock).mock.calls.filter((c) =>
      String(c[0]).includes('cross-reference reports TMDB ID'),
    );
    expect(driftWarns).toHaveLength(1);
  });

  it('does not leak the alternate into the primary slot via fillMissingIds', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-no-leak',
      type: 'movie',
      year: 2099,
      title: 'Fixture NoLeak',
      providerIds: { tmdb: ['111'], imdb: [], tvdb: [] },
    });
    const { service } = createService({
      tmdbDetails: {
        title: 'Fixture NoLeak',
        year: 2099,
        type: 'movie',
        // TMDB reports a different tmdb (alternate) AND fills tvdb.
        externalIds: { tmdb: 222, tvdb: 999, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    // Primary tmdb is the media-server's 111, not the alternate 222.
    expect(result?.tmdb).toBe(111);
    // fillMissingIds DID fill the empty tvdb slot from externalIds.
    expect(result?.tvdb).toBe(999);
  });

  it("does NOT dedup across providers when an alternate happens to numerically match another provider's primary", async () => {
    // tvdb primary 280331 and a (hypothetical) tmdb alternate also 280331 are
    // distinct entries — buildLookupCandidates dedups per provider key.
    const libraryItem = createMediaItem({
      id: 'movie-cross-collide',
      type: 'movie',
      year: 2099,
      title: 'Fixture Collide',
      providerIds: { tmdb: ['111'], tvdb: ['280331'], imdb: [] },
    });
    const { service } = createService({
      tmdbDetails: {
        title: 'Fixture Collide',
        year: 2099,
        type: 'movie',
        externalIds: { tmdb: 280331, type: 'movie' },
      },
    });

    const candidates = await service.resolveLookupCandidatesFromMediaItem(
      libraryItem,
      { providerKeys: ['tmdb', 'tvdb'] },
    );

    expect(candidates).toEqual([
      { providerKey: 'tmdb', id: 111 },
      { providerKey: 'tmdb', id: 280331 },
      { providerKey: 'tvdb', id: 280331 },
    ]);
  });

  it('emits primary-then-alternate via the mediaServerId entrypoint (action-handler path)', async () => {
    // resolveLookupCandidatesForService is used by sonarr/radarr action
    // handlers; the From-MediaItem variant is used by getters. Both paths
    // must surface alternates equally.
    const mediaServer = {
      getMetadata: jest.fn(),
    };
    mediaServer.getMetadata.mockResolvedValue(
      createMediaItem({
        id: 'plex-42',
        type: 'movie',
        year: 2099,
        title: 'Fixture Action',
        providerIds: { tmdb: ['111'], imdb: [], tvdb: [] },
      }),
    );
    const { service } = createService({
      mediaServer,
      tmdbDetails: {
        title: 'Fixture Action',
        year: 2099,
        type: 'movie',
        externalIds: { tmdb: 222, type: 'movie' },
      },
    });

    const candidates = await service.resolveLookupCandidatesForService(
      'plex-42',
      'radarr',
    );

    expect(candidates).toEqual([
      { providerKey: 'tmdb', id: 111 },
      { providerKey: 'tmdb', id: 222 },
    ]);
  });

  it('uses a WeakMap so alternates cannot be retained beyond the ids object lifetime', () => {
    // Pins the data-structure choice to prevent a future refactor from
    // accidentally switching to a string-keyed Map (unbounded leak).
    const { service } = createService({});
    expect(
      (service as unknown as { alternatesByIds: unknown }).alternatesByIds,
    ).toBeInstanceOf(WeakMap);
  });

  it('produces stable alternates across two resolveLookupCandidates calls on the same media item', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-stable',
      type: 'movie',
      year: 2099,
      title: 'Fixture Stable',
      providerIds: { tmdb: ['111'], imdb: [], tvdb: [] },
    });
    const { service } = createService({
      tmdbDetails: {
        title: 'Fixture Stable',
        year: 2099,
        type: 'movie',
        externalIds: { tmdb: 222, type: 'movie' },
      },
    });

    const first = await service.resolveLookupCandidatesFromMediaItem(
      libraryItem,
      { providerKeys: ['tmdb'] },
    );
    const second = await service.resolveLookupCandidatesFromMediaItem(
      libraryItem,
      { providerKeys: ['tmdb'] },
    );

    expect(first).toEqual(second);
    expect(second).toEqual([
      { providerKey: 'tmdb', id: 111 },
      { providerKey: 'tmdb', id: 222 },
    ]);
  });

  // Second-opinion path: the media item exposes only TMDB + IMDB tags.
  // TMDB disagrees on year. TVDB has no direct id on the item but can be
  // reached via the IMDB id, and when consulted it vouches for the year.
  // The validation flow should bridge IMDB -> TVDB, then accept.
  it('bridges to a secondary provider via imdb when the primary disagrees on year', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-bridge-1',
      type: 'movie',
      year: 2099,
      title: 'Fixture Beacon',
      providerIds: { tmdb: ['333'], imdb: ['tt0099785'], tvdb: [] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Beacon',
        year: 2096,
        type: 'movie',
        externalIds: { tmdb: 333, type: 'movie' },
      },
      tvdbDetails: {
        title: 'Fixture Beacon',
        year: 2099,
        type: 'movie',
        externalIds: { tvdb: 555, type: 'movie' },
      },
      tvdbMovieId: 555,
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toMatchObject({ tvdb: 555, type: 'movie' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // ±1 year tolerance: festival premiere vs theatrical release and similar
  // regional drift routinely produce a single-year gap between the media
  // server and TMDB/TVDB. Single-year gaps are accepted; larger gaps are
  // still rejected.
  it('accepts direct ids with a logged note when the provider year differs by exactly one year', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-year-tolerance',
      type: 'movie',
      year: 2099,
      title: 'Fixture Premiere',
      providerIds: { tmdb: ['606001'], imdb: [], tvdb: [] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Premiere',
        year: 2098,
        type: 'movie',
        externalIds: { tmdb: 606001, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toMatchObject({ tmdb: 606001, type: 'movie' });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('one-year drift'),
    );
  });

  it('rejects direct ids when the provider year differs by more than one year', async () => {
    const libraryItem = createMediaItem({
      id: 'movie-year-outside-tolerance',
      type: 'movie',
      year: 2099,
      title: 'Fixture Premiere',
      providerIds: { tmdb: ['606002'], imdb: [], tvdb: [] },
    });
    const { service, logger } = createService({
      tmdbDetails: {
        title: 'Fixture Premiere',
        year: 2097,
        type: 'movie',
        externalIds: { tmdb: 606002, type: 'movie' },
      },
    });

    const result = await service.resolveIdsFromMediaItem(libraryItem);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TMDB returned 2097'),
    );
  });

  describe('getDetails({ merge: true })', () => {
    it('fills missing show-only fields from the secondary provider', async () => {
      const { service, tmdbProvider, tvdbProvider } = createService({});

      // Preference defaults to TVDB_PRIMARY in createService; for this test we
      // make TMDB primary by reordering. Easiest: make TVDB unavailable then
      // re-run, OR mock getOrderedProviders. Instead, just match the existing
      // order (TVDB first) and have TVDB return partial, TMDB fill in.
      tvdbProvider.getDetails.mockResolvedValue({
        id: 1,
        title: 'Sample Series',
        type: 'tv',
        externalIds: { type: 'tv', tvdb: 1 },
        // No `ended` from TVDB — say its status was 'Unknown'.
        ended: undefined,
        firstAirDate: '2017-04-25',
        seasonCount: 4,
      });
      tmdbProvider.getDetails.mockResolvedValue({
        id: 2,
        title: 'Sample Series',
        type: 'tv',
        externalIds: { type: 'tv', tmdb: 2 },
        ended: true,
        firstAirDate: '2017-04-25',
        seasonCount: 4,
      });

      const merged = await service.getDetails(
        { type: 'tv', tmdb: 2, tvdb: 1 },
        'tv',
        { merge: true },
      );

      // Primary (TVDB) provided everything except `ended`; secondary (TMDB)
      // filled `ended: true`.
      expect(merged?.ended).toBe(true);
      expect(merged?.firstAirDate).toBe('2017-04-25');
      expect(merged?.seasonCount).toBe(4);
    });

    it('keeps the primary provider value when both providers have the field', async () => {
      const { service, tmdbProvider, tvdbProvider } = createService({});

      tvdbProvider.getDetails.mockResolvedValue({
        id: 1,
        title: 'Sample Series',
        type: 'tv',
        externalIds: { type: 'tv', tvdb: 1 },
        ended: false,
        firstAirDate: '2017-04-25',
        seasonCount: 2,
      });
      tmdbProvider.getDetails.mockResolvedValue({
        id: 2,
        title: 'Sample Series',
        type: 'tv',
        externalIds: { type: 'tv', tmdb: 2 },
        ended: true,
        firstAirDate: '2018-01-01',
        seasonCount: 9,
      });

      const merged = await service.getDetails(
        { type: 'tv', tmdb: 2, tvdb: 1 },
        'tv',
        { merge: true },
      );

      // Primary (TVDB) wins for every field it supplied.
      expect(merged?.ended).toBe(false);
      expect(merged?.firstAirDate).toBe('2017-04-25');
      expect(merged?.seasonCount).toBe(2);
    });

    it('walks every available provider so new providers compose automatically', async () => {
      const { service, tmdbProvider, tvdbProvider } = createService({});

      tvdbProvider.getDetails.mockResolvedValue({
        id: 1,
        title: 'Sample Series',
        type: 'tv',
        externalIds: { type: 'tv', tvdb: 1 },
        ended: undefined,
        firstAirDate: undefined,
        seasonCount: undefined,
      });
      tmdbProvider.getDetails.mockResolvedValue({
        id: 2,
        title: 'Sample Series',
        type: 'tv',
        externalIds: { type: 'tv', tmdb: 2 },
        ended: true,
        firstAirDate: '2017-04-25',
        seasonCount: 4,
      });

      const merged = await service.getDetails(
        { type: 'tv', tmdb: 2, tvdb: 1 },
        'tv',
        { merge: true },
      );

      expect(tvdbProvider.getDetails).toHaveBeenCalled();
      expect(tmdbProvider.getDetails).toHaveBeenCalled();
      expect(merged?.ended).toBe(true);
      expect(merged?.firstAirDate).toBe('2017-04-25');
      expect(merged?.seasonCount).toBe(4);
    });

    it('returns undefined when no provider has the series', async () => {
      const { service, tmdbProvider, tvdbProvider } = createService({});

      tvdbProvider.getDetails.mockResolvedValue(undefined);
      tmdbProvider.getDetails.mockResolvedValue(undefined);

      const merged = await service.getDetails(
        { type: 'tv', tmdb: 2, tvdb: 1 },
        'tv',
        { merge: true },
      );

      expect(merged).toBeUndefined();
    });

    it("records cross-reference alternates against the caller's ids object", async () => {
      // applyIdCorrections is called from THREE sites; the other tests cover
      // validateDirectIds. This one covers the getDetails(merge:true) path:
      // applyIdCorrections runs once with the primary provider's externalIds
      // after the merge. Alternates must land on the same ids object
      // reference the caller passed.
      //
      // Default preference is TVDB_PRIMARY; for the merge path to take TMDB
      // as primary we make TVDB return undefined so the loop falls through.
      const { service, tmdbProvider, tvdbProvider } = createService({});
      tvdbProvider.getDetails.mockResolvedValue(undefined);
      tmdbProvider.getDetails.mockResolvedValue({
        id: 2,
        title: 'Sample Series',
        type: 'tv',
        // TMDB reports a different tmdb (canonical cross-reference).
        externalIds: { type: 'tv', tmdb: 999 },
        ended: true,
      });

      const ids = { type: 'tv', tmdb: 2 } as const;
      await service.getDetails(ids, 'tv', { merge: true });

      // Direct verification: alternate is keyed by the caller's ids object.
      const alternates = (
        service as unknown as {
          alternatesByIds: WeakMap<object, { tmdb?: number }>;
        }
      ).alternatesByIds.get(ids);
      expect(alternates?.tmdb).toBe(999);
    });
  });
});
