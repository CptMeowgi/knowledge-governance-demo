/**
 * The governance report. Every figure is calculated from the stored data; none
 * is entered by hand. Rates are null when there's nothing to measure, so the
 * report never shows a reassuring 100% for an empty denominator.
 */

import { articleOwnershipIssues, sectionOwnershipIssues } from "./ownership";
import { POLICY } from "./policy";
import { isStale } from "./review";
import { daysSince, isWithinDays } from "./time";
import { isFailedSearch, searchesWithin, usageByArticle } from "./usage";
import type { Article, ArticleState, FeedbackEvent, KnowledgeBase } from "./types";

export interface Report {
  /** Searches where something useful was found and opened, last 30 days. */
  searchSuccess: { searches: number; successful: number; rate: number | null };
  /** Published articles past their review date. */
  staleness: { published: number; overdue: number; share: number | null };
  /** Articles and sections without active ownership. */
  ownership: { articles: number; articlesWithIssues: number; sections: number; sectionsWithoutOwner: number };
  /** Share of ratings that were "helpful", last 30 days. */
  helpfulness: { ratings: number; helpful: number; rate: number | null };
  /** Published long enough to judge, but nobody has read it in that time. Retirement candidates. */
  deadContent: { eligible: number; dead: number; share: number | null };
  /** How concentrated reading is: the share of views served by the most-read articles. */
  reuse: { views: number; topArticles: number; topShare: number | null };
  /** Where content sits in the lifecycle, and how long the oldest item has waited for a reviewer. */
  pipeline: Record<ArticleState, number> & { revisionsInReview: number; oldestInReviewDays: number | null };
}

const rate = (part: number, whole: number) => (whole ? part / whole : null);

/** When the article first went live, from its history. */
export const firstPublishedAt = (article: Article): string | null =>
  article.history.find((entry) => entry.to === "published" && !entry.revision)?.at ?? null;

/** When the content now in review was submitted. */
function submittedAt(article: Article): string | null {
  const isRevision = article.state === "published";
  const submissions = article.history.filter((entry) => entry.action === "submit" && !!entry.revision === isRevision);
  return submissions.at(-1)?.at ?? null;
}

export function buildReport(kb: KnowledgeBase, now: Date): Report {
  const window = POLICY.gapWindowDays;
  const published = kb.articles.filter((article) => article.state === "published");
  const live = kb.articles.filter((article) => article.state !== "retired");

  const searches = searchesWithin(kb, now, window);
  const successful = searches.filter((search) => !isFailedSearch(search)).length;

  const overdue = published.filter((article) => isStale(article, now)).length;

  const feedback = kb.events.filter(
    (event): event is FeedbackEvent => event.kind === "feedback" && isWithinDays(event.at, now, window),
  );
  const helpful = feedback.filter((event) => event.helpful).length;

  const longTermUsage = usageByArticle(kb.events, now, POLICY.deadContentDays);
  const eligible = published.filter((article) => {
    const since = firstPublishedAt(article);
    return !since || daysSince(since, now) > POLICY.deadContentDays;
  });
  const dead = eligible.filter((article) => !longTermUsage.get(article.id)?.views).length;

  const recentUsage = usageByArticle(kb.events, now, window);
  const viewCounts = published.map((article) => recentUsage.get(article.id)?.views ?? 0).sort((a, b) => b - a);
  const totalViews = viewCounts.reduce((sum, count) => sum + count, 0);
  const topArticles = published.length ? Math.max(1, Math.ceil(published.length * POLICY.reuseTopShare)) : 0;
  const topViews = viewCounts.slice(0, topArticles).reduce((sum, count) => sum + count, 0);

  const waiting = kb.articles.filter(
    (article) => article.state === "in_review" || (article.state === "published" && article.revision?.state === "in_review"),
  );
  const waits = waiting.map(submittedAt).filter((at): at is string => !!at).map((at) => daysSince(at, now));

  const count = (state: ArticleState) => kb.articles.filter((article) => article.state === state).length;

  return {
    searchSuccess: { searches: searches.length, successful, rate: rate(successful, searches.length) },
    staleness: { published: published.length, overdue, share: rate(overdue, published.length) },
    ownership: {
      articles: live.length,
      articlesWithIssues: live.filter((article) => articleOwnershipIssues(article, kb).length).length,
      sections: kb.sections.length,
      sectionsWithoutOwner: kb.sections.filter((section) => sectionOwnershipIssues(section, kb).length).length,
    },
    helpfulness: { ratings: feedback.length, helpful, rate: rate(helpful, feedback.length) },
    deadContent: { eligible: eligible.length, dead, share: rate(dead, eligible.length) },
    reuse: { views: totalViews, topArticles, topShare: rate(topViews, totalViews) },
    pipeline: {
      draft: count("draft"),
      in_review: count("in_review"),
      published: count("published"),
      retired: count("retired"),
      revisionsInReview: waiting.filter((article) => article.state === "published").length,
      oldestInReviewDays: waits.length ? Math.max(...waits) : null,
    },
  };
}
