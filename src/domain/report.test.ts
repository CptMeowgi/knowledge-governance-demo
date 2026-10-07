import { describe, expect, it } from "vitest";
import { NOW, article, daysAgo, kb, published, ratings, search, section, views } from "../test/fixtures";
import { buildReport } from "./report";
import type { HistoryEntry } from "./types";

const wentLive = (days: number): HistoryEntry => ({
  at: daysAgo(days), actorId: "rui", action: "approve", from: "in_review", to: "published",
});
const submitted = (days: number, revision = false): HistoryEntry => ({
  at: daysAgo(days), actorId: "ava", action: "submit", from: "draft", to: "in_review", revision,
});

const base = kb({
  sections: [section, { ...section, id: "devices", name: "Devices", ownerId: "lee" }],
  articles: [
    published({ id: "read", history: [wentLive(200)] }, 10),
    published({ id: "overdue", history: [wentLive(300)] }, 200),
    published({ id: "orphaned", ownerId: "lee", history: [wentLive(120)] }, 10),
    published({ id: "new", history: [wentLive(20)] }, 20),
    published(
      {
        id: "revising",
        history: [wentLive(400), submitted(9, true)],
        revision: { title: "Reset your password", body: {}, authorId: "ava", state: "in_review", startedAt: daysAgo(12) },
      },
      30,
    ),
    article({ id: "draft" }),
    article({ id: "waiting", state: "in_review", history: [submitted(4)] }),
    article({ id: "gone", state: "retired", ownerId: null }),
  ],
  events: [
    ...views("read", 8),
    ...views("overdue", 2),
    ...ratings("read", 3, 1),
    search("reset password", ["read"], "read"),
    search("reset password", ["read"], "read"),
    search("sign in", ["read"], "read"),
    search("guest wifi", [], null),
    search("ancient query", [], null, 45),
  ],
});

const report = buildReport(base, NOW);

describe("governance report", () => {
  it("measures search success over the last 30 days", () => {
    expect(report.searchSuccess).toEqual({ searches: 4, successful: 3, rate: 0.75 });
  });

  it("counts published articles past their review date as stale", () => {
    expect(report.staleness).toEqual({ published: 5, overdue: 1, share: 0.2 });
  });

  it("counts ownership gaps on live content and on sections", () => {
    expect(report.ownership).toEqual({ articles: 7, articlesWithIssues: 1, sections: 2, sectionsWithoutOwner: 1 });
  });

  it("reports the share of helpful ratings", () => {
    expect(report.helpfulness).toEqual({ ratings: 4, helpful: 3, rate: 0.75 });
  });

  it("only judges content as dead once it has been live long enough to be read", () => {
    // "new" went live 20 days ago, so it isn't judged yet; "orphaned" and "revising" have had no readers.
    expect(report.deadContent).toEqual({ eligible: 4, dead: 2, share: 0.5 });
  });

  it("shows how concentrated reading is", () => {
    expect(report.reuse).toEqual({ views: 10, topArticles: 1, topShare: 0.8 });
  });

  it("shows the pipeline and how long the oldest item has waited for review", () => {
    expect(report.pipeline).toEqual({
      draft: 1,
      in_review: 1,
      published: 5,
      retired: 1,
      revisionsInReview: 1,
      oldestInReviewDays: 9,
    });
  });

  it("reports unknown rather than perfect when there's nothing to measure", () => {
    const empty = buildReport(kb(), NOW);
    expect(empty.searchSuccess.rate).toBeNull();
    expect(empty.helpfulness.rate).toBeNull();
    expect(empty.staleness.share).toBeNull();
    expect(empty.pipeline.oldestInReviewDays).toBeNull();
  });
});
