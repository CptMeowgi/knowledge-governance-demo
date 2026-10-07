import { useMemo, useState, type FormEvent } from "react";
import { detectGaps, dismissGap, gapStatus, reopenGap, startWork, type ArticleSignal, type Gap, type GapStatus, type GapView } from "../domain/gaps";
import { POLICY } from "../domain/policy";
import { useStore } from "../store/store";
import { Badge, Empty, Notice, PageHead, PersonName, Reasons } from "../ui/bits";
import { percent, plural } from "../ui/format";
import { link } from "../ui/router";
import { FEEDBACK_REASONS } from "./ArticleView";

const SIGNALS: Record<ArticleSignal, string> = {
  low_helpfulness: "Low helpfulness",
  high_traffic_poor_outcome: "Busy article, poor outcome",
  high_traffic_overdue: "Busy article, review overdue",
};

const FILTERS: { status: GapStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "resolved", label: "Resolved" },
  { status: "dismissed", label: "Dismissed" },
];

export function Gaps() {
  const { kb, now } = useStore();
  const [filter, setFilter] = useState<GapStatus>("open");
  const views = useMemo(() => detectGaps(kb, now).map((gap) => gapStatus(gap, kb)), [kb, now]);
  const shown = views.filter((v) => v.status === filter);

  return (
    <>
      <PageHead title="Knowledge gaps">
        Nothing on this page was typed in by hand. Gaps are calculated from what people searched for, opened and rated
        over the last {POLICY.gapWindowDays} days, and ranked by one number: an estimate of how many people the knowledge
        base failed.
      </PageHead>

      <details className="card explainer">
        <summary>How a gap qualifies</summary>
        <ul>
          <li>
            <strong>Unmet search</strong>: similar searches are grouped. A group counts once it has at least{" "}
            {POLICY.minFailedSearches} failures and at least {percent(POLICY.minSearchFailureRate)} of it failed. A search
            fails if it found nothing, or if nothing it found was opened.
          </li>
          <li>
            <strong>Low helpfulness</strong>: a published article with at least {POLICY.minRatings} ratings and under{" "}
            {percent(POLICY.lowHelpfulRate)} rated helpful.
          </li>
          <li>
            <strong>Busy articles</strong> (top quarter by views) are held to a higher bar: under{" "}
            {percent(POLICY.highTrafficHelpfulRate)} helpful, or overdue for review.
          </li>
          <li>
            <strong>People failed</strong> = failed searches, or views × the share rated unhelpful. An overdue article
            without enough ratings is listed but scores 0: it's a risk, not yet proven failure.
          </li>
          <li>
            A dismissed gap reopens on its own if its evidence reaches {POLICY.reopenDismissedAtMultiple}× what it was when
            it was dismissed.
          </li>
        </ul>
      </details>

      <div className="filters" role="tablist" aria-label="Gap status">
        {FILTERS.map(({ status, label }) => (
          <button key={status} role="tab" aria-selected={filter === status} className={`chip${filter === status ? " is-active" : ""}`} onClick={() => setFilter(status)}>
            {label} <span className="count">{views.filter((v) => v.status === status).length}</span>
          </button>
        ))}
      </div>

      {shown.length ? (
        <ol className="gap-list">
          {shown.map((view) => (
            <GapCard key={view.gap.key} view={view} />
          ))}
        </ol>
      ) : (
        <Empty>No {FILTERS.find((f) => f.status === filter)?.label.toLowerCase()} gaps.</Empty>
      )}
    </>
  );
}

function GapCard({ view }: { view: GapView }) {
  const { kb, actor, now, setTriage } = useStore();
  const { gap, status, triage, reopened } = view;
  const article = gap.kind === "article" ? kb.articles.find((a) => a.id === gap.articleId) : undefined;
  const linked = triage?.linkedArticleId ? kb.articles.find((a) => a.id === triage.linkedArticleId) : undefined;
  const [assigneeId, setAssigneeId] = useState(defaultAssignee(gap));
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string[] | null>(null);

  function defaultAssignee(g: Gap): string {
    const sectionOwner = g.kind === "article" ? kb.sections.find((s) => s.id === g.sectionId)?.ownerId : undefined;
    const active = (id?: string | null) => (id && kb.people.find((p) => p.id === id)?.active ? id : undefined);
    return active(sectionOwner) ?? kb.people.find((p) => p.active && p.role === "knowledge_manager")?.id ?? actor.id;
  }

  function start() {
    const result = startWork(gap, kb, { assigneeId }, now);
    if (result.ok) setTriage(result.triage);
    else setFailure(result.reasons);
  }

  function dismiss(event: FormEvent) {
    event.preventDefault();
    const result = dismissGap(gap, kb, reason, now);
    if (result.ok) setTriage(result.triage);
    else setFailure(result.reasons);
  }

  const draftTitle = gap.kind === "unmet_search" ? gap.label.charAt(0).toUpperCase() + gap.label.slice(1) : "";

  return (
    <li className={`card gap gap--${status}`}>
      <div className="gap__score">
        <strong>{gap.peopleFailed}</strong>
        <span>people failed</span>
      </div>

      <div className="gap__body">
        <div className="badges">
          {gap.kind === "unmet_search" ? (
            <Badge tone="warn">Unmet search</Badge>
          ) : (
            gap.signals.map((s) => (
              <Badge key={s} tone="bad">
                {SIGNALS[s]}
              </Badge>
            ))
          )}
          {reopened && <Badge tone="bad">Reopened</Badge>}
        </div>

        <h2 className="gap__title">
          {gap.kind === "unmet_search" ? (
            <>People searching for “{gap.label}”</>
          ) : (
            <a href={link(`/article/${gap.articleId}`)}>{article?.title}</a>
          )}
        </h2>

        {gap.kind === "unmet_search" ? (
          <div className="evidence">
            <p>
              {plural(gap.evidence.searches, "search", "searches")} in {POLICY.gapWindowDays} days, {gap.evidence.failed} failed:{" "}
              {gap.evidence.zeroResults} found nothing and {gap.evidence.failed - gap.evidence.zeroResults} found results nobody
              opened.
            </p>
            <ul className="phrasings" aria-label="How people phrased it">
              {gap.evidence.phrasings.map((p) => (
                <li key={p.text}>
                  “{p.text}” <span className="muted">×{p.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="evidence">
            <p>
              {plural(gap.evidence.views, "view")} · {plural(gap.evidence.ratings, "rating")} ·{" "}
              {gap.evidence.helpfulRate === null ? `too few ratings to judge (under ${POLICY.minRatings})` : `${percent(gap.evidence.helpfulRate)} helpful`}
              {gap.evidence.topReason && <> · most common complaint: {FEEDBACK_REASONS[gap.evidence.topReason].toLowerCase()}</>}
            </p>
            {gap.evidence.complaints.map((c) => (
              <blockquote key={c}>{c}</blockquote>
            ))}
          </div>
        )}

        {reopened && triage && (
          <Notice tone="bad">
            Dismissed earlier (“{triage.note}”) with {triage.peopleFailedAtDismissal} people failed. The evidence has since grown
            to {gap.peopleFailed}, so it's back on the list.
          </Notice>
        )}
        {status === "in_progress" && triage && (
          <p className="gap__status">
            <PersonName id={triage.assigneeId} /> is working on it
            {linked && (
              <>
                {" "}
                · linked to <a href={link(`/article/${linked.id}`)}>{linked.title || "Untitled draft"}</a>. It resolves when that
                article is next approved.
              </>
            )}
          </p>
        )}
        {status === "resolved" && linked && (
          <Notice tone="ok">
            Resolved: <a href={link(`/article/${linked.id}`)}>{linked.title}</a> was approved after work started. The evidence
            here ages out over the next {POLICY.gapWindowDays} days.
          </Notice>
        )}
        {status === "dismissed" && triage && (
          <p className="gap__status">
            Dismissed: “{triage.note}”. It reopens on its own at{" "}
            {Math.max(1, triage.peopleFailedAtDismissal ?? 0) * POLICY.reopenDismissedAtMultiple} people failed.
          </p>
        )}

        {failure && <Reasons reasons={failure} />}

        <div className="gap__actions">
          {status === "open" && !dismissing && (
            <>
              <span className="inline-field">
                <select className="select select--small" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Who works on it">
                  {kb.people
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <button className="btn btn--secondary" onClick={start}>
                  Start work
                </button>
              </span>
              {gap.kind === "unmet_search" && (
                <a className="btn btn--primary" href={link(`/new?gap=${encodeURIComponent(gap.key)}&title=${encodeURIComponent(draftTitle)}`)}>
                  Create draft from gap
                </a>
              )}
              <button className="btn btn--ghost" onClick={() => setDismissing(true)}>
                Dismiss
              </button>
            </>
          )}
          {status === "open" && dismissing && (
            <form className="inline-form" onSubmit={dismiss}>
              <input className="input" placeholder="Why isn't this worth acting on?" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              <button className="btn btn--danger" type="submit">
                Dismiss
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => setDismissing(false)}>
                Cancel
              </button>
            </form>
          )}
          {(status === "in_progress" || status === "dismissed") && (
            <button className="btn btn--ghost" onClick={() => setTriage(reopenGap(gap, kb))}>
              {status === "dismissed" ? "Reopen" : "Stop work and reopen"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
