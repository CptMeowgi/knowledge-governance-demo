import { useState, type FormEvent } from "react";
import { TEMPLATES } from "../domain/templates";
import type { ArticleType } from "../domain/types";
import { useStore } from "../store/store";
import { Notice, PageHead, Reasons } from "../ui/bits";
import { go } from "../ui/router";

/** Starts a draft. Opened with ?title=…&gap=… when creating a draft from a gap. */
export function NewArticle({ query }: { query: URLSearchParams }) {
  const { kb, createArticle } = useStore();
  const gapKey = query.get("gap") ?? undefined;
  const [title, setTitle] = useState(query.get("title") ?? "");
  const [sectionId, setSectionId] = useState(query.get("section") ?? kb.sections[0]?.id ?? "");
  const [type, setType] = useState<ArticleType>("how-to");
  const [failure, setFailure] = useState<string[] | null>(null);

  function create(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return setFailure(["Give it a working title."]);
    const result = createArticle({ title: title.trim(), sectionId, type }, gapKey);
    if (!result.ok) return setFailure(result.reasons);
    go(`/article/${result.article.id}/edit`);
  }

  return (
    <>
      <PageHead title="New article">
        Pick a section and a template. The owner, reviewer and review cycle are filled in from the section and the
        template, and can be changed later.
      </PageHead>
      {gapKey && (
        <Notice tone="info">
          You're answering a gap. Creating this draft marks the gap as in progress and links the two, and the gap resolves
          once this article is approved.
        </Notice>
      )}
      <form className="card form" onSubmit={create}>
        <label className="field">
          <span className="field__label">Working title</span>
          <input className="input input--large" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field__label">Section</span>
          <select className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {kb.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="template-picker">
          <legend className="field__label">Template</legend>
          {Object.values(TEMPLATES).map((template) => (
            <label key={template.type} className={`template-option${type === template.type ? " is-selected" : ""}`}>
              <input type="radio" name="type" value={template.type} checked={type === template.type} onChange={() => setType(template.type)} />
              <strong>{template.label}</strong>
              <span className="muted">{template.purpose}</span>
              <span className="hint">
                Reviewed every {template.defaultReviewIntervalDays} days ·{" "}
                {template.fields.filter((f) => f.required).map((f) => f.label).join(", ")}
              </span>
            </label>
          ))}
        </fieldset>
        {failure && <Reasons reasons={failure} />}
        <button className="btn btn--primary" type="submit">
          Create draft
        </button>
      </form>
    </>
  );
}
