import { POLICY } from "./policy";
import { addDays } from "./time";
import type { Article } from "./types";

export type ReviewStatus = "current" | "due_soon" | "overdue";

export interface ReviewInfo {
  status: ReviewStatus;
  /** Null only for a published article that has somehow never been reviewed. */
  dueAt: string | null;
  /** Negative once overdue. */
  daysUntilDue: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Where a published article stands against its review interval. Staleness is
 * a condition of published content, not a lifecycle state, so drafts, items in
 * review and retired articles have no review status.
 */
export function reviewInfo(article: Article, now: Date): ReviewInfo | null {
  if (article.state !== "published") return null;
  if (!article.lastReviewedAt) return { status: "overdue", dueAt: null, daysUntilDue: null };

  const dueAt = addDays(article.lastReviewedAt, article.reviewIntervalDays);
  const daysUntilDue = (Date.parse(dueAt) - now.getTime()) / DAY_MS;
  const status: ReviewStatus =
    daysUntilDue < 0 ? "overdue" : daysUntilDue <= POLICY.reviewDueSoonDays ? "due_soon" : "current";
  return { status, dueAt, daysUntilDue };
}

/** Published and past its review date. Stale articles stay live but are flagged. */
export const isStale = (article: Article, now: Date): boolean => reviewInfo(article, now)?.status === "overdue";
