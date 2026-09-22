import { useState, type KeyboardEvent } from "react";

import type { SendGate } from "./types.ts";

interface PromptComposerProps {
  readonly gate: SendGate;
  readonly onSend: (text: string) => void;
}

/** FE-02: multiline input, Enter submits / Shift+Enter inserts a newline,
 * disabled while a request is in flight or local AI isn't ready yet. */
function PromptComposer({ gate, onSend }: PromptComposerProps) {
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
        disabled={!gate.canSend}
        rows={3}
        aria-label="Message"
      />
      <div className="chat-composer__footer">
        <span className="chat-composer__hint">{gate.canSend ? "" : gate.reason}</span>
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
