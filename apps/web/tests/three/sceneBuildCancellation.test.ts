import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { buildScene, buildSceneSteps, createResources } from '../../src/three/sceneBuild.ts'
import { createEmptyScene } from '../../src/three/sceneDocument.ts'
import type { CharacterSkin } from '../../src/three/sceneRuntimeTypes.ts'

test('cancelled scene construction releases created skins without constructing the rest', () => {
  const resources = createResources(), created: string[] = [], released: string[] = []
  function* skins(): Generator<CharacterSkin> {
    for (const id of ['first', 'second']) {
      created.push(id)
      yield { rootId: id, object: new THREE.Group(), meshes: [], hidden: new Set(), springs: [], restHands: { left: 'relaxed', right: 'relaxed' }, grips: {}, setFace() {}, setHands() {}, setQuality() {}, dispose() { released.push(id) } }
    }
  }
  const steps = buildSceneSteps(createEmptyScene(), resources, { instancing: false, helpers: false, skins })
  while (!created.length) assert.equal(steps.next().done, false)
  steps.return(undefined!)
  assert.deepEqual(created, ['first']); assert.deepEqual(released, ['first'])
  resources.dispose()
})
test('completed scene construction retains ownership until the caller disposes it', () => {
  const resources = createResources(), disposed: string[] = []
  const built = buildScene(createEmptyScene(), resources, { instancing: false, helpers: false, skins: function* () {
    yield { rootId: 'actor', object: new THREE.Group(), meshes: [], hidden: new Set(), springs: [], restHands: { left: 'relaxed', right: 'relaxed' }, grips: {}, setFace() {}, setHands() {}, setQuality() {}, dispose() { disposed.push('actor') } }
  } })
  assert.deepEqual(disposed, [])
  built.dispose(); assert.deepEqual(disposed, ['actor']); resources.dispose()
})
