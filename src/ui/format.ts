const DAY_MS = 86_400_000;

export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** A rate as a whole percentage, or a dash when there's nothing to measure. */
export const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "today", "3 days ago", "in 8 days". */
export function relativeDays(iso: string, now: Date): string {
  const days = Math.round((Date.parse(iso) - now.getTime()) / DAY_MS);
  if (days === 0) return "today";
  return days > 0 ? `in ${plural(days, "day")}` : `${plural(-days, "day")} ago`;
}

export const daysAgo = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));
