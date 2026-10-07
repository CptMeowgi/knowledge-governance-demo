import type { ReactNode } from "react";
import { articleOwnershipIssues, OWNERSHIP_ISSUE_LABELS } from "../domain/ownership";
import { reviewInfo } from "../domain/review";
import { TEMPLATES } from "../domain/templates";
import type { Article, ArticleState, KnowledgeBase } from "../domain/types";
import { useStore } from "../store/store";
import { plural } from "./format";
import { link } from "./router";

type Tone = "neutral" | "info" | "ok" | "warn" | "bad" | "muted";

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATE_LABEL: Record<ArticleState, [string, Tone]> = {
  draft: ["Draft", "neutral"],
  in_review: ["In review", "info"],
  published: ["Published", "ok"],
  retired: ["Retired", "muted"],
};

export function StateBadge({ article }: { article: Article }) {
  const [label, tone] = STATE_LABEL[article.state];
  return (
    <>
      <Badge tone={tone}>{label}</Badge>
      {article.revision && (
        <Badge tone="info" title="A change to this article is being drafted or reviewed. Readers still see the published version.">
          Revision {article.revision.state === "in_review" ? "in review" : "in draft"}
        </Badge>
      )}
    </>
  );
}

/** Review status for published articles: when the content next needs re-certifying. */
export function ReviewBadge({ article, now }: { article: Article; now: Date }) {
  const info = reviewInfo(article, now);
  if (!info) return null;
  const days = Math.abs(Math.round(info.daysUntilDue ?? 0));
  if (info.status === "overdue") return <Badge tone="bad">Review overdue{info.daysUntilDue !== null && ` by ${plural(days, "day")}`}</Badge>;
  if (info.status === "due_soon") return <Badge tone="warn">Review due in {plural(days, "day")}</Badge>;
  return null;
}

export function OwnershipFlags({ article, kb }: { article: Article; kb: KnowledgeBase }) {
  return (
    <>
      {articleOwnershipIssues(article, kb).map((issue) => (
        <Badge key={issue} tone="bad">
          {OWNERSHIP_ISSUE_LABELS[issue]}
        </Badge>
      ))}
    </>
  );
}

export function PersonName({ id }: { id: string | null | undefined }) {
  const { kb } = useStore();
  const person = id ? kb.people.find((p) => p.id === id) : undefined;
  if (!person) return <span className="muted">Nobody</span>;
  return (
    <span className={person.active ? undefined : "person--left"} title={person.active ? person.title : `${person.title}, has left`}>
      {person.name}
      {!person.active && " (left)"}
    </span>
  );
}

/** The plain-language reasons an action is blocked. */
export function Reasons({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="reasons">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}

export function PageHead({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {children && <p className="page-intro">{children}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "bad"; children: ReactNode }) {
  return <div className={`notice notice--${tone}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** One line in an article list: title, where it lives, and every governance flag. */
export function ArticleRow({ article, now, extra }: { article: Article; now: Date; extra?: ReactNode }) {
  const { kb } = useStore();
  const section = kb.sections.find((s) => s.id === article.sectionId);
  return (
    <li className={`article-row${article.state === "retired" ? " article-row--retired" : ""}`}>
      <div className="article-row__main">
        <a className="article-row__title" href={link(`/article/${article.id}`)}>
          {article.title || "Untitled draft"}
        </a>
        <span className="article-row__meta">
          {TEMPLATES[article.type].label} · {section?.name}
          {extra && <> · {extra}</>}
        </span>
      </div>
      <div className="article-row__badges">
        <StateBadge article={article} />
        <ReviewBadge article={article} now={now} />
        <OwnershipFlags article={article} kb={kb} />
      </div>
    </li>
  );
}
