import { emptyInput, type PlayerInput } from './scenePlayer.ts'

export type InputDevice = 'keyboard' | 'gamepad'
export type GameAction = 'move' | 'look' | 'jump' | 'sprint' | 'down' | 'attack' | 'heavy' | 'interact' | 'dodge' | 'pause' | 'camera' | 'help' | 'fly' | 'mute'
  | 'confirm' | 'back' | 'menuUp' | 'menuDown'
/** Minimal view of the Gamepad API so the mapping can be tested without a browser. */
export interface GamepadLike { buttons: readonly { pressed: boolean; value: number }[]; axes: readonly number[]; connected?: boolean; mapping?: string }
export interface GamepadState { buttons: boolean[]; sprintLatch: boolean; menu: -1 | 0 | 1 }
export interface GamepadFrame {
  input: PlayerInput
  move: { x: number; y: number }; look: { x: number; y: number }
  /** Rising edges this frame. */
  pressed: Set<GameAction>
  held: Set<GameAction>
  /** True when any stick left its dead zone or any button/trigger is down: the HUD switches glyphs to the gamepad. */
  active: boolean
}

/** Standard mapping (Xbox layout). */
export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const
const buttonActions: [number, GameAction][] = [[BUTTON.A, 'jump'], [BUTTON.B, 'dodge'], [BUTTON.X, 'interact'], [BUTTON.Y, 'camera'], [BUTTON.RB, 'attack'], [BUTTON.RT, 'heavy'],
  [BUTTON.LB, 'down'], [BUTTON.MENU, 'pause'], [BUTTON.VIEW, 'help'], [BUTTON.UP, 'fly'], [BUTTON.DOWN, 'mute'], [BUTTON.A, 'confirm'], [BUTTON.B, 'back']]
export const DEADZONE = 0.18, TRIGGER = 0.35, STICK_STEP = 0.55

export const createGamepadState = (): GamepadState => ({ buttons: [], sprintLatch: false, menu: 0 })
/** Radial dead zone with rescaling, so motion starts at 0 just past the dead zone and reaches 1 before the physical rim. */
export function deadzone(x: number, y: number, inner = DEADZONE, outer = 0.95): { x: number; y: number } {
  const length = Math.hypot(x, y)
  if (!Number.isFinite(length) || length <= inner) return { x: 0, y: 0 }
  const scaled = Math.min(1, (length - inner) / (outer - inner)) / length
  return { x: x * scaled, y: y * scaled }
}
const down = (pad: GamepadLike, index: number) => { const button = pad.buttons[index]; return !!button && (button.pressed || button.value > TRIGGER) }

/** Reads one pad into player input (thresholded stick → WASD booleans), analog sticks and rising-edge actions. */
export function readGamepad(pad: GamepadLike | null, state: GamepadState): GamepadFrame {
  const input = emptyInput(), pressed = new Set<GameAction>(), held = new Set<GameAction>()
  if (!pad || pad.connected === false) { state.buttons = []; state.sprintLatch = false; state.menu = 0; return { input, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, pressed, held, active: false } }
  const move = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0), look = deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0)
  const now = pad.buttons.map((_, index) => down(pad, index))
  for (const [index, action] of buttonActions) {
    if (now[index]) held.add(action)
    if (now[index] && !state.buttons[index]) pressed.add(action)
  }
  const moving = Math.hypot(move.x, move.y) > 0.2
  if (now[BUTTON.LS] && !state.buttons[BUTTON.LS]) state.sprintLatch = !state.sprintLatch
  if (!moving) state.sprintLatch = false
  const step = move.y < -STICK_STEP || now[BUTTON.UP] ? -1 : move.y > STICK_STEP || now[BUTTON.DOWN] ? 1 : 0
  if (step && step !== state.menu) pressed.add(step < 0 ? 'menuUp' : 'menuDown')
  state.menu = step
  state.buttons = now
  input.forward = move.y < -0.3; input.back = move.y > 0.3; input.left = move.x < -0.3; input.right = move.x > 0.3
  input.sprint = state.sprintLatch || now[BUTTON.LT]
  input.jump = held.has('jump'); input.up = held.has('jump'); input.down = held.has('down')
  if (input.sprint) held.add('sprint')
  if (moving) held.add('move')
  if (look.x || look.y) held.add('look')
  return { input, move, look, pressed, held, active: moving || !!(look.x || look.y) || now.some(Boolean) }
}
/** Merges keyboard and gamepad movement without letting one release the other. */
export function mergeInput(keyboard: PlayerInput, pad: PlayerInput): PlayerInput {
  const merged = emptyInput()
  for (const key of Object.keys(merged) as (keyof PlayerInput)[]) merged[key] = keyboard[key] || pad[key]
  return merged
}
/** Right-stick look in radians for this frame; curved for precision near the centre. */
export function lookDelta(look: { x: number; y: number }, dt: number, sensitivity = 1, invertY = false): { yaw: number; pitch: number } {
  const curve = (value: number) => Math.sign(value) * Math.abs(value) ** 1.6, speed = 2.6 * sensitivity * dt
  return { yaw: -curve(look.x) * speed, pitch: -curve(look.y) * speed * (invertY ? -1 : 1) }
}
export function firstGamepad(list: ArrayLike<GamepadLike | null> | null | undefined): GamepadLike | null {
  if (!list) return null
  for (let index = 0; index < list.length; index++) { const pad = list[index]; if (pad && pad.connected !== false) return pad }
  return null
}
export function pollGamepad(): GamepadLike | null {
  try { return typeof navigator !== 'undefined' && navigator.getGamepads ? firstGamepad(navigator.getGamepads()) : null } catch { return null }
}

export interface Glyph { label: string; kind: 'key' | 'mouse-left' | 'mouse-right' | 'mouse' | 'face' | 'bumper' | 'trigger' | 'stick' | 'dpad' | 'menu'; tone?: 'a' | 'b' | 'x' | 'y' }
const keyboardGlyphs: Record<GameAction, Glyph> = {
  move: { label: 'WASD', kind: 'key' }, look: { label: 'Mouse', kind: 'mouse' }, jump: { label: 'Espaço', kind: 'key' }, sprint: { label: 'Shift', kind: 'key' }, down: { label: 'C', kind: 'key' },
  attack: { label: 'Clique', kind: 'mouse-left' }, heavy: { label: 'Botão direito', kind: 'mouse-right' }, interact: { label: 'E', kind: 'key' }, dodge: { label: 'Q', kind: 'key' },
  pause: { label: 'Esc', kind: 'key' }, camera: { label: 'V', kind: 'key' }, help: { label: 'H', kind: 'key' }, fly: { label: 'F', kind: 'key' }, mute: { label: 'M', kind: 'key' },
  confirm: { label: 'Enter', kind: 'key' }, back: { label: 'Esc', kind: 'key' }, menuUp: { label: '↑', kind: 'key' }, menuDown: { label: '↓', kind: 'key' },
}
const gamepadGlyphs: Record<GameAction, Glyph> = {
  move: { label: 'LS', kind: 'stick' }, look: { label: 'RS', kind: 'stick' }, jump: { label: 'A', kind: 'face', tone: 'a' }, sprint: { label: 'LS', kind: 'stick' }, down: { label: 'LB', kind: 'bumper' },
  attack: { label: 'RB', kind: 'bumper' }, heavy: { label: 'RT', kind: 'trigger' }, interact: { label: 'X', kind: 'face', tone: 'x' }, dodge: { label: 'B', kind: 'face', tone: 'b' },
  pause: { label: 'Start', kind: 'menu' }, camera: { label: 'Y', kind: 'face', tone: 'y' }, help: { label: 'View', kind: 'menu' }, fly: { label: '↑', kind: 'dpad' }, mute: { label: '↓', kind: 'dpad' },
  confirm: { label: 'A', kind: 'face', tone: 'a' }, back: { label: 'B', kind: 'face', tone: 'b' }, menuUp: { label: '↑', kind: 'dpad' }, menuDown: { label: '↓', kind: 'dpad' },
}
export const glyph = (action: GameAction, device: InputDevice): Glyph => (device === 'gamepad' ? gamepadGlyphs : keyboardGlyphs)[action]
export const actionNames: Record<GameAction, string> = { move: 'Andar', look: 'Olhar', jump: 'Pular', sprint: 'Correr', down: 'Descer (voo)', attack: 'Atacar', heavy: 'Ataque pesado',
  interact: 'Interagir / conversar', dodge: 'Esquivar', pause: 'Pausar', camera: 'Alternar 1ª/3ª pessoa', help: 'Ajuda', fly: 'Caminhada/voo', mute: 'Som', confirm: 'Confirmar', back: 'Voltar',
  menuUp: 'Opção anterior', menuDown: 'Próxima opção' }
export const controlActions: GameAction[] = ['move', 'look', 'jump', 'sprint', 'interact', 'attack', 'heavy', 'dodge', 'camera', 'fly', 'down', 'mute', 'help', 'pause']
