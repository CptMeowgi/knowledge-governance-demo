const DAY_MS = 86_400_000;

export const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(iso) + days * DAY_MS).toISOString();

/** Whole and fractional days from `iso` until `now`. Negative if `iso` is in the future. */
export const daysSince = (iso: string, now: Date): number =>
  (now.getTime() - Date.parse(iso)) / DAY_MS;

/** True if `iso` falls within the last `days` days, counting back from `now`. */
export const isWithinDays = (iso: string, now: Date, days: number): boolean => {
  const age = daysSince(iso, now);
  return age >= 0 && age <= days;
};
