import type { QualityLevel } from '../sceneRuntimeTypes.ts'

/** Streaming and atmospheric visibility share a budget, so the horizon hides rather than exposes fallback geometry. */
export function worldVisibility(quality:QualityLevel) {
  const distance=quality==='low'?650:quality==='high'?1500:1000
  return{distance,fogDensity:2.15/distance}
}
/** Only trees retain lightweight 3D silhouettes beyond the mid-range vegetation band. */
export const distantVegetation=new Set(['tree','pine','palm'])
