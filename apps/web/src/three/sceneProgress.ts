import type { SceneRuntime } from './sceneRuntime.ts'
import { itemKey, restoreGameplay, snapshotGameplay, type GameplaySnapshot } from './sceneGameplay.ts'

export interface SceneProgress {
  items: [string, number][]; collected: string[]; consumed: string[]; defeated: string[]; gameplay: GameplaySnapshot
  health: number; elapsed: number; score: number; checkpoint: [number, number, number] | null
  hiddenToggles?: string[]; unlocked?: string[]
}
export function snapshotRuntime(runtime: SceneRuntime): SceneProgress {
  return { items: [...runtime.items], collected: [...runtime.collected], consumed: [...runtime.consumed], defeated: [...runtime.defeated], gameplay: snapshotGameplay(runtime.gameplay), health: runtime.health, elapsed: runtime.elapsed, score: runtime.score, checkpoint: runtime.checkpoint,
    hiddenToggles: [...runtime.toggles].filter(id => runtime.hidden.has(id)), unlocked: [...runtime.unlocked] }
}
export function restoreRuntime(runtime: SceneRuntime, saved: SceneProgress) {
  const allowed = new Set([...(runtime.rules?.startingItems ?? []).map(s => itemKey(s.item)), ...(runtime.rules?.recipes ?? []).flatMap(r => [itemKey(r.output.item), ...r.inputs.map(s => itemKey(s.item))]),
    ...(runtime.rules?.quests ?? []).flatMap(q => q.rewards.map(s => itemKey(s.item))), ...runtime.nodes.flatMap(n => [n.resource?.item, n.interaction?.item].filter((item): item is string => !!item).map(itemKey)),
    ...(runtime.rules?.naturalResources ? ['madeira', 'pedra', 'fibra', 'cogumelo'] : [])])
  if (Array.isArray(saved.items)) {
    runtime.items.clear()
    for (const pair of saved.items.slice(0, 256)) if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[0].length <= 40 && allowed.has(itemKey(pair[0])) && Number.isInteger(pair[1]) && pair[1] > 0 && pair[1] <= 100000) runtime.items.set(pair[0], pair[1])
  }
  for (const name of ['collected', 'consumed', 'defeated'] as const) for (const id of Array.isArray(saved[name]) ? saved[name].slice(0, 2000) : []) if (runtime.byId.has(id)) { runtime[name].add(id); runtime.hidden.add(id); if (name === 'defeated') runtime.enemyHealth.set(id, 0) }
  if (Array.isArray(saved.hiddenToggles)) for (const id of runtime.toggles) { if (saved.hiddenToggles.includes(id)) runtime.hidden.add(id); else runtime.hidden.delete(id) }
  if (Array.isArray(saved.unlocked)) for (const id of saved.unlocked.slice(0, 2000)) if (runtime.byId.has(id)) runtime.unlocked.add(id)
  if (saved.gameplay && typeof saved.gameplay === 'object') restoreGameplay(runtime.gameplay, saved.gameplay)
  for (const id of runtime.gameplay.destroyed) if (runtime.byId.get(id)?.resource) runtime.hidden.add(id)
  if (typeof saved.health === 'number' && Number.isFinite(saved.health)) runtime.health = Math.max(1, Math.min(runtime.maxHealth, saved.health))
  if (typeof saved.elapsed === 'number' && Number.isFinite(saved.elapsed)) runtime.elapsed = Math.max(0, Math.min(1e8, saved.elapsed))
  if (typeof saved.score === 'number' && Number.isFinite(saved.score)) runtime.score = Math.max(0, Math.min(1e9, saved.score))
  if (Array.isArray(saved.checkpoint) && saved.checkpoint.length === 3 && saved.checkpoint.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000)) runtime.checkpoint = [...saved.checkpoint]
}
