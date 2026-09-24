import type { FloorSnapshot } from "./floor";

export type FloorSnapshotRefresh = () => Promise<FloorSnapshot>;

export type FloorUpdateBusOptions = {
  refresh: FloorSnapshotRefresh;
  intervalMs?: number;
};

export type FloorUpdateErrorHandler = (error: unknown) => void;

export type FloorUpdateBus = {
  invalidate: () => void;
  stop: () => void;
  subscribe: (
    listener: (snapshot: FloorSnapshot) => void,
    onError?: FloorUpdateErrorHandler,
  ) => () => void;
};

/**
 * Shares one authoritative Floor refresh across all human subscribers.
 * Invalidations that arrive while a refresh is in flight are coalesced into
 * another refresh, so an update cannot be lost behind a slow T3 reader.
 */
export function createFloorUpdateBus({
  refresh,
  intervalMs = 5_000,
}: FloorUpdateBusOptions): FloorUpdateBus {
  const listeners = new Map<
    (snapshot: FloorSnapshot) => void,
    FloorUpdateErrorHandler | undefined
  >();
  let timer: ReturnType<typeof setInterval> | undefined;
  let refreshPromise: Promise<void> | undefined;
  let dirty = false;
  let stopped = false;

  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const runRefresh = async (): Promise<void> => {
    if (refreshPromise !== undefined || stopped || listeners.size === 0) return;
    refreshPromise = (async () => {
      while (!stopped && listeners.size > 0 && dirty) {
        dirty = false;
        try {
          const snapshot = await refresh();
          if (stopped || listeners.size === 0) continue;
          for (const listener of [...listeners.keys()]) listener(snapshot);
        } catch (error) {
          // Normal T3 transport failures are represented by the snapshot's
          // connection state. Unexpected reader/projection failures terminate
          // the current stream so clients can mark the snapshot stale and
          // reconnect while the next timer or invalidation retries.
          for (const onError of [...listeners.values()]) onError?.(error);
        }
      }
    })().finally(() => {
      refreshPromise = undefined;
      if (!stopped && listeners.size > 0 && dirty) void runRefresh();
    });
    await refreshPromise;
  };

  const invalidate = (): void => {
    if (stopped || listeners.size === 0) return;
    dirty = true;
    void runRefresh();
  };

  const startTimer = (): void => {
    if (timer !== undefined || stopped) return;
    timer = setInterval(invalidate, intervalMs);
  };

  return {
    invalidate,
    stop: () => {
      if (stopped) return;
      stopped = true;
      dirty = false;
      stopTimer();
      listeners.clear();
    },
    subscribe: (listener, onError) => {
      if (stopped) return () => undefined;
      listeners.set(listener, onError);
      startTimer();
      invalidate();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          dirty = false;
          stopTimer();
        }
      };
    },
  };
}
