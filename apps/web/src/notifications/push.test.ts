import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url string (with padding stripped) to bytes', () => {
    // "aGVsbG8" is base64url for "hello".
    expect(Array.from(urlBase64ToUint8Array('aGVsbG8'))).toEqual([
      104, 101, 108, 108, 111,
    ]);
  });

  it('handles the url-safe alphabet (- and _)', () => {
    // 0xfb 0xff encodes as "+/" in standard base64 → "-_" in base64url.
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([0xfb, 0xff]);
  });
});
