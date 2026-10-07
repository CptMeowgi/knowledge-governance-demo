import type { Article, KnowledgeBase, Section } from "./types";

export type OwnershipIssue = "no_owner" | "owner_left" | "no_reviewer" | "reviewer_left";

function personIssue(kb: KnowledgeBase, id: string | null, missing: OwnershipIssue, left: OwnershipIssue) {
  if (!id) return [missing];
  const person = kb.people.find((p) => p.id === id);
  if (!person) return [missing];
  return person.active ? [] : [left];
}

/**
 * Accountability gaps on an article. Ownership decays as people leave, so this
 * is recalculated from the current people list rather than stored. Retired
 * articles don't need owners.
 */
export function articleOwnershipIssues(article: Article, kb: KnowledgeBase): OwnershipIssue[] {
  if (article.state === "retired") return [];
  return [
    ...personIssue(kb, article.ownerId, "no_owner", "owner_left"),
    ...personIssue(kb, article.reviewerId, "no_reviewer", "reviewer_left"),
  ];
}

export function sectionOwnershipIssues(section: Section, kb: KnowledgeBase): OwnershipIssue[] {
  return personIssue(kb, section.ownerId, "no_owner", "owner_left");
}

export const OWNERSHIP_ISSUE_LABELS: Record<OwnershipIssue, string> = {
  no_owner: "No owner",
  owner_left: "Owner has left",
  no_reviewer: "No reviewer",
  reviewer_left: "Reviewer has left",
};
