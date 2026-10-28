import { createEmptyScene, validateEnvironment, validateScene, type ThreeSceneDocument } from '../sceneDocument.ts'
import { validateWorld, type ThreeWorldDocument } from './worldDocument.ts'
import { sandboxLocation, frontierLocation, auroraGameplay } from './worldAdventure.ts'
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
  return validateWorld({ version: '2.0', name: 'Relevo sintético 4 km', ...base, regions: [], locations: [], routes: [],
    environment: validateEnvironment({ background: '#c6d8dd', exposure: 1.05, lightIntensity: 1.5, grid: false, wireframe: false, shadows: true, reflections: true, sky: 'day', sunElevation: 34, sunAzimuth: 140, fog: 0, bloom: 0, toneMapping: 'agx',
      player: { spawn: null, yaw: 0, speed: 8, jumpHeight: 1.1, mode: 'walk', allowFly: true, camera: 'first' }, motion: { wind: 0.4, grass: 'none', fauna: 'none' } }) })
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
    locations: [
      { id: 'lirio', name: 'Posto do Lírio', kind: 'camp', regionId: 'bosque', position: [-160, -384], footprint: 32, brief: 'Um abrigo inicial e uma viajante com rumores sobre o vale.', scene: sandboxLocation('camp') },
      { id: 'ruinas', name: 'Ruínas do Guardião', kind: 'ruin', regionId: 'bosque', position: [-40, -384], footprint: 24, brief: 'Um brilho entre pedras antigas. Lobos rondam o santuário.', scene: sandboxLocation('ruins') },
      { id: 'posto', name: 'Farol das Garças', kind: 'landmark', regionId: 'vale', position: [0, -256], footprint: 24, brief: 'Uma torre apagada, visível de longe.', scene: sandboxLocation('beacon') },
      { id: 'resina', name: 'Acampamento dos Resinadores', kind: 'camp', regionId: 'bosque', position: [-420, -600], footprint: 20, brief: 'Pinheiros marcados e um diário de viagem.', scene: frontierLocation('resin') },
      { id: 'pedreira', name: 'Pedreira Abandonada', kind: 'ruin', regionId: 'vale', position: [160, -620], footprint: 20, brief: 'Veios de cobre entre ruínas de uma antiga extração.', scene: frontierLocation('copper') },
      { id: 'jardim', name: 'Jardim Esquecido', kind: 'landmark', regionId: 'bosque', position: [-70, 80], footprint: 18, brief: 'Uma horta escondida perto de um poço.', scene: frontierLocation('garden') },
    ],
    routes: [{ id: 'estrada-ruinas', kind: 'road', from: 'lirio', to: 'ruinas', width: 5 }, { id: 'estrada-farol', kind: 'road', from: 'ruinas', to: 'posto', width: 5 }],
    environment: validateEnvironment({ premise: 'Postos abandonados, veios de cobre e uma luz entre as ruínas. Faça suas ferramentas, escolha um abrigo e siga as pistas no seu ritmo.', background: '#c6d8dd', exposure: 1.05, lightIntensity: 1.5, grid: false, wireframe: false, shadows: true, reflections: true, sky: 'day', sunElevation: 38, sunAzimuth: 150, fog: 0.00028, bloom: 0, toneMapping: 'agx',
      player: { spawn: null, yaw: 0, speed: 5.5, jumpHeight: 1.1, mode: 'walk', allowFly: false, camera: 'first', avatar: 'explorer', weapon: 'none', health: 100 },
      objective: { type: 'explore', title: 'Explore, experimente, construa', timeLimit: 0 }, gameplay: auroraGameplay(),
      dayCycle: { enabled: true, duration: 900, start: 9 },
      audio: { ambience: 'forest', music: 'adventure', volume: 0.7 }, motion: { wind: 0.5, grass: 'none', fauna: 'auto' } }) })
}

/** Upgrade only the bundled rescue preset, retaining authored nodes, transforms and stored progress IDs. */
export function upgradeAurora(world: ThreeWorldDocument): ThreeWorldDocument | null {
  if (world.seed !== 714023 || world.name !== 'Terras de Aurora' || world.environment.gameplay?.playStyle === 'sandbox' || world.environment.gameplay?.quests.map(q => q.id).join(',') !== 'ajudar,fabricar,ruinas,farol') return null
  const fresh = createClimateWorld(), next = structuredClone(world)
  next.environment = { ...next.environment, gameplay: auroraGameplay(), objective: fresh.environment.objective, player: { ...next.environment.player!, weapon: 'none' }, dayCycle: fresh.environment.dayCycle }
  for (const location of next.locations) if (location.scene) {
    const kind = location.id === 'lirio' ? 'camp' : location.id === 'ruinas' ? 'ruins' : location.id === 'posto' ? 'beacon' : null
    if (!kind) continue
    const defaults = sandboxLocation(kind)
    for (const node of location.scene.nodes) if (['mara', 'nucleo', 'acionador'].includes(node.id)) {
      const replacement = defaults.nodes.find(entry => entry.id === node.id)
      if (replacement) { node.interaction = replacement.interaction; if (node.id !== 'mara') node.name = replacement.name }
    }
  }
  for (const location of fresh.locations) if (!next.locations.some(old => old.id === location.id)) next.locations.push(location)
  return validateWorld(next)
}
