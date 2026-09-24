import { useState, type KeyboardEvent } from "react";

import type { SendGate } from "./types.ts";

interface PromptComposerProps {
  readonly gate: SendGate;
  readonly onSend: (text: string) => void;
  /** True when the agent is `unsupported`/`error` (e.g. no WebGPU) -- the
   * exact moment a "configure a different provider instead" link is useful. */
  readonly showProviderLink: boolean;
  readonly onOpenProviderSettings: () => void;
}

/** FE-02: multiline input, Enter submits / Shift+Enter inserts a newline.
 * The input remains editable while sending is gated so the user can draft a
 * prompt while the provider or project is still starting. */
function PromptComposer({ gate, onSend, showProviderLink, onOpenProviderSettings }: PromptComposerProps) {
  const [value, setValue] = useState("");

  function submit(): void {
    if (!gate.canSend) return;
    const text = value.trim();
    if (text.length === 0) return;
    onSend(text);
    setValue("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="chat-composer">
      <textarea
        className="chat-composer__input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe the 3D object you want to create or change…"
        rows={3}
        aria-label="Message"
      />
      <div className="chat-composer__footer">
        <span className="chat-composer__hint">
          {gate.canSend ? "" : gate.reason}
          {!gate.canSend && showProviderLink && (
            <>
              {" "}
              <button type="button" className="chat-composer__provider-link" onClick={onOpenProviderSettings}>
                Configure a custom provider instead
              </button>
            </>
          )}
        </span>
        <button
          type="button"
          className="chat-composer__submit"
          onClick={submit}
          disabled={!gate.canSend || value.trim().length === 0}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default PromptComposer;
