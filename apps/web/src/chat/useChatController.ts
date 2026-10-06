import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import * as apiClient from "../api/x3d.ts";
import type { Recipe } from "../api/x3d.ts";
import { ChatController, type AgentProvider, type ChatControllerState, type SceneRequestOptions } from "./ChatController.ts";
import type { SendGate } from "./types.ts";

export interface UseChatController {
  readonly state: ChatControllerState;
  readonly canSend: () => SendGate;
  readonly sendMessage: (text: string, options?: SceneRequestOptions) => void;
  readonly applyRecipe: (recipe: Recipe) => void;
  readonly importManifest: (contents: string) => void;
  readonly cancelGeneration: () => void;
  readonly retryProject: () => void;
  readonly resetProject: () => void;
  readonly renameProject: (name: string) => void;
  readonly persistProjectName: () => void;
  readonly setViewerStatus: (status: "artifact-generation" | "loading" | "ready" | "failed") => void;
}

export function useChatController(provider: AgentProvider, enabled: boolean): UseChatController {
  const [controller] = useState(() => new ChatController(provider, apiClient));
  useEffect(() => { controller.setProvider(provider); }, [controller, provider]);

  useEffect(() => {
    if (enabled) void controller.initialize();
    return () => controller.dispose();
  }, [controller, enabled]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.onChange(onStoreChange),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const sendMessage = useCallback(
    (text: string, options?: SceneRequestOptions) => {
      void controller.sendMessage(text, options);
    },
    [controller],
  );
  const applyRecipe = useCallback((recipe: Recipe) => { void controller.applyRecipe(recipe); }, [controller]);
  const importManifest = useCallback((contents: string) => { void controller.importManifest(contents); }, [controller]);
  const canSend = useCallback(() => controller.canSend(), [controller]);
  const cancelGeneration = useCallback(() => controller.cancelGeneration(), [controller]);
  const retryProject = useCallback(() => {
    void controller.retryProject();
  }, [controller]);
  const resetProject = useCallback(() => {
    void controller.resetProject();
  }, [controller]);
  const renameProject = useCallback((name: string) => controller.renameProject(name), [controller]);
  const persistProjectName = useCallback(() => { void controller.persistProjectName(); }, [controller]);
  const setViewerStatus = useCallback(
    (status: "artifact-generation" | "loading" | "ready" | "failed") => controller.setViewerStatus(status),
    [controller],
  );

  return { state, sendMessage, applyRecipe, importManifest, cancelGeneration, canSend, retryProject, resetProject, renameProject, persistProjectName, setViewerStatus };
}
