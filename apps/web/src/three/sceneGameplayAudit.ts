import type { SceneEnvironment, SceneNode } from './sceneDocument.ts'
import { expandRecipeSources, itemKey } from './sceneGameplay.ts'

/** Checks the dependency graph before a generated adventure can be played. */
export function validateGameplaySources(environment: SceneEnvironment, nodes: SceneNode[]) {
  const spec = environment.gameplay
  if (!spec) return
  const gathered = new Set(nodes.flatMap(node => [node.resource?.item, node.interaction?.action === 'collect' ? node.interaction.item : undefined]).filter((name): name is string => !!name).map(itemKey))
  if (spec.naturalResources) for (const name of ['Madeira', 'Pedra', 'Fibra', 'Cogumelo']) gathered.add(itemKey(name))
  const available = new Set([...gathered, ...spec.startingItems.map(stack => itemKey(stack.item))])
  for (const quest of spec.quests) {
    expandRecipeSources(spec, available)
    for (const step of quest.steps) {
      if (step.kind === 'gather' && !gathered.has(itemKey(step.target)) && !spec.startingItems.some(stack => itemKey(stack.item) === itemKey(step.target))) throw new Error(`Missão “${quest.title}”: não existe fonte de ${step.target}.`)
      if (step.kind === 'craft' && !spec.recipes.some(recipe => itemKey(recipe.output.item) === itemKey(step.target) && recipe.inputs.every(input => available.has(itemKey(input.item))))) throw new Error(`Missão “${quest.title}”: receita ou ingredientes inacessíveis para ${step.target}.`)
      if (['talk', 'visit', 'interact'].includes(step.kind) && step.count !== 1 || step.kind === 'defeat' && step.target !== '*' && !step.target.endsWith('/*') && step.count !== 1) throw new Error(`Missão “${quest.title}”: alvos individuais usam quantidade 1.`)
    }
    for (const reward of quest.rewards) available.add(itemKey(reward.item))
  }
}
