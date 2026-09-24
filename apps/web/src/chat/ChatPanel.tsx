import './ChatPanel.css'

import GenerationProgress from './GenerationProgress.tsx'
import MessageList from './MessageList.tsx'
import PromptComposer from './PromptComposer.tsx'
import type { ChatControllerState, SendGate } from './types.ts'

interface ChatPanelProps {
  readonly state: ChatControllerState
  readonly sendMessage: (text: string) => void
  readonly cancelGeneration: () => void
  readonly canSend: () => SendGate
  readonly retryProject: () => void
  readonly onOpenProviderSettings: () => void
}

/**
 * Chat column: history + composer (Issue #26/#27), filling the
 * `.workspace-chat__history`/`.workspace-chat__composer` slots
 * `WorkspaceShell` (Issue #25) already lays out. Takes the chat controller's
 * state/actions as props (owned by `WorkspaceShell`, via `useChatController`)
 * rather than calling the hook itself, so the same controller instance
 * -- and the single `WebLLMProvider`/project session it owns -- is also the
 * source of `previewUrl` for the viewer panel next to it.
 */
function ChatPanel({ state, sendMessage, cancelGeneration, canSend, retryProject, onOpenProviderSettings }: ChatPanelProps) {
  const gate = canSend()
  const progressVisible = state.isBusy || state.agentPhase === 'loading'
  const progressLabel = state.isBusy ? 'Generating…' : (state.agentDetail ?? 'Loading local model…')
  const showProviderLink = state.agentPhase === 'unsupported' || state.agentPhase === 'error'

  return (
    <>
      <div className="workspace-chat__history">
        <MessageList messages={state.messages} />
      </div>
      <div className="workspace-chat__composer">
        <GenerationProgress visible={progressVisible} label={progressLabel} />
        {state.isBusy && (
          <button type="button" className="chat-composer__cancel" onClick={cancelGeneration}>
            Cancel generation
          </button>
        )}
        {state.projectError && (
          <button type="button" onClick={retryProject}>
            {state.requestStatus === 'session-expired' ? 'Recreate expired project' : 'Start a new project'}
          </button>
        )}
        <PromptComposer
          gate={gate}
          onSend={sendMessage}
          showProviderLink={showProviderLink}
          onOpenProviderSettings={onOpenProviderSettings}
        />
      </div>
    </>
  )
}

export default ChatPanel
