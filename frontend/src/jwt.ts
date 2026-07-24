/** Client-side only, for UX gating — the real enforcement is the backend AdminGuard. */
export function decodeJwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}
