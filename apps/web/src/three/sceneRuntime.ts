import { cycleProgress, isTriggered, playsOnce, samplePose, type ScenePose } from './sceneAnimation.ts'
import { subtreeIds, type PowerKind, type SceneBehavior, type SceneInteraction, type SceneNode, type SceneObjective, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'

interface NodeState { clock: number; active: boolean; progress: number; direction: 1 | -1 }
export type RuntimeEventKind = 'collect' | 'unlock' | 'locked' | 'heal' | 'powerup' | 'powerdown' | 'hit' | 'defeat' | 'spawn' | 'checkpoint' | 'dialogue' | 'message' | 'toggle'
  | 'hurt' | 'shield' | 'victory' | 'defeat-player' | 'timeout'
/** One-shot notifications for audio and HUD; `id` is the node involved, or the power kind for powerup expiry. */
export interface RuntimeEvent { kind: RuntimeEventKind; id?: string }
/** Play-mode state. It never mutates the document; leaving play mode discards it. */
export interface SceneRuntime {
  byId: Map<string, SceneNode>
  nodes: SceneNode[]
  states: Map<string, NodeState>
  hidden: Set<string>
  /** Targets of toggleVisibility: their runtime visibility replaces the authored flag, so hidden passages can be revealed. */
  toggles: Set<string>
  collected: Set<string>
  /** Heal and powerup pickups already used; like collected they are hidden but never count as collectibles. */
  consumed: Set<string>
  inside: Set<string>
  /** Every reachable collect interaction, including those that add an `item` to the inventory. */
  collectibles: number
  /** Inventory: item name → count, filled by collect interactions with `item`. Required items are never consumed. */
  items: Map<string, number>
  /** Interactions whose last attempt was refused for a missing `requires` item. */
  blocked: Set<string>
  /** Interactions with `requires` that already succeeded once (the 'unlock' event fires only then). */
  unlocked: Set<string>
  /** Active powers and their remaining seconds. */
  effects: Map<PowerKind, number>
  /** Next dialogue line per node. */
  dialogue: Map<string, number>
  /** Game loop state: health, respawn point, defeated enemies, timer and outcome. */
  health: number
  maxHealth: number
  invulnerable: number
  checkpoint: Vector3Tuple | null
  checkpoints: Set<string>
  defeated: Set<string>
  enemies: string[]
  enemyHealth: Map<string, number>
  /** Enemies waiting for their `delay`: id → spawn time. They stay hidden and inactive but count toward totals. */
  pending: Map<string, number>
  goals: string[]
  objective: SceneObjective
  elapsed: number
  outcome: 'playing' | 'won' | 'lost'
  score: number
  events: RuntimeEvent[]
}
export const actionLabels: Record<SceneInteraction['action'], string> = { toggleAnimation: 'Acionar', toggleVisibility: 'Alternar', collect: 'Coletar', message: 'Ler', heal: 'Curar', powerup: 'Pegar poder', dialogue: 'Conversar' }
export const powerLabels: Record<PowerKind, string> = { speed: 'Velocidade', jump: 'Super pulo', shield: 'Escudo', strength: 'Força' }
/** Score: +10 collect, +50 enemy defeated, +5 heal/powerup; victory adds up to 100 for remaining health and 2 per second left on a time limit. */
export const SCORE = { collect: 10, defeat: 50, pickup: 5, health: 100, second: 2 } as const
export const HEAL_DEFAULT = 25, POWER_SECONDS = 10, SURVIVE_DEFAULT = 60, MAX_EVENTS = 64

export function createRuntime(doc: ThreeSceneDocument, startTime = 0): SceneRuntime {
  const states = new Map<string, NodeState>()
  for (const node of doc.nodes) if (node.animation.kind !== 'none') states.set(node.id, { clock: isTriggered(node) ? 0 : startTime, active: !isTriggered(node), progress: 0, direction: -1 })
  const byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const toggles = new Set(doc.nodes.flatMap((node) => node.interaction?.action === 'toggleVisibility' ? [node.interaction.targetId ?? node.id] : []))
  const hidden = new Set([...toggles].filter((id) => byId.get(id)?.visible === false))
  // Objectives only count what the player can ever see; a hidden branch that a switch reveals still counts.
  const reachable = (node: SceneNode | undefined): boolean => !node || ((node.visible || toggles.has(node.id)) && reachable(node.parentId ? byId.get(node.parentId) : undefined))
  const health = doc.environment.player?.health ?? 100, foes = doc.nodes.filter((node) => node.behavior?.type === 'enemy' && reachable(node)), enemies = foes.map((node) => node.id)
  const collectibles = doc.nodes.filter((node) => node.interaction?.action === 'collect' && reachable(node)).length, goals = doc.nodes.filter((node) => node.behavior?.type === 'goal' && reachable(node)).map((node) => node.id)
  const objective: SceneObjective = doc.environment.objective ?? { type: goals.length ? 'reachGoal' : collectibles ? 'collectAll' : enemies.length ? 'defeatEnemies' : 'explore', title: '', timeLimit: 0 }
  const pending = new Map(foes.filter((node) => (node.behavior!.delay ?? 0) > 0).map((node) => [node.id, node.behavior!.delay!]))
  for (const id of pending.keys()) hidden.add(id)
  return { byId, nodes: doc.nodes, states, hidden, toggles, collected: new Set(), consumed: new Set(), inside: new Set(), collectibles, items: new Map(), blocked: new Set(), unlocked: new Set(), effects: new Map(), dialogue: new Map(),
    health, maxHealth: health, invulnerable: 0, checkpoint: null, checkpoints: new Set(), defeated: new Set(), enemies, enemyHealth: new Map(foes.map((node) => [node.id, node.behavior!.health ?? 1])), pending,
    goals, objective, elapsed: 0, outcome: 'playing', score: 0, events: [] }
}

function emit(runtime: SceneRuntime, kind: RuntimeEventKind, id?: string) {
  runtime.events.push(id === undefined ? { kind } : { kind, id })
  if (runtime.events.length > MAX_EVENTS) runtime.events.splice(0, runtime.events.length - MAX_EVENTS)
}
/** Returns and clears the pending events; call once per frame. */
export function drainEvents(runtime: SceneRuntime): RuntimeEvent[] {
  return runtime.events.splice(0)
}

/** Effective time limit: survive defaults to 60 s when the objective sets none. */
export function objectiveLimit(runtime: SceneRuntime): number {
  return runtime.objective.type === 'survive' ? runtime.objective.timeLimit || SURVIVE_DEFAULT : runtime.objective.timeLimit
}

/** Remaining requirements; reaching a goal only wins after the other conditions of the objective are met. */
export function objectiveStatus(runtime: SceneRuntime): { done: boolean; text: string } {
  const items = `${runtime.collected.size}/${runtime.collectibles} itens`, foes = `${runtime.defeated.size}/${runtime.enemies.length} inimigos`
  const title = runtime.objective.title
  switch (runtime.objective.type) {
    case 'collectAll': return { done: runtime.collected.size >= runtime.collectibles, text: title || `Colete todos os itens · ${items}` }
    case 'defeatEnemies': return { done: runtime.defeated.size >= runtime.enemies.length, text: title || `Derrote os inimigos · ${foes}` }
    case 'reachGoal': return { done: true, text: title || `Chegue ao portal${runtime.collectibles ? ` · ${items}` : ''}` }
    case 'survive': { const left = objectiveLimit(runtime) - runtime.elapsed; return { done: left <= 0, text: title || `Sobreviva · ${Math.max(0, Math.ceil(left))} s` } }
    default: return { done: false, text: title || (runtime.collectibles ? `Explore · ${items}` : 'Explore livremente') }
  }
}

/** Runtime visibility of a node's own flag: toggle targets follow the switches, others keep the authored value. */
export function runtimeVisible(runtime: SceneRuntime, node: SceneNode): boolean {
  return (runtime.toggles.has(node.id) || node.visible) && !runtime.hidden.has(node.id)
}

/** Multipliers from active powers: speed and jump ×1.6, strength doubles damage, shield blocks damage. */
export function playerModifiers(runtime: SceneRuntime): { speed: number; jump: number; damage: number; shield: boolean } {
  const on = (power: PowerKind) => (runtime.effects.get(power) ?? 0) > 0
  return { speed: on('speed') ? 1.6 : 1, jump: on('jump') ? 1.6 : 1, damage: on('strength') ? 2 : 1, shield: on('shield') }
}

/** Applies damage unless the player is briefly invulnerable after the previous hit or shielded (the block also grants the grace period). */
export function damagePlayer(runtime: SceneRuntime, amount: number): boolean {
  if (runtime.outcome !== 'playing' || runtime.invulnerable > 0 || amount <= 0) return false
  runtime.invulnerable = 1
  if (playerModifiers(runtime).shield) { emit(runtime, 'shield'); return false }
  runtime.health = Math.max(0, runtime.health - amount)
  emit(runtime, runtime.health <= 0 ? 'defeat-player' : 'hurt')
  return true
}

/** Spawned, not defeated and not hidden by a switch. */
export function activeEnemy(runtime: SceneRuntime, id: string): boolean {
  return runtime.enemies.includes(id) && !runtime.defeated.has(id) && !runtime.pending.has(id) && !runtime.hidden.has(id)
}

export function enemyHealth(runtime: SceneRuntime, id: string): { health: number; max: number } | null {
  const health = runtime.enemyHealth.get(id)
  return health === undefined ? null : { health, max: runtime.byId.get(id)?.behavior?.health ?? 1 }
}

/** Defeats outright (stomp, legacy strike). Waiting enemies cannot be defeated before they appear. */
export function defeatEnemy(runtime: SceneRuntime, id: string): boolean {
  if (runtime.defeated.has(id) || !runtime.enemies.includes(id) || runtime.pending.has(id)) return false
  runtime.defeated.add(id)
  runtime.hidden.add(id)
  runtime.enemyHealth.set(id, 0)
  runtime.score += SCORE.defeat
  emit(runtime, 'defeat', id)
  return true
}

/** Removes `amount` health; the caller applies weapon damage × playerModifiers().damage. */
export function damageEnemy(runtime: SceneRuntime, id: string, amount: number): 'hit' | 'defeated' | null {
  if (!(amount > 0) || runtime.outcome !== 'playing' || !activeEnemy(runtime, id)) return null
  const health = (runtime.enemyHealth.get(id) ?? 1) - amount
  if (health <= 1e-6) return defeatEnemy(runtime, id) ? 'defeated' : null
  runtime.enemyHealth.set(id, health)
  emit(runtime, 'hit', id)
  return 'hit'
}

/** Speed that lifts the player `range` metres: sqrt(2·g·h). */
export function launchVelocity(behavior: Pick<SceneBehavior, 'range'>, gravity = 24): number {
  return Math.sqrt(2 * gravity * Math.max(0, behavior.range))
}

/** Saves a respawn point once per checkpoint. */
export function reachCheckpoint(runtime: SceneRuntime, id: string, position: Vector3Tuple): boolean {
  if (runtime.checkpoints.has(id) || runtime.outcome !== 'playing') return false
  runtime.checkpoints.add(id)
  runtime.checkpoint = [...position]
  emit(runtime, 'checkpoint', id)
  return true
}

function win(runtime: SceneRuntime) {
  runtime.outcome = 'won'
  const limit = objectiveLimit(runtime)
  runtime.score += Math.round(SCORE.health * runtime.health / runtime.maxHealth) + (limit > 0 && runtime.objective.type !== 'survive' ? SCORE.second * Math.max(0, Math.floor(limit - runtime.elapsed)) : 0)
  emit(runtime, 'victory')
}

/** Touching a goal finishes the level when the objective allows; returns a message for the HUD. */
export function reachGoal(runtime: SceneRuntime): string | null {
  if (runtime.outcome !== 'playing') return null
  const status = objectiveStatus(runtime), needsItems = runtime.objective.type === 'reachGoal' ? false : !status.done
  if (needsItems) return `O portal ainda está fechado: ${status.text}`
  win(runtime)
  return 'Fase concluída!'
}

/** Automatic victory for collect/defeat objectives without a goal and for survive, and defeat when other time limits end. */
export function checkOutcome(runtime: SceneRuntime): void {
  if (runtime.outcome !== 'playing') return
  if (runtime.objective.type === 'survive') { if (runtime.health > 0 && objectiveStatus(runtime).done) win(runtime); return }
  if (runtime.objective.timeLimit > 0 && runtime.elapsed >= runtime.objective.timeLimit) { runtime.outcome = 'lost'; emit(runtime, 'timeout'); return }
  const required = runtime.objective.type === 'collectAll' ? runtime.collectibles : runtime.objective.type === 'defeatEnemies' ? runtime.enemies.length : 0
  if (!runtime.goals.length && required > 0 && objectiveStatus(runtime).done) win(runtime)
}

export function advanceRuntime(runtime: SceneRuntime, seconds: number): void {
  if (runtime.outcome === 'playing') {
    runtime.elapsed += seconds
    for (const [power, left] of runtime.effects) {
      if (left - seconds > 0) runtime.effects.set(power, left - seconds)
      else { runtime.effects.delete(power); emit(runtime, 'powerdown', power) }
    }
    for (const [id, at] of runtime.pending) if (runtime.elapsed >= at) { runtime.pending.delete(id); runtime.hidden.delete(id); emit(runtime, 'spawn', id) }
  }
  runtime.invulnerable = Math.max(0, runtime.invulnerable - seconds)
  for (const [id, state] of runtime.states) {
    const node = runtime.byId.get(id)!
    if (playsOnce(node)) state.progress = Math.min(1, Math.max(0, state.progress + state.direction * seconds / node.animation.duration))
    else if (state.active) state.clock += seconds
  }
}

export function runtimePose(runtime: SceneRuntime, node: SceneNode): ScenePose {
  const state = runtime.states.get(node.id)
  if (!state) return samplePose(node, 0)
  return playsOnce(node) ? samplePose(node, state.progress) : samplePose(node, cycleProgress(node, state.clock))
}

export function interactionAvailable(runtime: SceneRuntime, node: SceneNode): boolean {
  return !!node.interaction && !runtime.collected.has(node.id) && !runtime.consumed.has(node.id) && (node.interaction.trigger === 'key' || !runtime.hidden.has(node.id))
}

const itemKey = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
/** Message shown instead of acting while the inventory lacks the required item; null when allowed. */
export function interactionBlocked(runtime: SceneRuntime, node: SceneNode): string | null {
  const requires = node.interaction?.requires
  return requires && ![...runtime.items].some(([name, count]) => count > 0 && itemKey(name) === itemKey(requires)) ? `Precisa de: ${requires}` : null
}

const dialogueLines = (message: string) => message.split('|').map((line) => line.trim()).filter(Boolean)
/** Last line shown by a dialogue node (index −1 before the first conversation). */
export function dialogueState(runtime: SceneRuntime, id: string): { index: number; total: number; line: string | null } | null {
  const interaction = runtime.byId.get(id)?.interaction
  if (interaction?.action !== 'dialogue') return null
  const lines = dialogueLines(interaction.message), next = runtime.dialogue.get(id) ?? 0, index = next ? (next - 1) % Math.max(1, lines.length) : -1
  return { index, total: lines.length, line: index >= 0 ? lines[index] ?? null : null }
}

/** Applies one interaction and returns the message to display, if any. */
export function triggerInteraction(runtime: SceneRuntime, sourceId: string): string | null {
  const node = runtime.byId.get(sourceId), interaction = node?.interaction
  if (!node || !interaction || !interactionAvailable(runtime, node)) return null
  const blocked = interactionBlocked(runtime, node)
  if (blocked) { runtime.blocked.add(node.id); emit(runtime, 'locked', node.id); return blocked }
  runtime.blocked.delete(node.id)
  if (interaction.requires && !runtime.unlocked.has(node.id)) { runtime.unlocked.add(node.id); emit(runtime, 'unlock', node.id) }
  const target = interaction.targetId ?? node.id
  switch (interaction.action) {
    case 'toggleAnimation':
      for (const id of subtreeIds(runtime.nodes, target)) {
        const state = runtime.states.get(id), animated = runtime.byId.get(id)!
        if (!state) continue
        if (playsOnce(animated)) state.direction = state.direction === 1 ? -1 : 1
        else state.active = !state.active
      }
      emit(runtime, 'toggle', node.id)
      break
    case 'toggleVisibility':
      if (runtime.hidden.has(target)) runtime.hidden.delete(target); else runtime.hidden.add(target)
      emit(runtime, 'toggle', node.id)
      break
    case 'collect': {
      runtime.collected.add(node.id)
      runtime.hidden.add(node.id)
      runtime.score += SCORE.collect
      if (interaction.item) runtime.items.set(interaction.item, (runtime.items.get(interaction.item) ?? 0) + 1)
      emit(runtime, 'collect', node.id)
      return interaction.message || `${interaction.item ? `${interaction.item} obtido` : `${node.name} coletado`} · ${runtime.collected.size}/${runtime.collectibles}`
    }
    case 'heal': {
      if (runtime.health >= runtime.maxHealth) return 'Vida já está cheia.'
      const before = runtime.health
      runtime.health = Math.min(runtime.maxHealth, runtime.health + (interaction.amount || HEAL_DEFAULT))
      runtime.consumed.add(node.id)
      runtime.hidden.add(node.id)
      runtime.score += SCORE.pickup
      emit(runtime, 'heal', node.id)
      return interaction.message || `+${Math.round(runtime.health - before)} de vida`
    }
    case 'powerup': {
      const power = interaction.power ?? 'speed', seconds = interaction.amount || POWER_SECONDS
      runtime.effects.set(power, Math.max(runtime.effects.get(power) ?? 0, seconds))
      runtime.consumed.add(node.id)
      runtime.hidden.add(node.id)
      runtime.score += SCORE.pickup
      emit(runtime, 'powerup', node.id)
      return interaction.message || `${powerLabels[power]} por ${Math.round(seconds)} s`
    }
    case 'dialogue': {
      const lines = dialogueLines(interaction.message)
      if (!lines.length) return null
      const next = runtime.dialogue.get(node.id) ?? 0
      runtime.dialogue.set(node.id, next + 1)
      emit(runtime, 'dialogue', node.id)
      return lines[next % lines.length]
    }
    default:
      if (interaction.message) emit(runtime, 'message', node.id)
  }
  return interaction.message || null
}

export function pressInteractionKey(runtime: SceneRuntime, key: string): string[] {
  const lower = key.toLowerCase()
  return runtime.nodes.filter((node) => node.interaction?.trigger === 'key' && node.interaction.key === lower)
    .map((node) => triggerInteraction(runtime, node.id)).filter((message): message is string => !!message)
}

/** Fires proximity triggers once per entry; leaving 10% beyond the radius re-arms them. */
export function updateProximity(runtime: SceneRuntime, player: Vector3Tuple, positions: Map<string, Vector3Tuple>): string[] {
  const messages: string[] = []
  for (const node of runtime.nodes) {
    if (node.interaction?.trigger !== 'proximity' || !positions.has(node.id)) continue
    const position = positions.get(node.id)!, distance = Math.hypot(player[0] - position[0], player[1] - position[1], player[2] - position[2])
    if (distance <= node.interaction.radius && !runtime.inside.has(node.id)) {
      runtime.inside.add(node.id)
      const message = triggerInteraction(runtime, node.id)
      if (message) messages.push(message)
    } else if (distance > node.interaction.radius * 1.1) runtime.inside.delete(node.id)
  }
  return messages
}
