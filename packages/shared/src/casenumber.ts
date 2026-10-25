/** CC-2026-000142 — generated on the server from an atomic counter. */
export function formatCaseNumber(year: number, sequence: number): string {
  return `CC-${year}-${String(sequence).padStart(6, '0')}`;
}

export const CASE_NUMBER_PATTERN = /^CC-\d{4}-\d{6}$/;

export function formatSosNumber(year: number, sequence: number): string {
  return `SOS-${year}-${String(sequence).padStart(5, '0')}`;
}
