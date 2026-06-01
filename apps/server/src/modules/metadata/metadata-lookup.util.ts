export interface MetadataLookupCandidate {
  providerKey: string;
  id: number;
}

export function formatMetadataLookupCandidates(
  lookupCandidates: MetadataLookupCandidate[],
): string {
  return lookupCandidates
    .map(
      (candidate) => `${candidate.providerKey.toUpperCase()}:${candidate.id}`,
    )
    .join(', ');
}

// Three-state lookup result semantics (e.g. SonarrApi.getSeriesByTvdbId):
//   - non-null/defined value → hit, return immediately
//   - null → "confirmed not tracked"; remember it but keep iterating in case a
//     later candidate (e.g. a cross-reference alternate from issue #3010) is a
//     real hit. If none is, surface the remembered null so the caller can keep
//     distinguishing "definitively missing" from "transport failure" (the
//     fail-closed semantic Sonarr/Radarr getters rely on).
//   - undefined / throw → advance to the next candidate.
export async function findMetadataLookupMatch<T>(
  lookupCandidates: MetadataLookupCandidate[],
  lookups: Record<string, (id: number) => Promise<T | undefined>>,
): Promise<{ candidate: MetadataLookupCandidate; result: T } | undefined> {
  let confirmedMiss:
    | { candidate: MetadataLookupCandidate; result: T }
    | undefined;

  for (const candidate of lookupCandidates) {
    const lookup = lookups[candidate.providerKey];

    if (!lookup) {
      continue;
    }

    try {
      const result = await lookup(candidate.id);
      if (result === undefined) continue;
      if (result === null) {
        confirmedMiss ??= { candidate, result };
        continue;
      }
      return { candidate, result };
    } catch {
      continue;
    }
  }

  return confirmedMiss;
}
