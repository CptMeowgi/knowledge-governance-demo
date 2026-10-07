/**
 * Gap detection. A gap is never entered by hand: it's calculated from what
 * people searched for, read and rated. Every gap carries its evidence and is
 * ranked by one unit, the estimated number of people it failed recently.
 */

import { canonicalize } from "./glossary";
import { POLICY } from "./policy";
import { reviewInfo } from "./review";
import { keywords } from "./search";
import { emptyUsage, isFailedSearch, searchesWithin, topReason, usageByArticle } from "./usage";
import type { FeedbackReason, GapTriage, KnowledgeBase, SearchEvent } from "./types";

export interface SearchGap {
  key: string;
  kind: "unmet_search";
  /** The most common phrasing in the group, in the words people actually used. */
  label: string;
  peopleFailed: number;
  evidence: {
    searches: number;
    failed: number;
    zeroResults: number;
    /** Every canonical query in the group, used to match triage records. */
    queries: string[];
    /** The most common phrasings as typed, most frequent first. */
    phrasings: { text: string; count: number }[];
  };
}

export type ArticleSignal = "low_helpfulness" | "high_traffic_poor_outcome" | "high_traffic_overdue";

export interface ArticleGap {
  key: string;
  kind: "article";
  articleId: string;
  sectionId: string;
  peopleFailed: number;
  signals: ArticleSignal[];
  evidence: {
    views: number;
    ratings: number;
    /** Null below the minimum number of ratings: too few to judge. */
    helpfulRate: number | null;
    topReason: FeedbackReason | null;
    complaints: string[];
  };
}

export type Gap = SearchGap | ArticleGap;

/** Unmet searches and struggling articles, most people failed first. */
export function detectGaps(kb: KnowledgeBase, now: Date): Gap[] {
  return [...searchGaps(kb, now), ...articleGaps(kb, now)].sort(
    (a, b) => b.peopleFailed - a.peopleFailed || a.key.localeCompare(b.key),
  );
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const shared = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union ? shared / union : 0;
}

interface SearchGroup {
  label: string;
  keywords: Set<string>;
  queries: string[];
  searches: SearchEvent[];
}

/**
 * Groups searches that ask for the same thing in different words. The most
 * frequent phrasing seeds each group, and a phrasing joins a group when their
 * keywords overlap enough.
 */
function groupSearches(searches: SearchEvent[], kb: KnowledgeBase): SearchGroup[] {
  const byQuery = new Map<string, SearchEvent[]>();
  for (const search of searches) {
    const query = canonicalize(search.query, kb.glossary);
    if (keywords(query, kb.glossary).length) byQuery.set(query, [...(byQuery.get(query) ?? []), search]);
  }

  const mostFrequentFirst = [...byQuery].sort(([qa, a], [qb, b]) => b.length - a.length || qa.localeCompare(qb));
  const groups: SearchGroup[] = [];
  for (const [query, events] of mostFrequentFirst) {
    const words = new Set(keywords(query, kb.glossary));
    const group = groups.find((g) => jaccard(g.keywords, words) >= POLICY.searchClusterSimilarity);
    if (group) {
      group.queries.push(query);
      group.searches.push(...events);
    } else {
      groups.push({ label: query, keywords: words, queries: [query], searches: [...events] });
    }
  }
  return groups;
}

function topPhrasings(searches: SearchEvent[], limit: number): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { query } of searches) {
    const text = query.trim().toLowerCase();
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts]
    .sort(([ta, a], [tb, b]) => b - a || ta.localeCompare(tb))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

function searchGaps(kb: KnowledgeBase, now: Date): SearchGap[] {
  return groupSearches(searchesWithin(kb, now, POLICY.gapWindowDays), kb).flatMap((group): SearchGap[] => {
    const failed = group.searches.filter(isFailedSearch).length;
    if (failed < POLICY.minFailedSearches || failed / group.searches.length < POLICY.minSearchFailureRate) return [];
    return [
      {
        key: `search:${group.label}`,
        kind: "unmet_search",
        label: group.label,
        peopleFailed: failed,
        evidence: {
          searches: group.searches.length,
          failed,
          zeroResults: group.searches.filter((s) => s.resultIds.length === 0).length,
          queries: group.queries,
          phrasings: topPhrasings(group.searches, 5),
        },
      },
    ];
  });
}

/** The value at quantile `q` of an ascending list, rounding up so "top quartile" means the top quarter. */
function quantile(ascending: number[], q: number): number {
  if (!ascending.length) return Infinity;
  return ascending[Math.ceil(q * (ascending.length - 1))];
}

function articleGaps(kb: KnowledgeBase, now: Date): ArticleGap[] {
  const usage = usageByArticle(kb.events, now, POLICY.gapWindowDays);
  const published = kb.articles.filter((article) => article.state === "published");
  const viewCounts = published.map((article) => usage.get(article.id)?.views ?? 0).sort((a, b) => a - b);
  const highTrafficFrom = Math.max(quantile(viewCounts, POLICY.highTrafficQuantile), POLICY.minViewsForHighTraffic);

  return published.flatMap((article): ArticleGap[] => {
    const stats = usage.get(article.id) ?? emptyUsage();
    const helpfulRate = stats.ratings >= POLICY.minRatings ? stats.helpful / stats.ratings : null;
    const highTraffic = stats.views >= highTrafficFrom;

    const signals: ArticleSignal[] = [];
    if (helpfulRate !== null && helpfulRate < POLICY.lowHelpfulRate) signals.push("low_helpfulness");
    if (highTraffic && helpfulRate !== null && helpfulRate < POLICY.highTrafficHelpfulRate) signals.push("high_traffic_poor_outcome");
    if (highTraffic && reviewInfo(article, now)?.status === "overdue") signals.push("high_traffic_overdue");
    if (!signals.length) return [];

    // Readers failed = views x share unhelpful, never less than the explicit "not helpful" count.
    // With too few ratings to judge, there's risk but no evidence of failure yet.
    const peopleFailed =
      helpfulRate === null ? 0 : Math.max(stats.notHelpful, Math.round(stats.views * (1 - helpfulRate)));

    return [
      {
        key: `article:${article.id}`,
        kind: "article",
        articleId: article.id,
        sectionId: article.sectionId,
        peopleFailed,
        signals,
        evidence: {
          views: stats.views,
          ratings: stats.ratings,
          helpfulRate,
          topReason: topReason(stats),
          complaints: stats.complaints.slice(0, 3),
        },
      },
    ];
  });
}

// --- Handling gaps --------------------------------------------------------

export type GapStatus = "open" | "in_progress" | "resolved" | "dismissed";

export interface GapView {
  gap: Gap;
  status: GapStatus;
  triage?: GapTriage;
  /** A dismissed gap whose evidence has since grown enough to reopen it. */
  reopened: boolean;
}

/** Finds a gap's triage record. Search gaps match on any query in the group, so they survive relabelling. */
export function triageFor(gap: Gap, triage: readonly GapTriage[]): GapTriage | undefined {
  const keys = new Set([gap.key, ...(gap.kind === "unmet_search" ? gap.evidence.queries.map((q) => `search:${q}`) : [])]);
  return triage.find((record) => keys.has(record.gapKey));
}

/**
 * Where a gap stands. Open and resolved are calculated: a gap is resolved once
 * its linked article has been approved after work started, and a dismissed gap
 * reopens on its own if the evidence has grown enough since dismissal.
 */
export function gapStatus(gap: Gap, kb: KnowledgeBase): GapView {
  const record = triageFor(gap, kb.triage);
  if (!record) return { gap, status: "open", reopened: false };

  if (record.status === "dismissed") {
    const baseline = Math.max(1, record.peopleFailedAtDismissal ?? 0);
    const reopened = gap.peopleFailed >= baseline * POLICY.reopenDismissedAtMultiple;
    return { gap, status: reopened ? "open" : "dismissed", triage: record, reopened };
  }

  const linked = kb.articles.find((article) => article.id === record.linkedArticleId);
  const approvedSinceStart = linked?.history.some((entry) => entry.action === "approve" && entry.at > record.at);
  const resolved = linked?.state === "published" && approvedSinceStart;
  return { gap, status: resolved ? "resolved" : "in_progress", triage: record, reopened: false };
}

export type TriageResult = { ok: true; triage: GapTriage[] } | { ok: false; reasons: string[] };

const replaceRecord = (triage: readonly GapTriage[], gap: Gap, record: GapTriage): GapTriage[] => {
  const existing = triageFor(gap, triage);
  return [...triage.filter((r) => r !== existing), record];
};

/**
 * Marks a gap as being worked on. Article gaps link to their own article by
 * default; search gaps are linked once a draft has been created for them.
 */
export function startWork(
  gap: Gap,
  kb: KnowledgeBase,
  input: { assigneeId: string; linkedArticleId?: string },
  now: Date,
): TriageResult {
  const assignee = kb.people.find((p) => p.id === input.assigneeId);
  if (!assignee) return { ok: false, reasons: ["Pick someone to work on it."] };
  if (!assignee.active) return { ok: false, reasons: [`${assignee.name} has left.`] };
  const linkedArticleId = input.linkedArticleId ?? (gap.kind === "article" ? gap.articleId : undefined);
  return {
    ok: true,
    triage: replaceRecord(kb.triage, gap, {
      gapKey: gap.key,
      status: "in_progress",
      at: now.toISOString(),
      assigneeId: assignee.id,
      linkedArticleId,
    }),
  };
}

/** Dismisses a gap with a reason. It reopens if its evidence later doubles. */
export function dismissGap(gap: Gap, kb: KnowledgeBase, note: string, now: Date): TriageResult {
  if (!note.trim()) return { ok: false, reasons: ["Say why this isn't worth acting on."] };
  return {
    ok: true,
    triage: replaceRecord(kb.triage, gap, {
      gapKey: gap.key,
      status: "dismissed",
      at: now.toISOString(),
      note: note.trim(),
      peopleFailedAtDismissal: gap.peopleFailed,
    }),
  };
}

/** Clears any triage, putting the gap back in the open queue. */
export const reopenGap = (gap: Gap, kb: KnowledgeBase): GapTriage[] => {
  const existing = triageFor(gap, kb.triage);
  return kb.triage.filter((record) => record !== existing);
};
