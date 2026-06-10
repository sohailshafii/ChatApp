// Deterministic avatar colors for human peers (§2): same username always maps
// to the same color, from a curated palette chosen to read well with white
// text in both light and dark themes. No server involvement.

const AVATAR_COLORS = [
  '#4f46e5', // indigo
  '#0f766e', // teal
  '#b45309', // amber
  '#be123c', // rose
  '#7c3aed', // violet
  '#2563eb', // blue
  '#15803d', // green
  '#c2410c', // orange
  '#9333ea', // purple
  '#0369a1', // sky
];

export function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

// First character of a name, uppercased, for a monogram avatar.
export function monogram(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}
