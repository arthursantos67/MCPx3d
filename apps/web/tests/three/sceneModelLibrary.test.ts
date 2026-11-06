import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { modelLibrary, characterModelId } from '../../src/three/sceneModelLibrary.ts'
import type { PrefabSpec } from '../../src/three/scenePrefabs.ts'

const directory = new URL('../../public/models/kaykit/', import.meta.url)
test('the bundled collection is pinned, licensed, self-contained and within its download budget', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as { id: string; file: string; sha256: string; bytes: number; license: string; source: string }[]
  assert.equal(manifest.length, modelLibrary.length)
  let bytes = 0
  for (const entry of manifest) {
    const data = readFileSync(new URL(entry.file, directory)), jsonLength = data.readUInt32LE(12)
    assert.equal(data.readUInt32LE(0), 0x46546c67); assert.equal(data.readUInt32LE(8), data.length)
    assert.equal(data.length, entry.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256)
    assert.equal(entry.license, 'CC0-1.0'); assert.match(entry.source, /github.com\/KayKit-Game-Assets\/[^/]+\/blob\/[a-f0-9]{40}\//)
    const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'))
    assert.ok(gltf.images.every((image: { uri?: string; bufferView?: number }) => !image.uri && Number.isInteger(image.bufferView)))
    assert.ok(gltf.buffers.every((buffer: { uri?: string }) => !buffer.uri))
    if (['knight', 'rogue', 'mage'].includes(entry.id)) {
      const clips = gltf.animations.map((clip: { name: string }) => clip.name)
      assert.ok(clips.includes('Walking_A') && clips.includes('Idle') && clips.includes('Death_A'))
      assert.equal(clips.length, 18)
      assert.ok(gltf.skins.length > 0)
    }
    bytes += data.length
  }
  assert.ok(bytes < 11_000_000, `collection uses ${bytes} bytes`)
  assert.match(readFileSync(new URL('LICENSE-adventurers.txt', directory), 'utf8'), /Creative Commons Zero/)
})
test('authored character palettes and archetypes are preserved while default humanoids use the library', () => {
  const spec: PrefabSpec = { type: 'knight', size: 1, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: true }
  assert.equal(characterModelId(spec), 'knight')
  assert.equal(characterModelId({ ...spec, primary: '#123456' }), null)
  assert.equal(characterModelId(spec, 'robot'), null)
  assert.equal(characterModelId(spec, 'explorer'), 'rogue')
})
