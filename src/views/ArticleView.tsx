import { useEffect, useMemo, useState, type FormEvent } from "react";
import { detectGaps, gapStatus, type GapView } from "../domain/gaps";
import { blockers, type Action } from "../domain/lifecycle";
import { POLICY } from "../domain/policy";
import { reviewInfo } from "../domain/review";
import { TEMPLATES } from "../domain/templates";
import { topReason, usageByArticle } from "../domain/usage";
import type { ActionType, Article, Body, FeedbackReason, HistoryEntry, RetirementReason } from "../domain/types";
import { useStore } from "../store/store";
import { Badge, Notice, OwnershipFlags, PersonName, Reasons, ReviewBadge, StateBadge } from "../ui/bits";
import { percent, plural, relativeDays, shortDate } from "../ui/format";
import { FEEDBACK_REASONS, RETIREMENT_REASONS } from "../ui/labels";
import { link } from "../ui/router";

export function ArticleView({ id, via }: { id: string; via: "search" | "browse" }) {
  const { kb, actor, recordView } = useStore();
  const article = kb.articles.find((a) => a.id === id);
  const published = article?.state === "published";

  // Count a view once per visit. The timeout absorbs React's development double-mount.
  useEffect(() => {
    if (!published) return;
    const timer = window.setTimeout(() => recordView(id, via), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, published]);

  if (!article) {
    return (
      <Notice tone="warn">
        That article doesn't exist. <a href={link("/")}>Back to the library</a>.
      </Notice>
    );
  }

  return (
    <div className="article-layout">
      <ArticleMain key={article.id} article={article} />
      <aside className="article-side">
        <ActionsPanel key={`${article.id}:${actor.id}`} article={article} />
        {published && <Feedback key={article.id} article={article} />}
        {published && <UsagePanel article={article} />}
        <HistoryPanel article={article} />
      </aside>
    </div>
  );
}

function ArticleMain({ article }: { article: Article }) {
  const { kb, now } = useStore();
  const section = kb.sections.find((s) => s.id === article.sectionId);
  const template = TEMPLATES[article.type];
  const review = reviewInfo(article, now);
  const [showing, setShowing] = useState<"live" | "revision">("live");
  const gapView = useMemo(() => {
    const gap = detectGaps(kb, now).find((g) => g.kind === "article" && g.articleId === article.id);
    return gap && gapStatus(gap, kb);
  }, [kb, now, article.id]);
  const replacement = article.retirement?.supersededBy
    ? kb.articles.find((a) => a.id === article.retirement?.supersededBy)
    : undefined;
  const shown: { title: string; body: Body } =
    showing === "revision" && article.revision ? article.revision : article;

  return (
    <article className="article-main card">
      <p className="eyebrow">
        <a href={link("/")}>Library</a> / {section?.name} / {template.label}
      </p>
      <h1 className="article-title">{shown.title || "Untitled draft"}</h1>
      <div className="badges">
        <StateBadge article={article} />
        <ReviewBadge article={article} now={now} />
        <OwnershipFlags article={article} kb={kb} />
      </div>

      {gapView && <GapNotice view={gapView} />}
      {article.state === "retired" && article.retirement && (
        <Notice tone="warn">
          Retired as <strong>{RETIREMENT_REASONS[article.retirement.reason].split(":")[0].toLowerCase()}</strong>
          {replacement && (
            <>
              . Readers are sent to <a href={link(`/article/${replacement.id}`)}>{replacement.title}</a>
            </>
          )}
          {article.retirement.note && <>. {article.retirement.note}</>}
        </Notice>
      )}
      {article.revision && (
        <div className="revision-switch">
          <p>
            A revision by <PersonName id={article.revision.authorId} /> is{" "}
            {article.revision.state === "in_review" ? "waiting for review" : "being drafted"}. Readers keep seeing the
            published version until it's approved.
          </p>
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={showing === "live"} className={showing === "live" ? "is-active" : ""} onClick={() => setShowing("live")}>
              Published version
            </button>
            <button role="tab" aria-selected={showing === "revision"} className={showing === "revision" ? "is-active" : ""} onClick={() => setShowing("revision")}>
              Pending revision
            </button>
          </div>
        </div>
      )}

      <div className="article-body">
        {template.fields.map((field) => {
          const text = shown.body[field.key]?.trim();
          if (!text && !field.required) return null;
          return (
            <section key={field.key} className="article-field">
              <h2>{field.label}</h2>
              {text ? <p className="field-text">{text}</p> : <p className="missing">Not written yet. Required by the template.</p>}
            </section>
          );
        })}
      </div>

      <dl className="meta-grid">
        <div>
          <dt>Owner</dt>
          <dd>
            <PersonName id={article.ownerId} />
          </dd>
        </div>
        <div>
          <dt>Reviewer</dt>
          <dd>
            <PersonName id={article.reviewerId} />
          </dd>
        </div>
        <div>
          <dt>Last edited by</dt>
          <dd>
            <PersonName id={article.authorId} />
          </dd>
        </div>
        <div>
          <dt>Review cycle</dt>
          <dd>Every {plural(article.reviewIntervalDays, "day")}</dd>
        </div>
        <div>
          <dt>Last reviewed</dt>
          <dd>{article.lastReviewedAt ? shortDate(article.lastReviewedAt) : "Never"}</dd>
        </div>
        <div>
          <dt>Next review</dt>
          <dd>{review?.dueAt ? `${shortDate(review.dueAt)} (${relativeDays(review.dueAt, now)})` : "When published"}</dd>
        </div>
      </dl>
    </article>
  );
}

const SUCCESS: Partial<Record<ActionType, string>> = {
  submit: "Submitted for review.",
  request_changes: "Sent back to the author with your note.",
  discard_revision: "Revision discarded. The published version is unchanged.",
  recertify: "Recertified as accurate. The review clock has restarted.",
  retire: "Retired. It no longer appears in search.",
  restore: "Restored to draft. It has to pass review before it's published again.",
  assign: "Ownership updated.",
};

const DESCRIPTIONS: Record<ActionType, string> = {
  edit: "Change the content. Edits to published articles become a revision, and readers keep the current version until it's approved.",
  submit: "Send it to the assigned reviewer. Checks the template, the glossary and ownership first.",
  approve: "Publish it. The reviewer can't approve a version they wrote themselves.",
  request_changes: "Send it back to the author with a note saying what to fix.",
  discard_revision: "Drop the pending change and keep the published version.",
  recertify: "Confirm the content is still accurate. Restarts the review clock without changing anything.",
  retire: "Take it out of search, with a reason. It can be restored later.",
  restore: "Bring a retired article back as a draft. It has to pass review again.",
  assign: "Change the owner, the reviewer or how often it's reviewed.",
};

/** Actions that make sense for the article's current state. Each still has to pass its guards. */
function relevantActions(article: Article): ActionType[] {
  switch (article.state) {
    case "draft":
      return ["edit", "submit", "assign"];
    case "in_review":
      return ["approve", "request_changes", "assign"];
    case "published":
      if (article.revision?.state === "in_review") return ["approve", "request_changes", "discard_revision", "recertify", "assign"];
      if (article.revision) return ["edit", "submit", "discard_revision", "recertify", "assign"];
      return ["edit", "recertify", "retire", "assign"];
    case "retired":
      return ["restore"];
  }
}

function actionLabel(type: ActionType, article: Article): string {
  const onRevision = article.state === "published";
  switch (type) {
    case "edit":
      return article.state === "draft" ? "Edit draft" : article.revision ? "Edit the revision" : "Propose a change";
    case "submit":
      return onRevision ? "Submit revision for review" : "Submit for review";
    case "approve":
      return onRevision ? "Approve revision" : "Approve and publish";
    case "request_changes":
      return "Request changes";
    case "discard_revision":
      return "Discard revision";
    case "recertify":
      return "Recertify as accurate";
    case "retire":
      return "Retire";
    case "restore":
      return "Restore to draft";
    case "assign":
      return "Change ownership";
  }
}

function GapNotice({ view }: { view: GapView }) {
  const people = <strong>{plural(view.gap.peopleFailed, "person", "people")}</strong>;
  const gapsLink = <a href={link("/gaps")}>gaps list</a>;
  switch (view.status) {
    case "open":
      return (
        <Notice tone="bad">
          This article is on the {gapsLink}: an estimated {people} weren't helped by it in the last {POLICY.gapWindowDays} days.
        </Notice>
      );
    case "in_progress":
      return (
        <Notice tone="info">
          This article is on the {gapsLink} ({people} not helped in the last {POLICY.gapWindowDays} days), and a fix is in
          progress.
        </Notice>
      );
    case "resolved":
      return (
        <Notice tone="ok">
          A fix for this article's gap has been approved, so the gap is marked resolved. The usage figures still include
          the {POLICY.gapWindowDays} days before the fix.
        </Notice>
      );
    case "dismissed":
      return null;
  }
}

function ActionsPanel({ article }: { article: Article }) {
  const { kb, actor, now, act } = useStore();
  const context = { kb, actorId: actor.id, now };
  const [open, setOpen] = useState<ActionType | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string; reasons?: string[] } | null>(null);
  const [note, setNote] = useState("");
  const [retireReason, setRetireReason] = useState<RetirementReason>("obsolete");
  const [replacementId, setReplacementId] = useState("");
  const [ownerId, setOwnerId] = useState(article.ownerId ?? "");
  const [reviewerId, setReviewerId] = useState(article.reviewerId ?? "");
  const [intervalDays, setIntervalDays] = useState(String(article.reviewIntervalDays));

  function run(action: Action) {
    const result = act(article.id, action);
    if (result.ok) {
      const text =
        action.type === "approve"
          ? article.state === "published"
            ? "Revision approved. Readers now see the new version, and the review clock has restarted."
            : "Approved and published."
          : (SUCCESS[action.type] ?? "Done.");
      setOutcome({ ok: true, text });
      setOpen(null);
      setNote("");
    } else {
      setOutcome({ ok: false, text: "That didn't go through:", reasons: result.reasons });
    }
  }

  function simple(type: ActionType) {
    switch (type) {
      case "submit":
      case "approve":
      case "recertify":
      case "restore":
      case "discard_revision":
        return run({ type });
      default:
        setOutcome(null);
        return setOpen(open === type ? null : type);
    }
  }

  function submitForm(event: FormEvent, type: ActionType) {
    event.preventDefault();
    if (type === "request_changes") return run({ type, note });
    if (type === "retire") {
      return run({ type, reason: retireReason, note, supersededBy: retireReason === "superseded" ? replacementId : undefined });
    }
    if (type === "assign") {
      const days = Number(intervalDays);
      return run({
        type,
        ownerId: ownerId && ownerId !== article.ownerId ? ownerId : undefined,
        reviewerId: reviewerId && reviewerId !== article.reviewerId ? reviewerId : undefined,
        reviewIntervalDays: days !== article.reviewIntervalDays ? days : undefined,
      });
    }
  }

  const people = kb.people.filter((p) => p.active);
  const replacements = kb.articles.filter((a) => a.state === "published" && a.id !== article.id);

  return (
    <section className="card panel">
      <h2 className="panel__title">What you can do</h2>
      <p className="panel__sub">
        As <strong>{actor.name}</strong>. Switch who you're viewing as at the top to try other roles.
      </p>
      {outcome && (
        <Notice tone={outcome.ok ? "ok" : "bad"}>
          {outcome.text}
          {outcome.reasons && <Reasons reasons={outcome.reasons} />}
        </Notice>
      )}

      <ul className="actions">
        {relevantActions(article).map((type) => {
          const reasons = blockers(article, type, context);
          const allowed = reasons.length === 0;
          const primary = allowed && (type === "submit" || type === "approve");
          return (
            <li key={type} className={`action${allowed ? "" : " action--blocked"}`}>
              {type === "edit" ? (
                allowed ? (
                  <a className="btn btn--secondary" href={link(`/article/${article.id}/edit`)}>
                    {actionLabel(type, article)}
                  </a>
                ) : (
                  <button className="btn btn--secondary" disabled>
                    {actionLabel(type, article)}
                  </button>
                )
              ) : (
                <button className={`btn ${primary ? "btn--primary" : "btn--secondary"}`} disabled={!allowed} onClick={() => simple(type)} aria-expanded={open === type}>
                  {actionLabel(type, article)}
                </button>
              )}
              <p className="action__desc">{DESCRIPTIONS[type]}</p>
              {!allowed && <Reasons reasons={reasons} />}

              {allowed && open === "request_changes" && type === "request_changes" && (
                <form className="action__form" onSubmit={(e) => submitForm(e, type)}>
                  <label className="field">
                    <span>What needs to change?</span>
                    <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <button className="btn btn--primary" type="submit">
                    Send back
                  </button>
                </form>
              )}

              {allowed && open === "retire" && type === "retire" && (
                <form className="action__form" onSubmit={(e) => submitForm(e, type)}>
                  <label className="field">
                    <span>Reason</span>
                    <select className="select" value={retireReason} onChange={(e) => setRetireReason(e.target.value as RetirementReason)}>
                      {Object.entries(RETIREMENT_REASONS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {retireReason === "superseded" && (
                    <label className="field">
                      <span>Replaced by</span>
                      <select className="select" value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
                        <option value="">Choose a published article…</option>
                        {replacements.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="field">
                    <span>Note (optional)</span>
                    <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <button className="btn btn--danger" type="submit">
                    Retire article
                  </button>
                </form>
              )}

              {allowed && open === "assign" && type === "assign" && (
                <form className="action__form" onSubmit={(e) => submitForm(e, type)}>
                  <label className="field">
                    <span>Owner</span>
                    <PersonSelect value={ownerId} onChange={setOwnerId} people={people} currentId={article.ownerId} />
                  </label>
                  <label className="field">
                    <span>Reviewer</span>
                    <PersonSelect value={reviewerId} onChange={setReviewerId} people={people} currentId={article.reviewerId} />
                  </label>
                  <label className="field">
                    <span>
                      Review every (days, {POLICY.reviewIntervalDays.min}–{POLICY.reviewIntervalDays.max})
                    </span>
                    <input className="input" type="number" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
                  </label>
                  <button className="btn btn--primary" type="submit">
                    Save ownership
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PersonSelect({
  value,
  onChange,
  people,
  currentId,
}: {
  value: string;
  onChange: (id: string) => void;
  people: { id: string; name: string; title: string }[];
  currentId: string | null;
}) {
  const { kb } = useStore();
  const current = currentId ? kb.people.find((p) => p.id === currentId) : undefined;
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">Nobody assigned</option>}
      {current && !current.active && (
        <option value={current.id} disabled>
          {current.name} (has left)
        </option>
      )}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}, {p.title}
        </option>
      ))}
    </select>
  );
}

function Feedback({ article }: { article: Article }) {
  const { recordFeedback } = useStore();
  const [step, setStep] = useState<"ask" | "why" | "done">("ask");
  const [reason, setReason] = useState<FeedbackReason>("out_of_date");
  const [comment, setComment] = useState("");

  function send(event: FormEvent) {
    event.preventDefault();
    recordFeedback(article.id, false, reason, comment);
    setStep("done");
  }

  return (
    <section className="card panel">
      <h2 className="panel__title">Was this helpful?</h2>
      {step === "ask" && (
        <div className="button-row">
          <button
            className="btn btn--secondary"
            onClick={() => {
              recordFeedback(article.id, true);
              setStep("done");
            }}
          >
            Yes
          </button>
          <button className="btn btn--secondary" onClick={() => setStep("why")}>
            No
          </button>
        </div>
      )}
      {step === "why" && (
        <form className="action__form" onSubmit={send}>
          <fieldset className="choice-group">
            <legend>What was wrong?</legend>
            {Object.entries(FEEDBACK_REASONS).map(([value, label]) => (
              <label key={value} className="choice">
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value as FeedbackReason)} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Anything else? (optional)</span>
            <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button className="btn btn--primary" type="submit">
            Send feedback
          </button>
        </form>
      )}
      {step === "done" && (
        <p className="muted">
          Thanks, that's recorded. Ratings feed the <a href={link("/gaps")}>gaps list</a> and the{" "}
          <a href={link("/report")}>report</a>.
        </p>
      )}
    </section>
  );
}

function UsagePanel({ article }: { article: Article }) {
  const { kb, now } = useStore();
  const usage = usageByArticle(kb.events, now, POLICY.gapWindowDays).get(article.id);
  const rated = (usage?.ratings ?? 0) >= POLICY.minRatings;
  const reason = usage ? topReason(usage) : null;
  return (
    <section className="card panel">
      <h2 className="panel__title">Last {POLICY.gapWindowDays} days</h2>
      <dl className="stats">
        <div>
          <dt>Views</dt>
          <dd>{usage?.views ?? 0}</dd>
        </div>
        <div>
          <dt>Ratings</dt>
          <dd>{usage?.ratings ?? 0}</dd>
        </div>
        <div>
          <dt>Helpful</dt>
          <dd>{rated && usage ? percent(usage.helpful / usage.ratings) : "—"}</dd>
        </div>
      </dl>
      {!rated && <p className="hint">Fewer than {POLICY.minRatings} ratings: too few to judge.</p>}
      {reason && <p className="hint">Most common complaint: {FEEDBACK_REASONS[reason].toLowerCase()}.</p>}
    </section>
  );
}

const VERBS: Record<HistoryEntry["action"], string> = {
  create: "created the draft",
  edit: "edited",
  submit: "submitted for review",
  request_changes: "requested changes",
  approve: "approved and published",
  discard_revision: "discarded the revision",
  recertify: "recertified as accurate",
  retire: "retired the article",
  restore: "restored it to draft",
  assign: "changed ownership",
};

function HistoryPanel({ article }: { article: Article }) {
  const entries = [...article.history].reverse();
  return (
    <section className="card panel">
      <h2 className="panel__title">History</h2>
      <ol className="timeline">
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${index}`}>
            <span className="timeline__date">{shortDate(entry.at)}</span>
            <span>
              <PersonName id={entry.actorId} /> {VERBS[entry.action]}
              {entry.revision && <Badge tone="info">revision</Badge>}
            </span>
            {entry.note && <span className="timeline__note">“{entry.note}”</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
