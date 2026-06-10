import { useEffect, useState } from 'react';

// A `Date` that refreshes on an interval, so relative timestamps ("5 min ago")
// re-render without a reload. One ticker drives the whole message list.
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
