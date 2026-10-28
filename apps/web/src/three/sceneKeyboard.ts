import type { PlayerInput } from './scenePlayer.ts'

export type EditorCommand = { command: 'translate' | 'rotate' | 'scale' | 'frame' | 'delete' | 'duplicate' | 'undo' | 'redo' | 'toggleVisible' | 'deselect'
  | 'playPause' | 'grid' | 'play' | 'snap' | 'help' | 'capture' } | { command: 'view'; view: 'front' | 'right' | 'top' | 'perspective' } | { command: 'nudge'; axis: 0 | 1 | 2; amount: number }
export interface KeyLike { key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false
  const element = target as HTMLElement
  return !!element.closest('input, textarea, select, [contenteditable="true"]')
}

/** Maps a key press to an editor command. Modifier-less letters follow common 3D editor conventions. */
export function editorShortcut(event: KeyLike): EditorCommand | null {
  const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase()
  if (mod && key === 'z') return { command: event.shiftKey ? 'redo' : 'undo' }
  if (mod && key === 'y') return { command: 'redo' }
  if (mod && key === 'd') return { command: 'duplicate' }
  if (mod || event.altKey && !event.code.startsWith('Arrow') && !event.code.startsWith('Page')) return null
  const step = event.shiftKey ? 1 : event.altKey ? 0.01 : 0.1
  switch (event.code) {
    case 'ArrowLeft': return { command: 'nudge', axis: 0, amount: -step }
    case 'ArrowRight': return { command: 'nudge', axis: 0, amount: step }
    case 'ArrowUp': return { command: 'nudge', axis: 2, amount: -step }
    case 'ArrowDown': return { command: 'nudge', axis: 2, amount: step }
    case 'PageUp': return { command: 'nudge', axis: 1, amount: step }
    case 'PageDown': return { command: 'nudge', axis: 1, amount: -step }
    case 'Delete': case 'Backspace': return { command: 'delete' }
    case 'Escape': return { command: 'deselect' }
    case 'Space': return { command: 'playPause' }
    case 'Digit1': case 'Numpad1': return { command: 'view', view: 'front' }
    case 'Digit3': case 'Numpad3': return { command: 'view', view: 'right' }
    case 'Digit7': case 'Numpad7': return { command: 'view', view: 'top' }
    case 'Digit0': case 'Numpad0': return { command: 'view', view: 'perspective' }
  }
  const letters: Record<string, EditorCommand['command']> = { w: 'translate', e: 'rotate', r: 'scale', f: 'frame', h: 'toggleVisible', g: 'grid', p: 'play', s: 'snap', k: 'capture', '?': 'help' }
  const command = letters[key]
  return command ? { command } as EditorCommand : null
}

export const editorShortcutList: [string, string][] = [
  ['W / E / R', 'Mover, girar ou escalar com o gizmo'], ['S', 'Liga/desliga o encaixe (0,25 m · 15° · 0,1)'], ['F', 'Enquadrar seleção ou cena'],
  ['Setas · PgUp/PgDn', 'Deslocar 0,1 m (Shift 1 m · Alt 1 cm)'], ['Delete', 'Excluir seleção'], ['Ctrl+D', 'Duplicar'], ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'],
  ['H', 'Ocultar/mostrar seleção'], ['Esc', 'Limpar seleção'], ['Espaço', 'Reproduzir/pausar timeline'], ['1 / 3 / 7 / 0', 'Vista frontal, lateral, superior ou perspectiva'],
  ['G', 'Grade'], ['K', 'Capturar PNG'], ['P', 'Entrar no modo jogo'], ['?', 'Mostrar atalhos'],
]
export const playControlList: [string, string][] = [
  ['W A S D', 'Andar'], ['Mouse · ← →', 'Olhar / girar'], ['Shift', 'Correr'], ['Espaço', 'Pular (subir no voo)'], ['C', 'Descer no voo'], ['F', 'Alternar caminhada/voo'],
  ['E · clique', 'Interagir, extrair recursos ou atacar'], ['B', 'Inventário e fabricação'], ['Espaço / C na água', 'Subir à superfície / mergulhar'], ['Pular em cima', 'Derrota inimigos'], ['Escada + W/S', 'Subir e descer'], ['V', 'Alternar 1ª/3ª pessoa'], ['0–9 e letras livres', 'Gatilhos definidos na cena'], ['H', 'Mostrar/ocultar ajuda'], ['Esc', 'Pausar / fechar inventário'],
]

export function playerKey(code: string): keyof PlayerInput | null {
  const keys: Record<string, keyof PlayerInput> = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', KeyD: 'right',
    ArrowLeft: 'turnLeft', ArrowRight: 'turnRight', ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump', KeyC: 'down' }
  return keys[code] ?? null
}
