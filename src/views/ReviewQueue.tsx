import { useState, type ReactNode } from "react";
import { blockers, submissionProblems, workingCopy } from "../domain/lifecycle";
import { articleOwnershipIssues, sectionOwnershipIssues } from "../domain/ownership";
import { reviewInfo } from "../domain/review";
import type { Article } from "../domain/types";
import { useStore } from "../store/store";
import { ArticleRow, Badge, Empty, PageHead, PersonName } from "../ui/bits";
import { daysAgo, plural } from "../ui/format";

/** When the content now waiting for review was submitted. */
const submittedAt = (article: Article) =>
  [...article.history].reverse().find((e) => e.action === "submit" && !!e.revision === (article.state === "published"))?.at;

export function ReviewQueue() {
  const { kb, actor, now } = useStore();
  const [scope, setScope] = useState<"mine" | "everyone">("mine");
  const context = { kb, actorId: actor.id, now };
  const involves = (...ids: (string | null | undefined)[]) => scope === "everyone" || ids.includes(actor.id);

  const waiting = kb.articles
    .filter((a) => workingCopy(a)?.state === "in_review" && involves(a.reviewerId))
    .sort((a, b) => (submittedAt(a) ?? "").localeCompare(submittedAt(b) ?? ""));

  const drafts = kb.articles.filter((a) => {
    const copy = workingCopy(a);
    return copy?.state === "draft" && involves(copy.authorId, a.ownerId);
  });

  const recertification = kb.articles
    .filter((a) => {
      const status = reviewInfo(a, now)?.status;
      return (status === "overdue" || status === "due_soon") && involves(a.ownerId, a.reviewerId);
    })
    .sort((a, b) => (reviewInfo(a, now)?.daysUntilDue ?? 0) - (reviewInfo(b, now)?.daysUntilDue ?? 0));

  // Ownership problems this person is allowed to fix (or every one, in the "everyone" view).
  const ownership = kb.articles.filter(
    (a) => articleOwnershipIssues(a, kb).length && (scope === "everyone" || blockers(a, "assign", context).length === 0),
  );
  const orphanedSections = kb.sections.filter(
    (s) => sectionOwnershipIssues(s, kb).length && (scope === "everyone" || actor.role === "knowledge_manager"),
  );

  return (
    <>
      <PageHead
        title="Review queue"
        actions={
          <div className="segmented" role="tablist" aria-label="Whose work to show">
            <button role="tab" aria-selected={scope === "mine"} className={scope === "mine" ? "is-active" : ""} onClick={() => setScope("mine")}>
              {actor.name.split(" ")[0]}'s work
            </button>
            <button role="tab" aria-selected={scope === "everyone"} className={scope === "everyone" ? "is-active" : ""} onClick={() => setScope("everyone")}>
              Everyone
            </button>
          </div>
        }
      >
        Content waits here until somebody accountable acts on it: reviews to approve, drafts to finish, recertifications
        coming due, and ownership to repair.
      </PageHead>

      <Queue title="Waiting for review" count={waiting.length} empty="Nothing is waiting for review.">
        {waiting.map((a) => {
          const at = submittedAt(a);
          return (
            <ArticleRow
              key={a.id}
              article={a}
              now={now}
              extra={
                <>
                  {at && `waiting ${plural(daysAgo(at, now), "day")}`} · reviewer <PersonName id={a.reviewerId} />
                </>
              }
            />
          );
        })}
      </Queue>

      <Queue title="Drafts" count={drafts.length} empty="No drafts in progress.">
        {drafts.map((a) => {
          const problems = submissionProblems(a, workingCopy(a)!, kb).length;
          return (
            <ArticleRow
              key={a.id}
              article={a}
              now={now}
              extra={problems ? <Badge tone="warn">{plural(problems, "thing")} to fix before review</Badge> : <Badge tone="ok">Ready to submit</Badge>}
            />
          );
        })}
      </Queue>

      <Queue title="Recertification due" count={recertification.length} empty="Nothing is due for review.">
        {recertification.map((a) => (
          <ArticleRow key={a.id} article={a} now={now} extra={<>owner <PersonName id={a.ownerId} /></>} />
        ))}
      </Queue>

      <Queue
        title="Ownership to fix"
        count={ownership.length + orphanedSections.length}
        empty={scope === "mine" ? "Nothing here that you're able to fix." : "Every article and section has active ownership."}
      >
        {orphanedSections.map((s) => (
          <li key={s.id} className="article-row">
            <div className="article-row__main">
              <span className="article-row__title">Section: {s.name}</span>
              <span className="article-row__meta">
                Section owner <PersonName id={s.ownerId} />. Articles here have no escalation point.
              </span>
            </div>
            <div className="article-row__badges">
              <Badge tone="bad">No active owner</Badge>
            </div>
          </li>
        ))}
        {ownership.map((a) => (
          <ArticleRow key={a.id} article={a} now={now} />
        ))}
      </Queue>
    </>
  );
}

function Queue({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="card__title">
        {title} <span className="count">{count}</span>
      </h2>
      {count ? <ul className="article-list">{children}</ul> : <Empty>{empty}</Empty>}
    </section>
  );
}
