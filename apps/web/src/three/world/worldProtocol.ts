import type { SurfaceTextureKind, TextureData } from '../sceneTextures.ts'
import type { ThreeWorldDocument } from './worldDocument.ts'
import type { MacroLayout, WaterMesh, WorldMacro } from './worldMacro.ts'
import type { CellVegetation } from './worldVegetation.ts'
import type { GroundWindow } from './worldGround.ts'
import type { AtlasLocationIntent } from './worldGeneration.ts'

/** Macro grids a worker keeps per world: relief for heights, biome and water for vegetation. */
export type MacroFields = Pick<WorldMacro, 'delta' | 'cell' | 'points' | 'origin' | 'biome' | 'water' | 'river' | 'ground' | 'clear' | 'pads'>

/** Messages between the main thread and world workers. Results carry only transferable typed arrays and numbers. */
export type WorldSeed = Pick<ThreeWorldDocument, 'seed' | 'terrain'>
export type WorldJob =
  | { type: 'tile'; world: WorldSeed; origin: [number, number]; level: number; ix: number; iz: number }
  | { type: 'errors'; world: WorldSeed; levels: number; blocks: { x: number; z: number; last: [boolean, boolean] }[] }
  | { type: 'texture'; kind: SurfaceTextureKind }
  /** Erosion, drainage and climate for a `climate` world (sequential, one worker). */
  | { type: 'macro'; world: WorldSeed; layout?: MacroLayout }
  /** Gives a worker the macro fields it needs for this world's heights and vegetation. */
  | { type: 'install'; world: WorldSeed; fields: MacroFields }
  /** Plants of the listed 128 m vegetation cells. */
  | { type: 'vegetation'; world: WorldSeed; origin: [number, number]; density: number; cells: [number, number][] }
  /** Computes the terrain of an atlas world and places its locations by their rules (AI world generation). */
  | { type: 'place'; world: ThreeWorldDocument; intents: AtlasLocationIntent[]; only?: string[] }
  /** The world map image (ground colours, water, relief shading, cleared ground). */
  | { type: 'map'; world: WorldSeed; size: number }
  /** Grass and ground field for the window around the player. */
  | { type: 'ground'; world: WorldSeed; center: [number, number] }
export interface WorldJobResults {
  tile: { level: number; ix: number; iz: number; heights: Float32Array; minY: number; maxY: number; ms: number }
  /** One `measureBlockErrors` result per requested block, in order. */
  errors: { blocks: Float32Array[]; ms: number }
  texture: TextureData & { ms: number }
  macro: { macro: WorldMacro; mesh: WaterMesh; ms: number }
  install: { ms: number }
  vegetation: { cells: { cx: number; cz: number; plants: CellVegetation }[]; ms: number }
  ground: GroundWindow & { ms: number }
  place: { world: ThreeWorldDocument; notes: string[]; ms: number }
  map: { pixels: Uint8ClampedArray; size: number; ms: number }
}
export type WorldRequest = WorldJob & { id: number }
export type WorldResponse = { id: number; ok: true; result: WorldJobResults[WorldJob['type']] } | { id: number; ok: false; error: string }
