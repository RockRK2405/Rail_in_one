'use client';

import * as React from 'react';

/**
 * Counts down to an ISO deadline, returning the whole seconds remaining and an
 * `expired` flag. The deadline (server-issued) is authoritative — the browser
 * timer is only a display; callers must reconcile real seat state with the
 * server when it hits zero.
 */
export function useCountdown(deadlineIso: string | null): {
  secondsLeft: number;
  expired: boolean;
} {
  const compute = React.useCallback(() => {
    if (!deadlineIso) return 0;
    return Math.max(0, Math.round((new Date(deadlineIso).getTime() - Date.now()) / 1000));
  }, [deadlineIso]);

  const [secondsLeft, setSecondsLeft] = React.useState(compute);

  React.useEffect(() => {
    setSecondsLeft(compute());
    if (!deadlineIso) return;
    const id = setInterval(() => setSecondsLeft(compute()), 1000);
    return () => clearInterval(id);
  }, [deadlineIso, compute]);

  return { secondsLeft, expired: deadlineIso !== null && secondsLeft <= 0 };
}
