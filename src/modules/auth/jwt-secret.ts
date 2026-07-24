/**
 * Fails fast at boot if JWT_SECRET isn't set, instead of silently falling
 * back to a hardcoded default — a forgotten env var used to mean anyone who
 * knew the default string could forge a valid JWT for any user, including
 * `role: 'ADMIN'`, and take over the back office.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. Refusing to start with an insecure default secret.',
    );
  }
  return secret;
}
