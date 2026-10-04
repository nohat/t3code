import { NativeModule, requireOptionalNativeModule } from "expo";

declare class T3PapercutNativeModule extends NativeModule<{
  onShake: (event: { readonly id: string }) => void;
}> {
  heartbeat(): void;
  setContext(json: string): void;
  capture(trigger: "shake" | "manual"): Promise<string>;
  listPending(): Promise<string[]>;
  readPending(id: string): Promise<string | null>;
  discardPending(id: string): Promise<void>;
}

/**
 * The native report module, or null where it does not exist: Android, and any
 * iOS build made before it was added. Callers fall back to a report without a
 * screenshot, so a missing module never blocks reporting.
 */
export const papercutNative = requireOptionalNativeModule<T3PapercutNativeModule>("T3Papercut");
