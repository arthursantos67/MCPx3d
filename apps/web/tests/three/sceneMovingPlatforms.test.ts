import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { carry, findSupport } from '../../src/three/sceneMovingPlatforms.ts'
import { boxFromMatrix } from '../../src/three/scenePlayer.ts'

const matrix = (x: number, y: number, z: number, yaw = 0, size = new THREE.Vector3(4, 0.4, 4)) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), size)

test('a translating platform carries the player standing on it', () => {
  const before = matrix(0, 1, 0), after = matrix(0.5, 1.3, -0.2), feet = new THREE.Vector3(1, 1.2, 1)
  assert.equal(findSupport(feet, [{ id: 'lift', box: boxFromMatrix(before) }]), 'lift')
  const { position, yaw } = carry(before, after, feet)
  assert.ok(position.distanceTo(new THREE.Vector3(1.5, 1.5, 0.8)) < 1e-6, position.toArray().join())
  assert.ok(Math.abs(yaw) < 1e-9)
})

test('a rotating platform turns the player around its centre and reports the yaw delta', () => {
  const before = matrix(2, 0, 0, 0.2), after = matrix(2, 0, 0, 0.2 + Math.PI / 2), feet = new THREE.Vector3(3, 0.2, 0)
  assert.equal(findSupport(feet, [{ id: 'carousel', box: boxFromMatrix(before) }]), 'carousel')
  const { position, yaw } = carry(before, after, feet)
  assert.ok(position.distanceTo(new THREE.Vector3(2, 0.2, -1)) < 1e-6, position.toArray().join())
  assert.ok(Math.abs(yaw - Math.PI / 2) < 1e-6)
})

test('no support when jumping above, standing beside, under or on a wall-like box; the nearest top wins', () => {
  const lift = { id: 'lift', box: boxFromMatrix(matrix(0, 1, 0)) }
  assert.equal(findSupport(new THREE.Vector3(0, 1.6, 0), [lift]), null, 'too high above the top')
  assert.equal(findSupport(new THREE.Vector3(2.3, 1.2, 0), [lift]), null, 'outside the footprint')
  assert.equal(findSupport(new THREE.Vector3(2.1, 1.2, 0), [lift]), 'lift', 'small overhang margin')
  assert.equal(findSupport(new THREE.Vector3(0, 0, 0), [lift]), null, 'under the platform')
  const wall = { id: 'wall', box: boxFromMatrix(new THREE.Matrix4().compose(new THREE.Vector3(0, 1, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2.5), new THREE.Vector3(4, 0.4, 4))) }
  assert.equal(findSupport(new THREE.Vector3(0, 1.2, 0), [wall]), null, 'steep faces are not floors')
  const upper = { id: 'upper', box: boxFromMatrix(matrix(0, 1.25, 0)) }
  assert.equal(findSupport(new THREE.Vector3(0, 1.45, 0), [lift, upper]), 'upper')
})
