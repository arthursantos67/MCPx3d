import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, createNode, hasSurface } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { supportedInsertionPosition, sceneMatrices } from '../../src/three/scenePlacement.ts'
import { terrainHeightAt } from '../../src/three/sceneGeometrySpec.ts'

test('a library character enters on the floor, with clear space, instead of outside the playable level', () => {
  const scene = createEmptyScene()
  scene.environment.player!.spawn = [0, 2, 0]
  scene.nodes = [{ ...createNode('box'), id: 'floor', dimensions: [12, 0.2, 12], position: [0,1.9,0] }, { ...createNode('box'), id: 'occupied', dimensions: [2,2,2], position: [0,3,0] }]
  const generated = expandSceneRecipe({ name: 'Personagem', duration: 10, background: '#ffffff', exposure: 1, lightIntensity: 1, nodes: [{ ...createNode('group'), id: 'actor', name: 'Cavaleiro', color: '#ffffff', metalness: 0, roughness: 0.5, prefab: { type: 'knight', size: 1, seed: 1 }, repeat: { mode: 'linear', count: 1, offset: [0,0,0], axis: 'y', radius: 0 } }] })
  const root = generated.nodes[0]
  root.position = supportedInsertionPosition(scene, root, generated.nodes)
  const matrices = sceneMatrices(generated), bounds = new THREE.Box3(), unit = new THREE.Box3(new THREE.Vector3(-0.5,-0.5,-0.5),new THREE.Vector3(0.5,0.5,0.5))
  for (const node of generated.nodes) if (hasSurface(node.kind)) bounds.union(unit.clone().applyMatrix4(matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))))
  assert.ok(Math.abs(bounds.min.y - 2) < 0.001, `feet at ${bounds.min.y}`)
  assert.ok(bounds.min.x >= -6 && bounds.max.x <= 6 && bounds.min.z >= -6 && bounds.max.z <= 6)
  const overlap = bounds.clone().intersect(new THREE.Box3(new THREE.Vector3(-1,2,-1),new THREE.Vector3(1,4,1)))
  assert.ok(overlap.isEmpty(), 'the occupied space must stay clear')
})
test('library placement follows the actual triangulated terrain height', () => {
  const terrain = { ...createNode('terrain'), dimensions: [40,6,40] as [number,number,number], position: [0,3,0] as [number,number,number] }, scene = { ...createEmptyScene(), nodes: [terrain] }, box = createNode('box')
  const position = supportedInsertionPosition(scene, box, [box])
  const expected = terrain.position[1] + terrainHeightAt(terrain.geometry, position[0]/40, position[2]/40)*6
  assert.ok(Math.abs(position[1] - 0.5 - expected) < 0.001)
})
