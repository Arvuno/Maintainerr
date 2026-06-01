import { MediaItem } from '@maintainerr/contracts';
import { Mocked, TestBed } from '@suites/unit';
import {
  createArrDiskspaceResource,
  createCollectionMedia,
  createMediaItem,
  createRadarrMovie,
  createRadarrMovieFile,
  createRadarrQuality,
  createRuleDto,
  createRulesDto,
} from '../../../../test/utils/data';
import { RadarrApi } from '../../api/servarr-api/helpers/radarr.helper';
import { RadarrMovie } from '../../api/servarr-api/interfaces/radarr.interface';
import { ServarrService } from '../../api/servarr-api/servarr.service';
import { CollectionMedia } from '../../collections/entities/collection_media.entities';
import { MaintainerrLogger } from '../../logging/logs.service';
import { MetadataService } from '../../metadata/metadata.service';
import { RadarrGetterService } from './radarr-getter.service';

describe('RadarrGetterService', () => {
  let radarrGetterService: RadarrGetterService;
  let servarrService: Mocked<ServarrService>;
  let metadataService: Mocked<MetadataService>;
  let logger: Mocked<MaintainerrLogger>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(RadarrGetterService).compile();

    radarrGetterService = unit;
    servarrService = unitRef.get(ServarrService);
    metadataService = unitRef.get(MetadataService);
    logger = unitRef.get(MaintainerrLogger);

    metadataService.resolveLookupCandidatesFromMediaItemForService.mockResolvedValue(
      [{ providerKey: 'tmdb', id: 1 }],
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('movie file properties', () => {
    let collectionMedia: CollectionMedia;
    let mediaItem: MediaItem;

    beforeEach(() => {
      collectionMedia = createCollectionMedia('movie');
      collectionMedia.collection.radarrSettingsId = 1;
      mediaItem = createMediaItem({ type: 'movie' });
    });

    it('should return true when the cut off is met', async () => {
      const movie = createRadarrMovie({
        movieFile: createRadarrMovieFile({
          qualityCutoffNotMet: false,
        }),
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        20,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe(true);
    });

    it('should return false when the cut off is not met', async () => {
      const movie = createRadarrMovie({
        movieFile: createRadarrMovieFile({
          qualityCutoffNotMet: true,
        }),
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        20,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe(false);
    });

    it('should return false when no movie file exists', async () => {
      const movie = createRadarrMovie({
        movieFile: undefined,
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        20,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe(false);
    });

    it('should return quality name', async () => {
      const movie = createRadarrMovie({
        movieFile: createRadarrMovieFile({
          quality: {
            quality: createRadarrQuality({
              name: 'WEBDL-1080p',
            }),
          },
        }),
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        21,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe('WEBDL-1080p');
    });

    it('should return null when no movie file exists (quality)', async () => {
      const movie = createRadarrMovie({
        movieFile: undefined,
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        21,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe(null);
    });

    it('should return audio languages', async () => {
      const movie = createRadarrMovie({
        movieFile: createRadarrMovieFile({
          mediaInfo: { audioLanguages: 'eng' } as any,
        }),
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        22,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe('eng');
    });

    it('should return null when no movie file exists (audio)', async () => {
      const movie = createRadarrMovie({
        movieFile: undefined,
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        22,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe(null);
    });

    it('should return null when no media info exists', async () => {
      const movie = createRadarrMovie({
        movieFile: createRadarrMovieFile({
          mediaInfo: undefined,
        }),
      });
      mockRadarrApi(movie);

      const response = await radarrGetterService.get(
        22,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      expect(response).toBe(null);
    });
  });

  describe('diskspace properties', () => {
    let collectionMedia: CollectionMedia;
    let mediaItem: MediaItem;
    let mockedRadarrApi: RadarrApi;

    beforeEach(() => {
      collectionMedia = createCollectionMedia('movie');
      collectionMedia.collection.radarrSettingsId = 1;
      mediaItem = createMediaItem({ type: 'movie' });
      mockedRadarrApi = mockRadarrApi();
    });

    it('should use merged diskspace data for targeted remaining space rules', async () => {
      const getDiskspaceWithRootFoldersSpy = jest
        .spyOn(mockedRadarrApi, 'getDiskspaceWithRootFolders')
        .mockResolvedValue([
          createArrDiskspaceResource({
            path: '/movies',
            freeSpace: 10 * 1073741824,
          }),
          createArrDiskspaceResource({
            path: '/downloads',
            freeSpace: 5 * 1073741824,
          }),
        ]);
      const getDiskspaceSpy = jest.spyOn(mockedRadarrApi, 'getDiskspace');

      const response = await radarrGetterService.get(
        23,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
        createRuleDto({ arrDiskPath: '/movies/' }),
      );

      expect(response).toBe(10);
      expect(getDiskspaceWithRootFoldersSpy).toHaveBeenCalled();
      expect(getDiskspaceSpy).not.toHaveBeenCalled();
    });

    it('should use raw diskspace data for total space rules', async () => {
      const getDiskspaceSpy = jest
        .spyOn(mockedRadarrApi, 'getDiskspace')
        .mockResolvedValue([
          createArrDiskspaceResource({
            path: '/movies',
            totalSpace: 30 * 1073741824,
          }),
        ]);
      const getDiskspaceWithRootFoldersSpy = jest.spyOn(
        mockedRadarrApi,
        'getDiskspaceWithRootFolders',
      );

      const response = await radarrGetterService.get(
        24,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
        createRuleDto({ arrDiskPath: '/movies' }),
      );

      expect(response).toBe(30);
      expect(getDiskspaceSpy).toHaveBeenCalled();
      expect(getDiskspaceWithRootFoldersSpy).not.toHaveBeenCalled();
    });
  });

  describe('cross-reference alternate fallback (#3010)', () => {
    let collectionMedia: CollectionMedia;
    let mediaItem: MediaItem;

    beforeEach(() => {
      collectionMedia = createCollectionMedia('movie');
      collectionMedia.collection.radarrSettingsId = 1;
      mediaItem = createMediaItem({ type: 'movie' });
    });

    it('tries the primary tmdb first; falls back to the alternate when the primary is not in Radarr', async () => {
      metadataService.resolveLookupCandidatesFromMediaItemForService.mockResolvedValue(
        [
          { providerKey: 'tmdb', id: 280331 },
          { providerKey: 'tmdb', id: 306261 },
        ],
      );

      const altMovie = createRadarrMovie({
        movieFile: createRadarrMovieFile({ qualityCutoffNotMet: false }),
      });
      const mockedRadarrApi = new RadarrApi(
        { url: 'http://localhost:7878', apiKey: 'test' },
        logger as any,
      );
      // Radarr collapses both "not in Radarr" and "transport error" to
      // undefined, so findMetadataLookupMatch will advance.
      jest
        .spyOn(mockedRadarrApi, 'getMovieByTmdbId')
        .mockImplementation(async (id: number) =>
          id === 306261 ? altMovie : (undefined as unknown as RadarrMovie),
        );
      servarrService.getRadarrApiClient.mockResolvedValue(mockedRadarrApi);

      const response = await radarrGetterService.get(
        20,
        mediaItem,
        createRulesDto({
          collection: collectionMedia.collection,
          dataType: 'movie',
        }),
      );

      // The cut-off-met value came from the ALTERNATE movie, proving the
      // candidate iteration tried it after the primary returned undefined.
      expect(response).toBe(true);
      expect(mockedRadarrApi.getMovieByTmdbId).toHaveBeenCalledWith(280331);
      expect(mockedRadarrApi.getMovieByTmdbId).toHaveBeenCalledWith(306261);
    });
  });

  const mockRadarrApi = (movie?: RadarrMovie) => {
    const mockedRadarrApi = new RadarrApi(
      { url: 'http://localhost:7878', apiKey: 'test' },
      logger as any,
    );
    const mockedServarrService = new ServarrService({} as any, logger as any);
    jest
      .spyOn(mockedServarrService, 'getRadarrApiClient')
      .mockResolvedValue(mockedRadarrApi);

    if (movie) {
      jest.spyOn(mockedRadarrApi, 'getMovieByTmdbId').mockResolvedValue(movie);
    } else {
      jest
        .spyOn(mockedRadarrApi, 'getMovieByTmdbId')
        .mockImplementation(jest.fn());
    }

    servarrService.getRadarrApiClient.mockResolvedValue(mockedRadarrApi);

    return mockedRadarrApi;
  };
});
