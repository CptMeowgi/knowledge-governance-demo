/**
 * Turns the declarative seed (seed.json) into a working knowledge base.
 *
 * Every date in the seed is relative ("published 415 days ago"), resolved
 * against the moment the demo is opened. Otherwise the demo itself would go
 * stale a few months after launch, which is the problem it exists to show.
 *
 * Usage events are expanded from short per-article profiles ("about four
 * views a day, about half rated helpful"). The expansion is deterministic:
 * proportions are spread evenly rather than rolled at random, so the same
 * seed always tells the same story. Searches are run through the real search
 * engine, so the event log and the search logic can't disagree.
 */

import { searchArticles } from "../domain/search";
import type {
  Article,
  ArticleState,
  ArticleType,
  Body,
  FeedbackReason,
  GapTriage,
  GlossaryTerm,
  HistoryEntry,
  KnowledgeBase,
  Person,
  RetirementReason,
  Section,
  UsageEvent,
} from "../domain/types";
import seedJson from "./seed.json";

interface SeedUsage {
  viewsPerDay: number;
  ratingsPerView: number;
  helpfulShare: number;
  reasons: FeedbackReason[];
  complaints: string[];
}

interface SeedArticle {
  id: string;
  sectionId: string;
  type: ArticleType;
  state: ArticleState;
  title: string;
  body: Body;
  authorId: string;
  ownerId: string | null;
  reviewerId: string | null;
  reviewIntervalDays: number;
  createdDaysAgo: number;
  publishedDaysAgo?: number;
  reviewedDaysAgo?: number;
  submittedDaysAgo?: number;
  revision?: { title: string; body: Body; authorId: string; state: "draft" | "in_review"; startedDaysAgo: number; submittedDaysAgo?: number };
  retirement?: { reason: RetirementReason; supersededBy?: string; note?: string; retiredDaysAgo: number };
  usage?: SeedUsage;
}

interface SeedFile {
  people: Person[];
  sections: Section[];
  glossary: GlossaryTerm[];
  articles: SeedArticle[];
  searches: { query: string; perWeek: number; openRate: number }[];
  triage: (Omit<GapTriage, "at"> & { daysAgo: number })[];
}

// JSON imports are typed loosely, so the cast goes via unknown. seed.test.ts checks the real shape.
const seed = seedJson as unknown as SeedFile;

/** How much usage history the demo starts with. Long enough to judge dead content. */
export const HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;

/** Small seeded PRNG (mulberry32). Only used for times of day and minor variety. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** True for exactly `share` of items, spread evenly: item k is chosen when the running total crosses a whole number. */
const chosen = (k: number, share: number) => Math.floor((k + 1) * share) > Math.floor(k * share);

/**
 * Timestamps for something that happens `perDay` times a day on average,
 * busier on weekdays than weekends, over the last `days` days. Never in the future.
 */
function schedule(perDay: number, days: number, now: Date, rand: () => number): string[] {
  const times: string[] = [];
  let carry = 0;
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    const day = new Date(now.getTime() - daysAgo * DAY_MS);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    carry += perDay * (weekend ? 0.375 : 1.25); // averages back to perDay over a week
    while (carry >= 1) {
      carry -= 1;
      const offset = 5 * 60_000 + rand() * 10 * 3_600_000; // within the ten hours before this point
      times.push(new Date(day.getTime() - offset).toISOString());
    }
  }
  return times.sort();
}

function buildArticle(source: SeedArticle, now: Date): Article {
  const at = (daysAgo: number, minutes = 0) => new Date(now.getTime() - daysAgo * DAY_MS + minutes * 60_000).toISOString();
  const history: HistoryEntry[] = [
    { at: at(source.createdDaysAgo), actorId: source.authorId, action: "create", from: null, to: "draft" },
  ];

  if (source.state === "in_review" && source.submittedDaysAgo !== undefined) {
    history.push({ at: at(source.submittedDaysAgo), actorId: source.authorId, action: "submit", from: "draft", to: "in_review" });
  }

  if (source.publishedDaysAgo !== undefined && source.reviewerId) {
    history.push(
      { at: at(source.publishedDaysAgo + 1), actorId: source.authorId, action: "submit", from: "draft", to: "in_review" },
      { at: at(source.publishedDaysAgo), actorId: source.reviewerId, action: "approve", from: "in_review", to: "published" },
    );
    if (source.reviewedDaysAgo !== undefined && source.reviewedDaysAgo < source.publishedDaysAgo) {
      history.push({ at: at(source.reviewedDaysAgo), actorId: source.reviewerId, action: "recertify", from: "published", to: "published" });
    }
  }

  const { revision, retirement } = source;
  if (revision) {
    history.push({ at: at(revision.startedDaysAgo), actorId: revision.authorId, action: "edit", from: "draft", to: "draft", revision: true });
    if (revision.submittedDaysAgo !== undefined) {
      history.push({ at: at(revision.submittedDaysAgo), actorId: revision.authorId, action: "submit", from: "draft", to: "in_review", revision: true });
    }
  }
  if (retirement && source.ownerId) {
    history.push({ at: at(retirement.retiredDaysAgo), actorId: source.ownerId, action: "retire", from: "published", to: "retired", note: retirement.note });
  }

  const article: Article = {
    id: source.id,
    sectionId: source.sectionId,
    type: source.type,
    title: source.title,
    body: source.body,
    state: source.state,
    authorId: source.authorId,
    ownerId: source.ownerId,
    reviewerId: source.reviewerId,
    reviewIntervalDays: source.reviewIntervalDays,
    lastReviewedAt: source.reviewedDaysAgo !== undefined ? at(source.reviewedDaysAgo) : null,
    history: history.sort((a, b) => a.at.localeCompare(b.at)),
  };
  if (revision) {
    article.revision = {
      title: revision.title,
      body: revision.body,
      authorId: revision.authorId,
      state: revision.state,
      startedAt: at(revision.startedDaysAgo),
    };
  }
  if (retirement) {
    article.retirement = { reason: retirement.reason, supersededBy: retirement.supersededBy, note: retirement.note };
  }
  return article;
}

function buildEvents(kb: KnowledgeBase, now: Date): UsageEvent[] {
  const rand = random(20_260_401);
  const events: UsageEvent[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;
  const minuteAfter = (iso: string) => new Date(Date.parse(iso) + 60_000).toISOString();

  // People browsing straight to articles, and rating some of what they read.
  for (const source of seed.articles) {
    const usage = source.usage;
    if (!usage) continue;
    const views = schedule(usage.viewsPerDay, HISTORY_DAYS, now, rand);
    let ratings = 0;
    let unhelpful = 0;
    views.forEach((at, k) => {
      events.push({ kind: "view", id: nextId("v"), at, articleId: source.id, via: "browse" });
      if (!chosen(k, usage.ratingsPerView)) return;
      const helpful = chosen(ratings++, usage.helpfulShare);
      if (helpful) {
        events.push({ kind: "feedback", id: nextId("f"), at: minuteAfter(at), articleId: source.id, helpful: true });
        return;
      }
      const reason = usage.reasons.length ? usage.reasons[unhelpful % usage.reasons.length] : undefined;
      // Every other complaint comes with a comment, cycling through the seed's comments.
      const comment = unhelpful % 2 === 0 && usage.complaints.length ? usage.complaints[(unhelpful / 2) % usage.complaints.length] : undefined;
      unhelpful++;
      events.push({ kind: "feedback", id: nextId("f"), at: minuteAfter(at), articleId: source.id, helpful: false, reason, comment });
    });
  }

  // Searches, run through the real search engine. Opening a result also counts as a view.
  for (const profile of seed.searches) {
    const resultIds = searchArticles(kb, profile.query);
    schedule(profile.perWeek / 7, HISTORY_DAYS, now, rand).forEach((at, k) => {
      const clickedId = resultIds.length && chosen(k, profile.openRate) ? resultIds[0] : null;
      events.push({ kind: "search", id: nextId("s"), at, query: profile.query, resultIds, clickedId });
      if (clickedId) events.push({ kind: "view", id: nextId("v"), at: minuteAfter(at), articleId: clickedId, via: "search" });
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/** A fresh copy of the demo knowledge base, with every relative date resolved against `now`. */
export function buildSeed(now: Date = new Date()): KnowledgeBase {
  const kb: KnowledgeBase = {
    people: seed.people.map((person) => ({ ...person })),
    sections: seed.sections.map((section) => ({ ...section })),
    glossary: seed.glossary.map((term) => ({ ...term, avoid: [...term.avoid] })),
    articles: seed.articles.map((article) => buildArticle(article, now)),
    events: [],
    triage: seed.triage.map(({ daysAgo, ...record }) => ({
      ...record,
      at: new Date(now.getTime() - daysAgo * DAY_MS).toISOString(),
    })),
  };
  kb.events = buildEvents(kb, now);
  return kb;
}

/** The person the demo starts as: the knowledge manager, who can see the whole framework. */
export const DEFAULT_ACTOR_ID = "kim";
