/**
 * The demo seed has to tell a specific story. These tests pin it down, so a
 * change to the data or the rules can't quietly leave a view with nothing to show.
 */
import { describe, expect, it } from "vitest";
import { detectGaps, gapStatus, type ArticleGap, type SearchGap } from "../domain/gaps";
import { findGlossaryViolations } from "../domain/glossary";
import { submissionProblems, transition, workingCopy } from "../domain/lifecycle";
import { articleOwnershipIssues, sectionOwnershipIssues } from "../domain/ownership";
import { buildReport } from "../domain/report";
import { reviewInfo } from "../domain/review";
import { missingRequiredFields } from "../domain/templates";
import { buildSeed } from "./generate";

const now = new Date("2026-10-07T12:00:00.000Z");
const kb = buildSeed(now);
const byId = (id: string) => kb.articles.find((article) => article.id === id)!;

describe("demo seed", () => {
  it("is deterministic", () => {
    expect(buildSeed(now)).toEqual(kb);
  });

  it("only contains published content that would pass today's standards", () => {
    for (const article of kb.articles.filter((a) => a.state === "published")) {
      const text = [article.title, ...Object.values(article.body)].join(" ");
      expect(findGlossaryViolations(text, kb.glossary), article.id).toEqual([]);
      expect(missingRequiredFields(article.type, article.body), article.id).toEqual([]);
    }
  });

  it("never shows anyone approving their own work in the history", () => {
    for (const article of kb.articles) {
      for (const entry of article.history.filter((e) => e.action === "approve" && !e.revision)) {
        expect(entry.actorId, article.id).not.toBe(article.authorId);
      }
    }
  });

  it("has every lifecycle state and a revision waiting for review", () => {
    const states = new Set(kb.articles.map((a) => a.state));
    expect([...states].sort()).toEqual(["draft", "in_review", "published", "retired"]);
    expect(byId("mfa-setup").revision?.state).toBe("in_review");
  });

  it("has four stale articles and one due soon", () => {
    const status = (id: string) => reviewInfo(byId(id), now)?.status;
    const overdue = kb.articles.filter((a) => reviewInfo(a, now)?.status === "overdue").map((a) => a.id);
    expect(overdue.sort()).toEqual(["account-locked", "laptop-charging", "replacement-laptop", "supported-os"]);
    expect(status("recover-deleted-file")).toBe("due_soon");
  });

  it("has two orphaned articles and a section whose owner has left", () => {
    const orphaned = kb.articles.filter((a) => articleOwnershipIssues(a, kb).length).map((a) => a.id);
    expect(orphaned.sort()).toEqual(["replacement-laptop", "shared-mailbox"]);
    expect(kb.sections.filter((s) => sectionOwnershipIssues(s, kb).length).map((s) => s.id)).toEqual(["joiners"]);
  });

  it("has drafts blocked by the content standards", () => {
    const problems = (id: string) => submissionProblems(byId(id), workingCopy(byId(id))!, kb);
    expect(problems("encrypt-usb")).toEqual([
      '"Expected result" is required by the How-to template.',
      'Uses "Log in". The agreed term is "sign in".',
    ]);
    expect(problems("joiner-checklist")).toEqual(['"Details" is required by the Reference template.']);
  });

  it("surfaces gaps of every kind, ranked by people failed", () => {
    const gaps = detectGaps(kb, now);
    const summary = gaps.map((g) => (g.kind === "article" ? g.articleId : g.label));
    expect(summary).toEqual([
      "mfa-setup",
      "vpn split tunnel",
      "expense receipt upload",
      "parking-permits",
      "guest wifi",
      "laptop-charging",
    ]);

    const mfa = gaps[0] as ArticleGap;
    expect(mfa.signals).toEqual(["low_helpfulness", "high_traffic_poor_outcome"]);
    const vpn = gaps[1] as SearchGap;
    expect(vpn.evidence.zeroResults).toBe(0); // results were shown, but nobody opened them
    expect((gaps.at(-1) as ArticleGap).signals).toEqual(["high_traffic_overdue"]);
  });

  it("has a gap in progress and a dismissed gap that has reopened", () => {
    const statuses = Object.fromEntries(detectGaps(kb, now).map((gap) => [gap.key, gapStatus(gap, kb)]));
    expect(statuses["article:mfa-setup"].status).toBe("in_progress");
    expect(statuses["search:guest wifi"]).toMatchObject({ status: "open", reopened: true });
  });

  it("resolves the multi-factor gap when its revision is approved", () => {
    const result = transition(byId("mfa-setup"), { type: "approve" }, { kb, actorId: "rui", now });
    if (!result.ok) throw new Error(result.reasons.join(", "));
    const after = { ...kb, articles: kb.articles.map((a) => (a.id === "mfa-setup" ? result.article : a)) };
    const gap = detectGaps(after, now).find((g) => g.key === "article:mfa-setup")!;
    expect(gapStatus(gap, after).status).toBe("resolved");
  });

  it("produces a report with something to say on every line", () => {
    const report = buildReport(kb, now);
    expect(report.searchSuccess.rate).toBeGreaterThan(0.5);
    expect(report.searchSuccess.rate).toBeLessThan(0.9);
    expect(report.staleness.overdue).toBe(4);
    expect(report.ownership).toMatchObject({ articlesWithIssues: 2, sectionsWithoutOwner: 1 });
    expect(report.deadContent.dead).toBe(1);
    expect(report.pipeline).toMatchObject({ draft: 2, in_review: 1, retired: 1, revisionsInReview: 1 });
  });
});
