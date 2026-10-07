/**
 * Browser persistence. Storage can be missing, full or blocked (private
 * windows, strict privacy settings), so every access is wrapped and the app
 * carries on in memory if it fails.
 */
import type { KnowledgeBase } from "../domain/types";

const STORAGE_KEY = "kb2:v1";

export interface SavedState {
  version: 1;
  kb: KnowledgeBase;
  actorId: string;
}

export function loadState(): SavedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    const valid = parsed.version === 1 && Array.isArray(parsed.kb?.articles) && typeof parsed.actorId === "string";
    return valid ? (parsed as SavedState) : null;
  } catch {
    return null;
  }
}

/** Returns false if the browser refused to save. */
export function saveState(state: SavedState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
