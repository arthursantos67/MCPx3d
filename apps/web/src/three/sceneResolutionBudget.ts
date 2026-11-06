/** Slow, bounded resolution adjustments for automatic quality; scene data and explicit quality stay untouched. */
export function createResolutionBudget() {
  let scale = 1, samples: number[] = [], elapsed = 0, healthy = 0
  return {
    reset() { scale = 1; samples = []; elapsed = 0; healthy = 0 },
    sample(milliseconds: number): number | null {
      // Ignore suspension/loading gaps; never interpret a background tab as a slow GPU.
      if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 250) { samples = []; elapsed = 0; healthy = 0; return null }
      samples.push(milliseconds); elapsed += milliseconds
      if (elapsed < 2000 || samples.length < 16) return null
      const sorted = [...samples].sort((a,b)=>a-b), p75 = sorted[Math.floor((sorted.length-1)*0.75)]
      const window = elapsed; samples = []; elapsed = 0
      let next = scale
      if (p75 > 28) { next = Math.max(0.6, Math.min(scale-0.05, scale*Math.sqrt(22/p75))); healthy = 0 }
      else if (p75 < 18.5) { healthy += window; if (healthy >= 8000) { next = Math.min(1, scale+0.05); healthy = 0 } }
      else healthy = 0
      next = Math.round(next*100)/100
      if (Math.abs(next-scale) < 0.001) return null
      scale = next
      return scale
    },
  }
}
