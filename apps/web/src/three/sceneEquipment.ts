import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { RigBinding } from './sceneCharacterRig.ts'
import type { WeaponKind } from './sceneCombat.ts'
import type { Animator } from './sceneCharacterAnimator.ts'
import type { CharacterSkin } from './sceneRuntimeTypes.ts'

/**
 * Hand-held weapon. The model is authored in its aim frame: origin at the centre of the handle, +Z towards the tip or the line of fire.
 * `grip` turns that frame into a fist socket frame (+Z along the hole the fingers wrap, −Y along the fingers).
 */
export interface Equipment {
  kind: WeaponKind; object: THREE.Group; muzzle: THREE.Vector3; blade: THREE.Line3; radius: number; grip: THREE.Quaternion; hand: 'L' | 'R'
  segment: () => THREE.Line3; origin: () => THREE.Vector3; dispose: () => void
}

export function bindEmitter(parent: THREE.Object3D, offset = new THREE.Vector3()): Equipment {
  const object = new THREE.Group()
  object.name = 'Origem do disparo'; object.position.copy(offset); parent.add(object)
  return { kind: 'staff', object, muzzle: new THREE.Vector3(), blade: new THREE.Line3(), radius: 0, grip: new THREE.Quaternion(), hand: 'R',
    segment: () => new THREE.Line3(), origin: () => object.getWorldPosition(new THREE.Vector3()), dispose: () => object.removeFromParent() }
}

const basis = (x: [number, number, number], y: [number, number, number], z: [number, number, number]) =>
  new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)))
/** Pistol grips and bow risers pass through the fist; the barrel or arrow then points along the fingers. */
const PISTOL = basis([-1, 0, 0], [0, 0, -1], [0, -1, 0]), RISER = basis([1, 0, 0], [0, 0, 1], [0, -1, 0])
const lathe = (profile: [number, number][], segments = 20) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments)
/** Lathe profiles run along +Y; equipment runs along +Z. */
const alongZ = (geometry: THREE.BufferGeometry) => geometry.rotateX(Math.PI / 2)

export function createEquipment(kind: WeaponKind): Equipment {
  const object = new THREE.Group(), geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = []
  object.name = `Equipamento: ${kind}`
  const material = <T extends THREE.Material>(value: T) => { materials.push(value); return value }
  const steel = material(new THREE.MeshPhysicalMaterial({ color: '#c9d3dd', metalness: 0.92, roughness: 0.22, clearcoat: 0.4, clearcoatRoughness: 0.3 }))
  const gold = material(new THREE.MeshPhysicalMaterial({ color: '#c9a04a', metalness: 0.9, roughness: 0.32 }))
  const leather = material(new THREE.MeshStandardMaterial({ color: '#4a2f1d', metalness: 0, roughness: 0.75 }))
  const wood = material(new THREE.MeshStandardMaterial({ color: '#6b4528', metalness: 0, roughness: 0.68 }))
  const shell = material(new THREE.MeshPhysicalMaterial({ color: '#2c3a48', metalness: 0.55, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25 }))
  const trim = material(new THREE.MeshPhysicalMaterial({ color: '#e7ecf1', metalness: 0.2, roughness: 0.3, clearcoat: 0.8 }))
  const glow = material(new THREE.MeshBasicMaterial({ color: kind === 'staff' ? '#cf8bff' : '#62ecff', toneMapped: false }))
  const add = (name: string, geometry: THREE.BufferGeometry, mat: THREE.Material, position: [number, number, number] = [0, 0, 0], rotation: [number, number, number] = [0, 0, 0]) => {
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.name = name; mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.castShadow = true; mesh.receiveShadow = true
    object.add(mesh)
    return mesh
  }
  let grip = new THREE.Quaternion(), hand: 'L' | 'R' = 'R'
  const blade = new THREE.Line3(new THREE.Vector3(0, 0, 0.11), new THREE.Vector3(0, 0, 0.18)), muzzle = new THREE.Vector3(0, 0, 0.55)
  if (kind === 'sword') {
    add('Empunhadura', alongZ(lathe([[0, -0.085], [0.017, -0.083], [0.0185, -0.05], [0.017, -0.02], [0.0185, 0.015], [0.017, 0.05], [0.0165, 0.08], [0, 0.082]], 16)), leather)
    for (let i = 0; i < 5; i++) add('Cordão do cabo', new THREE.TorusGeometry(0.0182, 0.0028, 6, 18), leather, [0, 0, -0.065 + i * 0.032])
    add('Pomo', alongZ(lathe([[0, -0.03], [0.018, -0.026], [0.029, -0.012], [0.03, 0.004], [0.02, 0.022], [0.012, 0.03], [0, 0.031]], 18)), gold, [0, 0, -0.112])
    const guard = new THREE.Shape()
    guard.moveTo(-0.13, 0.022); guard.quadraticCurveTo(-0.07, -0.004, 0, -0.012); guard.quadraticCurveTo(0.07, -0.004, 0.13, 0.022)
    guard.quadraticCurveTo(0.142, 0.03, 0.134, 0.04); guard.quadraticCurveTo(0.07, 0.016, 0, 0.018); guard.quadraticCurveTo(-0.07, 0.016, -0.134, 0.04)
    guard.quadraticCurveTo(-0.142, 0.03, -0.13, 0.022)
    add('Guarda', new THREE.ExtrudeGeometry(guard, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3, curveSegments: 10 }).translate(0, 0, -0.013).rotateX(-Math.PI / 2), gold, [0, 0, 0.088])
    const length = 0.84, outline = new THREE.Shape()
    outline.moveTo(-0.026, 0); outline.lineTo(-0.024, length * 0.72); outline.quadraticCurveTo(-0.02, length * 0.9, 0, length); outline.quadraticCurveTo(0.02, length * 0.9, 0.024, length * 0.72); outline.lineTo(0.026, 0)
    outline.lineTo(-0.026, 0)
    add('Lâmina', new THREE.ExtrudeGeometry(outline, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.009, bevelSegments: 2, curveSegments: 12 }).translate(0, 0, -0.001).rotateX(Math.PI / 2), steel, [0, 0, 0.11])
    const fuller = new THREE.Shape()
    fuller.moveTo(-0.0045, 0); fuller.lineTo(-0.0035, length * 0.58); fuller.quadraticCurveTo(0, length * 0.63, 0.0035, length * 0.58); fuller.lineTo(0.0045, 0); fuller.lineTo(-0.0045, 0)
    const groove = material(new THREE.MeshPhysicalMaterial({ color: '#8b97a3', metalness: 0.95, roughness: 0.35 }))
    for (const side of [-1, 1]) add('Sulco da lâmina', new THREE.ShapeGeometry(fuller, 6).rotateX(Math.PI / 2).rotateZ(side > 0 ? 0 : Math.PI), groove, [0, side * 0.0058, 0.13])
    blade.set(new THREE.Vector3(0, 0, 0.12), new THREE.Vector3(0, 0, 0.11 + length))
  } else if (kind === 'axe') {
    add('Cabo de madeira', alongZ(new THREE.CylinderGeometry(0.022, 0.027, 0.7, 10)), wood, [0, 0, 0.2])
    add('Cabeça de pedra', new THREE.DodecahedronGeometry(0.12, 0).scale(1.4, 0.4, 0.85), steel, [0.07, 0, 0.5])
    for (let i = 0; i < 4; i++) add('Amarra de fibra', new THREE.TorusGeometry(0.035, 0.006, 5, 12), leather, [0, 0, 0.43 + i * 0.025])
    blade.set(new THREE.Vector3(0, 0, 0.34), new THREE.Vector3(0.18, 0, 0.56))
  } else if (kind === 'blaster') {
    grip = PISTOL
    add('Cabo', new RoundedBoxGeometry(0.046, 0.15, 0.06, 3, 0.016), shell, [0, -0.02, -0.035], [-0.28, 0, 0])
    add('Gatilho', new THREE.TorusGeometry(0.022, 0.004, 6, 16, Math.PI), trim, [0, 0.025, 0.012], [0, Math.PI / 2, 0])
    add('Corpo do blaster', new RoundedBoxGeometry(0.075, 0.085, 0.24, 4, 0.024), shell, [0, 0.07, 0.04])
    add('Placa lateral', new RoundedBoxGeometry(0.08, 0.04, 0.16, 3, 0.012), trim, [0, 0.085, 0.03])
    add('Cano', alongZ(lathe([[0.022, 0], [0.024, 0.04], [0.02, 0.06], [0.02, 0.17], [0.026, 0.19], [0.026, 0.215], [0.017, 0.22], [0, 0.22]], 20)), steel, [0, 0.07, 0.15])
    for (let i = 0; i < 3; i++) add('Anel de energia', new THREE.TorusGeometry(0.025, 0.0045, 8, 22), glow, [0, 0.07, 0.235 + i * 0.035])
    add('Célula de energia', new THREE.CapsuleGeometry(0.014, 0.08, 4, 10).rotateX(Math.PI / 2), glow, [0, 0.122, 0.02])
    add('Mira', new RoundedBoxGeometry(0.018, 0.022, 0.05, 2, 0.006), shell, [0, 0.122, 0.12])
    muzzle.set(0, 0.07, 0.375)
    blade.set(new THREE.Vector3(0, 0.07, 0), new THREE.Vector3(0, 0.07, 0.35))
  } else if (kind === 'bow') {
    grip = RISER; hand = 'L'
    const limb = new THREE.CatmullRomCurve3([[-0.03, 0.62], [0.02, 0.5], [0.075, 0.28], [0.06, 0.1], [0.035, 0]].map(([z, y]) => new THREE.Vector3(0, y, z)))
    for (const sign of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3(limb.points.map((point) => point.clone().setY(point.y * sign)))
      add('Membro do arco', new THREE.TubeGeometry(curve, 24, 0.011, 8), wood)
      add('Ponteira', new THREE.SphereGeometry(0.013, 10, 8), gold, [0, 0.62 * sign, -0.03])
    }
    add('Empunhadura do arco', new THREE.CylinderGeometry(0.019, 0.019, 0.12, 14), leather, [0, 0, 0.035])
    add('Corda', new THREE.CylinderGeometry(0.0018, 0.0018, 1.24, 5), trim, [0, 0, -0.03])
    add('Haste da flecha', new THREE.CylinderGeometry(0.0045, 0.0045, 0.66, 8).rotateX(Math.PI / 2), wood, [0, 0.01, 0.3])
    add('Ponta da flecha', new THREE.ConeGeometry(0.012, 0.045, 10).rotateX(Math.PI / 2), steel, [0, 0.01, 0.65])
    const vane = new THREE.Shape(); vane.moveTo(0, 0); vane.lineTo(0.022, 0.02); vane.lineTo(0.022, 0.07); vane.lineTo(0, 0.06); vane.lineTo(0, 0)
    for (let i = 0; i < 3; i++) add('Pena', new THREE.ShapeGeometry(vane).rotateX(Math.PI / 2).rotateZ(i * Math.PI * 2 / 3), material(new THREE.MeshStandardMaterial({ color: '#b8402f', side: THREE.DoubleSide, roughness: 0.8 })), [0, 0.01, -0.02])
    muzzle.set(0, 0.01, 0.68)
    blade.set(new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(0, 0, 0.2))
  } else if (kind === 'staff') {
    const path = new THREE.CatmullRomCurve3([[0, 0, -0.62], [0.008, 0.004, -0.3], [-0.006, -0.004, 0.1], [0.006, 0.006, 0.5], [0, 0, 0.88]].map((p) => new THREE.Vector3(...p)))
    add('Cajado', new THREE.TubeGeometry(path, 40, 0.02, 10), wood)
    for (const [z, r] of [[-0.25, 0.026], [0.32, 0.025], [0.7, 0.027]] as const) add('Nó da madeira', new THREE.SphereGeometry(r, 12, 10).scale(1, 1, 1.3), wood, [0, 0, z])
    add('Ponteira do cajado', new THREE.ConeGeometry(0.022, 0.06, 10).rotateX(-Math.PI / 2), gold, [0, 0, -0.65])
    add('Anel do cajado', new THREE.TorusGeometry(0.024, 0.006, 8, 20), gold, [0, 0, 0.86])
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3, claw = new THREE.CatmullRomCurve3([[0.012, 0.86], [0.05, 0.94], [0.058, 1.02], [0.03, 1.1]].map(([r, z]) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z)))
      add('Garra do cajado', new THREE.TubeGeometry(claw, 12, 0.0075, 6), wood)
    }
    add('Gema mágica', new THREE.OctahedronGeometry(0.045, 0).scale(1, 1, 1.5), glow, [0, 0, 1.03])
    add('Halo da gema', new THREE.SphereGeometry(0.06, 16, 12), material(new THREE.MeshBasicMaterial({ color: '#cf8bff', transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false })), [0, 0, 1.03])
    muzzle.z = 1.08
    blade.set(new THREE.Vector3(0, 0, 0.6), new THREE.Vector3(0, 0, 1.1))
  } else {
    const fist = new THREE.Object3D(); fist.name = 'Punho'; object.add(fist)
    blade.start.z = 0; blade.end.z = 0.12
  }
  return { kind, object, muzzle, blade, grip, hand, radius: kind === 'none' ? 0.09 : 0.035,
    segment: () => new THREE.Line3(object.localToWorld(blade.start.clone()), object.localToWorld(blade.end.clone())),
    origin: () => object.localToWorld(muzzle.clone()),
    dispose: () => { object.removeFromParent(); geometries.forEach((geometry) => geometry.dispose()); materials.forEach((value) => value.dispose()) } }
}

export function equipmentHand(binding: RigBinding, holders: Map<string, THREE.Object3D>, side: 'L' | 'R' = 'R'): THREE.Object3D | undefined {
  return holders.get(binding.joints.find((joint) => joint.joint === `j_elbow${side}`)?.nodeId ?? '')
}

/** Seats the equipment in the closed fist of a skinned hand; rigid bodies fall back to a point below the forearm. */
export function mountEquipment(equipment: Equipment, binding: RigBinding, holders: Map<string, THREE.Object3D>, skin?: CharacterSkin | null): boolean {
  const socket = skin?.grips[equipment.hand] ?? (equipment.hand === 'L' ? skin?.grips.R : undefined)
  if (socket) {
    if (equipment.object.parent !== socket) socket.add(equipment.object)
    equipment.object.position.set(0, 0, 0)
    equipment.object.quaternion.copy(equipment.grip)
    return true
  }
  const hand = equipmentHand(binding, holders)
  if (!hand) return false
  const forearm = binding.joints.find((joint) => joint.joint === 'j_elbowR')!
  const length = Math.max(0.15, Math.abs(forearm.basePosition[1]))
  if (equipment.object.parent !== hand) hand.add(equipment.object)
  equipment.object.position.set(0, -length - 0.06, 0.03)
  equipment.object.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)).multiply(equipment.grip)
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
  const object = equipment.object, a = animator, sw = a.swing, ranged = !['none', 'sword', 'axe'].includes(equipment.kind)
  const u = sw ? THREE.MathUtils.clamp((a.time - sw.a) / sw.s, 0, 1) : 0
  const envelope = sw ? Math.sin(Math.PI * Math.min(1, a.time / (sw.a + sw.s + sw.r))) : 0
  object.scale.setScalar(1)
  object.position.set(equipment.kind === 'bow' ? -0.2 : 0.25, -0.26 + envelope * 0.08, ranged ? -0.55 : -0.48)
  object.rotation.set(0, Math.PI, 0)
  if (!sw && !ranged) { object.position.set(0.34, -0.46, -0.36); object.rotation.set(0.85, Math.PI, -0.15) }
  if (equipment.kind === 'staff') { object.position.set(0.3, -0.62, -0.62); object.rotation.set(-0.35, Math.PI, 0) }
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
