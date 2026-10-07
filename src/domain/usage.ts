import { isWithinDays } from "./time";
import type { FeedbackReason, KnowledgeBase, SearchEvent, UsageEvent } from "./types";

export interface ArticleUsage {
  views: number;
  ratings: number;
  helpful: number;
  notHelpful: number;
  /** How often each reason was given with a "not helpful" rating. */
  reasons: Partial<Record<FeedbackReason, number>>;
  /** Comments left with "not helpful" ratings, newest first. */
  complaints: string[];
}

export const emptyUsage = (): ArticleUsage => ({ views: 0, ratings: 0, helpful: 0, notHelpful: 0, reasons: {}, complaints: [] });

/** Views and feedback per article over the last `days` days. */
export function usageByArticle(events: readonly UsageEvent[], now: Date, days: number): Map<string, ArticleUsage> {
  const usage = new Map<string, ArticleUsage>();
  const forArticle = (id: string) => {
    let entry = usage.get(id);
    if (!entry) usage.set(id, (entry = emptyUsage()));
    return entry;
  };
  const recent = events.filter((event) => isWithinDays(event.at, now, days)).sort((a, b) => b.at.localeCompare(a.at));

  for (const event of recent) {
    if (event.kind === "view") forArticle(event.articleId).views++;
    if (event.kind !== "feedback") continue;
    const entry = forArticle(event.articleId);
    entry.ratings++;
    if (event.helpful) {
      entry.helpful++;
      continue;
    }
    entry.notHelpful++;
    if (event.reason) entry.reasons[event.reason] = (entry.reasons[event.reason] ?? 0) + 1;
    if (event.comment?.trim()) entry.complaints.push(event.comment.trim());
  }
  return usage;
}

/** The most common reason given for "not helpful", if any. */
export function topReason(usage: ArticleUsage): FeedbackReason | null {
  const ranked = Object.entries(usage.reasons).sort(([, a], [, b]) => b - a);
  return (ranked[0]?.[0] as FeedbackReason | undefined) ?? null;
}

/** A search failed the person if it found nothing, or nothing it found was worth opening. */
export const isFailedSearch = (search: SearchEvent): boolean =>
  search.resultIds.length === 0 || search.clickedId === null;

export const searchesWithin = (kb: KnowledgeBase, now: Date, days: number): SearchEvent[] =>
  kb.events.filter((event): event is SearchEvent => event.kind === "search" && isWithinDays(event.at, now, days));
