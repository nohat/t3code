type PapercutReportHandler = () => Promise<void>;

let handler: PapercutReportHandler | null = null;

/** The mounted reporter claims this; menu entry points call `reportPapercut`. */
export function registerPapercutReporter(next: PapercutReportHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Starts a report from a menu item: captures the screen, asks for a note, uploads. */
export async function reportPapercut(): Promise<void> {
  await handler?.();
}
