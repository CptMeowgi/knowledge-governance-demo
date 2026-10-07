import { describe, expect, it } from "vitest";
import { NOW, article, daysAgo, kb, published } from "../test/fixtures";
import { articleOwnershipIssues, sectionOwnershipIssues } from "./ownership";
import { isStale, reviewInfo } from "./review";

describe("review status", () => {
  // The fixture interval is 180 days.
  it("is current while the next review is more than 14 days away", () => {
    expect(reviewInfo(published({}, 100), NOW)).toMatchObject({ status: "current", daysUntilDue: 80 });
  });

  it("is due soon within 14 days of the review date", () => {
    expect(reviewInfo(published({}, 166), NOW)?.status).toBe("due_soon");
    expect(reviewInfo(published({}, 180), NOW)?.status).toBe("due_soon");
  });

  it("is overdue, and therefore stale, once the review date has passed", () => {
    expect(reviewInfo(published({}, 181), NOW)).toMatchObject({ status: "overdue", daysUntilDue: -1 });
    expect(isStale(published({}, 181), NOW)).toBe(true);
  });

  it("follows the article's own interval", () => {
    expect(reviewInfo(published({ reviewIntervalDays: 90 }, 100), NOW)?.status).toBe("overdue");
  });

  it("only applies to published articles", () => {
    expect(reviewInfo(article({ lastReviewedAt: daysAgo(400) }), NOW)).toBeNull();
    expect(reviewInfo(article({ state: "retired", lastReviewedAt: daysAgo(400) }), NOW)).toBeNull();
  });

  it("treats a published article that was never reviewed as overdue", () => {
    expect(reviewInfo(published({ lastReviewedAt: null }), NOW)?.status).toBe("overdue");
  });
});

describe("ownership health", () => {
  const base = kb();

  it("is clean when owner and reviewer are both active", () => {
    expect(articleOwnershipIssues(published(), base)).toEqual([]);
  });

  it("flags missing people and people who have left", () => {
    expect(articleOwnershipIssues(published({ ownerId: null, reviewerId: "lee" }), base)).toEqual(["no_owner", "reviewer_left"]);
    expect(articleOwnershipIssues(published({ ownerId: "lee" }), base)).toEqual(["owner_left"]);
  });

  it("decays automatically when someone leaves, with no change to the article", () => {
    const omarLeaves = kb({ people: base.people.map((p) => (p.id === "omar" ? { ...p, active: false } : p)) });
    expect(articleOwnershipIssues(published(), omarLeaves)).toEqual(["owner_left"]);
  });

  it("ignores retired articles", () => {
    expect(articleOwnershipIssues(article({ state: "retired", ownerId: null }), base)).toEqual([]);
  });

  it("flags sections without an active owner", () => {
    expect(sectionOwnershipIssues(base.sections[0], base)).toEqual([]);
    expect(sectionOwnershipIssues({ ...base.sections[0], ownerId: "lee" }, base)).toEqual(["owner_left"]);
  });
});
