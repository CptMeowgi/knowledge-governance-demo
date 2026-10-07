import { useState, type FormEvent } from "react";
import { sectionOwnershipIssues } from "../domain/ownership";
import type { SearchEvent } from "../domain/types";
import { useStore } from "../store/store";
import { ArticleRow, Badge, Empty, Notice, PageHead, PersonName } from "../ui/bits";
import { plural } from "../ui/format";
import { link } from "../ui/router";

export function Library() {
  const { kb, now, search, openSearchResult } = useStore();
  const [query, setQuery] = useState("");
  const [lastSearch, setLastSearch] = useState<SearchEvent | null>(null);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    setLastSearch(query.trim() ? search(query.trim()) : null);
  }

  const results = lastSearch?.resultIds.flatMap((id) => kb.articles.filter((a) => a.id === id)) ?? [];

  return (
    <>
      <PageHead
        title="Library"
        actions={
          <a className="btn btn--primary" href={link("/new")}>
            New article
          </a>
        }
      >
        Every article, with its lifecycle state, review status and ownership visible at a glance. Readers only ever see
        published content; the rest is shown here so the governance is visible.
      </PageHead>

      <form className="search" onSubmit={onSearch} role="search">
        <input
          className="input search__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search published articles, e.g. “login locked” or “vpn split tunnel”"
          aria-label="Search published articles"
        />
        <button className="btn btn--primary" type="submit">
          Search
        </button>
      </form>

      {lastSearch && (
        <section className="card search-results" aria-live="polite">
          <h2 className="card__title">
            {plural(results.length, "result")} for “{lastSearch.query}”
          </h2>
          {results.length ? (
            <>
              <ul className="article-list">
                {results.map((article) => (
                  <li key={article.id} className="search-hit">
                    <a
                      className="article-row__title"
                      href={link(`/article/${article.id}?via=search`)}
                      onClick={() => openSearchResult(lastSearch.id, article.id)}
                    >
                      {article.title}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="hint">
                Searches where nothing gets opened count as failed, just like empty results. Enough of them on one topic
                becomes a gap.
              </p>
            </>
          ) : (
            <Notice tone="warn">
              Nothing found. This search has been recorded, and if enough people search for the same thing and find
              nothing, it appears on the <a href={link("/gaps")}>gaps list</a> as evidence of missing content.
            </Notice>
          )}
        </section>
      )}

      <div className="sections">
        {kb.sections.map((section) => {
          const articles = kb.articles
            .filter((a) => a.sectionId === section.id)
            .sort((a, b) => Number(a.state === "retired") - Number(b.state === "retired") || a.title.localeCompare(b.title));
          const issues = sectionOwnershipIssues(section, kb);
          return (
            <section key={section.id} className="card">
              <header className="section-head">
                <div>
                  <h2 className="card__title">{section.name}</h2>
                  <p className="muted">{section.description}</p>
                </div>
                <div className="section-head__owner">
                  <span className="label">Section owner</span>
                  <PersonName id={section.ownerId} />
                  {issues.length > 0 && <Badge tone="bad">No active owner</Badge>}
                </div>
              </header>
              {articles.length ? (
                <ul className="article-list">
                  {articles.map((article) => (
                    <ArticleRow key={article.id} article={article} now={now} />
                  ))}
                </ul>
              ) : (
                <Empty>No articles yet.</Empty>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
