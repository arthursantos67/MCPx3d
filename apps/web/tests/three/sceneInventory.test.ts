import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode } from '../../src/three/sceneDocument.ts'
import { availableCraftCells, consumeCraftCells, sceneHasInventory, transferInventoryStack, workbenchRecipe } from '../../src/three/sceneInventory.ts'

test('games without items have no inventory, and collection does not imply crafting', () => {
  const scene = createEmptyScene()
  assert.equal(sceneHasInventory(scene), false)
  scene.nodes.push({ ...createNode('sphere'), interaction: { trigger: 'proximity', key: '', action: 'collect', targetId: null, radius: 1, message: '' } })
  assert.equal(sceneHasInventory(scene), false, 'score-only collectibles do not need a bag')
  scene.nodes[0].interaction!.item = 'Relíquia'
  assert.equal(sceneHasInventory(scene), true)
  assert.equal(scene.environment.gameplay?.recipes.length ?? 0, 0)
})
test('a stack cannot be duplicated across crafting cells and unrelated ingredients never produce an item', () => {
  const recipe = { id: 'axe', name: 'Machado', inputs: [{ item: 'Madeira', amount: 3 }, { item: 'Pedra', amount: 2 }], output: { item: 'Machado', amount: 1 }, healing: 0 }
  const cells = availableCraftCells([{ item: 'Madeira', amount: 4 }, { item: 'Madeira', amount: 4 }, { item: 'Pedra', amount: 3 }], [{ name: 'Madeira', count: 5 }, { name: 'Pedra', count: 2 }])
  assert.deepEqual(cells.map(cell => cell?.amount), [4, 1, 2])
  assert.equal(workbenchRecipe(cells, [recipe]), recipe)
  assert.equal(workbenchRecipe([...cells, { item: 'Fibra', amount: 1 }], [recipe]), null)
  assert.deepEqual(consumeCraftCells(cells, recipe), [{ item: 'Madeira', amount: 1 }, { item: 'Madeira', amount: 1 }, null])
})
test('transfers conserve stacks at the capacity limit and honor a single-item gesture', () => {
  const bag = new Map([['Pedra', 12]]), chest = new Map([['pedra', 99997]])
  assert.equal(transferInventoryStack(bag, chest, 'PEDRA', 12), 3)
  assert.equal(bag.get('Pedra'), 9); assert.equal(chest.get('pedra'), 100000)
  assert.equal(transferInventoryStack(chest, bag, 'pedra', 1), 1)
  assert.equal(bag.get('Pedra'), 10); assert.equal(chest.get('pedra'), 99999)
  for (const amount of [0, -1, NaN, Infinity, 1.5]) assert.equal(transferInventoryStack(bag, chest, 'Pedra', amount), 0)
})
