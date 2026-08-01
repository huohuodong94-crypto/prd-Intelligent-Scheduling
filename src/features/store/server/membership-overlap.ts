const MAX_DATE = new Date(8640000000000000);

export function dateRangesOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null
): boolean {
  return aFrom <= (bTo ?? MAX_DATE) && bFrom <= (aTo ?? MAX_DATE);
}
