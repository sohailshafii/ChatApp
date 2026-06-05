import { linkify } from '../lib/linkify';

// Renders message text with http(s) URLs as clickable links (§3). Text is
// rendered as React children (escaped by default); links open in a new tab with
// noopener/noreferrer.
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((seg, i) =>
        seg.type === 'link' ? (
          <a key={i} href={seg.value} target="_blank" rel="noopener noreferrer">
            {seg.value}
          </a>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}
