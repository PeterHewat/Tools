/**
 * Work that waits for edits to pause: each call starts the wait again, and the work runs once,
 * `wait` milliseconds after the last. `flush` runs what is waiting now (a download must not use
 * a result that is about to change); `cancel` drops it.
 */
export interface Debounced {
  (): void;
  flush(): void;
  cancel(): void;
  /** Work is waiting to run. */
  readonly pending: boolean;
}

export function debounce(run: () => void, wait: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    timer = undefined;
    run();
  };
  const call = (() => {
    clearTimeout(timer);
    timer = setTimeout(fire, wait);
  }) as Debounced;
  call.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    fire();
  };
  call.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  Object.defineProperty(call, "pending", { get: () => timer !== undefined });
  return call;
}
