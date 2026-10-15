import { cycleProgress, isTriggered, playsOnce, samplePose, type ScenePose } from './sceneAnimation.ts'
import { subtreeIds, type SceneInteraction, type SceneNode, type SceneObjective, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'

interface NodeState { clock: number; active: boolean; progress: number; direction: 1 | -1 }
/** Play-mode state. It never mutates the document; leaving play mode discards it. */
export interface SceneRuntime {
  byId: Map<string, SceneNode>
  nodes: SceneNode[]
  states: Map<string, NodeState>
  hidden: Set<string>
  /** Targets of toggleVisibility: their runtime visibility replaces the authored flag, so hidden passages can be revealed. */
  toggles: Set<string>
  collected: Set<string>
  inside: Set<string>
  collectibles: number
  /** Game loop state: health, respawn point, defeated enemies, timer and outcome. */
  health: number
  maxHealth: number
  invulnerable: number
  checkpoint: Vector3Tuple | null
  checkpoints: Set<string>
  defeated: Set<string>
  enemies: string[]
  goals: string[]
  objective: SceneObjective
  elapsed: number
  outcome: 'playing' | 'won' | 'lost'
}
export const actionLabels: Record<SceneInteraction['action'], string> = { toggleAnimation: 'Acionar', toggleVisibility: 'Alternar', collect: 'Coletar', message: 'Ler' }

export function createRuntime(doc: ThreeSceneDocument, startTime = 0): SceneRuntime {
  const states = new Map<string, NodeState>()
  for (const node of doc.nodes) if (node.animation.kind !== 'none') states.set(node.id, { clock: isTriggered(node) ? 0 : startTime, active: !isTriggered(node), progress: 0, direction: -1 })
  const byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const toggles = new Set(doc.nodes.flatMap((node) => node.interaction?.action === 'toggleVisibility' ? [node.interaction.targetId ?? node.id] : []))
  const hidden = new Set([...toggles].filter((id) => byId.get(id)?.visible === false))
  // Objectives only count what the player can ever see; a hidden branch that a switch reveals still counts.
  const reachable = (node: SceneNode | undefined): boolean => !node || ((node.visible || toggles.has(node.id)) && reachable(node.parentId ? byId.get(node.parentId) : undefined))
  const health = doc.environment.player?.health ?? 100, enemies = doc.nodes.filter((node) => node.behavior?.type === 'enemy' && reachable(node)).map((node) => node.id)
  const collectibles = doc.nodes.filter((node) => node.interaction?.action === 'collect' && reachable(node)).length, goals = doc.nodes.filter((node) => node.behavior?.type === 'goal' && reachable(node)).map((node) => node.id)
  const objective: SceneObjective = doc.environment.objective ?? { type: goals.length ? 'reachGoal' : collectibles ? 'collectAll' : enemies.length ? 'defeatEnemies' : 'explore', title: '', timeLimit: 0 }
  return { byId, nodes: doc.nodes, states, hidden, toggles, collected: new Set(), inside: new Set(), collectibles,
    health, maxHealth: health, invulnerable: 0, checkpoint: null, checkpoints: new Set(), defeated: new Set(), enemies, goals, objective, elapsed: 0, outcome: 'playing' }
}

/** Remaining requirements; reaching a goal only wins after the other conditions of the objective are met. */
export function objectiveStatus(runtime: SceneRuntime): { done: boolean; text: string } {
  const items = `${runtime.collected.size}/${runtime.collectibles} itens`, foes = `${runtime.defeated.size}/${runtime.enemies.length} inimigos`
  const title = runtime.objective.title
  switch (runtime.objective.type) {
    case 'collectAll': return { done: runtime.collected.size >= runtime.collectibles, text: title || `Colete todos os itens · ${items}` }
    case 'defeatEnemies': return { done: runtime.defeated.size >= runtime.enemies.length, text: title || `Derrote os inimigos · ${foes}` }
    case 'reachGoal': return { done: true, text: title || `Chegue ao portal${runtime.collectibles ? ` · ${items}` : ''}` }
    default: return { done: false, text: title || (runtime.collectibles ? `Explore · ${items}` : 'Explore livremente') }
  }
}

/** Runtime visibility of a node's own flag: toggle targets follow the switches, others keep the authored value. */
export function runtimeVisible(runtime: SceneRuntime, node: SceneNode): boolean {
  return (runtime.toggles.has(node.id) || node.visible) && !runtime.hidden.has(node.id)
}

/** Applies damage unless the player is briefly invulnerable after the previous hit. */
export function damagePlayer(runtime: SceneRuntime, amount: number): boolean {
  if (runtime.outcome !== 'playing' || runtime.invulnerable > 0 || amount <= 0) return false
  runtime.health = Math.max(0, runtime.health - amount)
  runtime.invulnerable = 1
  return true
}

export function defeatEnemy(runtime: SceneRuntime, id: string): boolean {
  if (runtime.defeated.has(id) || !runtime.enemies.includes(id)) return false
  runtime.defeated.add(id)
  runtime.hidden.add(id)
  return true
}

/** Touching a goal finishes the level when the objective allows; returns a message for the HUD. */
export function reachGoal(runtime: SceneRuntime): string | null {
  if (runtime.outcome !== 'playing') return null
  const status = objectiveStatus(runtime), needsItems = runtime.objective.type === 'reachGoal' ? false : !status.done
  if (needsItems) return `O portal ainda está fechado: ${status.text}`
  runtime.outcome = 'won'
  return 'Fase concluída!'
}

/** Automatic victory for collect/defeat objectives without a goal, and defeat when the time limit ends. */
export function checkOutcome(runtime: SceneRuntime): void {
  if (runtime.outcome !== 'playing') return
  if (runtime.objective.timeLimit > 0 && runtime.elapsed >= runtime.objective.timeLimit) { runtime.outcome = 'lost'; return }
  const required = runtime.objective.type === 'collectAll' ? runtime.collectibles : runtime.objective.type === 'defeatEnemies' ? runtime.enemies.length : 0
  if (!runtime.goals.length && required > 0 && objectiveStatus(runtime).done) runtime.outcome = 'won'
}

export function advanceRuntime(runtime: SceneRuntime, seconds: number): void {
  if (runtime.outcome === 'playing') runtime.elapsed += seconds
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
  return !!node.interaction && !runtime.collected.has(node.id) && (node.interaction.trigger === 'key' || !runtime.hidden.has(node.id))
}

/** Applies one interaction and returns the message to display, if any. */
export function triggerInteraction(runtime: SceneRuntime, sourceId: string): string | null {
  const node = runtime.byId.get(sourceId), interaction = node?.interaction
  if (!node || !interaction || !interactionAvailable(runtime, node)) return null
  const target = interaction.targetId ?? node.id
  if (interaction.action === 'toggleAnimation') {
    for (const id of subtreeIds(runtime.nodes, target)) {
      const state = runtime.states.get(id), animated = runtime.byId.get(id)!
      if (!state) continue
      if (playsOnce(animated)) state.direction = state.direction === 1 ? -1 : 1
      else state.active = !state.active
    }
  }
  if (interaction.action === 'toggleVisibility') { if (runtime.hidden.has(target)) runtime.hidden.delete(target); else runtime.hidden.add(target) }
  if (interaction.action === 'collect') {
    runtime.collected.add(node.id)
    runtime.hidden.add(node.id)
    return interaction.message || `${node.name} coletado · ${runtime.collected.size}/${runtime.collectibles}`
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
