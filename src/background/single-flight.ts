/**
 * Wraps a task so that calls made while it runs join that run instead of starting another. After it
 * settles (resolved or failed) the next call starts a new run.
 */
export function singleFlight(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  return () => {
    running ??= (async () => {
      try {
        await task();
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
