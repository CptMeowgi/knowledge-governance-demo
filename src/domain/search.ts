import { canonicalize } from "./glossary";
import { POLICY } from "./policy";
import type { GlossaryTerm, KnowledgeBase } from "./types";

const STOPWORDS = new Set(
  "a an and are as at be can do does for from get how i if in is it me my no not of on or so the to up what when where why with you your".split(" "),
);

/** Crude plural folding, applied the same way to queries and content. */
const stem = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);

/** Meaningful keywords in a piece of text, after the glossary has been applied. */
export function keywords(text: string, glossary: readonly GlossaryTerm[]): string[] {
  const words = canonicalize(text, glossary)
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word))
    .map(stem);
  return [...new Set(words)];
}

/**
 * Ranks published articles for a query. Title matches count three times as
 * much as body matches, and a result must contain at least half the query's
 * keywords. Because both sides go through the glossary, a search for "login"
 * finds content written with "sign in".
 */
export function searchArticles(kb: KnowledgeBase, query: string): string[] {
  const wanted = keywords(query, kb.glossary);
  if (!wanted.length) return [];

  return kb.articles
    .filter((article) => article.state === "published")
    .map((article) => {
      const title = new Set(keywords(article.title, kb.glossary));
      const body = new Set(keywords(Object.values(article.body).join(" "), kb.glossary));
      const matched = wanted.filter((word) => title.has(word) || body.has(word));
      const score = wanted.reduce((sum, word) => sum + (title.has(word) ? 3 : 0) + (body.has(word) ? 1 : 0), 0);
      return { article, score, coverage: matched.length / wanted.length };
    })
    .filter((hit) => hit.coverage >= POLICY.minQueryCoverage)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
    .map((hit) => hit.article.id);
}
