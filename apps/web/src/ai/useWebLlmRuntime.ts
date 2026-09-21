/**
 * Exposes a `WebLlmRuntime`'s status as React application state (Issue #16's
 * "runtime status is exposed to application state" acceptance criterion).
 * `useSyncExternalStore` is used instead of a plain `useState`/`useEffect`
 * pair because the runtime's status can change from a WebLLM worker message
 * callback outside any React event, which `useSyncExternalStore` is built to
 * subscribe to safely.
 */
import { useCallback, useSyncExternalStore } from "react";

import type { WebLlmRuntime, WebLlmStatus } from "./webllm-runtime.ts";

export function useWebLlmRuntime(runtime: WebLlmRuntime): WebLlmStatus {
  const subscribe = useCallback(
    (onStoreChange: () => void) => runtime.onStatusChange(onStoreChange),
    [runtime],
  );
  const getSnapshot = useCallback(() => runtime.getStatus(), [runtime]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
