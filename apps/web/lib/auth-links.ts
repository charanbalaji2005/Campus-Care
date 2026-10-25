'use client';

import * as React from 'react';

/**
 * Redirect allowlist for `?next=` style parameters: only same-origin, absolute paths are accepted.
 * Rejects protocol-relative (`//evil`), backslash tricks (`/\evil`), schemes and control characters,
 * then confirms the resolved URL stays on this origin.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof window === 'undefined') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Countdown for "send again" buttons. start(seconds) begins it; remaining is 0 when the button may be used. */
export function useCooldown() {
  const [until, setUntil] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  const start = React.useCallback((seconds: number) => {
    setNow(Date.now());
    setUntil(Date.now() + seconds * 1000);
  }, []);
  return { remaining, start };
}
