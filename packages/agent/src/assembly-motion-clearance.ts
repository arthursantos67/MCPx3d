import { validateCadAssembly, type CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadBounds } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import type { CadProgramStep } from '../../domain/ts/src/cad-program.ts'
import type { AssemblyRepairStrategy } from './assembly-repair.ts'
import { add, axes, direction, dot, lineDistance, scale, subtract } from './cad-spatial.ts'

const origin = { x: 0, y: 0, z: 0 }

export const motionClearanceStrategy: AssemblyRepairStrategy = {
  assumption: 'Folga cilíndrica aberta no corpo fixo para o envelope do componente móvel durante o curso, conservando roscas, posições e movimentos; sólidos e todas as amostras novamente verificados.',
  propose: async (spec, _message, checkPart, assess, collision) => {
    if (!collision) return null
    for (const sourceIndex of [0, 1] as const) {
      const source = spec.components.find((item) => item.id === collision.components[sourceIndex])
      const host = spec.components.find((item) => item.id === collision.components[1 - sourceIndex])
      if (!source?.motion || !host || host.motion || host.steps.length >= 32 ||
          host.steps.some((step) => step.shape === 'thread') || !host.steps.some((step) => step.op === 'cut')) continue
      const motion = source.motion
      const axis = { ...origin, [motion.axis]: 1 }
      const hostBounds = collision.componentBoundsMm[1 - sourceIndex]
      for (const feature of source.steps) {
        if ((feature.op !== 'base' && feature.op !== 'union') || feature.pattern ||
            (feature.shape !== 'cylinder' && feature.shape !== 'cone') ||
            Math.abs(dot(direction(feature.rotation), axis)) < 1 - 1e-6 ||
            (motion.kind !== 'slider' && lineDistance(feature.position, origin, axis) > 1e-6)) continue
        const diameter = (feature.shape === 'cylinder' ? feature.diameter : Math.max(feature.bottomDiameter, feature.topDiameter)) + 0.4
        const low = motion.kind === 'rotary' ? 0 : Math.min(motion.minimum, motion.maximum) * (motion.factor ?? 1)
        const high = motion.kind === 'rotary' ? 0 : Math.max(motion.minimum, motion.maximum) * (motion.factor ?? 1)
        const height = feature.height + Math.abs(high - low) + 0.4
        if (diameter > 10_000 || height > 10_000) continue
        const worldCenter = add(add(source.position, feature.position), scale(axis, (low + high) / 2))
        const bounds: CadBounds = Object.fromEntries(axes.map((key) => {
          const half = key === motion.axis ? height / 2 : diameter / 2
          return [key, [worldCenter[key] - half, worldCenter[key] + half]]
        })) as unknown as CadBounds
        const intersection = (a: CadBounds, b: CadBounds) => axes.map((key) =>
          Math.max(0, Math.min(a[key][1], b[key][1]) - Math.max(a[key][0], b[key][0])))
        if (intersection(bounds, collision.overlapBoundsMm).some((length) => length <= 0)) continue
        const removalBound = intersection(bounds, hostBounds).reduce((volume, length) => volume * length, 1)
        if (removalBound <= 0 || removalBound > collision.componentVolumesMm3[1 - sourceIndex] * 0.15) continue
        let number = 1
        while (host.steps.some((step) => step.id === `assembly_motion_clearance_${number}`)) number++
        const tool: CadProgramStep = { id: `assembly_motion_clearance_${number}`, op: 'cut', shape: 'cylinder',
          diameter, height, rotation: feature.rotation, position: subtract(worldCenter, host.position) }
        const steps = [...host.steps, tool]
        const candidate: CadAssemblySpec = { ...spec, components: spec.components.map((item) => item === host ? { ...host, steps } : item) }
        try { validateCadAssembly(candidate) } catch { continue }
        if (await checkPart({ schemaVersion: '3.0', units: 'mm', partId: host.id, steps })) continue
        if (!await assess(candidate)) return candidate
      }
    }
    return null
  },
}
