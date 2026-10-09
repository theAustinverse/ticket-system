/**
 * The mailbox an address really delivers to. Gmail ignores dots in the local
 * part and anything after a `+`, and treats googlemail.com as gmail.com — so
 * `a.b@gmail.com`, `ab+1@gmail.com` and `AB@googlemail.com` are one inbox.
 * Used to stop one person registering many accounts (and so many "own seats")
 * out of a single Gmail address. Other domains are only trimmed and lowercased:
 * their alias rules aren't universal, so collapsing them would merge strangers.
 */
export function canonicalEmail(email: string): string {
  const cleaned = email.trim().toLowerCase();
  const at = cleaned.lastIndexOf('@');
  if (at <= 0) return cleaned;
  const local = cleaned.slice(0, at);
  const domain = cleaned.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return cleaned;
  const stripped = local.split('+')[0].replace(/\./g, '');
  // "+tag@gmail.com" has nothing left before the tag: keep it distinct rather than collapsing to "@gmail.com".
  return `${stripped || local}@gmail.com`;
}
