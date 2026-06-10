import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  resendSender,
  deliverEmail,
  setMailSender,
  resetMailSender,
  type OutgoingEmail,
} from './transport.js';

const email: OutgoingEmail = {
  to: 'alice@example.com',
  subject: 'Subject',
  text: 'plain',
  html: '<p>html</p>',
};

// A no-op logger that also records error calls, enough for these unit tests.
function fakeLog(): FastifyBaseLogger & { errors: unknown[] } {
  const errors: unknown[] = [];
  const log = {
    errors,
    info: () => {},
    warn: () => {},
    error: (obj: unknown) => errors.push(obj),
    // FastifyBaseLogger has more methods; we only call info/warn/error here.
  } as unknown as FastifyBaseLogger & { errors: unknown[] };
  return log;
}

afterEach(() => {
  resetMailSender();
  vi.unstubAllGlobals();
});

describe('resendSender', () => {
  it('POSTs the email to the Resend API with auth + JSON body', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit): Promise<Response> =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await resendSender(email, { from: 'noreply@x.com', apiKey: 'sk_test' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'noreply@x.com',
      to: 'alice@example.com',
      subject: 'Subject',
      text: 'plain',
      html: '<p>html</p>',
    });
  });

  it('throws on a non-2xx response, surfacing the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('domain not verified', { status: 403 })),
    );
    await expect(
      resendSender(email, { from: 'bad@unverified.com', apiKey: 'sk_test' }),
    ).rejects.toThrow(/403/);
  });
});

describe('deliverEmail', () => {
  it('routes through the active sender (test seam)', async () => {
    const sent: OutgoingEmail[] = [];
    setMailSender(async (e) => {
      sent.push(e);
    });
    await deliverEmail(fakeLog(), email, { from: 'f@x.com', apiKey: 'k' });
    expect(sent).toEqual([email]);
  });

  it('is best-effort: a sender failure is logged, not thrown', async () => {
    setMailSender(async () => {
      throw new Error('boom');
    });
    const log = fakeLog();
    await expect(
      deliverEmail(log, email, { from: 'f@x.com', apiKey: 'k' }),
    ).resolves.toBeUndefined();
    expect(log.errors).toHaveLength(1);
  });
});
