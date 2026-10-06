/**
 * Whether decorative video may play. Off for people who asked for less motion,
 * who turned on data saver, or who are on a slow connection — they get the
 * plain page change.
 */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && /(^|-)2g$|^3g$/.test(conn.effectiveType)) return false;
  return true;
}
