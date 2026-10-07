import { useId, useState } from "react";
import { findGlossaryViolations } from "../domain/glossary";
import { blockers, submissionProblems, workingCopy, type WorkingCopy } from "../domain/lifecycle";
import { TEMPLATES, emptyBody } from "../domain/templates";
import type { Article, Body } from "../domain/types";
import { useStore } from "../store/store";
import { Notice, PageHead, Reasons } from "../ui/bits";
import { go, link } from "../ui/router";

export function ArticleEditor({ id }: { id: string }) {
  const { kb } = useStore();
  const article = kb.articles.find((a) => a.id === id);
  if (!article) {
    return (
      <Notice tone="warn">
        That article doesn't exist. <a href={link("/")}>Back to the library</a>.
      </Notice>
    );
  }
  return <Editor key={article.id} article={article} />;
}

function Editor({ article }: { article: Article }) {
  const { kb, actor, now, act } = useStore();
  const template = TEMPLATES[article.type];
  const isRevision = article.state === "published";
  // A published article without a revision starts from its live content.
  const source = workingCopy(article) ?? { title: article.title, body: article.body };
  const [title, setTitle] = useState(source.title);
  const [body, setBody] = useState<Body>({ ...emptyBody(article.type), ...source.body });
  const [failure, setFailure] = useState<string[] | null>(null);
  const ids = useId();

  const editBlockers = blockers(article, "edit", { kb, actorId: actor.id, now });

  // Checked live, as if this person saved now (saving makes them the author).
  const preview: WorkingCopy = { title, body, authorId: actor.id, state: "draft", isRevision };
  const problems = submissionProblems(article, preview, kb);

  function save(thenSubmit: boolean) {
    const edited = act(article.id, { type: "edit", title, body });
    if (!edited.ok) return setFailure(edited.reasons);
    if (thenSubmit) {
      const submitted = act(article.id, { type: "submit" });
      if (!submitted.ok) return setFailure(submitted.reasons);
    }
    go(`/article/${article.id}`);
  }

  return (
    <>
      <PageHead title={isRevision ? "Propose a change" : "Edit draft"}>
        {isRevision
          ? "You're drafting a revision. Readers keep seeing the published version until the reviewer approves your change."
          : `${template.label} template: ${template.purpose.toLowerCase()} Required fields are marked.`}
      </PageHead>

      {editBlockers.length > 0 ? (
        <Notice tone="warn">
          You can't edit this right now:
          <Reasons reasons={editBlockers} />
          <a href={link(`/article/${article.id}`)}>Back to the article</a>
        </Notice>
      ) : (
        <div className="editor-layout">
          <div className="card editor">
            <div className="field">
              <label className="field__label" htmlFor={`${ids}-title`}>
                Title
              </label>
              <input
                id={`${ids}-title`}
                className="input input--large"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-describedby={`${ids}-title-glossary`}
              />
              <GlossaryHints id={`${ids}-title-glossary`} text={title} />
            </div>
            {template.fields.map((field) => {
              const id = `${ids}-${field.key}`;
              return (
                <div key={field.key} className="field">
                  <label className="field__label" htmlFor={id}>
                    {field.label}
                    {field.required ? <span className="required"> required</span> : <span className="muted"> optional</span>}
                  </label>
                  <span className="field__hint" id={`${id}-hint`}>
                    {field.hint}
                  </span>
                  <textarea
                    id={id}
                    className="textarea"
                    rows={field.key === "steps" || field.key === "resolution" || field.key === "details" ? 6 : 3}
                    value={body[field.key] ?? ""}
                    onChange={(e) => setBody({ ...body, [field.key]: e.target.value })}
                    aria-describedby={`${id}-hint ${id}-glossary`}
                  />
                  <GlossaryHints id={`${id}-glossary`} text={body[field.key] ?? ""} />
                </div>
              );
            })}
          </div>

          <aside className="card panel editor-checks">
            <h2 className="panel__title">Ready for review?</h2>
            {problems.length === 0 ? (
              <Notice tone="ok">Everything checks out. You can submit this for review.</Notice>
            ) : (
              <>
                <p className="panel__sub">Fix these before it can be submitted:</p>
                <Reasons reasons={problems} />
              </>
            )}
            {failure && (
              <Notice tone="bad">
                That didn't go through:
                <Reasons reasons={failure} />
              </Notice>
            )}
            <div className="button-col">
              <button className="btn btn--primary" disabled={problems.length > 0} onClick={() => save(true)}>
                Save and submit for review
              </button>
              <button className="btn btn--secondary" onClick={() => save(false)}>
                Save {isRevision ? "revision" : "draft"}
              </button>
              <a className="btn btn--ghost" href={link(`/article/${article.id}`)}>
                Cancel
              </a>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function GlossaryHints({ id, text }: { id: string; text: string }) {
  const { kb } = useStore();
  const violations = findGlossaryViolations(text, kb.glossary);
  // Always rendered, so aria-describedby points at something and screen readers hear new hints.
  return (
    <span className="glossary-hint" id={id} aria-live="polite">
      {violations.map((v) => (
        <span key={v.found}>
          Use “{v.preferred}” instead of “{v.found}”.{" "}
        </span>
      ))}
    </span>
  );
}
