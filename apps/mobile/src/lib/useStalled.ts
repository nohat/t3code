import { useEffect, useState } from "react";

/**
 * True once `active` has stayed true for `afterMs` under the same `key`. A new
 * key or `active` going false resets it, so a stall belongs to one thread.
 */
export function useStalled(key: string, active: boolean, afterMs: number): boolean {
  const [stalledKey, setStalledKey] = useState<string | null>(null);
  useEffect(() => {
    if (!active) {
      setStalledKey(null);
      return;
    }
    const timer = setTimeout(() => setStalledKey(key), afterMs);
    return () => clearTimeout(timer);
  }, [key, active, afterMs]);
  return active && stalledKey === key;
}
