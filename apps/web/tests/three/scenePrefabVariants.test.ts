import assert from 'node:assert/strict'
import test from 'node:test'
import { createNode } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import { prefabTypes } from '../../src/three/scenePrefabs.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }

test('every prefab variant (seed, size, lighting) stays free of intersections and coplanar surface conflicts', () => {
  const failures: string[] = []
  for (const type of prefabTypes) for (const [seed, size, lit] of [[0, 1, false], [1, 2.5, true], [2, 0.6, false]] as const) {
    const base = createNode('box')
    const doc = expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [{
      id: type, parentId: null, name: type, kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
      color: base.material.color, metalness: 0, roughness: 0.5, animation: base.animation, repeat: single, overlapWith: [],
      prefab: { type, size: type === 'house' ? 1 : size, seed, primary: null, secondary: null, text: 'Olá', lit, interactive: true } }] })
    const label = `${type} seed=${seed} size=${size}`
    const report = inspectSceneGeometry(doc)
    if (!report.complete) failures.push(`${label}: inspeção incompleta`)
    for (const issue of [...report.intersections, ...report.surfaceConflicts ?? []]) failures.push(`${label}: ${issue.nameA} | ${issue.nameB}`)
  }
  assert.deepEqual([...new Set(failures)], [])
})
