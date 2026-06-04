import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

// Build a JSON Response; status defaults to 200 and can be overridden via init.
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** Stub global fetch and return the mock so tests can assert on the call. */
function stubFetch(response: Response | Error) {
  const mock =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Await a call expected to reject, returning the thrown value (typed) for assertions. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the request to reject, but it resolved');
}

describe('apiFetch', () => {
  beforeEach(() => {
    // readCookie touches document.cookie on state-changing requests.
    vi.stubGlobal('document', { cookie: '' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses a JSON success body and uses safe defaults', async () => {
    const fetchMock = stubFetch(jsonResponse({ user: { id: '1' } }));

    const result = await apiFetch<{ user: { id: string } }>('/auth/me');

    expect(result).toEqual({ user: { id: '1' } });
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/auth/me');
    expect(opts.method).toBe('GET');
    expect(opts.credentials).toBe('same-origin');
    expect(opts.body).toBeUndefined();
  });

  it('returns undefined for an empty success body', async () => {
    stubFetch(new Response('', { status: 200 }));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('serializes a JSON body and sets Content-Type', async () => {
    const fetchMock = stubFetch(new Response('', { status: 200 }));

    await apiFetch('/auth/signup', { method: 'POST', body: { username: 'a' } });

    const [, opts] = fetchMock.mock.calls[0]!;
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ username: 'a' }));
  });

  it('decodes a shared ErrorEnvelope into a typed ApiError', async () => {
    stubFetch(
      jsonResponse(
        { error: { code: 'username_taken', message: 'That username is taken' } },
        { status: 409 },
      ),
    );

    const err = await rejection(apiFetch('/auth/signup', { method: 'POST', body: {} }));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('username_taken');
    expect((err as ApiError).message).toBe('That username is taken');
    expect((err as ApiError).status).toBe(409);
  });

  it('maps a non-envelope error body (e.g. Fastify 404) to internal_error', async () => {
    stubFetch(
      jsonResponse(
        { message: 'Route POST:/auth/login not found', error: 'Not Found', statusCode: 404 },
        { status: 404 },
      ),
    );

    const err = await rejection(apiFetch('/auth/login', { method: 'POST', body: {} }));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('internal_error');
    expect((err as ApiError).status).toBe(404);
  });

  it('wraps a transport failure as ApiError network_error with status 0', async () => {
    stubFetch(new TypeError('Failed to fetch'));

    const err = await rejection(apiFetch('/auth/me'));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('network_error');
    expect((err as ApiError).status).toBe(0);
  });

  it('rethrows an AbortError untouched (not wrapped as ApiError)', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    stubFetch(abort);

    const err = await rejection(apiFetch('/auth/me'));
    expect(err).toBe(abort);
    expect(err).not.toBeInstanceOf(ApiError);
  });

  it('throws malformed_response when a success body is not valid JSON', async () => {
    stubFetch(new Response('not json', { status: 200 }));

    const err = await rejection(apiFetch('/auth/me'));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('malformed_response');
  });

  describe('CSRF double-submit', () => {
    it('attaches X-CSRF-Token from the cookie on state-changing requests', async () => {
      vi.stubGlobal('document', { cookie: 'foo=bar; csrf_token=tok123' });
      const fetchMock = stubFetch(new Response('', { status: 200 }));

      await apiFetch('/auth/logout', { method: 'POST' });

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(opts.headers['X-CSRF-Token']).toBe('tok123');
    });

    it('does not attach the CSRF header on safe (GET) requests', async () => {
      vi.stubGlobal('document', { cookie: 'csrf_token=tok123' });
      const fetchMock = stubFetch(jsonResponse({}));

      await apiFetch('/auth/me');

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(opts.headers['X-CSRF-Token']).toBeUndefined();
    });

    it('omits the CSRF header when no cookie is present', async () => {
      vi.stubGlobal('document', { cookie: '' });
      const fetchMock = stubFetch(new Response('', { status: 200 }));

      await apiFetch('/auth/signup', { method: 'POST', body: {} });

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(opts.headers['X-CSRF-Token']).toBeUndefined();
    });
  });
});
