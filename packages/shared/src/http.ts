// Cookie and header names shared across the wire so client and server can't
// drift on the session/CSRF contract (REQUIREMENTS.md §1 login, §6 security).

// The opaque session token: httpOnly + Secure + SameSite=Lax cookie (§1, §6).
export const SESSION_COOKIE_NAME = 'session';

// Double-submit CSRF (§6): the server sets CSRF_COOKIE_NAME as a NON-httpOnly
// cookie (readable by client JS) and the client echoes its value in the
// CSRF_HEADER_NAME header on state-changing requests. The server requires the
// two to match. Security relies on the same-origin policy — a cross-site
// attacker can neither read the cookie nor set the custom header.
export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';
