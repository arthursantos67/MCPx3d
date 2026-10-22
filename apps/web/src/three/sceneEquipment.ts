import * as THREE from 'three'
import type { RigBinding } from './sceneCharacterRig.ts'
import type { WeaponKind } from './sceneCombat.ts'
import type { Animator } from './sceneCharacterAnimator.ts'

export interface Equipment {
  kind: WeaponKind; object: THREE.Group; muzzle: THREE.Vector3; blade: THREE.Line3; radius: number
  segment: () => THREE.Line3; origin: () => THREE.Vector3; dispose: () => void
}

export function bindEmitter(parent: THREE.Object3D, offset = new THREE.Vector3()): Equipment {
  const object = new THREE.Group()
  object.name = 'Origem do disparo'; object.position.copy(offset); parent.add(object)
  return { kind: 'staff', object, muzzle: new THREE.Vector3(), blade: new THREE.Line3(), radius: 0,
    segment: () => new THREE.Line3(), origin: () => object.getWorldPosition(new THREE.Vector3()), dispose: () => object.removeFromParent() }
}

export function createEquipment(kind: WeaponKind): Equipment {
  const object = new THREE.Group(), geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = []
  object.name = `Equipamento: ${kind}`
  const metal = new THREE.MeshStandardMaterial({ color: '#b9c7d8', metalness: 0.8, roughness: 0.3 })
  const dark = new THREE.MeshStandardMaterial({ color: '#263442', metalness: 0.45, roughness: 0.6 })
  const glow = new THREE.MeshBasicMaterial({ color: kind === 'staff' ? '#c680ff' : '#58e7ff', toneMapped: false })
  materials.push(metal, dark, glow)
  const part = (name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
    const geometry = new THREE.BoxGeometry(...size), mesh = new THREE.Mesh(geometry, material)
    geometries.push(geometry); mesh.name = name; mesh.position.set(...position); mesh.castShadow = true; object.add(mesh)
    return mesh
  }
  const blade = new THREE.Line3(new THREE.Vector3(0, 0, 0.12), new THREE.Vector3(0, 0, kind === 'sword' ? 1.02 : 0.18))
  const muzzle = new THREE.Vector3(0, 0, 0.55)
  if (kind === 'sword') {
    part('Empunhadura', [0.05, 0.05, 0.18], [0, 0, 0], dark)
    part('Guarda', [0.26, 0.05, 0.05], [0, 0, 0.12], metal)
    part('Lâmina', [0.065, 0.018, 0.9], [0, 0, 0.57], metal)
  } else if (kind === 'blaster') {
    part('Corpo do blaster', [0.14, 0.17, 0.32], [0, 0.025, 0.12], dark)
    part('Cabo', [0.085, 0.19, 0.09], [0, -0.1, 0.02], metal)
    part('Cano', [0.07, 0.07, 0.25], [0, 0.04, 0.4], metal)
    part('Boca luminosa', [0.08, 0.08, 0.025], [0, 0.04, 0.535], glow)
    muzzle.set(0, 0.04, 0.56)
  } else if (kind === 'bow') {
    for (const sign of [-1, 1]) part('Arco', [0.045, 0.45, 0.05], [0, sign * 0.2, 0.05], dark).rotation.x = sign * -0.35
    part('Corda', [0.01, 0.88, 0.01], [0, 0, -0.025], metal)
    part('Flecha', [0.018, 0.018, 0.6], [0, 0, 0.25], metal)
  } else if (kind === 'staff') {
    part('Cajado', [0.06, 0.06, 1.15], [0, 0, 0.25], dark)
    part('Cristal', [0.14, 0.14, 0.2], [0, 0, 0.9], glow)
    muzzle.z = 1.03
  } else {
    part('Punho', [0.13, 0.13, 0.17], [0, 0, 0.06], dark)
    blade.start.z = 0; blade.end.z = 0.15
  }
  return { kind, object, muzzle, blade, radius: kind === 'none' ? 0.09 : 0.035,
    segment: () => new THREE.Line3(object.localToWorld(blade.start.clone()), object.localToWorld(blade.end.clone())),
    origin: () => object.localToWorld(muzzle.clone()),
    dispose: () => { object.removeFromParent(); geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()) } }
}

export function equipmentHand(binding: RigBinding, holders: Map<string, THREE.Object3D>): THREE.Object3D | undefined {
  return holders.get(binding.joints.find((joint) => joint.joint === 'j_elbowR')?.nodeId ?? '')
}

export function mountEquipment(equipment: Equipment, binding: RigBinding, holders: Map<string, THREE.Object3D>): boolean {
  const hand = equipmentHand(binding, holders)
  if (!hand) return false
  const forearm = binding.joints.find((joint) => joint.joint === 'j_elbowR')!
  const length = Math.max(0.15, Math.abs(forearm.basePosition[1]))
  if (equipment.object.parent !== hand) hand.add(equipment.object)
  equipment.object.position.set(0, -length, 0.025)
  equipment.object.rotation.set(Math.PI / 2, 0, 0)
  return true
}

export function aimEquipment(equipment: Equipment, target: THREE.Vector3): void {
  const object = equipment.object, origin = object.getWorldPosition(new THREE.Vector3())
  if (target.distanceToSquared(origin) < 1e-8) return
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(target, origin, new THREE.Vector3(0, 1, 0)))
  if (object.parent) rotation.premultiply(object.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
  object.quaternion.copy(rotation)
}

export function poseFirstPersonEquipment(equipment: Equipment, animator: Animator): void {
  const object = equipment.object, a = animator, sw = a.swing, ranged = !['none', 'sword'].includes(equipment.kind)
  const u = sw ? THREE.MathUtils.clamp((a.time - sw.a) / sw.s, 0, 1) : 0
  const envelope = sw ? Math.sin(Math.PI * Math.min(1, a.time / (sw.a + sw.s + sw.r))) : 0
  object.scale.setScalar(ranged ? 0.7 : 1)
  object.position.set(0.25, -0.26 + envelope * 0.08, ranged ? -0.65 : -0.48)
  object.rotation.set(0, Math.PI, 0)
  if (!sw || ranged) return
  const sweep = (u * 2 - 1) * 0.85 * envelope
  object.rotation.y += a.combo === 2 ? -sweep : sweep
  object.rotation.x = a.heavy ? (u * 2 - 1) * 1.1 * envelope : a.combo === 3 ? -0.2 * envelope : (u * 2 - 1) * 0.6 * envelope
  if (a.combo === 3 && !a.heavy) object.position.z -= Math.sin(Math.PI * u) * 0.28
  if (equipment.kind === 'none') {
    object.position.x = a.combo === 2 ? -0.18 : 0.18
    object.position.z = -0.45 - Math.sin(Math.PI * u) * 0.35
    object.rotation.set(0, Math.PI, 0)
  }
}
