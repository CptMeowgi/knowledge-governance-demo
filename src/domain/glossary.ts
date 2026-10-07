import type { GlossaryTerm } from "./types";

export interface GlossaryViolation {
  termId: string;
  /** The avoided term exactly as it appears in the text. */
  found: string;
  preferred: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Matches a whole word or phrase, so "login" doesn't fire inside "loginsight".
 * Spaces in a phrase also match hyphens, so avoiding "log on" catches "log-on".
 */
const wholePhrase = (phrase: string, flags: string) => {
  const body = escapeRegExp(phrase.trim()).replace(/\s+/g, "[\\s\\-]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, `${flags}u`);
};

/** Lowercase, with every run of punctuation or whitespace collapsed to one space. */
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Every avoided term used in `text`, reported once per spelling. */
export function findGlossaryViolations(text: string, glossary: readonly GlossaryTerm[]): GlossaryViolation[] {
  const violations = new Map<string, GlossaryViolation>();
  for (const term of glossary) {
    for (const phrase of term.avoid) {
      for (const match of text.matchAll(wholePhrase(phrase, "gi"))) {
        const key = `${term.id}:${match[0].toLowerCase()}`;
        if (!violations.has(key)) {
          violations.set(key, { termId: term.id, found: match[0], preferred: term.preferred });
        }
      }
    }
  }
  return [...violations.values()];
}

/**
 * Lowercases text, swaps avoided terms for agreed ones and strips punctuation.
 * Used for search and for grouping search queries, so "Log-in issue" and
 * "sign in issue" are treated as the same request.
 */
export function canonicalize(text: string, glossary: readonly GlossaryTerm[]): string {
  // Longest phrases first, so a long variant is replaced before a shorter one could split it.
  const replacements = glossary
    .flatMap((term) => term.avoid.map((phrase) => [plain(phrase), plain(term.preferred)] as const))
    .sort(([a], [b]) => b.length - a.length);

  let result = plain(text);
  for (const [phrase, preferred] of replacements) {
    result = result.replace(wholePhrase(phrase, "g"), preferred);
  }
  return result;
}
