/**
 * App state: the knowledge base plus who you're "viewing as". Every change to
 * an article goes through the domain's transition() or createDraft(), so the
 * UI can't bypass a governance rule.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildSeed, DEFAULT_ACTOR_ID } from "../data/generate";
import { detectGaps, startWork } from "../domain/gaps";
import { createDraft, transition, type Action, type NewDraft, type TransitionResult } from "../domain/lifecycle";
import { searchArticles } from "../domain/search";
import type { Article, FeedbackReason, GapTriage, KnowledgeBase, Person, SearchEvent } from "../domain/types";
import { loadState, saveState, type SavedState } from "./storage";

interface Store {
  kb: KnowledgeBase;
  actor: Person;
  /** The moment the current state was produced. Derived views use it as "now". */
  now: Date;
  storageAvailable: boolean;
  setActorId(id: string): void;
  act(articleId: string, action: Action): TransitionResult;
  createArticle(input: Omit<NewDraft, "id">, fromGapKey?: string): TransitionResult;
  search(query: string): SearchEvent;
  openSearchResult(searchId: string, articleId: string): void;
  recordView(articleId: string, via: "search" | "browse"): void;
  recordFeedback(articleId: string, helpful: boolean, reason?: FeedbackReason, comment?: string): void;
  setTriage(triage: GapTriage[]): void;
  reset(): void;
}

const StoreContext = createContext<Store | null>(null);

const freshState = (): SavedState => ({ version: 1, kb: buildSeed(new Date()), actorId: DEFAULT_ACTOR_ID });

const newId = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "article";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SavedState>(() => loadState() ?? freshState());
  const [storageAvailable, setStorageAvailable] = useState(true);
  // Mirrors `state` synchronously, so two actions in a row (save, then submit) see each other.
  const current = useRef(state);

  const commit = useCallback((next: SavedState) => {
    current.current = next;
    setState(next);
  }, []);

  const updateKb = useCallback(
    (change: (kb: KnowledgeBase) => KnowledgeBase) => commit({ ...current.current, kb: change(current.current.kb) }),
    [commit],
  );

  useEffect(() => {
    setStorageAvailable(saveState(state));
  }, [state]);

  const now = useMemo(() => new Date(), [state]);

  const replaceArticle = (kb: KnowledgeBase, article: Article): KnowledgeBase => ({
    ...kb,
    articles: kb.articles.some((a) => a.id === article.id)
      ? kb.articles.map((a) => (a.id === article.id ? article : a))
      : [...kb.articles, article],
  });

  const store = useMemo<Store>(() => {
    const actor =
      state.kb.people.find((p) => p.id === state.actorId && p.active) ??
      state.kb.people.find((p) => p.active)!;

    return {
      kb: state.kb,
      actor,
      now,
      storageAvailable,

      setActorId: (actorId) => commit({ ...current.current, actorId }),

      act(articleId, action) {
        const { kb, actorId } = current.current;
        const article = kb.articles.find((a) => a.id === articleId);
        if (!article) return { ok: false, reasons: ["That article no longer exists."] };
        const result = transition(article, action, { kb, actorId, now: new Date() });
        if (result.ok) updateKb((base) => replaceArticle(base, result.article));
        return result;
      },

      createArticle(input, fromGapKey) {
        const { kb, actorId } = current.current;
        const at = new Date();
        const result = createDraft({ ...input, id: newId(slug(input.title)) }, { kb, actorId, now: at });
        if (!result.ok) return result;
        let next = replaceArticle(kb, result.article);
        // Creating a draft from a gap starts work on that gap and links them.
        const gap = fromGapKey ? detectGaps(kb, at).find((g) => g.key === fromGapKey) : undefined;
        if (gap) {
          const started = startWork(gap, next, { assigneeId: actorId, linkedArticleId: result.article.id }, at);
          if (started.ok) next = { ...next, triage: started.triage };
        }
        updateKb(() => next);
        return result;
      },

      search(query) {
        const { kb } = current.current;
        const event: SearchEvent = {
          kind: "search",
          id: newId("s"),
          at: new Date().toISOString(),
          query,
          resultIds: searchArticles(kb, query),
          clickedId: null,
        };
        updateKb((base) => ({ ...base, events: [...base.events, event] }));
        return event;
      },

      // A search event is completed when someone opens a result. Nothing else in the log is ever changed.
      openSearchResult(searchId, articleId) {
        updateKb((base) => ({
          ...base,
          events: base.events.map((e) => (e.kind === "search" && e.id === searchId ? { ...e, clickedId: articleId } : e)),
        }));
      },

      recordView(articleId, via) {
        updateKb((base) => ({
          ...base,
          events: [...base.events, { kind: "view", id: newId("v"), at: new Date().toISOString(), articleId, via }],
        }));
      },

      recordFeedback(articleId, helpful, reason, comment) {
        updateKb((base) => ({
          ...base,
          events: [
            ...base.events,
            {
              kind: "feedback",
              id: newId("f"),
              at: new Date().toISOString(),
              articleId,
              helpful,
              reason: helpful ? undefined : reason,
              comment: comment?.trim() || undefined,
            },
          ],
        }));
      },

      setTriage: (triage) => updateKb((base) => ({ ...base, triage })),

      reset: () => commit(freshState()),
    };
  }, [state, now, storageAvailable, commit, updateKb]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}
