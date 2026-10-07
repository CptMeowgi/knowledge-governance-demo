import { describe, expect, it } from "vitest";
import { NOW, article, as, kb, people, published } from "../test/fixtures";
import { blockers, createDraft, transition, type Action, type TransitionResult } from "./lifecycle";
import type { Article } from "./types";

/** Runs an action and returns the new article, failing the test if it was refused. */
function run(subject: Article, action: Action, actorId: string, base = kb()): Article {
  const result = transition(subject, action, as(actorId, base));
  if (!result.ok) throw new Error(`Expected "${action.type}" to succeed, got: ${result.reasons.join(" | ")}`);
  return result.article;
}

function reasons(result: TransitionResult): string[] {
  return result.ok ? [] : result.reasons;
}

describe("submitting a draft for review", () => {
  it("moves a complete draft into review", () => {
    const submitted = run(article(), { type: "submit" }, "ava");
    expect(submitted.state).toBe("in_review");
    expect(submitted.history.at(-1)).toMatchObject({ action: "submit", actorId: "ava", from: "draft", to: "in_review" });
  });

  it("refuses when a required template field is empty", () => {
    const draft = article({ body: { ...article().body, steps: "   " } });
    expect(reasons(transition(draft, { type: "submit" }, as("ava")))).toContain(
      '"Steps" is required by the How-to template.',
    );
  });

  it("refuses wording the glossary says to avoid, anywhere in the content", () => {
    const draft = article({ title: "Can't login after a password reset" });
    expect(reasons(transition(draft, { type: "submit" }, as("ava")))).toContain(
      'Uses "login". The agreed term is "sign in".',
    );
  });

  it("refuses when the owner has left", () => {
    const draft = article({ ownerId: "lee" });
    expect(reasons(transition(draft, { type: "submit" }, as("ava")))).toContain(
      "The owner, Lee Moran, has left. Assign an active owner.",
    );
  });

  it("refuses when there is no reviewer, or the reviewer is the author", () => {
    expect(reasons(transition(article({ reviewerId: null }), { type: "submit" }, as("ava")))).toContain("Assign a reviewer.");
    expect(reasons(transition(article({ reviewerId: "ava" }), { type: "submit" }, as("ava")))).toContain(
      "Ava Lindqvist wrote this version, so a different reviewer must approve it.",
    );
  });

  it("lets only the author or the owner submit", () => {
    expect(transition(article(), { type: "submit" }, as("omar")).ok).toBe(true);
    expect(reasons(transition(article(), { type: "submit" }, as("rui")))).toContain(
      "Only the author or the owner can submit it for review.",
    );
  });

  it("reports every problem at once, not one at a time", () => {
    const draft = article({ title: "", ownerId: null, body: { goal: "", before: "", steps: "", result: "" } });
    expect(reasons(transition(draft, { type: "submit" }, as("ava")))).toHaveLength(5);
  });
});

describe("reviewing", () => {
  const inReview = article({ state: "in_review" });

  it("publishes on approval and starts the review clock", () => {
    const approved = run(inReview, { type: "approve" }, "rui");
    expect(approved.state).toBe("published");
    expect(approved.lastReviewedAt).toBe(NOW.toISOString());
  });

  it("lets only the assigned reviewer approve", () => {
    expect(reasons(transition(inReview, { type: "approve" }, as("omar")))).toEqual([
      "Only the assigned reviewer, Rui Costa, can approve.",
    ]);
    expect(transition(inReview, { type: "approve" }, as("kim")).ok).toBe(false);
  });

  it("never lets anyone approve content they wrote", () => {
    const ownWork = article({ state: "in_review", authorId: "rui" });
    expect(reasons(transition(ownWork, { type: "approve" }, as("rui")))).toContain(
      "You wrote this version, so someone else has to approve it.",
    );
  });

  it("won't publish content whose owner has left during review", () => {
    expect(reasons(transition(article({ state: "in_review", ownerId: "lee" }), { type: "approve" }, as("rui")))).toContain(
      "The owner, Lee Moran, has left. Assign an active owner.",
    );
  });

  it("sends content back to draft with a note when changes are requested", () => {
    const returned = run(inReview, { type: "request_changes", note: "  Add a screenshot of step 2.  " }, "rui");
    expect(returned.state).toBe("draft");
    expect(returned.history.at(-1)).toMatchObject({ action: "request_changes", note: "Add a screenshot of step 2." });
  });

  it("requires the note to say what needs to change", () => {
    expect(reasons(transition(inReview, { type: "request_changes", note: " " }, as("rui")))).toEqual([
      "Say what needs to change.",
    ]);
  });
});

describe("content in review is frozen", () => {
  it("can't be edited by anyone, so the reviewer approves exactly what they read", () => {
    for (const person of people.filter((p) => p.active)) {
      expect(blockers(article({ state: "in_review" }), "edit", as(person.id))).toEqual([
        "Content is locked while it's in review, so the reviewer approves exactly what they read.",
      ]);
    }
  });

  it("makes whoever edits a draft its author, so a reviewer who edits can't then approve", () => {
    const edited = run(article(), { type: "edit", title: "Reset your password", body: article().body }, "rui");
    expect(edited.authorId).toBe("rui");
    expect(reasons(transition(edited, { type: "submit" }, as("rui")))).toContain(
      "Rui Costa wrote this version, so a different reviewer must approve it.",
    );
  });
});

describe("revising published content", () => {
  const live = published();
  const newBody = { ...live.body, steps: "1. Open the self-service portal.\n2. Choose Forgot password.\n3. Check your email." };
  const edit: Action = { type: "edit", title: live.title, body: newBody };

  it("keeps the published text live while the change is drafted and reviewed", () => {
    const revised = run(live, edit, "ava");
    const submitted = run(revised, { type: "submit" }, "ava");
    expect(submitted.state).toBe("published");
    expect(submitted.body).toEqual(live.body);
    expect(submitted.revision).toMatchObject({ state: "in_review", authorId: "ava", body: newBody });
  });

  it("replaces the live content and restarts the review clock when the revision is approved", () => {
    const submitted = run(run(live, edit, "ava"), { type: "submit" }, "ava");
    const approved = run(submitted, { type: "approve" }, "rui");
    expect(approved.body).toEqual(newBody);
    expect(approved.revision).toBeUndefined();
    expect(approved.lastReviewedAt).toBe(NOW.toISOString());
    expect(approved.history.at(-1)).toMatchObject({ action: "approve", revision: true });
  });

  it("keeps the article published when changes to a revision are requested", () => {
    const submitted = run(run(live, edit, "ava"), { type: "submit" }, "ava");
    const returned = run(submitted, { type: "request_changes", note: "Step 3 needs the sender's address." }, "rui");
    expect(returned.state).toBe("published");
    expect(returned.revision?.state).toBe("draft");
  });

  it("holds the same review rules for revisions as for new articles", () => {
    const badEdit: Action = { type: "edit", title: "How to login again", body: newBody };
    expect(reasons(transition(run(live, badEdit, "ava"), { type: "submit" }, as("ava")))).toContain(
      'Uses "login". The agreed term is "sign in".',
    );
  });

  it("locks a revision while it's in review", () => {
    const submitted = run(run(live, edit, "ava"), { type: "submit" }, "ava");
    expect(blockers(submitted, "edit", as("omar"))).toEqual([
      "A revision is in review. Its content is locked until the reviewer decides.",
    ]);
  });

  it("lets the revision's author, the owner or a knowledge manager discard it", () => {
    const revised = run(live, edit, "ava");
    expect(blockers(revised, "discard_revision", as("ava"))).toEqual([]);
    expect(blockers(revised, "discard_revision", as("omar"))).toEqual([]);
    expect(blockers(revised, "discard_revision", as("kim"))).toEqual([]);
    expect(blockers(revised, "discard_revision", as("rui"))).toHaveLength(1);
    const discarded = run(revised, { type: "discard_revision" }, "ava");
    expect(discarded.revision).toBeUndefined();
    expect(discarded.body).toEqual(live.body);
  });
});

describe("recertifying", () => {
  it("restarts the review clock without changing content", () => {
    const stale = published({}, 200);
    const recertified = run(stale, { type: "recertify" }, "rui");
    expect(recertified.lastReviewedAt).toBe(NOW.toISOString());
    expect(recertified.body).toEqual(stale.body);
  });

  it("is limited to the owner and the reviewer, on published articles", () => {
    expect(blockers(published(), "recertify", as("omar"))).toEqual([]);
    expect(blockers(published(), "recertify", as("ava"))).toEqual(["Only the owner or the reviewer can recertify."]);
    expect(blockers(article(), "recertify", as("rui"))).toEqual(["Only published articles can be recertified."]);
  });
});

describe("retiring and restoring", () => {
  it("retires with a reason, by the owner or a knowledge manager", () => {
    const retired = run(published(), { type: "retire", reason: "obsolete", note: "Portal replaced." }, "omar");
    expect(retired.state).toBe("retired");
    expect(retired.retirement).toMatchObject({ reason: "obsolete", note: "Portal replaced." });
    expect(transition(published(), { type: "retire", reason: "obsolete" }, as("kim")).ok).toBe(true);
    expect(reasons(transition(published(), { type: "retire", reason: "obsolete" }, as("ava")))).toContain(
      "Only the owner or a knowledge manager can retire an article.",
    );
  });

  it("requires a published replacement when retiring as superseded", () => {
    const replacement = published({ id: "a2", title: "Reset your password (new portal)" });
    const draftReplacement = article({ id: "a3" });
    const base = kb({ articles: [published(), replacement, draftReplacement] });
    const retire = (supersededBy?: string) =>
      transition(published(), { type: "retire", reason: "superseded", supersededBy }, as("omar", base));

    expect(reasons(retire(undefined))).toEqual(["Pick the article that replaces this one."]);
    expect(reasons(retire("a1"))).toEqual(["An article can't replace itself."]);
    expect(reasons(retire("a3"))).toEqual(["The replacement must be published."]);
    expect(retire("a2").ok).toBe(true);
  });

  it("won't retire while a revision is pending", () => {
    const revised = run(published(), { type: "edit", title: "Reset your password", body: published().body }, "ava");
    expect(blockers(revised, "retire", as("omar"))).toContain("Discard or finish the pending revision first.");
  });

  it("restores to draft, never straight to published", () => {
    const retired = article({ state: "retired", retirement: { reason: "obsolete" } });
    const restored = run(retired, { type: "restore" }, "omar");
    expect(restored.state).toBe("draft");
    expect(restored.retirement).toBeUndefined();
    expect(blockers(retired, "restore", as("ava"))).toEqual([
      "Only the section owner or a knowledge manager can restore an article.",
    ]);
  });

  it("only allows actions that make sense for the current state", () => {
    expect(blockers(article(), "retire", as("omar"))).toEqual(["Only published articles can be retired."]);
    expect(blockers(published(), "restore", as("omar"))).toEqual(["Only retired articles can be restored."]);
    expect(blockers(published(), "approve", as("rui"))).toEqual(["Nothing is waiting for review."]);
    expect(blockers(article({ state: "retired" }), "edit", as("omar"))).toEqual([
      "Retired articles can't be edited. Restore it first.",
    ]);
  });
});

describe("assigning ownership", () => {
  const orphaned = published({ ownerId: "lee" });

  it("lets the section owner fix an orphaned article", () => {
    const fixed = run(orphaned, { type: "assign", ownerId: "rui", reviewerId: "omar" }, "omar");
    expect(fixed).toMatchObject({ ownerId: "rui", reviewerId: "omar" });
    expect(fixed.history.at(-1)?.note).toBe("Owner: Lee Moran → Rui Costa; Reviewer: Rui Costa → Omar Haddad");
  });

  it("lets a knowledge manager fix ownership anywhere", () => {
    expect(blockers(orphaned, "assign", as("kim"))).toEqual([]);
  });

  it("refuses people who aren't responsible for the article", () => {
    expect(blockers(orphaned, "assign", as("ava"))).toEqual([
      "Only the article owner, the section owner or a knowledge manager can change ownership.",
    ]);
  });

  it("won't hand ownership to someone who has left", () => {
    expect(reasons(transition(published(), { type: "assign", ownerId: "lee" }, as("omar")))).toEqual([
      "Lee Moran has left and can't be the owner.",
    ]);
  });

  it("won't make the author of content in review its reviewer", () => {
    expect(reasons(transition(article({ state: "in_review" }), { type: "assign", reviewerId: "ava" }, as("omar")))).toEqual([
      "Ava Lindqvist wrote the version in review, so they can't review it.",
    ]);
  });

  it("keeps the review interval within policy limits", () => {
    expect(reasons(transition(published(), { type: "assign", reviewIntervalDays: 7 }, as("omar")))).toEqual([
      "The review interval must be between 30 and 730 days.",
    ]);
    expect(run(published(), { type: "assign", reviewIntervalDays: 90 }, "omar").reviewIntervalDays).toBe(90);
  });
});

describe("people who have left", () => {
  it("can't take any action", () => {
    expect(blockers(article({ authorId: "lee" }), "submit", as("lee"))).toEqual(["Lee Moran has left and can't make changes."]);
    expect(blockers(published(), "edit", as("lee"))).toEqual(["Lee Moran has left and can't make changes."]);
  });
});

describe("creating a draft", () => {
  it("takes ownership and reviewer from the section, and the interval from the template", () => {
    const result = createDraft({ id: "new", sectionId: "accounts", type: "troubleshooting", title: "VPN drops" }, as("ava"));
    expect(result.ok && result.article).toMatchObject({
      state: "draft",
      authorId: "ava",
      ownerId: "omar",
      reviewerId: "rui",
      reviewIntervalDays: 90,
      body: { symptom: "", cause: "", resolution: "", escalation: "" },
    });
  });

  it("falls back to the author as owner when the section owner has left", () => {
    const base = kb({ sections: [{ id: "accounts", name: "Accounts", description: "", ownerId: "lee", defaultReviewerId: "rui" }] });
    const result = createDraft({ id: "new", sectionId: "accounts", type: "how-to", title: "x" }, as("ava", base));
    expect(result.ok && result.article.ownerId).toBe("ava");
  });

  it("never makes the author the default reviewer", () => {
    const result = createDraft({ id: "new", sectionId: "accounts", type: "how-to", title: "x" }, as("rui"));
    expect(result.ok && result.article.reviewerId).toBeNull();
  });
});
