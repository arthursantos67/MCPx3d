import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createEmptyScene, createNode, validateScene } from '../../apps/web/src/three/sceneDocument.ts'
import { projectAction } from './threeHelpers.ts'

test('local models mount a native animated rig, export its clips and import an editable hill', async ({ page }) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/Shader Error|No target node found|Can not resolve|GL_INVALID/.test(message.text())) errors.push(message.text()) })
  const scene = validateScene({ ...createEmptyScene(), nodes: [{ ...createNode('box'), id: 'floor', position: [0, -0.1, 0], dimensions: [12, 0.2, 12] }], environment: { ...createEmptyScene().environment, shadows: false, motion: { wind: 0, fauna: 'none', grass: 'none' } } })
  await page.addInitScript(doc => { localStorage.setItem('modeler:workspace', 'three'); localStorage.setItem('modeler:three-scene:v1', JSON.stringify(doc)) }, scene)
  await page.route('http://127.0.0.1:8011/api/**', route => route.fulfill({ status: 503, body: '{}' }))
  await page.goto('/')
  await projectAction(page, 'Biblioteca de modelos')
  const library = page.getByRole('dialog', { name: 'Biblioteca de modelos' })
  await expect(library.getByRole('button', { name: /^Adicionar modelo:/ })).toHaveCount(23)
  await expect.poll(() => library.locator('img').evaluateAll(images => images.filter(image=>(image as HTMLImageElement).loading!=='lazy'||image.getBoundingClientRect().top<innerHeight).every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.screenshot({ path: '.cache/browser/three-model-library.png' })
  await library.getByRole('button', { name: 'Adicionar modelo: Cavaleiro', exact: true }).click()
  await expect(library).toBeHidden()
  await expect(page.getByRole('button', { name: '▶ Jogar', exact: true })).toBeEnabled()
  const animation = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js'), models = await import('/src/three/sceneModelLibrary.ts')
    const spec = { type: 'knight', size: 1, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: true }
    const a = models.libraryCharacter('probe-a', spec, new Map([['probe-a', new THREE.Group()]]), new Map(), { shadows: false, height: 1.8 })!
    const b = models.libraryCharacter('probe-b', spec, new Map([['probe-b', new THREE.Group()]]), new Map(), { shadows: false, height: 1.8 })!
    const bone = a.object.getObjectByName('upperlegl')!, before = bone.quaternion.toArray()
    for (let i=0;i<20;i++) a.animate!({ dt: 1/60, time: i/60, speed: 1.6, grounded: true, verticalSpeed: 0, dead: false, talk: false }, { state: 'locomotion', joints: new Map(), bob: 0, collapse: 0, face: { blink: 0, jaw: 0, brow: 0, smile: 0, gaze: [0,0] }, combo: 1, events: [], seat: 0, footIK: 0, look: 0 })
    const result = { changed: bone.quaternion.toArray().some((value,index)=>Math.abs(value-before[index])>0.01), independent: a.meshes[0].skeleton !== b.meshes[0].skeleton, sharedGeometry: a.meshes[0].geometry === b.meshes[0].geometry, socket: !!a.grips.R && new THREE.Vector3(0,0,1).applyQuaternion(a.grips.R.quaternion).y > 0.99 }
    a.dispose(); b.dispose(); return result
  })
  expect(animation).toEqual({ changed: true, independent: true, sharedGeometry: true, socket: true })
  const editedBody = await page.evaluate(async () => {
    const { parseScene } = await import('/src/three/sceneDocument.ts'), { buildScene, createResources } = await import('/src/three/sceneBuild.ts'), { buildCharacterSkins } = await import('/src/three/sceneSkin.ts')
    const doc = parseScene(localStorage.getItem('modeler:three-scene:v1')!), actor = doc.nodes.find(node=>node.asset?.type==='knight')!
    doc.nodes.find(node=>node.parentId && node.assetPart==='head')!.material.color = '#ed3344'
    const resources = createResources(), built = buildScene(doc,resources,{instancing:false,helpers:false,skins:(document,holders)=>buildCharacterSkins(document,holders,{quality:'low',shadows:false})})
    const preserved = !built.skins.get(actor.id)?.nativeClips
    built.dispose(); resources.dispose(); return preserved
  })
  expect(editedBody).toBe(true)
  const pending = page.waitForEvent('download'); await projectAction(page, 'Exportar GLB')
  const data = await readFile((await (await pending).path())!)
  const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8'))
  expect(gltf.skins.length).toBeGreaterThan(0)
  expect(gltf.animations.some((clip: { name: string }) => clip.name.includes('Walking_A'))).toBe(true)
  expect(gltf.animations.every((clip: { channels: { target: { node: number } }[] }) => clip.channels.every(channel => Number.isInteger(channel.target.node) && channel.target.node < gltf.nodes.length))).toBe(true)
  await page.screenshot({ path: '.cache/browser/three-library-knight.png' })
  await projectAction(page, 'Biblioteca de modelos')
  await library.getByRole('button', { name: 'Adicionar modelo: Colina gramada', exact: true }).click()
  await expect(library).toBeHidden()
  await expect(page.getByRole('button', { name: '▶ Jogar', exact: true })).toBeEnabled()
  const saved = page.waitForEvent('download'); await projectAction(page, 'Exportar JSON')
  const doc = JSON.parse(await readFile((await (await saved).path())!, 'utf8'))
  expect(doc.nodes.some((node: { name: string; kind: string }) => node.name === 'Colina gramada' && node.kind === 'group')).toBe(true)
  expect(doc.nodes.some((node: { kind: string; geometry: { vertices: number[] } }) => node.kind === 'mesh' && node.geometry.vertices.length > 0)).toBe(true)
  expect(errors).toEqual([])
})
