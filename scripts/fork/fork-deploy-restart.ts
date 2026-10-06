export interface RestartOperations {
  readonly plistExists: () => boolean;
  readonly bootout: () => number | null;
  readonly pid: () => number | null;
  readonly bootstrap: () => number | null;
  readonly now: () => number;
  readonly wait: () => void;
}

export function restartStoppedJob(operations: RestartOperations, whileStopped?: () => void): void {
  operations.bootout();
  whileStopped?.();
  operations.bootstrap();
}
