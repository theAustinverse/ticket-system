/**
 * Shared CORS origin check for both the HTTP server (main.ts) and the chat
 * WebSocket gateway, so a change to the allow-list only has to happen once.
 * All mutating HTTP requests require a Bearer JWT (not a cookie), so CORS
 * alone can't grant a malicious site any ambient credentials — but a bare
 * `origin: '*'` fallback is still sloppier than it needs to be. If
 * CORS_ORIGIN isn't set, fall back to just this project's known origins
 * (production domain, Vercel preview deployments, local dev) instead of
 * "everywhere".
 */
export function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) {
  const configured = process.env.CORS_ORIGIN;
  if (configured) {
    const allowed = configured.split(',').map((o) => o.trim());
    callback(null, !origin || allowed.includes(origin));
    return;
  }

  const defaultAllowed =
    !origin ||
    /^https:\/\/([a-z0-9-]+\.)*ts-annual-event\.com$/.test(origin) ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) ||
    /^http:\/\/localhost:\d+$/.test(origin);
  callback(null, defaultAllowed);
}
