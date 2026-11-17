/** One 30-second clock while the app is visible; resume recalculates immediately. */
export function foregroundClock(tick: () => void, scheduler = { set: (fn: () => void) => setInterval(fn, 30000), clear: (id: ReturnType<typeof setInterval>) => clearInterval(id) }) {
  let timer: ReturnType<typeof setInterval> | undefined;
  return (active: boolean) => {
    if (active && timer === undefined) { tick(); timer = scheduler.set(tick); }
    if (!active && timer !== undefined) { scheduler.clear(timer); timer = undefined; }
  };
}
