import { describe, expect, it } from "vitest";
import { NOW, article, daysAgo, kb, published, ratings, search, views } from "../test/fixtures";
import { detectGaps, dismissGap, gapStatus, startWork, type ArticleGap, type Gap } from "./gaps";
import type { HistoryEntry, KnowledgeBase, UsageEvent } from "./types";

const repeat = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);
const withEvents = (events: UsageEvent[], overrides: Partial<KnowledgeBase> = {}) => kb({ events, ...overrides });

describe("unmet searches", () => {
  it("groups different phrasings of the same need into one gap", () => {
    const base = withEvents([
      ...repeat(3, () => search("vpn split tunnel", [], null)),
      ...repeat(2, () => search("Split tunnel VPN setup", [], null)),
      search("VPN split-tunnel", [], null),
    ]);
    expect(detectGaps(base, NOW)).toEqual([
      {
        key: "search:vpn split tunnel",
        kind: "unmet_search",
        label: "vpn split tunnel",
        peopleFailed: 6,
        evidence: {
          searches: 6,
          failed: 6,
          zeroResults: 6,
          queries: ["vpn split tunnel", "split tunnel vpn setup"],
          phrasings: [
            { text: "vpn split tunnel", count: 3 },
            { text: "split tunnel vpn setup", count: 2 },
            { text: "vpn split-tunnel", count: 1 },
          ],
        },
      },
    ]);
  });

  it("counts searches where nothing was opened, not just empty results", () => {
    const base = withEvents(repeat(3, () => search("expense card limit", ["a1"], null)));
    expect(detectGaps(base, NOW)[0]).toMatchObject({ peopleFailed: 3, evidence: { zeroResults: 0, failed: 3 } });
  });

  it("needs at least three failures before calling it a gap", () => {
    expect(detectGaps(withEvents(repeat(2, () => search("badge printer", [], null))), NOW)).toEqual([]);
  });

  it("ignores topics where most searches succeed", () => {
    const base = withEvents([
      ...repeat(10, () => search("reset password", ["a1"], "a1")),
      ...repeat(4, () => search("reset password", ["a1"], null)),
    ]);
    expect(detectGaps(base, NOW)).toEqual([]);
  });

  it("only looks at the last 30 days", () => {
    expect(detectGaps(withEvents(repeat(5, () => search("old intranet", [], null, 31))), NOW)).toEqual([]);
  });
});

describe("struggling articles", () => {
  it("needs enough ratings before judging an article", () => {
    const fourBad = withEvents(ratings("a1", 0, 4), { articles: [published()] });
    expect(detectGaps(fourBad, NOW)).toEqual([]);

    const fiveMostlyBad = withEvents(ratings("a1", 2, 3), { articles: [published()] });
    expect(detectGaps(fiveMostlyBad, NOW)).toMatchObject([
      { kind: "article", articleId: "a1", signals: ["low_helpfulness"], peopleFailed: 3, evidence: { helpfulRate: 0.4 } },
    ]);
  });

  describe("with traffic", () => {
    const articles = [
      published({ id: "busy" }),
      published({ id: "quiet" }),
      published({ id: "rare" }),
      published({ id: "unread" }),
      published({ id: "busy-stale" }, 400),
    ];
    const base = withEvents(
      [
        ...views("busy", 100),
        ...ratings("busy", 6, 4), // 60%: fine for an ordinary article, poor for a busy one
        ...views("quiet", 10),
        ...ratings("quiet", 1, 4), // 20%
        ...views("rare", 5),
        ...views("busy-stale", 100), // overdue and unrated
      ],
      { articles },
    );
    const gaps = detectGaps(base, NOW) as ArticleGap[];

    it("holds high-traffic articles to a higher bar", () => {
      expect(gaps.find((g) => g.articleId === "busy")).toMatchObject({
        signals: ["high_traffic_poor_outcome"],
        peopleFailed: 40, // 100 views x 40% unhelpful
      });
    });

    it("ranks by people failed, so a busy mediocre article beats a quiet bad one", () => {
      expect(gaps.map((g) => [g.articleId, g.peopleFailed])).toEqual([
        ["busy", 40],
        ["quiet", 8],
        ["busy-stale", 0],
      ]);
    });

    it("flags busy articles that are overdue for review, ranked by risk rather than proven failure", () => {
      expect(gaps.find((g) => g.articleId === "busy-stale")).toMatchObject({
        signals: ["high_traffic_overdue"],
        peopleFailed: 0,
        evidence: { helpfulRate: null },
      });
    });
  });

  it("ignores drafts and retired articles", () => {
    const base = withEvents([...ratings("d", 0, 9), ...ratings("r", 0, 9)], {
      articles: [article({ id: "d" }), article({ id: "r", state: "retired" })],
    });
    expect(detectGaps(base, NOW)).toEqual([]);
  });
});

describe("handling gaps", () => {
  const unmet = withEvents(repeat(3, () => search("guest wifi", [], null)));
  const gap = detectGaps(unmet, NOW)[0];

  it("is open until someone acts on it", () => {
    expect(gapStatus(gap, unmet).status).toBe("open");
  });

  it("needs a reason to dismiss", () => {
    expect(dismissGap(gap, unmet, " ", NOW)).toEqual({ ok: false, reasons: ["Say why this isn't worth acting on."] });
  });

  it("stays dismissed until its evidence doubles, then reopens on its own", () => {
    const dismissed = dismissGap(gap, unmet, "Guest wifi is handled by facilities.", NOW);
    if (!dismissed.ok) throw new Error("dismiss failed");
    expect(gapStatus(gap, { ...unmet, triage: dismissed.triage }).status).toBe("dismissed");

    const grown: Gap = { ...gap, peopleFailed: 6 };
    expect(gapStatus(grown, { ...unmet, triage: dismissed.triage })).toMatchObject({ status: "open", reopened: true });
  });

  it("still finds its record when the group's most common phrasing changes", () => {
    const dismissed = dismissGap(gap, unmet, "Facilities.", NOW);
    if (!dismissed.ok) throw new Error("dismiss failed");
    const relabelled = withEvents(
      [...repeat(3, () => search("guest wifi", [], null)), ...repeat(5, () => search("wifi for guests", [], null))],
      { triage: dismissed.triage },
    );
    const [regrouped] = detectGaps(relabelled, NOW);
    expect(regrouped.key).toBe("search:wifi for guests");
    expect(gapStatus(regrouped, relabelled).triage?.note).toBe("Facilities.");
  });

  it("resolves only once the linked article is approved after work started", () => {
    const approve = (days: number): HistoryEntry => ({ at: daysAgo(days), actorId: "rui", action: "approve", from: "in_review", to: "published" });
    const busy = published({ id: "busy", history: [approve(60)] });
    const base = withEvents([...views("busy", 50), ...ratings("busy", 1, 4)], { articles: [busy] });
    const [articleGap] = detectGaps(base, NOW);

    const started = startWork(articleGap, base, { assigneeId: "omar" }, new Date(daysAgo(5)));
    if (!started.ok) throw new Error("start failed");
    const working = { ...base, triage: started.triage };
    expect(gapStatus(articleGap, working)).toMatchObject({ status: "in_progress", triage: { linkedArticleId: "busy", assigneeId: "omar" } });

    const fixed = { ...working, articles: [{ ...busy, history: [...busy.history, approve(1)] }] };
    expect(gapStatus(articleGap, fixed).status).toBe("resolved");
  });

  it("won't assign work to someone who has left", () => {
    expect(startWork(gap, unmet, { assigneeId: "lee" }, NOW)).toEqual({ ok: false, reasons: ["Lee Moran has left."] });
  });
});
