/**
 * Best score persistence. Safe when localStorage is unavailable (e.g. SSR).
 */

const KEY = "otr-best-score";
const ANIM_SPEED_KEY = "otr-anim-speed-percent";
const TEXT_SIZE_OFFSET_KEY = "otr-text-size-offset";

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

export function getAnimationSpeedPercent(): number {
  if (typeof window === "undefined" || !window.localStorage) return 100;
  const raw = window.localStorage.getItem(ANIM_SPEED_KEY);
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(200, n));
}

export function setAnimationSpeedPercent(percent: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const clamped = Math.max(0, Math.min(200, Math.round(percent)));
  window.localStorage.setItem(ANIM_SPEED_KEY, String(clamped));
}

export function getTextSizeOffset(): number {
  if (typeof window === "undefined" || !window.localStorage) return 0;
  const raw = window.localStorage.getItem(TEXT_SIZE_OFFSET_KEY);
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-100, Math.min(200, n));
}

export function setTextSizeOffset(offset: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const clamped = Math.max(-100, Math.min(200, Math.round(offset)));
  window.localStorage.setItem(TEXT_SIZE_OFFSET_KEY, String(clamped));
}
