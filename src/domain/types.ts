/**
 * The stored data model. Anything not defined here (review status, ownership
 * health, gaps, report figures) is derived from it on demand and never saved.
 */

export type ArticleState = "draft" | "in_review" | "published" | "retired";
export type ArticleType = "how-to" | "troubleshooting" | "reference";
export type RetirementReason = "obsolete" | "superseded" | "duplicate";
export type FeedbackReason = "out_of_date" | "missing_steps" | "incorrect" | "hard_to_follow";

export interface Person {
  id: string;
  name: string;
  title: string;
  /** False once someone has left. They can't act, and what they own becomes orphaned. */
  active: boolean;
  /** Knowledge managers run the framework: they can fix ownership anywhere. */
  role: "contributor" | "knowledge_manager";
}

export interface Section {
  id: string;
  name: string;
  description: string;
  /** Accountable for the section's coverage, and the escalation point for its articles. */
  ownerId: string | null;
  defaultReviewerId: string | null;
}

/** Article content, keyed by the field names of the article's template. */
export type Body = Record<string, string>;

/**
 * A proposed change to a published article. The published text stays live
 * until the revision is approved.
 */
export interface Revision {
  title: string;
  body: Body;
  authorId: string;
  state: "draft" | "in_review";
  startedAt: string;
}

export interface Retirement {
  reason: RetirementReason;
  /** Required when the reason is "superseded": the published article that replaces this one. */
  supersededBy?: string;
  note?: string;
}

export interface Article {
  id: string;
  sectionId: string;
  type: ArticleType;
  title: string;
  body: Body;
  state: ArticleState;
  /** Whoever last changed the content now in question. They can't approve it. */
  authorId: string;
  /** Accountable for the article staying accurate. */
  ownerId: string | null;
  /** Approves changes and recertifies the content. */
  reviewerId: string | null;
  reviewIntervalDays: number;
  /** Set on approval and on recertification. Drives the next review date. */
  lastReviewedAt: string | null;
  revision?: Revision;
  retirement?: Retirement;
  history: HistoryEntry[];
}

export type ActionType =
  | "edit"
  | "submit"
  | "request_changes"
  | "approve"
  | "discard_revision"
  | "recertify"
  | "retire"
  | "restore"
  | "assign";

/** Append-only audit trail of everything that happened to an article. */
export interface HistoryEntry {
  at: string;
  actorId: string;
  action: ActionType | "create";
  from: ArticleState | null;
  to: ArticleState;
  /** True when the action applied to a pending revision rather than the live article. */
  revision?: boolean;
  note?: string;
}

/** One agreed term per concept, plus the variants writers must not use. */
export interface GlossaryTerm {
  id: string;
  preferred: string;
  avoid: string[];
  definition: string;
}

// Usage events: an append-only log. Gaps and report figures are derived from it.

export interface SearchEvent {
  kind: "search";
  id: string;
  at: string;
  query: string;
  resultIds: string[];
  clickedId: string | null;
}

export interface ViewEvent {
  kind: "view";
  id: string;
  at: string;
  articleId: string;
  via: "search" | "browse";
}

export interface FeedbackEvent {
  kind: "feedback";
  id: string;
  at: string;
  articleId: string;
  helpful: boolean;
  reason?: FeedbackReason;
  comment?: string;
}

export type UsageEvent = SearchEvent | ViewEvent | FeedbackEvent;

/**
 * The only stored part of a gap: how it's being handled. "Open" and
 * "resolved" are derived, so they're never stored.
 */
export interface GapTriage {
  gapKey: string;
  status: "in_progress" | "dismissed";
  /** When this status was set. Approvals after this moment resolve the gap. */
  at: string;
  assigneeId?: string;
  linkedArticleId?: string;
  note?: string;
  /** For dismissed gaps: the evidence at the time, so the gap can reopen if it grows. */
  peopleFailedAtDismissal?: number;
}

export interface KnowledgeBase {
  people: Person[];
  sections: Section[];
  articles: Article[];
  glossary: GlossaryTerm[];
  events: UsageEvent[];
  triage: GapTriage[];
}
