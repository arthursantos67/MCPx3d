import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { buildAvatar } from '../apps/web/src/three/sceneCharacters.ts'
import { applyRig, bindParts } from '../apps/web/src/three/sceneCharacterRig.ts'
import * as current from '../apps/web/src/three/sceneCharacterIK.ts'

const source = 'apps/web/src/three/sceneCharacterIK.ts', cache = resolve('.cache/benchmark-ik')
await mkdir(cache, { recursive: true })
await writeFile(resolve(cache, 'package.json'), '{"type":"module"}\n')
const baseline = execFileSync('git', ['show', `HEAD:${source}`], { encoding: 'utf8' }).replace(/from '(\.\/[^']+)'/g, (_, relative) => `from '${pathToFileURL(resolve('apps/web/src/three', relative)).href}'`)
await writeFile(resolve(cache, 'baseline.ts'), baseline)
const before = await import(pathToFileURL(resolve(cache, 'baseline.ts')).href)

function measure(solver) {
  const parts = buildAvatar('knight'), holders = new Map(), root = new THREE.Group()
  for (const part of parts) {
    const holder = new THREE.Group()
    holder.position.fromArray(part.position); holder.rotation.set(...(part.rotation ?? [0, 0, 0]).map(THREE.MathUtils.degToRad)); holders.set(part.id, holder)
  }
  for (const part of parts) (part.parentId ? holders.get(part.parentId) : root).add(holders.get(part.id))
  const binding = bindParts('avatar', 'biped', parts), target = new THREE.Vector3(2, 1.6, 5), samples = []
  const frame = (i) => {
    applyRig(binding, holders, { time: i / 60, speed: 2, airborne: false, attack: -1, hurt: 0, dead: 0 })
    solver.solveFootIK(binding, holders, (x) => x > 0 ? 0.12 : 0)
    solver.solveLookAt(binding, holders, target, 1)
    root.updateMatrixWorld(true)
  }
  for (let i = 0; i < 300; i++) frame(i)
  for (let sample = 0; sample < 9; sample++) {
    const start = performance.now()
    for (let i = 0; i < 600; i++) frame(i)
    samples.push((performance.now() - start) / 600)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: +samples[4].toFixed(4), maxBatchMs: +samples.at(-1).toFixed(4) }
}
const old = measure(before), updated = measure(current)
console.log(JSON.stringify({ scenario: 'one knight, walking FK + stepped-ground foot IK + look-at + render matrix update; Node CPU, no GPU', samples: '9 batches of 600 frames after 300 warmup frames', baseline: old, updated, medianReductionPercent: +((1 - updated.medianMs / old.medianMs) * 100).toFixed(1) }, null, 2))
