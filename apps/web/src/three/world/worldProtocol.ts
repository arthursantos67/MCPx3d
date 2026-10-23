import type { SurfaceTextureKind, TextureData } from '../sceneTextures.ts'
import type { ThreeWorldDocument } from './worldDocument.ts'

/** Messages between the main thread and world workers. Results carry only transferable typed arrays and numbers. */
export type WorldSeed = Pick<ThreeWorldDocument, 'seed' | 'terrain'>
export type WorldJob =
  | { type: 'tile'; world: WorldSeed; origin: [number, number]; level: number; ix: number; iz: number }
  | { type: 'errors'; world: WorldSeed; levels: number; blocks: { x: number; z: number; last: [boolean, boolean] }[] }
  | { type: 'texture'; kind: SurfaceTextureKind }
export interface WorldJobResults {
  tile: { level: number; ix: number; iz: number; heights: Float32Array; minY: number; maxY: number; ms: number }
  /** One `measureBlockErrors` result per requested block, in order. */
  errors: { blocks: Float32Array[]; ms: number }
  texture: TextureData & { ms: number }
}
export type WorldRequest = WorldJob & { id: number }
export type WorldResponse = { id: number; ok: true; result: WorldJobResults[WorldJob['type']] } | { id: number; ok: false; error: string }
