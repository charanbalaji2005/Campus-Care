// ------------------------------------------------------------------ location quality

/**
 * How trustworthy a location fix is for campus-level dispatch. The thresholds are configurable
 * heuristics based on the accuracy radius the device reports (68% confidence on Android) — they
 * are not guarantees of real-world device performance or a GPS standard.
 */
export const LOCATION_QUALITIES = ['high', 'usable', 'low', 'poor', 'stale', 'unknown'] as const;
export type LocationQuality = (typeof LOCATION_QUALITIES)[number];

export const LOCATION_QUALITY_LABELS: Record<LocationQuality, string> = {
  high: 'High confidence',
  usable: 'Approximate',
  low: 'Low confidence',
  poor: 'Poor signal',
  stale: 'Stale',
  unknown: 'Accuracy unknown',
};

export interface LocationQualityThresholds {
  /** Up to this radius (m): high-quality fix. */
  highMaxMeters: number;
  /** Up to this radius: usable, shown with its uncertainty. */
  usableMaxMeters: number;
  /** Up to this radius: low confidence; keep acquiring. Above it: poor for precise dispatch. */
  lowMaxMeters: number;
}

export const DEFAULT_LOCATION_QUALITY_THRESHOLDS: LocationQualityThresholds = { highMaxMeters: 15, usableMaxMeters: 40, lowMaxMeters: 100 };

/** How old a fix may be before it is labelled stale, per use. SOS needs the freshest position. */
export const LOCATION_STALE_SECONDS = { sos: 60, share: 120, report: 600 } as const;

/** Location history kept for an SOS response (auditable), and the cap on points per subject. */
export const SOS_LOCATION_HISTORY_DAYS = 30;
export const MAX_LOCATION_POINTS_PER_SUBJECT = 2000;

export function classifyLocationQuality(
  fix: { accuracyMeters?: number | null; ageSeconds?: number | null },
  opts: { staleSeconds: number; thresholds?: LocationQualityThresholds },
): LocationQuality {
  const t = opts.thresholds ?? DEFAULT_LOCATION_QUALITY_THRESHOLDS;
  if (fix.ageSeconds != null && fix.ageSeconds > opts.staleSeconds) return 'stale';
  const acc = fix.accuracyMeters;
  if (acc == null || !Number.isFinite(acc) || acc <= 0) return 'unknown';
  if (acc <= t.highMaxMeters) return 'high';
  if (acc <= t.usableMaxMeters) return 'usable';
  if (acc <= t.lowMaxMeters) return 'low';
  return 'poor';
}

/**
 * Decimal places worth showing for a coordinate with this uncertainty, so we never display more
 * precision than the measurement supports (1e-5° ≈ 1.1 m of latitude). Between 3 and 6 places.
 */
export function coordinateDecimals(accuracyMeters?: number | null): number {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 4;
  const d = Math.ceil(Math.log10(111_320 / accuracyMeters));
  return Math.min(6, Math.max(3, d));
}

export function formatCoordinate(latitude: number, longitude: number, accuracyMeters?: number | null): string {
  const d = coordinateDecimals(accuracyMeters);
  return `${latitude.toFixed(d)}, ${longitude.toFixed(d)}`;
}
