import { randomBytes, timingSafeEqual } from 'node:crypto';

// Double-submit CSRF token (REQUIREMENTS.md §6). The value carries no server-side
// state: it is set as a non-httpOnly cookie at login and the client echoes it in
// the CSRF header on state-changing requests. Security comes from the same-origin
// policy — a cross-site attacker can neither read the cookie nor set the header.

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

// Constant-time comparison of the CSRF cookie value against the header value.
export function csrfTokensMatch(
  cookieValue: string | undefined,
  headerValue: string | string[] | undefined,
): boolean {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!cookieValue || !header) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(header);
  // timingSafeEqual throws on length mismatch; check first (length is not secret).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
