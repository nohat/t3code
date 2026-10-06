export interface RestartOperations {
  readonly plistExists: () => boolean;
  readonly bootout: () => number | null;
  readonly pid: () => number | null;
  readonly bootstrap: () => number | null;
  readonly now: () => number;
  readonly wait: () => void;
}

/** All process and clock operations are injected; mutation requires confirmed shutdown. */
export function restartStoppedJob(operations: RestartOperations, whileStopped?: () => void): void {
  if (!operations.plistExists()) throw new Error("missing launch agent plist; refusing restart");
  const stopped = operations.bootout();
  if (stopped !== 0)
    throw new Error(`bootout failed (status ${stopped}); refusing stopped callback`);
  const deadline = operations.now() + 90_000;
  while (operations.pid() !== null) {
    if (operations.now() >= deadline)
      throw new Error("PID still present after bootout; refusing cleanup and bootstrap");
    operations.wait();
  }
  let cleanupFailure: { readonly error: unknown } | undefined;
  try {
    whileStopped?.();
  } catch (error) {
    cleanupFailure = { error };
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    operations.wait();
    if (operations.bootstrap() === 0) {
      if (cleanupFailure) throw cleanupFailure.error;
      return;
    }
  }
  const recoveryFailure = "bootstrap failed after 8 attempts";
  if (cleanupFailure) {
    throw new AggregateError(
      [cleanupFailure.error, new Error(recoveryFailure)],
      `${String(cleanupFailure.error)}; ${recoveryFailure}`,
    );
  }
  throw new Error(recoveryFailure);
}
