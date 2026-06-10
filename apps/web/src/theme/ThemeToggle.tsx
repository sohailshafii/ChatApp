import { useEffect, useState } from 'react';

// Theme preference: an explicit light/dark choice, or follow the OS ('system').
// Persisted to localStorage and applied as `data-theme` on <html> (the same
// attribute the inline script in index.html sets before first paint).
type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'chatapp-theme';
const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const META: Record<ThemeChoice, { icon: string; label: string }> = {
  system: { icon: '🖥️', label: 'System' },
  light: { icon: '☀️', label: 'Light' },
  dark: { icon: '🌙', label: 'Dark' },
};

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // localStorage may be unavailable (private mode) — fall through to default.
  }
  return 'system';
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && prefersDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);

  // Apply + persist on change.
  useEffect(() => {
    apply(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Best-effort; the theme still applies for this session.
    }
  }, [choice]);

  // While following the OS, re-apply when its preference flips.
  useEffect(() => {
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  const meta = META[choice];
  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setChoice(next)}
      aria-label={`Theme: ${meta.label}. Activate to switch to ${META[next].label}.`}
      title={`Theme: ${meta.label}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
    </button>
  );
}
