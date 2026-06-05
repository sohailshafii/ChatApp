// Draws the favicon at runtime (§5 state C): a simple app glyph, with a red
// dot overlaid when there's unread. Canvas-generated so we ship no icon assets;
// best-effort — silently no-ops if the browser can't oblige.

let linkEl: HTMLLinkElement | null = null;

function iconLink(): HTMLLinkElement {
  if (linkEl) return linkEl;
  let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'icon';
    document.head.appendChild(el);
  }
  linkEl = el;
  return el;
}

export function setFaviconBadge(hasUnread: boolean): void {
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // App glyph: accent rounded square with a "C".
    ctx.fillStyle = '#2557d6';
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', size / 2, size / 2 + 1);

    if (hasUnread) {
      ctx.fillStyle = '#b00020';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(size - 8, 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    iconLink().href = canvas.toDataURL('image/png');
  } catch {
    // Canvas/DOM unavailable — leave the favicon as-is.
  }
}
