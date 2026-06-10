// Loading placeholders shown while data is fetching, in place of plain "Loading…"
// text. The shimmering blocks are decorative (aria-hidden); a visually-hidden
// live region announces the loading state to assistive tech.

export function ConversationListSkeleton() {
  return (
    <div className="sidebar-skeleton">
      <span className="visually-hidden" role="status">
        Loading your conversations…
      </span>
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="skel-row" key={i} aria-hidden="true">
          <div className="skeleton skel-avatar" />
          <div className="skel-lines">
            <div className="skeleton skel-line skel-line-name" />
            <div className="skeleton skel-line skel-line-preview" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Widths chosen to look like a natural back-and-forth thread.
const BUBBLES: Array<{ side: 'is-peer' | 'is-own'; width: string }> = [
  { side: 'is-peer', width: '55%' },
  { side: 'is-own', width: '40%' },
  { side: 'is-peer', width: '70%' },
  { side: 'is-peer', width: '35%' },
  { side: 'is-own', width: '60%' },
];

export function ConversationSkeleton() {
  return (
    <div className="chat-skeleton">
      <span className="visually-hidden" role="status">
        Loading conversation…
      </span>
      <div className="chat-skeleton-header" aria-hidden="true">
        <div className="skeleton skel-avatar" />
        <div className="skeleton skel-line" style={{ width: '8rem' }} />
      </div>
      <div className="chat-skeleton-bubbles" aria-hidden="true">
        {BUBBLES.map((b, i) => (
          <div className={`skel-bubble ${b.side}`} key={i}>
            <div className="skeleton skel-bubble-body" style={{ width: b.width }} />
          </div>
        ))}
      </div>
    </div>
  );
}
