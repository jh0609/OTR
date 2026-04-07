/**
 * Best score persistence. Safe when localStorage is unavailable (e.g. SSR).
 */

const KEY = "otr-best-score";
const ANIM_SPEED_KEY = "otr-anim-speed-percent";
const TEXT_SIZE_OFFSET_KEY = "otr-text-size-offset";
const TEXT_BASE_SIZE_KEY = "otr-text-base-size";
const QUICK_RESET_KEY = "otr-quick-reset-enabled";
const SWIPE_THRESHOLD_KEY = "otr-swipe-threshold";
const SHOW_DRAG_TRACE_KEY = "otr-show-drag-trace";
const AUTO_HINT_KEY = "otr-auto-hint-enabled";

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

export function getTextBaseSize(): number {
  if (typeof window === "undefined" || !window.localStorage) return 15;
  const raw = window.localStorage.getItem(TEXT_BASE_SIZE_KEY);
  const n = parseInt(raw ?? "", 10);
  if (Number.isFinite(n)) return Math.max(1, Math.min(200, n));
  // Backward-compatibility: migrate old offset value (default base 15).
  const legacyRaw = window.localStorage.getItem(TEXT_SIZE_OFFSET_KEY);
  const legacy = parseInt(legacyRaw ?? "", 10);
  if (Number.isFinite(legacy)) return Math.max(1, Math.min(200, 15 + legacy));
  return 15;
}

export function setTextBaseSize(size: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const clamped = Math.max(1, Math.min(200, Math.round(size)));
  window.localStorage.setItem(TEXT_BASE_SIZE_KEY, String(clamped));
}

export function getQuickResetEnabled(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return window.localStorage.getItem(QUICK_RESET_KEY) === "1";
}

export function setQuickResetEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(QUICK_RESET_KEY, enabled ? "1" : "0");
}

export function getSwipeThreshold(): number {
  if (typeof window === "undefined" || !window.localStorage) return 40;
  const raw = window.localStorage.getItem(SWIPE_THRESHOLD_KEY);
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 40;
  return Math.max(10, Math.min(100, n));
}

export function setSwipeThreshold(value: number): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const clamped = Math.max(10, Math.min(100, Math.round(value)));
  window.localStorage.setItem(SWIPE_THRESHOLD_KEY, String(clamped));
}

export function getShowDragTrace(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return window.localStorage.getItem(SHOW_DRAG_TRACE_KEY) === "1";
}

export function setShowDragTrace(enabled: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(SHOW_DRAG_TRACE_KEY, enabled ? "1" : "0");
}

export function getAutoHintEnabled(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return window.localStorage.getItem(AUTO_HINT_KEY) === "1";
}

export function setAutoHintEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(AUTO_HINT_KEY, enabled ? "1" : "0");
}
