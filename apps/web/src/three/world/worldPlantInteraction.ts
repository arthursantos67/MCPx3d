import * as THREE from 'three'
import { naturalResource, type SceneResource } from '../sceneGameplay.ts'
import { INSTANCE_STRIDE, VEGETATION_CELL, type CellVegetation, type Species } from './worldVegetation.ts'

export interface PlantTarget { id: string; name: string; resource: SceneResource; position: THREE.Vector3; distance: number }
export interface PlantObstacle { x: number; y: number; z: number; radius: number; height: number }
export const plantId = (species: string, x: number, z: number) => `plant:${species}:${x.toFixed(3)}:${z.toFixed(3)}`
const names: Record<Species, string> = { tree: 'Árvore', pine: 'Pinheiro', palm: 'Palmeira', bush: 'Arbusto', rock: 'Rocha', log: 'Tronco caído', cactus: 'Cacto', mushroom: 'Cogumelo' }
export function filterPlants(plants: CellVegetation, removed: Set<string>): CellVegetation {
  if (!removed.size) return plants
  return Object.fromEntries(Object.entries(plants).map(([species, list]) => {
    const values: number[] = []
    for (let i = 0; i < list!.length; i += INSTANCE_STRIDE) if (!removed.has(plantId(species, list![i], list![i + 2]))) for (let j = 0; j < INSTANCE_STRIDE; j++) values.push(list![i + j])
    return [species, new Float32Array(values)]
  }))
}
export function createPlantInteraction(origin: [number, number]) {
  const cells = new Map<string, CellVegetation>(), removed = new Set<string>(), sphere = new THREE.Sphere(), hit = new THREE.Vector3()
  function* nearby(x: number, z: number, radius: number) {
    const cx0 = Math.floor((x - radius - origin[0]) / VEGETATION_CELL), cz0 = Math.floor((z - radius - origin[1]) / VEGETATION_CELL)
    const cx1 = Math.floor((x + radius - origin[0]) / VEGETATION_CELL), cz1 = Math.floor((z + radius - origin[1]) / VEGETATION_CELL)
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) for (const [species, list] of Object.entries(cells.get(`${cx}:${cz}`) ?? {}) as [Species, Float32Array][]) {
      for (let i = 0; i < list.length; i += INSTANCE_STRIDE) {
        const id = plantId(species, list[i], list[i + 2])
        if (!removed.has(id) && Math.hypot(list[i] - x, list[i + 2] - z) <= radius) yield { species, id, x: list[i], y: list[i + 1], z: list[i + 2], scale: list[i + 4] }
      }
    }
  }
  return {
    removed,
    setCell(cx: number, cz: number, plants: CellVegetation | null) { if (plants) cells.set(`${cx}:${cz}`, plants); else cells.delete(`${cx}:${cz}`) },
    raycast(ray: THREE.Ray, range = 3.5): PlantTarget | null {
      let best: PlantTarget | null = null
      for (const plant of nearby(ray.origin.x, ray.origin.z, range + 1.5)) {
        const resource = naturalResource(plant.species)
        if (!resource) continue
        const tree = ['tree', 'pine', 'palm'].includes(plant.species)
        sphere.center.set(plant.x, plant.y + (tree ? 1.2 : plant.species === 'rock' ? 0.5 : 0.35) * plant.scale, plant.z)
        sphere.radius = (tree ? 0.7 : plant.species === 'rock' || plant.species === 'log' ? 0.85 : 0.5) * plant.scale
        if (!ray.intersectSphere(sphere, hit)) continue
        const distance = hit.distanceTo(ray.origin)
        if (distance <= range && (!best || distance < best.distance)) best = { id: plant.id, name: names[plant.species], resource, position: sphere.center.clone(), distance }
      }
      return best
    },
    obstacles(x: number, z: number): PlantObstacle[] {
      const result: PlantObstacle[] = []
      for (const plant of nearby(x, z, 5)) {
        const tree = ['tree', 'pine', 'palm'].includes(plant.species)
        if (!tree && plant.species !== 'rock' && plant.species !== 'log') continue
        result.push({ x: plant.x, y: plant.y, z: plant.z, radius: (tree ? 0.26 : 0.6) * plant.scale, height: (tree ? 5 : plant.species === 'log' ? 0.5 : 0.8) * plant.scale })
      }
      return result
    },
  }
}
