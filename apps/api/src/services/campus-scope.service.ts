/**
 * Campus scope of an administrator. Super Admins see every campus (null). A Campus Admin sees the
 * campuses in `managedCampuses` plus their own `campusZone`; with neither set, the default campus
 * ("main", which is also where accounts without a campus belong). Enforced on the server for every
 * campus-scoped endpoint; the client never chooses its own scope.
 */
export const DEFAULT_CAMPUS = 'main';

export function campusScopeOf(user: { role: string; campusZone?: string | null; managedCampuses?: string[] | null }): string[] | null {
  if (user.role === 'super_admin') return null;
  const scope = [...new Set([...(user.managedCampuses ?? []), ...(user.campusZone ? [user.campusZone] : [])].map((c) => c.trim()).filter(Boolean))];
  return scope.length ? scope : [DEFAULT_CAMPUS];
}

/** A record's campus: the person's campusZone when it is a configured campus id, else the default campus. */
export function knownCampus(zone: string | null | undefined, campusIds: string[]): string {
  return zone && campusIds.includes(zone) ? zone : DEFAULT_CAMPUS;
}

export function inCampusScope(scope: string[] | null, campus: string | null | undefined): boolean {
  return scope === null || scope.includes(campus || DEFAULT_CAMPUS);
}

/** Mongo filter on User.campusZone for a scope (accounts with no campus count as the default campus). */
export function userCampusFilter(scope: string[] | null): Record<string, unknown> {
  if (scope === null) return {};
  return scope.includes(DEFAULT_CAMPUS)
    ? { $or: [{ campusZone: { $in: scope } }, { campusZone: null }, { campusZone: '' }] }
    : { campusZone: { $in: scope } };
}
