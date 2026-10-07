/**
 * The article lifecycle. This module is the only place an article's state can
 * change. Every action is checked against its guards first; a refused action
 * returns the reasons in plain language instead of changing anything.
 *
 *            submit                 approve                 retire
 *   Draft ──────────▶ In Review ──────────▶ Published ──────────▶ Retired
 *     ▲                  │                   │  ▲                   │
 *     └─ request changes ┘                   └──┘ recertify         │
 *     ▲                                                             │
 *     └──────────────────────────── restore ────────────────────────┘
 *
 * Editing a published article creates a pending revision that goes through
 * the same draft → in review → approved steps while the published text stays
 * live.
 */

import { findGlossaryViolations } from "./glossary";
import { POLICY } from "./policy";
import { TEMPLATES, emptyBody, missingRequiredFields } from "./templates";
import type {
  ActionType,
  Article,
  ArticleType,
  Body,
  HistoryEntry,
  KnowledgeBase,
  Person,
  RetirementReason,
} from "./types";

export type Action =
  | { type: "edit"; title: string; body: Body }
  | { type: "submit" }
  | { type: "request_changes"; note: string }
  | { type: "approve" }
  | { type: "discard_revision" }
  | { type: "recertify" }
  | { type: "retire"; reason: RetirementReason; supersededBy?: string; note?: string }
  | { type: "restore" }
  | { type: "assign"; ownerId?: string; reviewerId?: string; reviewIntervalDays?: number };

export interface ActionContext {
  kb: KnowledgeBase;
  /** The person taking the action (picked with the "Viewing as" switcher). */
  actorId: string;
  now: Date;
}

export type TransitionResult = { ok: true; article: Article } | { ok: false; reasons: string[] };

/**
 * The content currently moving towards publication: the article itself while
 * it's a draft or in review, or its pending revision once it's published.
 */
export interface WorkingCopy {
  title: string;
  body: Body;
  authorId: string;
  state: "draft" | "in_review";
  isRevision: boolean;
}

export function workingCopy(article: Article): WorkingCopy | null {
  if (article.state === "draft" || article.state === "in_review") {
    const { title, body, authorId, state } = article;
    return { title, body, authorId, state, isRevision: false };
  }
  if (article.state === "published" && article.revision) {
    const { title, body, authorId, state } = article.revision;
    return { title, body, authorId, state, isRevision: true };
  }
  return null;
}

const findPerson = (kb: KnowledgeBase, id: string | null | undefined): Person | undefined =>
  id ? kb.people.find((person) => person.id === id) : undefined;

const nameOf = (kb: KnowledgeBase, id: string | null | undefined): string =>
  findPerson(kb, id)?.name ?? "nobody";

/** Keeps the messages from failed checks; a check that passes evaluates to `false`. */
const failed = (...checks: Array<string | false>): string[] =>
  checks.filter((check): check is string => check !== false);

function ownerProblems(article: Article, kb: KnowledgeBase): string[] {
  const owner = findPerson(kb, article.ownerId);
  if (!owner) return ["Assign an owner."];
  return owner.active ? [] : [`The owner, ${owner.name}, has left. Assign an active owner.`];
}

function reviewerProblems(article: Article, copy: WorkingCopy, kb: KnowledgeBase): string[] {
  const reviewer = findPerson(kb, article.reviewerId);
  if (!reviewer) return ["Assign a reviewer."];
  if (!reviewer.active) return [`The reviewer, ${reviewer.name}, has left. Assign an active reviewer.`];
  return reviewer.id === copy.authorId
    ? [`${reviewer.name} wrote this version, so a different reviewer must approve it.`]
    : [];
}

/** Everything that stops content entering review. */
export function submissionProblems(article: Article, copy: WorkingCopy, kb: KnowledgeBase): string[] {
  const template = TEMPLATES[article.type];
  const text = [copy.title, ...Object.values(copy.body)].join("\n");
  return [
    ...failed(!copy.title.trim() && "Add a title."),
    ...missingRequiredFields(article.type, copy.body).map(
      (field) => `"${field.label}" is required by the ${template.label} template.`,
    ),
    ...findGlossaryViolations(text, kb.glossary).map(
      (violation) => `Uses "${violation.found}". The agreed term is "${violation.preferred}".`,
    ),
    ...ownerProblems(article, kb),
    ...reviewerProblems(article, copy, kb),
  ];
}

/**
 * Why `actor` can't take this action on this article right now. Empty means
 * the action is allowed. Doesn't look at user input (notes, reasons, chosen
 * people); `transition` checks that separately.
 */
export function blockers(article: Article, type: ActionType, context: ActionContext): string[] {
  const { kb } = context;
  const actor = findPerson(kb, context.actorId);
  if (!actor) return ["Choose who you're acting as."];
  if (!actor.active) return [`${actor.name} has left and can't make changes.`];

  const copy = workingCopy(article);
  const section = kb.sections.find((s) => s.id === article.sectionId);
  const is = (id: string | null | undefined) => id === actor.id;
  const isManager = actor.role === "knowledge_manager";

  switch (type) {
    case "edit":
      return failed(
        article.state === "in_review" &&
          "Content is locked while it's in review, so the reviewer approves exactly what they read.",
        article.revision?.state === "in_review" &&
          "A revision is in review. Its content is locked until the reviewer decides.",
        article.state === "retired" && "Retired articles can't be edited. Restore it first.",
      );

    case "submit":
      if (copy?.state !== "draft") return [copy ? "Already in review." : "There's no draft to submit."];
      return [
        ...failed(!is(copy.authorId) && !is(article.ownerId) && "Only the author or the owner can submit it for review."),
        ...submissionProblems(article, copy, kb),
      ];

    case "request_changes":
    case "approve": {
      if (copy?.state !== "in_review") return ["Nothing is waiting for review."];
      if (!article.reviewerId) return ["Assign a reviewer first."];
      const verb = type === "approve" ? "approve" : "request changes";
      if (!is(article.reviewerId)) return [`Only the assigned reviewer, ${nameOf(kb, article.reviewerId)}, can ${verb}.`];
      if (type === "request_changes") return [];
      return [
        ...failed(is(copy.authorId) && "You wrote this version, so someone else has to approve it."),
        ...ownerProblems(article, kb),
      ];
    }

    case "discard_revision":
      if (!article.revision) return ["There's no pending revision."];
      return failed(
        !is(article.revision.authorId) &&
          !is(article.ownerId) &&
          !isManager &&
          "Only the revision's author, the owner or a knowledge manager can discard it.",
      );

    case "recertify":
      if (article.state !== "published") return ["Only published articles can be recertified."];
      return failed(!is(article.ownerId) && !is(article.reviewerId) && "Only the owner or the reviewer can recertify.");

    case "retire":
      if (article.state !== "published") return ["Only published articles can be retired."];
      return failed(
        !is(article.ownerId) && !isManager && "Only the owner or a knowledge manager can retire an article.",
        !!article.revision && "Discard or finish the pending revision first.",
      );

    case "restore":
      if (article.state !== "retired") return ["Only retired articles can be restored."];
      return failed(
        !is(section?.ownerId) && !isManager && "Only the section owner or a knowledge manager can restore an article.",
      );

    case "assign":
      if (article.state === "retired") return ["Retired articles don't need owners."];
      return failed(
        !is(article.ownerId) &&
          !is(section?.ownerId) &&
          !isManager &&
          "Only the article owner, the section owner or a knowledge manager can change ownership.",
      );
  }
}

/** Checks the input that comes with an action: notes, reasons, chosen people. */
function inputProblems(article: Article, action: Action, kb: KnowledgeBase): string[] {
  switch (action.type) {
    case "request_changes":
      return failed(!action.note.trim() && "Say what needs to change.");

    case "retire": {
      if (action.reason !== "superseded") return [];
      const replacement = kb.articles.find((a) => a.id === action.supersededBy);
      if (!replacement) return ["Pick the article that replaces this one."];
      if (replacement.id === article.id) return ["An article can't replace itself."];
      return failed(replacement.state !== "published" && "The replacement must be published.");
    }

    case "assign": {
      const { ownerId, reviewerId, reviewIntervalDays } = action;
      if (ownerId === undefined && reviewerId === undefined && reviewIntervalDays === undefined) {
        return ["Nothing to change."];
      }
      const problems: string[] = [];
      for (const [role, id] of [["owner", ownerId], ["reviewer", reviewerId]] as const) {
        if (id === undefined) continue;
        const person = findPerson(kb, id);
        if (!person) problems.push(`Pick a valid ${role}.`);
        else if (!person.active) problems.push(`${person.name} has left and can't be the ${role}.`);
      }
      const copy = workingCopy(article);
      if (reviewerId !== undefined && copy?.state === "in_review" && reviewerId === copy.authorId) {
        problems.push(`${nameOf(kb, reviewerId)} wrote the version in review, so they can't review it.`);
      }
      const { min, max } = POLICY.reviewIntervalDays;
      if (reviewIntervalDays !== undefined && (!Number.isInteger(reviewIntervalDays) || reviewIntervalDays < min || reviewIntervalDays > max)) {
        problems.push(`The review interval must be between ${min} and ${max} days.`);
      }
      return problems;
    }

    default:
      return [];
  }
}

/** Applies an action, or explains why it can't be applied. Never mutates its input. */
export function transition(article: Article, action: Action, context: ActionContext): TransitionResult {
  const reasons = [...blockers(article, action.type, context), ...inputProblems(article, action, context.kb)];
  return reasons.length ? { ok: false, reasons } : { ok: true, article: apply(article, action, context) };
}

function apply(article: Article, action: Action, context: ActionContext): Article {
  const at = context.now.toISOString();
  const log = (entry: Pick<HistoryEntry, "from" | "to" | "revision" | "note">): HistoryEntry[] => [
    ...article.history,
    { at, actorId: context.actorId, action: action.type, ...entry },
  ];
  // Once published, every content action applies to the pending revision.
  const revision = article.state === "published" ? article.revision : undefined;

  switch (action.type) {
    case "edit":
      if (article.state === "draft") {
        return {
          ...article,
          title: action.title,
          body: action.body,
          authorId: context.actorId,
          history: log({ from: "draft", to: "draft" }),
        };
      }
      return {
        ...article,
        revision: {
          title: action.title,
          body: action.body,
          authorId: context.actorId,
          state: "draft",
          startedAt: revision?.startedAt ?? at,
        },
        history: log({ from: "draft", to: "draft", revision: true }),
      };

    case "submit":
      return revision
        ? { ...article, revision: { ...revision, state: "in_review" }, history: log({ from: "draft", to: "in_review", revision: true }) }
        : { ...article, state: "in_review", history: log({ from: "draft", to: "in_review" }) };

    case "request_changes": {
      const note = action.note.trim();
      return revision
        ? { ...article, revision: { ...revision, state: "draft" }, history: log({ from: "in_review", to: "draft", revision: true, note }) }
        : { ...article, state: "draft", history: log({ from: "in_review", to: "draft", note }) };
    }

    case "approve":
      if (!revision) {
        return { ...article, state: "published", lastReviewedAt: at, history: log({ from: "in_review", to: "published" }) };
      }
      return withoutRevision({
        ...article,
        title: revision.title,
        body: revision.body,
        authorId: revision.authorId,
        lastReviewedAt: at,
        history: log({ from: "in_review", to: "published", revision: true }),
      });

    case "discard_revision":
      return withoutRevision({
        ...article,
        history: log({ from: "published", to: "published", revision: true, note: "Revision discarded." }),
      });

    case "recertify":
      return { ...article, lastReviewedAt: at, history: log({ from: "published", to: "published" }) };

    case "retire": {
      const note = action.note?.trim() || undefined;
      return {
        ...article,
        state: "retired",
        retirement: {
          reason: action.reason,
          supersededBy: action.reason === "superseded" ? action.supersededBy : undefined,
          note,
        },
        history: log({ from: "published", to: "retired", note }),
      };
    }

    case "restore": {
      const restored: Article = { ...article, state: "draft", history: log({ from: "retired", to: "draft" }) };
      delete restored.retirement;
      return restored;
    }

    case "assign": {
      const { kb } = context;
      const changes: string[] = [];
      if (action.ownerId !== undefined && action.ownerId !== article.ownerId) {
        changes.push(`Owner: ${nameOf(kb, article.ownerId)} → ${nameOf(kb, action.ownerId)}`);
      }
      if (action.reviewerId !== undefined && action.reviewerId !== article.reviewerId) {
        changes.push(`Reviewer: ${nameOf(kb, article.reviewerId)} → ${nameOf(kb, action.reviewerId)}`);
      }
      if (action.reviewIntervalDays !== undefined && action.reviewIntervalDays !== article.reviewIntervalDays) {
        changes.push(`Review interval: ${article.reviewIntervalDays} → ${action.reviewIntervalDays} days`);
      }
      return {
        ...article,
        ownerId: action.ownerId ?? article.ownerId,
        reviewerId: action.reviewerId ?? article.reviewerId,
        reviewIntervalDays: action.reviewIntervalDays ?? article.reviewIntervalDays,
        history: log({ from: article.state, to: article.state, note: changes.join("; ") || undefined }),
      };
    }
  }
}

function withoutRevision(article: Article): Article {
  const copy = { ...article };
  delete copy.revision;
  return copy;
}

export interface NewDraft {
  id: string;
  sectionId: string;
  type: ArticleType;
  title: string;
}

/**
 * Starts a new draft. Ownership defaults to the section owner (or the author,
 * if the section owner has left), the reviewer to the section's default
 * reviewer, and the review interval to the template's default.
 */
export function createDraft(input: NewDraft, context: ActionContext): TransitionResult {
  const { kb } = context;
  const actor = findPerson(kb, context.actorId);
  const section = kb.sections.find((s) => s.id === input.sectionId);
  if (!actor) return { ok: false, reasons: ["Choose who you're acting as."] };
  if (!actor.active) return { ok: false, reasons: [`${actor.name} has left and can't make changes.`] };
  if (!section) return { ok: false, reasons: ["Pick a section."] };

  const activeOrNull = (id: string | null) => (findPerson(kb, id)?.active ? id : null);
  const defaultReviewer = activeOrNull(section.defaultReviewerId);

  return {
    ok: true,
    article: {
      id: input.id,
      sectionId: section.id,
      type: input.type,
      title: input.title,
      body: emptyBody(input.type),
      state: "draft",
      authorId: actor.id,
      ownerId: activeOrNull(section.ownerId) ?? actor.id,
      // Nobody reviews their own work, so the author is never the default reviewer.
      reviewerId: defaultReviewer === actor.id ? null : defaultReviewer,
      reviewIntervalDays: TEMPLATES[input.type].defaultReviewIntervalDays,
      lastReviewedAt: null,
      history: [{ at: context.now.toISOString(), actorId: actor.id, action: "create", from: null, to: "draft" }],
    },
  };
}
