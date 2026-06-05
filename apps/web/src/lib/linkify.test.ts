import { describe, expect, it } from 'vitest';
import { linkify } from './linkify';

describe('linkify', () => {
  it('returns a single text segment when there are no URLs', () => {
    expect(linkify('just plain text')).toEqual([
      { type: 'text', value: 'just plain text' },
    ]);
  });

  it('linkifies an http(s) URL embedded in text', () => {
    expect(linkify('see https://example.com now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('handles multiple URLs', () => {
    const segs = linkify('http://a.com and http://b.com');
    expect(segs.filter((s) => s.type === 'link').map((s) => s.value)).toEqual([
      'http://a.com',
      'http://b.com',
    ]);
  });

  it('keeps trailing sentence punctuation out of the link', () => {
    expect(linkify('go to https://example.com.')).toEqual([
      { type: 'text', value: 'go to ' },
      { type: 'link', value: 'https://example.com' },
      { type: 'text', value: '.' },
    ]);
  });

  it('drops a wrapping close paren from the link', () => {
    expect(linkify('(https://example.com)')).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', value: 'https://example.com' },
      { type: 'text', value: ')' },
    ]);
  });

  it('does NOT linkify non-http(s) schemes (javascript:, data:)', () => {
    expect(linkify('javascript:alert(1)')).toEqual([
      { type: 'text', value: 'javascript:alert(1)' },
    ]);
    expect(linkify('data:text/html,<script>')).toEqual([
      { type: 'text', value: 'data:text/html,<script>' },
    ]);
  });

  it('preserves newlines in surrounding text', () => {
    const segs = linkify('line1\nhttps://x.com\nline2');
    expect(segs[0]).toEqual({ type: 'text', value: 'line1\n' });
    expect(segs[1]).toEqual({ type: 'link', value: 'https://x.com' });
    expect(segs[2]).toEqual({ type: 'text', value: '\nline2' });
  });
});
