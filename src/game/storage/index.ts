/**
 * Best score persistence. Safe when localStorage is unavailable (e.g. SSR).
 */

const KEY = "otr-best-score";

export function getBestScore(): number {
  if (typeof window === "undefined" || !window.localStorage) return 0;
  const raw = window.localStorage.getItem(KEY);
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setBestScore(score: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(KEY, String(Math.max(0, Math.floor(score))));
}
