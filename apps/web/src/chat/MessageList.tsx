import type { ChatMessage, ChatMessageRole } from "./types.ts";

interface MessageListProps {
  readonly messages: readonly ChatMessage[];
}

function roleLabel(role: ChatMessageRole): string {
  switch (role) {
    case "user":
      return "Você";
    case "assistant":
      return "Agente";
    case "error":
      return "Erro";
  }
}

function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return <p className="workspace-placeholder">Descreva uma cena, um objeto ou um ambiente para começar.</p>;
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
