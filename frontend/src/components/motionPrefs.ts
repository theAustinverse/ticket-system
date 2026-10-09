/** True when the visitor asked for less motion, or the browser can't observe visibility. */
export function motionIsOff(): boolean {
  if (typeof window === 'undefined') return true;
  if (!('IntersectionObserver' in window)) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
