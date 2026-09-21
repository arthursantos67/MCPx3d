/**
 * WebGPU capability detection for the default local AI mode (PRD FE-04/FE-05,
 * NFR-01/NFR-02, Issue #15).
 *
 * This only checks whether the browser/device can run WebLLM at all -- it
 * never triggers a model download itself, so callers can safely run it
 * before deciding whether to start one (FR-28's "recommended default model"
 * selection and Issue #16's engine init both depend on this running first).
 */

export type WebGpuCapability =
  | { readonly status: "ready" }
  | { readonly status: "unsupported"; readonly reason: string };

/** The subset of `Navigator` this module needs, so tests can supply a fake. */
export interface WebGpuCapableNavigator {
  readonly gpu?: {
    requestAdapter(): Promise<unknown | null>;
  };
}

const NO_WEBGPU_REASON =
  "This browser or device doesn't support WebGPU, so the built-in local AI " +
  "mode can't run here. The 3D viewer and manual editing are unaffected.";

const NO_ADAPTER_REASON =
  "WebGPU is present but no compatible graphics adapter was found, so the " +
  "built-in local AI mode can't run here. The 3D viewer and manual editing " +
  "are unaffected.";

/**
 * Resolves once whether the default local AI mode (WebLLM over WebGPU) can
 * run in this browser/device (FE-04, FE-05). Requesting an adapter is itself
 * cheap/fast relative to a model download, so this is safe to await before
 * showing any "initializing AI" UI.
 */
export async function detectWebGpuCapability(
  nav: WebGpuCapableNavigator = navigator,
): Promise<WebGpuCapability> {
  if (!nav.gpu) {
    return { status: "unsupported", reason: NO_WEBGPU_REASON };
  }

  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return { status: "unsupported", reason: NO_ADAPTER_REASON };
    }
    return { status: "ready" };
  } catch {
    return { status: "unsupported", reason: NO_ADAPTER_REASON };
  }
}
