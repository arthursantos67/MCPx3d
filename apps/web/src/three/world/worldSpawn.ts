import * as THREE from 'three'
import type { ThreeWorldDocument } from './worldDocument.ts'
import type { HeightSource } from './worldTerrain.ts'

/** Picks land after hydrology, avoiding both lake bottoms and slopes that immediately throw the player downhill. */
export async function findWorldSpawn(world: ThreeWorldDocument, source: HeightSource, dry: (x: number, z: number) => boolean): Promise<THREE.Vector3> {
  const sea = world.terrain.seaLevel ?? -Infinity, [low, high] = world.terrain.heightRange, ceiling = low + (high - low) * 0.5
  const first = world.locations.find(location => location.scene)
  if (first && dry(...first.position)) return new THREE.Vector3(first.position[0], source.heightAt(...first.position) + 0.05, first.position[1])
  let slice = performance.now(), best: THREE.Vector3 | null = null, bestSlope = Infinity
  for (let radius = 0; radius < Math.min(...world.terrain.size) / 2; radius += 24) for (let k = 0; k < (radius ? 24 : 1); k++) {
    const x = Math.cos(k * Math.PI / 12) * radius, z = Math.sin(k * Math.PI / 12) * radius, height = source.heightAt(x, z)
    if (height > sea + 3 && dry(x, z)) {
      const slope = Math.hypot(source.heightAt(x + 4, z) - source.heightAt(x - 4, z), source.heightAt(x, z + 4) - source.heightAt(x, z - 4)) / 8
      if (slope < bestSlope) { best = new THREE.Vector3(x, height + 0.05, z); bestSlope = slope }
      if (height < ceiling && slope < 0.35) return new THREE.Vector3(x, height + 0.05, z)
    }
    if (performance.now() - slice > 8) { await new Promise(resolve => setTimeout(resolve, 0)); slice = performance.now() }
  }
  return best ?? new THREE.Vector3(0, source.heightAt(0, 0) + 0.05, 0)
}
