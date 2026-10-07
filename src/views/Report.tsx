import { useMemo, type ReactNode } from "react";
import { articleOwnershipIssues, OWNERSHIP_ISSUE_LABELS, sectionOwnershipIssues } from "../domain/ownership";
import { POLICY } from "../domain/policy";
import { buildReport, firstPublishedAt } from "../domain/report";
import { reviewInfo } from "../domain/review";
import { daysSince } from "../domain/time";
import { usageByArticle } from "../domain/usage";
import { useStore } from "../store/store";
import { Empty, PageHead, PersonName } from "../ui/bits";
import { percent, plural } from "../ui/format";
import { link } from "../ui/router";

export function Report() {
  const { kb, now } = useStore();
  const report = useMemo(() => buildReport(kb, now), [kb, now]);
  const { searchSuccess, staleness, ownership, helpfulness, deadContent, reuse, pipeline } = report;

  const overdue = kb.articles
    .map((article) => ({ article, info: reviewInfo(article, now) }))
    .filter(({ info }) => info?.status === "overdue")
    .sort((a, b) => (a.info?.daysUntilDue ?? 0) - (b.info?.daysUntilDue ?? 0));
  const orphaned = kb.articles.filter((a) => articleOwnershipIssues(a, kb).length);
  const ownerlessSections = kb.sections.filter((s) => sectionOwnershipIssues(s, kb).length);
  const longTermViews = usageByArticle(kb.events, now, POLICY.deadContentDays);
  const dead = kb.articles.filter((a) => {
    if (a.state !== "published") return false;
    const since = firstPublishedAt(a);
    return (!since || daysSince(since, now) > POLICY.deadContentDays) && !longTermViews.get(a.id)?.views;
  });

  return (
    <>
      <PageHead title="Report">
        A handful of numbers, every one calculated from the knowledge base and its usage log. Where there's nothing to
        measure the report says so, instead of showing a reassuring 100%.
      </PageHead>

      <div className="metrics">
        <Metric label="Search success" value={percent(searchSuccess.rate)}>
          {searchSuccess.successful} of {plural(searchSuccess.searches, "search", "searches")} in the last {POLICY.gapWindowDays} days found
          something that was opened.
        </Metric>
        <Metric label="Stale content" value={percent(staleness.share)} tone={staleness.overdue ? "bad" : "ok"}>
          {staleness.overdue} of {plural(staleness.published, "published article")} are past their review date.
        </Metric>
        <Metric label="Ownership gaps" value={String(ownership.articlesWithIssues)} tone={ownership.articlesWithIssues ? "bad" : "ok"}>
          articles without an active owner or reviewer. {plural(ownership.sectionsWithoutOwner, "section")} without an active
          owner.
        </Metric>
        <Metric label="Rated helpful" value={percent(helpfulness.rate)}>
          {helpfulness.helpful} of {plural(helpfulness.ratings, "rating")} in the last {POLICY.gapWindowDays} days.
        </Metric>
        <Metric label="Dead content" value={String(deadContent.dead)} tone={deadContent.dead ? "warn" : "ok"}>
          of {plural(deadContent.eligible, "article")} live for over {POLICY.deadContentDays} days had no readers in that time.
          Candidates for retirement.
        </Metric>
        <Metric label="Reuse concentration" value={percent(reuse.topShare)}>
          of views in the last {POLICY.gapWindowDays} days went to the top {plural(reuse.topArticles, "article")}, the
          busiest {percent(POLICY.reuseTopShare)} of published content.
        </Metric>
        <Metric label="Review pipeline" value={String(pipeline.in_review + pipeline.revisionsInReview)}>
          waiting for a reviewer
          {pipeline.oldestInReviewDays !== null && `, the oldest for ${plural(Math.floor(pipeline.oldestInReviewDays), "day")}`}.{" "}
          {pipeline.draft} drafts, {pipeline.published} published, {pipeline.retired} retired.
        </Metric>
      </div>

      <div className="report-lists">
        <section className="card">
          <h2 className="card__title">Overdue for review</h2>
          {overdue.length ? (
            <ul className="plain-list">
              {overdue.map(({ article, info }) => (
                <li key={article.id}>
                  <a href={link(`/article/${article.id}`)}>{article.title}</a>
                  <span className="muted">
                    {" "}
                    · {plural(Math.abs(Math.round(info?.daysUntilDue ?? 0)), "day")} overdue · owner <PersonName id={article.ownerId} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing is overdue.</Empty>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">Ownership gaps</h2>
          {orphaned.length || ownerlessSections.length ? (
            <ul className="plain-list">
              {ownerlessSections.map((s) => (
                <li key={s.id}>
                  Section: {s.name} <span className="muted">· owner <PersonName id={s.ownerId} /></span>
                </li>
              ))}
              {orphaned.map((a) => (
                <li key={a.id}>
                  <a href={link(`/article/${a.id}`)}>{a.title}</a>
                  <span className="muted"> · {articleOwnershipIssues(a, kb).map((i) => OWNERSHIP_ISSUE_LABELS[i].toLowerCase()).join(", ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Everything has active ownership.</Empty>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">Retirement candidates</h2>
          {dead.length ? (
            <ul className="plain-list">
              {dead.map((a) => (
                <li key={a.id}>
                  <a href={link(`/article/${a.id}`)}>{a.title}</a>
                  <span className="muted"> · no views in {POLICY.deadContentDays} days</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Everything published has readers.</Empty>
          )}
        </section>
      </div>
    </>
  );
}

function Metric({ label, value, tone = "neutral", children }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" | "bad"; children: ReactNode }) {
  return (
    <section className={`card metric metric--${tone}`}>
      <h2 className="metric__label">{label}</h2>
      <p className="metric__value">{value}</p>
      <p className="metric__detail">{children}</p>
    </section>
  );
}
