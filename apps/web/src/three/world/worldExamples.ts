import { createEmptyScene, validateEnvironment, validateScene, type ThreeSceneDocument } from '../sceneDocument.ts'
import { DEFAULT_WORLD_BUDGETS, validateWorld, type ThreeWorldDocument } from './worldDocument.ts'
import { fitLocationScene } from './worldGeneration.ts'
import { createArchitectureScene } from '../sceneShowcase.ts'
import { createHeightSource } from './worldTerrain.ts'

/** First land point on a spiral from (x, z), at least `above` metres over the sea and at most `below` metres high. */
export function landSpawn(world: Pick<ThreeWorldDocument, 'seed' | 'terrain'>, x = 0, z = 0, above = 4, below = Infinity): [number, number, number] {
  const source = createHeightSource(world), sea = world.terrain.seaLevel ?? -Infinity
  for (let radius = 0; radius < Math.min(...world.terrain.size) / 2; radius += 16) for (let k = 0; k < (radius ? 24 : 1); k++) {
    const px = x + Math.cos(k * Math.PI / 12) * radius, pz = z + Math.sin(k * Math.PI / 12) * radius, height = source.heightAt(px, pz)
    if (height > sea + above && height < below) return [Math.round(px * 100) / 100, Math.round((height + 0.05) * 100) / 100, Math.round(pz * 100) / 100]
  }
  return [x, source.heightAt(x, z) + 0.05, z]
}

/** Spawn yaw in degrees facing downhill, so the first steps never walk into a slope too steep to climb. */
export function downhillYaw(world: Pick<ThreeWorldDocument, 'seed' | 'terrain'>, x: number, z: number): number {
  const source = createHeightSource(world), dx = source.heightAt(x - 4, z) - source.heightAt(x + 4, z), dz = source.heightAt(x, z - 4) - source.heightAt(x, z + 4)
  return Math.round(Math.atan2(-dx, -dz) * 180 / Math.PI)
}

/** 4×4 km synthetic relief (mountains, plateaus with cliffs, coast) used to validate streaming before biomes. */
export function createSyntheticWorld(): ThreeWorldDocument {
  const base = { seed: 20261023, terrain: { kind: 'synthetic' as const, size: [4096, 4096] as [number, number], heightRange: [-60, 700] as [number, number], seaLevel: 0, ruggedness: 0.85, erosion: 0, climate: { temperature: 16, humidity: 0.55, wind: 0 } } }
  const spawn = landSpawn(base, 0, 0, 4, 260)
  return validateWorld({ version: '2.0', name: 'Relevo sintético 4 km', ...base, regions: [], locations: [], routes: [],
    environment: validateEnvironment({ background: '#c6d8dd', exposure: 1.05, lightIntensity: 1.5, grid: false, wireframe: false, shadows: true, reflections: true, sky: 'day', sunElevation: 34, sunAzimuth: 140, fog: 0, bloom: 0, toneMapping: 'agx',
      player: { spawn, yaw: downhillYaw(base, spawn[0], spawn[2]), speed: 8, jumpHeight: 1.1, mode: 'walk', allowFly: true, camera: 'first' }, motion: { wind: 0.4, grass: 'none', fauna: 'none' } }) })
}

/** The 1.x scene edited and played on top of a world: its environment and player, no nodes yet. */
export function worldBaseScene(world: ThreeWorldDocument): ThreeSceneDocument {
  return validateScene({ ...createEmptyScene(), name: world.name, environment: world.environment })
}

/**
 * 4×4 km climate world: eroded relief, rivers down to lakes and the sea, biomes from temperature and humidity and
 * four named regions with their own ambience. The spawn is chosen after the macro pass (dry, low ground).
 */
export function createClimateWorld(): ThreeWorldDocument {
  return validateWorld({ version: '2.0', name: 'Terras de Aurora', seed: 714023,
    terrain: { kind: 'climate', size: [4096, 4096], heightRange: [-60, 900], seaLevel: 0, ruggedness: 0.75, erosion: 0.6, climate: { temperature: 18, humidity: 0.6, wind: 0 } },
    regions: [
      { id: 'costa', name: 'Costa das Garças', site: [0, -1500], biome: 'auto', danger: 0, ambience: 'auto', music: 'calm' },
      { id: 'bosque', name: 'Bosque do Lírio', site: [-700, -100], biome: 'auto', danger: 1, ambience: 'auto', music: 'auto' },
      { id: 'vale', name: 'Vale do Rio Claro', site: [800, -300], biome: 'auto', danger: 0, ambience: 'auto', music: 'adventure' },
      { id: 'picos', name: 'Picos de Geada', site: [300, 1300], weight: 1.3, biome: 'auto', danger: 3, ambience: 'auto', music: 'mystery', weather: 'snow' },
    ],
    // One detailed location (an existing 1.x scene) and one planned: both get level, cleared ground, joined by a road.
    locations: [
      { id: 'lirio', name: 'Casa do Lírio', kind: 'landmark', regionId: 'bosque', position: [-723, -123], footprint: 45, brief: 'Casa de dois pavimentos de um lenhador entre as árvores.',
        scene: fitLocationScene(createArchitectureScene(), DEFAULT_WORLD_BUDGETS, 45) },
      { id: 'posto', name: 'Posto da Costa', kind: 'camp', regionId: 'costa', position: [32, -1300], footprint: 30, brief: 'Acampamento de pescadores no alto da costa.', scene: null },
    ],
    routes: [{ id: 'estrada-costa', kind: 'road', from: 'lirio', to: 'posto', width: 5 }],
    environment: validateEnvironment({ background: '#c6d8dd', exposure: 1.05, lightIntensity: 1.5, grid: false, wireframe: false, shadows: true, reflections: true, sky: 'day', sunElevation: 38, sunAzimuth: 150, fog: 0.00028, bloom: 0, toneMapping: 'agx',
      player: { spawn: null, yaw: 0, speed: 8, jumpHeight: 1.1, mode: 'walk', allowFly: true, camera: 'first' }, motion: { wind: 0.5, grass: 'none', fauna: 'none' } }) })
}
