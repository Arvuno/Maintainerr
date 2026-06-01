import {
  findMetadataLookupMatch,
  formatMetadataLookupCandidates,
  MetadataLookupCandidate,
} from './metadata-lookup.util';

describe('formatMetadataLookupCandidates', () => {
  it('formats a single candidate', () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tvdb', id: 202 },
    ];
    expect(formatMetadataLookupCandidates(candidates)).toBe('TVDB:202');
  });

  it('formats multiple candidates comma-separated', () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tmdb', id: 771 },
      { providerKey: 'tvdb', id: 202 },
    ];
    expect(formatMetadataLookupCandidates(candidates)).toBe(
      'TMDB:771, TVDB:202',
    );
  });

  it('returns an empty string for no candidates', () => {
    expect(formatMetadataLookupCandidates([])).toBe('');
  });
});

describe('findMetadataLookupMatch', () => {
  it('returns the first matching candidate', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tmdb', id: 771 },
      { providerKey: 'tvdb', id: 202 },
    ];
    const result = await findMetadataLookupMatch(candidates, {
      tmdb: async (id) => ({ title: 'Movie', tmdbId: id }),
    });
    expect(result).toEqual({
      candidate: { providerKey: 'tmdb', id: 771 },
      result: { title: 'Movie', tmdbId: 771 },
    });
  });

  it('skips candidates with no matching lookup function', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tvdb', id: 202 },
      { providerKey: 'tmdb', id: 771 },
    ];
    const result = await findMetadataLookupMatch(candidates, {
      tmdb: async (id) => ({ title: 'Movie', tmdbId: id }),
    });
    expect(result).toEqual({
      candidate: { providerKey: 'tmdb', id: 771 },
      result: { title: 'Movie', tmdbId: 771 },
    });
  });

  it('skips candidates whose lookup returns undefined', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tmdb', id: 999 },
      { providerKey: 'tvdb', id: 202 },
    ];
    const result = await findMetadataLookupMatch(candidates, {
      tmdb: async () => undefined,
      tvdb: async (id) => ({ title: 'Show', tvdbId: id }),
    });
    expect(result).toEqual({
      candidate: { providerKey: 'tvdb', id: 202 },
      result: { title: 'Show', tvdbId: 202 },
    });
  });

  it('skips candidates whose lookup throws', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tmdb', id: 771 },
      { providerKey: 'tvdb', id: 202 },
    ];
    const result = await findMetadataLookupMatch(candidates, {
      tmdb: async () => {
        throw new Error('API down');
      },
      tvdb: async (id) => ({ title: 'Show', tvdbId: id }),
    });
    expect(result).toEqual({
      candidate: { providerKey: 'tvdb', id: 202 },
      result: { title: 'Show', tvdbId: 202 },
    });
  });

  it('returns undefined when no candidate matches', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tmdb', id: 771 },
    ];
    const result = await findMetadataLookupMatch(candidates, {
      tmdb: async () => undefined,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty candidates', async () => {
    const result = await findMetadataLookupMatch([], {
      tmdb: async (id) => ({ id }),
    });
    expect(result).toBeUndefined();
  });

  // The Sonarr/Radarr getters and #3010 alternate fallback depend on the
  // three-state contract: undefined skips, null is a confirmed miss (kept as
  // a fallback so the caller's fail-closed vs not-tracked distinction is
  // preserved), and a real value wins immediately if seen.
  it('advances past a null primary and surfaces a later hit (alternate fallback)', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tvdb', id: 280331 },
      { providerKey: 'tvdb', id: 306261 },
    ];
    const result = await findMetadataLookupMatch<{ tvdbId: number } | null>(
      candidates,
      {
        tvdb: async (id) => (id === 280331 ? null : { tvdbId: id }),
      },
    );
    expect(result).toEqual({
      candidate: { providerKey: 'tvdb', id: 306261 },
      result: { tvdbId: 306261 },
    });
  });

  it('returns the first remembered null when no later candidate hits', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tvdb', id: 1 },
      { providerKey: 'tvdb', id: 2 },
    ];
    const result = await findMetadataLookupMatch<{ tvdbId: number } | null>(
      candidates,
      { tvdb: async () => null },
    );
    expect(result).toEqual({
      candidate: { providerKey: 'tvdb', id: 1 },
      result: null,
    });
  });

  it('returns undefined when all candidates fail (no null seen)', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tvdb', id: 1 },
      { providerKey: 'tvdb', id: 2 },
    ];
    const result = await findMetadataLookupMatch<{ tvdbId: number } | null>(
      candidates,
      { tvdb: async () => undefined },
    );
    expect(result).toBeUndefined();
  });

  it('prefers an explicit null over later undefineds for the caller-facing remembered miss', async () => {
    const candidates: MetadataLookupCandidate[] = [
      { providerKey: 'tvdb', id: 1 },
      { providerKey: 'tvdb', id: 2 },
    ];
    const result = await findMetadataLookupMatch<{ tvdbId: number } | null>(
      candidates,
      { tvdb: async (id) => (id === 1 ? null : undefined) },
    );
    expect(result).toEqual({
      candidate: { providerKey: 'tvdb', id: 1 },
      result: null,
    });
  });
});
