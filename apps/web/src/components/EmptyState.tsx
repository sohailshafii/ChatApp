import type { ReactNode } from 'react';

// Shared empty-state block: an emoji in a tinted circle, a title, and optional
// supporting copy. `fill` vertically centers it in a full-height parent (chat
// pane / message area); without it the block sits at its natural height.
export function EmptyState({
  emoji,
  title,
  children,
  fill = false,
}: {
  emoji: string;
  title: string;
  children?: ReactNode;
  fill?: boolean;
}) {
  return (
    <div className={`empty-state${fill ? ' is-fill' : ''}`}>
      <p className="empty-state-emoji" aria-hidden="true">
        {emoji}
      </p>
      <p className="empty-state-title">{title}</p>
      {children && <p className="empty-state-sub">{children}</p>}
    </div>
  );
}
