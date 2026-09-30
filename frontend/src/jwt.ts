/** Client-side only, for UX gating — the real enforcement is the backend AdminGuard. */
export function decodeJwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads one claim, decoding properly: JWT payloads are base64url (with '-'
 * and '_', no padding) and UTF-8 — atob alone mangles a Chinese staff name
 * into mojibake. Display only, like decodeJwtRole.
 */
export function decodeJwtClaim(token: string, claim: string): string | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const value = payload[claim];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
