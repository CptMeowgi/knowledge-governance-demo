/**
 * A tiny, fixed knowledge base for tests. Every name is invented.
 * Tests run against a frozen clock so dates never drift.
 */
import type { ActionContext } from "../domain/lifecycle";
import type { Article, FeedbackEvent, KnowledgeBase, Person, SearchEvent, Section, ViewEvent } from "../domain/types";

export const NOW = new Date("2026-06-01T12:00:00.000Z");
const DAY_MS = 86_400_000;
export const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

export const people: Person[] = [
  { id: "ava", name: "Ava Lindqvist", title: "Service Desk Analyst", active: true, role: "contributor" },
  { id: "omar", name: "Omar Haddad", title: "Service Desk Lead", active: true, role: "contributor" },
  { id: "rui", name: "Rui Costa", title: "Senior Analyst", active: true, role: "contributor" },
  { id: "kim", name: "Kim Osei", title: "Knowledge Manager", active: true, role: "knowledge_manager" },
  { id: "lee", name: "Lee Moran", title: "Analyst (left)", active: false, role: "contributor" },
];

export const section: Section = {
  id: "accounts",
  name: "Accounts & Access",
  description: "Signing in, passwords and permissions.",
  ownerId: "omar",
  defaultReviewerId: "rui",
};

/** A complete how-to draft by Ava, owned by Omar, reviewed by Rui. Override what a test cares about. */
export function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "a1",
    sectionId: "accounts",
    type: "how-to",
    title: "Reset your password",
    body: {
      goal: "Get back into your account after forgetting your password.",
      before: "",
      steps: "1. Open the self-service portal.\n2. Choose Forgot password.",
      result: "You can sign in with the new password.",
    },
    state: "draft",
    authorId: "ava",
    ownerId: "omar",
    reviewerId: "rui",
    reviewIntervalDays: 180,
    lastReviewedAt: null,
    history: [],
    ...overrides,
  };
}

/** A published article, last reviewed `reviewedDaysAgo` days ago. */
export const published = (overrides: Partial<Article> = {}, reviewedDaysAgo = 10): Article =>
  article({ state: "published", lastReviewedAt: daysAgo(reviewedDaysAgo), ...overrides });

export function kb(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    people,
    sections: [section],
    articles: [],
    glossary: [
      { id: "sign-in", preferred: "sign in", avoid: ["log in", "login", "logon", "log on"], definition: "Access an account." },
      { id: "mfa", preferred: "multi-factor authentication", avoid: ["2FA", "two-factor"], definition: "A second proof of identity." },
    ],
    events: [],
    triage: [],
    ...overrides,
  };
}

/** Context for acting as `actorId` against a knowledge base (default: the fixture one). */
export const as = (actorId: string, base: KnowledgeBase = kb()): ActionContext => ({ kb: base, actorId, now: NOW });

let eventCounter = 0;
const nextId = () => `e${++eventCounter}`;

export const search = (query: string, resultIds: string[], clickedId: string | null, days = 1): SearchEvent => ({
  kind: "search",
  id: nextId(),
  at: daysAgo(days),
  query,
  resultIds,
  clickedId,
});

export const views = (articleId: string, count: number, days = 1): ViewEvent[] =>
  Array.from({ length: count }, () => ({ kind: "view", id: nextId(), at: daysAgo(days), articleId, via: "browse" }));

export const ratings = (articleId: string, helpful: number, notHelpful: number, days = 1): FeedbackEvent[] => [
  ...Array.from({ length: helpful }, (): FeedbackEvent => ({ kind: "feedback", id: nextId(), at: daysAgo(days), articleId, helpful: true })),
  ...Array.from(
    { length: notHelpful },
    (): FeedbackEvent => ({ kind: "feedback", id: nextId(), at: daysAgo(days), articleId, helpful: false, reason: "out_of_date" }),
  ),
];
