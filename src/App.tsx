import { useMemo } from "react";
import { detectGaps, gapStatus } from "./domain/gaps";
import { workingCopy } from "./domain/lifecycle";
import { StoreProvider, useStore } from "./store/store";
import { Notice } from "./ui/bits";
import { link, useRoute } from "./ui/router";
import { ArticleEditor } from "./views/ArticleEditor";
import { ArticleView } from "./views/ArticleView";
import { Gaps } from "./views/Gaps";
import { Library } from "./views/Library";
import { NewArticle } from "./views/NewArticle";
import { Report } from "./views/Report";
import { ReviewQueue } from "./views/ReviewQueue";
import { Standards } from "./views/Standards";

const REPO_URL = "https://github.com/CptMeowgi/knowledge-governance-demo";

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { segments, query } = useRoute();
  const { kb, actor, now, setActorId, reset, storageAvailable } = useStore();
  const [page, id, mode] = segments;

  const waitingForMe = kb.articles.filter((a) => workingCopy(a)?.state === "in_review" && a.reviewerId === actor.id).length;
  const openGaps = useMemo(
    () => detectGaps(kb, now).filter((gap) => gapStatus(gap, kb).status === "open").length,
    [kb, now],
  );

  const nav: { path: string; label: string; active: boolean; count?: number }[] = [
    { path: "/", label: "Library", active: !page || page === "article" || page === "new" },
    { path: "/review", label: "Review queue", active: page === "review", count: waitingForMe },
    { path: "/gaps", label: "Gaps", active: page === "gaps", count: openGaps },
    { path: "/report", label: "Report", active: page === "report" },
    { path: "/standards", label: "Standards", active: page === "standards" },
  ];

  function confirmReset() {
    if (window.confirm("Reset the demo to its starting data? Everything you've changed will be lost.")) {
      reset();
      window.location.hash = "/";
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__inner">
          <a className="brand" href={link("/")}>
            Knowledge Base <span className="brand__version">2.0</span>
          </a>
          <nav className="nav" aria-label="Main">
            {nav.map((item) => (
              <a key={item.path} href={link(item.path)} className={`nav__link${item.active ? " is-active" : ""}`} aria-current={item.active ? "page" : undefined}>
                {item.label}
                {!!item.count && <span className="nav__count">{item.count}</span>}
              </a>
            ))}
          </nav>
          <div className="header-tools">
            <label className="viewing-as">
              <span className="viewing-as__label">Viewing as</span>
              <select className="select select--small" value={actor.id} onChange={(e) => setActorId(e.target.value)}>
                {kb.people.map((person) => (
                  <option key={person.id} value={person.id} disabled={!person.active}>
                    {person.name}, {person.title}
                    {person.active ? "" : " (has left)"}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn--ghost btn--small" onClick={confirmReset}>
              Reset demo data
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {!storageAvailable && (
          <Notice tone="warn">This browser isn't letting the demo save, so your changes will last until you reload the page.</Notice>
        )}
        {(() => {
          switch (page) {
            case undefined:
              return <Library />;
            case "article":
              return mode === "edit" ? <ArticleEditor id={id} /> : <ArticleView id={id} via={query.get("via") === "search" ? "search" : "browse"} />;
            case "new":
              return <NewArticle query={query} />;
            case "review":
              return <ReviewQueue key={actor.id} />;
            case "gaps":
              return <Gaps />;
            case "report":
              return <Report />;
            case "standards":
              return <Standards />;
            default:
              return (
                <Notice tone="warn">
                  There's no page here. <a href={link("/")}>Back to the library</a>.
                </Notice>
              );
          }
        })()}
      </main>

      <footer className="footer">
        <p>
          Knowledge Base 2.0 is an independent demonstration project. Every person, article and number in it is invented.
          Changes are saved in this browser only.
        </p>
        <p>
          <a href={REPO_URL}>Source and design notes on GitHub</a>
        </p>
      </footer>
    </div>
  );
}
