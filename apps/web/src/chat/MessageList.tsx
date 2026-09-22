import type { ChatMessage, ChatMessageRole } from "./types.ts";

interface MessageListProps {
  readonly messages: readonly ChatMessage[];
}

function roleLabel(role: ChatMessageRole): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Agent";
    case "error":
      return "Error";
  }
}

function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return <p className="workspace-placeholder">Describe the 3D object you want to create.</p>;
  }

  return (
    <ul className="chat-messages" aria-live="polite">
      {messages.map((message) => (
        <li key={message.id} className={`chat-message chat-message--${message.role}`}>
          <span className="chat-message__role">{roleLabel(message.role)}</span>
          <p className="chat-message__text">{message.text}</p>
        </li>
      ))}
    </ul>
  );
}

export default MessageList;
