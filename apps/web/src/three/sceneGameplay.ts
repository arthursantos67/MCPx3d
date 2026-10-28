export interface ItemStack { item: string; amount: number }
export interface SceneResource extends ItemStack { health: number }
export function naturalResource(kind: string): SceneResource | undefined {
  if (['tree', 'pine', 'palm', 'log'].includes(kind)) return { item: 'Madeira', amount: kind === 'log' ? 2 : 3, health: kind === 'log' ? 2 : 4 }
  if (kind === 'rock') return { item: 'Pedra', amount: 3, health: 4 }
  if (kind === 'bush' || kind === 'cactus') return { item: 'Fibra', amount: 2, health: 2 }
  if (kind === 'mushroom') return { item: 'Cogumelo', amount: 1, health: 1 }
  return undefined
}
export type QuestStepKind = 'gather' | 'craft' | 'talk' | 'interact' | 'visit' | 'defeat'
export interface QuestStep { kind: QuestStepKind; target: string; count: number; label: string }
export interface SceneQuest { id: string; title: string; giverId: string | null; steps: QuestStep[]; rewards: ItemStack[] }
export interface CraftRecipe { id: string; name: string; inputs: ItemStack[]; output: ItemStack; healing: number }
export interface SceneGameplay { quests: SceneQuest[]; recipes: CraftRecipe[]; startingItems: ItemStack[]; naturalResources: boolean }
export function expandRecipeSources(spec: SceneGameplay, available: Set<string>): void {
  let changed = true
  while (changed) {
    changed = false
    for (const recipe of spec.recipes) if (!available.has(itemKey(recipe.output.item)) && recipe.inputs.every(input => available.has(itemKey(input.item)))) { available.add(itemKey(recipe.output.item)); changed = true }
  }
}
export function remapGameplay(spec: SceneGameplay, nodeId: (id: string) => string, namespace: (id: string) => string = id => id, defeatScope: string | null = null): SceneGameplay {
  return { ...structuredClone(spec), quests: spec.quests.map(quest => ({ ...structuredClone(quest), id: namespace(quest.id), giverId: quest.giverId ? nodeId(quest.giverId) : null,
    steps: quest.steps.map(step => ({ ...step, target: step.kind === 'defeat' && step.target === '*' && defeatScope ? `${defeatScope}/*` : ['visit', 'talk', 'interact', 'defeat'].includes(step.kind) && step.target !== '*' ? nodeId(step.target) : step.target })) })), recipes: spec.recipes.map(recipe => ({ ...structuredClone(recipe), id: namespace(recipe.id) })) }
}
export interface GameplayProgress {
  accepted: Set<string>; completed: Set<string>; talked: Set<string>; interacted: Set<string>; visited: Set<string>; destroyed: Set<string>
  gathered: Map<string, number>; crafted: Map<string, number>; resourceHealth: Map<string, number>
}
export const itemKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Jogabilidade: objeto inválido.'); return value as Record<string, unknown> }
const label = (value: unknown, max = 100) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Jogabilidade: texto obrigatório de até ${max} caracteres.`); return value.trim() }
const count = (value: unknown, min = 1) => { if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 1000) throw new Error('Jogabilidade: quantidade inteira entre 1 e 1000.'); return value }
const list = (value: unknown, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) throw new Error(`Jogabilidade: lista de até ${max} entradas.`); return value }
const stack = (value: unknown): ItemStack => { const data = object(value); return { item: label(data.item, 40), amount: count(data.amount) } }
export function validateResource(value: unknown): SceneResource | undefined {
  if (value == null) return undefined
  const data = object(value)
  return { ...stack(data), health: count(data.health) }
}
export function validateGameplay(value: unknown): SceneGameplay | undefined {
  if (value == null) return undefined
  const data = object(value)
  const quests = list(data.quests ?? [], 16).map((entry): SceneQuest => {
    const quest = object(entry), steps = list(quest.steps, 8).map((entry): QuestStep => {
      const step = object(entry)
      if (!['gather', 'craft', 'talk', 'interact', 'visit', 'defeat'].includes(step.kind as string)) throw new Error('Etapa de missão desconhecida.')
      return { kind: step.kind as QuestStepKind, target: label(step.target), count: count(step.count ?? 1), label: label(step.label, 160) }
    })
    if (!steps.length) throw new Error('Missões precisam de ao menos uma etapa.')
    return { id: label(quest.id), title: label(quest.title, 160), giverId: quest.giverId == null ? null : label(quest.giverId), steps, rewards: list(quest.rewards ?? [], 8).map(stack) }
  })
  const recipes = list(data.recipes ?? [], 24).map((entry): CraftRecipe => {
    const recipe = object(entry), inputs = list(recipe.inputs, 8).map(stack)
    if (!inputs.length || new Set(inputs.map(input => itemKey(input.item))).size !== inputs.length) throw new Error('Receitas precisam de ingredientes distintos.')
    return { id: label(recipe.id), name: label(recipe.name), inputs, output: stack(recipe.output), healing: count(recipe.healing ?? 0, 0) }
  })
  if (new Set(quests.map(q => q.id)).size !== quests.length || new Set(recipes.map(r => r.id)).size !== recipes.length) throw new Error('IDs de missões e receitas precisam ser únicos.')
  if (data.naturalResources != null && typeof data.naturalResources !== 'boolean') throw new Error('Recursos naturais: booleano obrigatório.')
  return { quests, recipes, startingItems: list(data.startingItems ?? [], 24).map(stack), naturalResources: data.naturalResources === true }
}
export const createGameplayProgress = (): GameplayProgress => ({ accepted: new Set(), completed: new Set(), talked: new Set(), interacted: new Set(), visited: new Set(), destroyed: new Set(), gathered: new Map(), crafted: new Map(), resourceHealth: new Map() })
export const itemCount = (items: Map<string, number>, name: string) => [...items].reduce((sum, [key, amount]) => sum + (itemKey(key) === itemKey(name) ? amount : 0), 0)
export function addItem(items: Map<string, number>, name: string, amount: number) {
  const key = [...items.keys()].find(key => itemKey(key) === itemKey(name)) ?? name
  items.set(key, Math.min(100000, (items.get(key) ?? 0) + amount))
}
export function gatherItem(progress: GameplayProgress, items: Map<string, number>, stack: ItemStack) {
  addItem(items, stack.item, stack.amount)
  const key = itemKey(stack.item)
  progress.gathered.set(key, (progress.gathered.get(key) ?? 0) + stack.amount)
}
export function resourceHit(progress: GameplayProgress, items: Map<string, number>, id: string, resource: SceneResource, damage = 1): { broken: boolean; left: number } | null {
  if (progress.destroyed.has(id) || !(damage > 0)) return null
  const left = Math.max(0, (progress.resourceHealth.get(id) ?? resource.health) - damage)
  progress.resourceHealth.set(id, left)
  if (!left) { progress.destroyed.add(id); gatherItem(progress, items, resource) }
  return { broken: !left, left }
}
export function recipeMissing(recipe: CraftRecipe, items: Map<string, number>): ItemStack[] {
  return recipe.inputs.flatMap(input => { const missing = input.amount - itemCount(items, input.item); return missing > 0 ? [{ item: input.item, amount: missing }] : [] })
}
export function craftItem(progress: GameplayProgress, items: Map<string, number>, recipe: CraftRecipe): boolean {
  if (recipeMissing(recipe, items).length) return false
  for (const input of recipe.inputs) {
    let remaining = input.amount
    for (const [key, amount] of items) if (itemKey(key) === itemKey(input.item)) {
      const spent = Math.min(amount, remaining)
      if (amount === spent) items.delete(key); else items.set(key, amount - spent)
      remaining -= spent
    }
  }
  addItem(items, recipe.output.item, recipe.output.amount)
  const key = itemKey(recipe.output.item)
  progress.crafted.set(key, (progress.crafted.get(key) ?? 0) + recipe.output.amount)
  return true
}
export function questStepCount(step: QuestStep, progress: GameplayProgress, defeated: Set<string>): number {
  switch (step.kind) {
    case 'gather': return progress.gathered.get(itemKey(step.target)) ?? 0
    case 'craft': return progress.crafted.get(itemKey(step.target)) ?? 0
    case 'talk': return progress.talked.has(step.target) ? 1 : 0
    case 'interact': return progress.interacted.has(step.target) ? 1 : 0
    case 'visit': return progress.visited.has(step.target) ? 1 : 0
    case 'defeat': return step.target === '*' ? defeated.size : step.target.endsWith('/*') ? [...defeated].filter(id => id.startsWith(step.target.slice(0, -1))).length : defeated.has(step.target) ? 1 : 0
  }
}
export function activeQuest(spec: SceneGameplay | undefined, progress: GameplayProgress): SceneQuest | undefined { return spec?.quests.find(quest => !progress.completed.has(quest.id)) }
export function talkToQuestGiver(spec: SceneGameplay | undefined, progress: GameplayProgress, id: string) {
  progress.talked.add(id)
  const quest = activeQuest(spec, progress)
  if (quest?.giverId === id) progress.accepted.add(quest.id)
}
export function updateQuests(spec: SceneGameplay | undefined, progress: GameplayProgress, items: Map<string, number>, defeated: Set<string>): SceneQuest[] {
  const completed: SceneQuest[] = []
  for (const quest of spec?.quests ?? []) {
    if (progress.completed.has(quest.id)) continue
    if (!quest.giverId) progress.accepted.add(quest.id)
    if (!progress.accepted.has(quest.id) || quest.steps.some(step => questStepCount(step, progress, defeated) < step.count)) break
    progress.completed.add(quest.id)
    for (const reward of quest.rewards) addItem(items, reward.item, reward.amount)
    completed.push(quest)
  }
  return completed
}
export function gameplayStatus(spec: SceneGameplay | undefined, progress: GameplayProgress, defeated: Set<string>) {
  const quest = activeQuest(spec, progress)
  if (!quest) return { done: !!spec?.quests.length, text: 'Todas as missões concluídas', target: null as string | null, steps: [] as { label: string; value: number; count: number }[] }
  const accepted = !quest.giverId || progress.accepted.has(quest.id), pending = quest.steps.find(step => questStepCount(step, progress, defeated) < step.count)
  return { done: false, text: quest.title, target: !accepted ? quest.giverId : pending && ['talk', 'interact', 'visit', 'defeat'].includes(pending.kind) && pending.target !== '*' ? pending.target : null,
    steps: accepted ? quest.steps.map(step => ({ label: step.label, value: Math.min(step.count, questStepCount(step, progress, defeated)), count: step.count })) : [{ label: 'Converse com quem precisa de ajuda', value: 0, count: 1 }] }
}

export interface GameplaySnapshot {
  accepted: string[]; completed: string[]; talked: string[]; interacted: string[]; visited: string[]; destroyed: string[]; gathered: [string, number][]; crafted: [string, number][]
  resourceHealth?: [string, number][]
}
export function snapshotGameplay(progress: GameplayProgress): GameplaySnapshot {
  return { accepted: [...progress.accepted], completed: [...progress.completed], talked: [...progress.talked], interacted: [...progress.interacted], visited: [...progress.visited], destroyed: [...progress.destroyed], gathered: [...progress.gathered], crafted: [...progress.crafted], resourceHealth: [...progress.resourceHealth] }
}
export function restoreGameplay(progress: GameplayProgress, saved: GameplaySnapshot) {
  for (const name of ['accepted', 'completed', 'talked', 'interacted', 'visited', 'destroyed'] as const) for (const id of Array.isArray(saved[name]) ? saved[name].slice(0, 10000) : []) if (typeof id === 'string' && id.length <= 160) progress[name].add(id)
  for (const name of ['gathered', 'crafted', 'resourceHealth'] as const) for (const pair of Array.isArray(saved[name]) ? saved[name]!.slice(0, name === 'resourceHealth' ? 10000 : 256) : []) if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[0].length <= 160 && Number.isInteger(pair[1]) && pair[1] > 0 && pair[1] <= 100000) progress[name].set(pair[0], pair[1])
}
