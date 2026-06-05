// Split plain message text into text/link segments for safe rendering (§3).
// Only http(s) URLs are linkified; other schemes (javascript:, data:, …) are
// left as plain text (§6 XSS). No HTML is produced here — the caller renders
// each segment with React, which escapes text by default.

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string };

// Match an http(s) URL run: scheme + non-space, non-angle/quote characters.
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

// Trailing characters that are usually punctuation around a URL rather than part
// of it (e.g. "see https://x.com." or "(https://x.com)").
function trimTrailing(url: string): { url: string; trailing: string } {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1]!;
    if ('.,!?;:'.includes(ch)) {
      end--;
      continue;
    }
    // Drop a trailing ")" only when it isn't part of a balanced pair in the URL.
    if (ch === ')' && !url.slice(0, end - 1).includes('(')) {
      end--;
      continue;
    }
    break;
  }
  return { url: url.slice(0, end), trailing: url.slice(end) };
}

export function linkify(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const { url, trailing } = trimTrailing(raw);

    if (start > last) {
      segments.push({ type: 'text', value: text.slice(last, start) });
    }
    segments.push({ type: 'link', value: url });
    if (trailing) {
      segments.push({ type: 'text', value: trailing });
    }
    last = start + raw.length;
  }

  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last) });
  }
  return segments;
}
