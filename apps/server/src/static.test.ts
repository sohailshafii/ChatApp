import { describe, it, expect } from 'vitest';
import { isSpaFallback } from './static.js';

describe('isSpaFallback', () => {
  it('serves the SPA for GET navigations outside the server namespaces', () => {
    expect(isSpaFallback('GET', '/')).toBe(true);
    expect(isSpaFallback('GET', '/login')).toBe(true);
    expect(isSpaFallback('GET', '/conversations/abc')).toBe(true);
    expect(isSpaFallback('GET', '/verify-email?token=xyz')).toBe(true);
    expect(isSpaFallback('HEAD', '/settings')).toBe(true);
  });

  it('never falls back for the API namespace', () => {
    expect(isSpaFallback('GET', '/api')).toBe(false);
    expect(isSpaFallback('GET', '/api/conversations')).toBe(false);
    expect(isSpaFallback('GET', '/api/ws')).toBe(false);
    expect(isSpaFallback('GET', '/api/unknown?x=1')).toBe(false);
  });

  it('never falls back for the health probe', () => {
    expect(isSpaFallback('GET', '/healthz')).toBe(false);
  });

  it('never falls back for non-GET/HEAD methods', () => {
    expect(isSpaFallback('POST', '/login')).toBe(false);
    expect(isSpaFallback('DELETE', '/conversations/abc')).toBe(false);
  });

  it('does not treat a path that merely starts with "api" (no slash) as API', () => {
    expect(isSpaFallback('GET', '/apidocs')).toBe(true);
  });
});
