import { errorEnvelopeSchema, type ErrorCode } from '@chatapp/shared';

// Single fetch wrapper for all REST calls.
//
// Responsibilities:
//  - JSON encode/decode with sensible empty-body handling.
//  - Translate the shared ErrorEnvelope into a typed `ApiError` so callers can
//    branch on `error.code` instead of poking at raw responses.
//  - Attach the double-submit CSRF token on state-changing requests
//    (REQUIREMENTS.md §security: non-HttpOnly cookie echoed via a request header).
//
// The session cookie is httpOnly and handled by the browser, so we only need
// `credentials` set — we never read or set it here.

// Names for the double-submit CSRF pair. These are a contract shared with the
// server; kept here as the single source of truth on the client.
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Codes that can originate on the client, in addition to the server's ErrorCode set. */
export type ClientErrorCode = 'network_error' | 'malformed_response';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | ClientErrorCode,
    message: string,
    /** HTTP status, or 0 when the request never completed (network failure). */
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: string;
  /** JSON-serializable request body; omitted for bodyless requests. */
  body?: unknown;
  signal?: AbortSignal;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

/**
 * Issue a JSON request and resolve with the parsed response body.
 * Throws `ApiError` for non-2xx responses and transport failures.
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const hasBody = opts.body !== undefined;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (hasBody) headers['Content-Type'] = 'application/json';

  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('network_error', 'Network request failed', 0);
  }

  const raw = await res.text();

  if (!res.ok) {
    throw toApiError(res.status, raw);
  }

  if (raw.length === 0) {
    // 200/204 with empty body (e.g. POST /auth/signup).
    return undefined as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(
      'malformed_response',
      'Server returned an unreadable response',
      res.status,
    );
  }
}

function toApiError(status: number, raw: string): ApiError {
  if (raw.length > 0) {
    try {
      const parsed = errorEnvelopeSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return new ApiError(parsed.data.error.code, parsed.data.error.message, status);
      }
    } catch {
      // fall through to a generic error below
    }
  }
  return new ApiError('internal_error', `Request failed (${status})`, status);
}
