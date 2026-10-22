import type { PrefabPart } from './scenePrefabs.ts'
import type { SlotMaterial } from './sceneSkinMesh.ts'

/**
 * What the skin of each character type replaces. `skin` parts become the signed-distance body and are hidden; `under` parts
 * also feed the body (inset) but stay visible as rigid armour; `wrap` parts (belts, bracers) squeeze the skin inside them.
 */
export interface SkinPlan {
  kind: 'humanoid' | 'quadruped' | 'arachnid' | 'dragon'
  skin: string[]; hidden: string[]; wrap: string[]; inset: Record<string, number>
  bindTweak: Record<string, [number, number, number]>; blend: Record<string, number>; defaultBlend: number; slotOverride: Record<string, SlotMaterial>
  /** Body index per part (0 = main; 1 = separate jaw). */
  bodyOf: (id: string) => number; bodies: number
  /** Parts used only by some LODs (fingers mitten for LOD2). */
  levels: Record<string, [number, number]>
  voxel: number; scale: number; weightBlend: number
  face: boolean; hair: boolean; fingers: boolean; tusks: boolean; cape: string | null; shell: { part: string; trim: string | null; long: boolean } | null
  avatar: string | null
}

const LR = (...names: string[]) => names.flatMap((name) => [`${name}L`, `${name}R`])
const legs = (...names: string[]) => names.flatMap((name) => ['FL', 'FR', 'BL', 'BR'].map((leg) => `${name}${leg}`))
const ANATOMY = ['pelvis', 'torso', 'neck', 'head', ...LR('thigh', 'shin', 'foot', 'sole', 'deltoid', 'upperArm', 'forearm', 'palm', 'fingers', 'thumb')]
const FACE = [...LR('eye', 'iris', 'pupil', 'brow', 'tusk'), 'mouth']
const HAIR = ['hair', 'hairBun', 'hairLong', 'hairTuft', 'hairTail', ...LR('braid'), 'spike0', 'spike1', 'spike2', 'topknot', 'topknotTie', 'beard', 'moustache']
const MITTEN = Object.fromEntries(LR('fingers', 'thumb').map((id) => [id, [2, 2] as [number, number]]))
const A_POSE: Record<string, [number, number, number]> = { j_shoulderL: [0, 0, 33], j_shoulderR: [0, 0, -33], j_hipL: [0, 0, 5], j_hipR: [0, 0, -5] }

function extent(parts: PrefabPart[], ids: Set<string>): number {
  const byId = new Map(parts.map((part) => [part.id, part]))
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const part of parts) {
    if (!ids.has(part.id)) continue
    let x = 0, y = 0, z = 0
    for (let p: PrefabPart | undefined = part; p; p = p.parentId ? byId.get(p.parentId) : undefined) { x += p.position[0]; y += p.position[1]; z += p.position[2] }
    const r = Math.max(...part.dimensions) / 2
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r); minZ = Math.min(minZ, z - r); maxZ = Math.max(maxZ, z + r); void x
  }
  return Math.max(maxY - Math.max(0, minY), maxZ - minZ)
}

/** Plan for a character type, or null when the type stays rigid (skeleton, golem, drone, robot avatar). */
export function skinPlan(request: { type: string; parts: PrefabPart[]; avatar?: string }): SkinPlan | null {
  const { parts } = request, present = new Set(parts.map((part) => part.id)), has = (ids: string[]) => ids.filter((id) => present.has(id))
  if (request.avatar === 'robot') return null
  const base = { wrap: [] as string[], inset: {} as Record<string, number>, bindTweak: {} as Record<string, [number, number, number]>, blend: {} as Record<string, number>, slotOverride: {} as Record<string, SlotMaterial>,
    bodyOf: () => 0, bodies: 1, levels: {} as Record<string, [number, number]>, face: false, hair: false, fingers: false, tusks: false, cape: null as string | null, shell: null as SkinPlan['shell'], avatar: request.avatar ?? null }
  const humanoid = (skin: string[], extra: Partial<SkinPlan> & { only?: boolean } = {}): SkinPlan => {
    const { only, ...rest } = extra, list = has(skin), hidden = only ? has(extra.hidden ?? []) : [...new Set([...list, ...has(extra.hidden ?? [])])]
    const scale = extent(parts, new Set(has(['head', 'torso', ...LR('sole', 'foot')]))) / 1.75
    return { ...base, kind: 'humanoid', skin: list, defaultBlend: 0.02, voxel: 0.024, weightBlend: 0.045, scale: Math.max(0.3, scale), bindTweak: A_POSE, levels: MITTEN, fingers: true, ...rest, hidden }
  }
  switch (request.type) {
    case 'villager':
      return humanoid([...ANATOMY, 'nose', ...LR('ear')], { hidden: [...FACE, ...HAIR, 'tunic', ...LR('cuff')], wrap: has(['belt']), face: true, hair: true, shell: present.has('tunic') ? { part: 'tunic', trim: null, long: false } : null })
    case 'knight': return humanoid(['pelvis', 'neck', 'head', 'torso', ...LR('thigh', 'shin', 'deltoid', 'upperArm', 'forearm', 'palm', 'fingers', 'thumb')], {
      only: true, hidden: ['pelvis', 'neck', 'head', 'cape', ...LR('thigh', 'deltoid', 'upperArm', 'palm', 'fingers', 'thumb')], inset: { torso: 0.014, ...Object.fromEntries(LR('shin', 'forearm').map((id) => [id, 0.01])) }, cape: present.has('cape') ? 'cape' : null })
    case 'wizard':
      return humanoid([...ANATOMY, 'nose', ...LR('ear')], { hidden: [...FACE, ...HAIR, 'robe', 'robeHem'], wrap: has(['sash']), face: true, hair: true, shell: { part: 'robe', trim: 'robeHem', long: true } })
    case 'astronaut': return humanoid(ANATOMY, { wrap: has([...LR('armBand', 'glove', 'bootCuff'), 'belt']) })
    case 'goblin':
      return humanoid([...ANATOMY, 'nose', ...LR('ear')], { hidden: [...FACE, ...HAIR, 'loincloth'], wrap: has(LR('bracer')), face: true, hair: true, tusks: true, shell: present.has('loincloth') ? { part: 'loincloth', trim: null, long: false } : null })
    case 'orc':
      return humanoid([...ANATOMY, 'nose', ...LR('ear'), 'browRidge', 'chin'], { hidden: [...FACE, ...HAIR], wrap: has([...LR('bracer'), 'belt']), face: true, hair: true, tusks: true })
    case 'wolf': case 'deer': {
      const skin = has(['body', 'belly', 'ruff', 'rump', 'neck', 'throat', 'skull', 'snout', 'nose', ...LR('ear'), 'tail', 'tailTip', ...legs('upper', 'knob', 'lower', 'paw', 'hoof')])
      const jaw = has(['jaw']), scale = extent(parts, new Set(skin)) / 1.75
      return { ...base, kind: 'quadruped', skin: [...skin, ...jaw], hidden: [...skin, ...jaw], bodyOf: (id) => id === 'jaw' ? 1 : 0, bodies: jaw.length ? 2 : 1, defaultBlend: 0.045, blend: { belly: 0.06, ruff: 0.06, tailTip: 0.03, nose: 0.015, earL: 0.02, earR: 0.02 },
        voxel: 0.022, weightBlend: 0.07, scale: Math.max(0.3, scale) }
    }
    case 'spider': {
      const skin = has(['cephalothorax', 'carapace', 'pedicel', 'abdomen', 'spinneret', ...LR('chelicera', 'palp'), ...Array.from({ length: 8 }, (_, i) => ['coxa', 'femur', 'kneeBall', 'tibia', 'band'].map((name) => `${name}${i}`)).flat()])
      return { ...base, kind: 'arachnid', skin, hidden: skin, defaultBlend: 0.025, blend: { carapace: 0.02, abdomen: 0.05, pedicel: 0.05 }, voxel: 0.017, weightBlend: 0.04, scale: Math.max(0.3, extent(parts, new Set(skin)) / 1.75) }
    }
    case 'dragon': {
      const skin = has(['body', 'belly', 'neck', 'neckBelly', 'skull', 'tail', 'tail2', ...LR('wingRoot', 'humerus', 'radius'), ...legs('upper', 'lower', 'foot')])
      const jaw = has(['jaw'])
      return { ...base, kind: 'dragon', skin: [...skin, ...jaw], hidden: [...skin, ...jaw], bodyOf: (id) => id === 'jaw' ? 1 : 0, bodies: jaw.length ? 2 : 1, defaultBlend: 0.05, blend: { belly: 0.08, neckBelly: 0.05 },
        voxel: 0.024, weightBlend: 0.09, scale: Math.max(0.3, extent(parts, new Set(skin)) / 1.75) }
    }
  }
  return null
}
