/** Releasing a view settles its join wait without detaching a newer/background run. */
export function hyperGatewayJoin(join: () => Promise<unknown>, onDeadline: () => void, timeout = 5000) {
  let active = true;
  let release!: () => void;
  let timer: ReturnType<typeof setTimeout>;
  const released = new Promise<void>(resolve => { release = resolve; });
  const deadline = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      if (!active) return;
      try { onDeadline(); resolve(); } catch (error) { reject(error); }
    }, timeout);
  });
  const promise = Promise.race([Promise.resolve().then(() => active ? join() : undefined), deadline, released])
    .finally(() => { active = false; clearTimeout(timer); });
  return { promise, cancel() { active = false; clearTimeout(timer); release(); } };
}
