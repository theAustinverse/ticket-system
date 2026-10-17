/**
 * Vercel Web Analytics without the npm package (its peer range clashes with
 * the React version pinned by @react-three/*). This is what the package's
 * inject() does: queue stub + the script Vercel serves at /_vercel/insights.
 * It is same-origin (CSP script-src 'self') and cookieless; until Web
 * Analytics is switched on in the Vercel project the script URL 404s and
 * nothing is collected. Production only, so local dev adds no noise.
 */
export function startAnalytics() {
  if (!import.meta.env.PROD) return;
  const w = window as Window & { va?: (...args: unknown[]) => void; vaq?: unknown[] };
  if (w.va) return;
  w.va = function (...args: unknown[]) {
    (w.vaq = w.vaq || []).push(args);
  };
  const s = document.createElement('script');
  s.src = '/_vercel/insights/script.js';
  s.defer = true;
  s.dataset.sdkn = '@vercel/analytics';
  s.dataset.sdkv = '1.6.1';
  document.head.appendChild(s);
}
