import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createNode, type ThreeSceneDocument } from '../../apps/web/src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../apps/web/src/three/sceneGeneration.ts'
import { characterTypes } from '../../apps/web/src/three/sceneCharacters.ts'
import { openAdvancedEditor, projectAction, leaveGame } from './threeHelpers.ts'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (/Shader Error|THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text()) })
  await page.addInitScript(() => { localStorage.setItem('modeler:workspace', 'three'); localStorage.removeItem('forma:play-settings.v1') })
  await page.route('http://127.0.0.1:8011/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/'); await openAdvancedEditor(page)
  return errors
}
async function load(page: Page, doc: ThreeSceneDocument) {
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'skins.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
}
async function download(page: Page, action: string) {
  const pending = page.waitForEvent('download'); await projectAction(page, action)
  return readFile((await (await pending).path())!)
}
const repeat = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' }
const actor = (id: string, type: string, position: number[], size = 1) => ({ ...createNode('group'), id, name: id, kind: 'group', position, repeat,
  color: '#cccccc', metalness: 0, roughness: 0.6, prefab: { type, size, seed: 3, primary: null, secondary: null, text: '', lit: false, interactive: true } })

test('organic skin gallery renders and exports portable skeletons, colors and character clips', async ({ page }) => {
  test.setTimeout(180_000)
  const errors = await open(page), organic = characterTypes.filter((type) => !['skeleton', 'golem', 'drone'].includes(type))
  const doc = expandSceneRecipe({ name: 'Galeria de peles', background: '#dce3ea', exposure: 1, lightIntensity: 1.5, duration: 8,
    environment: { sky: 'studio', motion: { wind: 0, grass: 'none', fauna: 'none' } },
    nodes: [{ ...createNode('box'), id: 'floor', color: '#c5ccd4', metalness: 0, roughness: 0.8, dimensions: [18, 0.2, 10], position: [0, -0.1, 0], repeat },
      ...organic.map((type, i) => actor(type, type, [(i % 5 - 2) * 3, 0, Math.floor(i / 5) * -4], type === 'dragon' ? 0.55 : 1))] })
  await load(page, doc)
  await page.screenshot({ path: '.cache/browser/three-skins-gallery.png' })
  const original = JSON.parse((await download(page, 'Exportar JSON')).toString())
  const glb = await download(page, 'Exportar GLB'), json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
  expect(json.skins).toHaveLength(organic.length)
  expect(json.meshes.some((mesh: { primitives: { attributes: Record<string, number> }[] }) => mesh.primitives.some((primitive) => primitive.attributes.JOINTS_0 !== undefined && primitive.attributes.WEIGHTS_0 !== undefined && primitive.attributes.COLOR_0 !== undefined))).toBe(true)
  expect(json.animations.map((animation: { name: string }) => animation.name)).toEqual(expect.arrayContaining(['Personagens · caminhada', 'Personagens · ociosidade']))
  const parsed = await page.evaluate(async (bytes) => {
    const source = await (await fetch('/src/three/importGlb.ts')).text()
    const loaderUrl = source.match(/from\s+["']([^"']*GLTFLoader[^"']*)["']/)![1]
    const threeUrl = source.match(/from\s+["']([^"']*three\.js[^"']*)["']/)![1]
    const { GLTFLoader } = await import(/* @vite-ignore */ loaderUrl)
    const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0)).buffer, '')
    const { AnimationMixer, Vector3 } = await import(/* @vite-ignore */ threeUrl)
    const mixer = new AnimationMixer(gltf.scene)
    mixer.clipAction(gltf.animations.find((clip) => clip.name.includes('caminhada'))!).play(); mixer.update(0.4)
    gltf.scene.updateMatrixWorld(true)
    let skins = 0, finite = true
    const rigs = new Set<string>()
    gltf.scene.traverse((object) => {
      if ('isSkinnedMesh' in object && object.isSkinnedMesh) {
        const mesh = object as import('three').SkinnedMesh
        mesh.skeleton.update(); skins++; rigs.add(mesh.skeleton.bones[0].uuid)
        const point = mesh.getVertexPosition(0, new Vector3()); finite &&= Number.isFinite(point.x + point.y + point.z)
      }
    })
    return { skins, rigs: rigs.size, finite }
  }, glb.toString('base64'))
  expect(parsed.rigs).toBe(organic.length); expect(parsed.skins).toBeGreaterThanOrEqual(organic.length); expect(parsed.finite).toBe(true)
  expect(JSON.parse((await download(page, 'Exportar JSON')).toString())).toEqual(original)
  expect(errors).toEqual([])
})

test('skinned avatar and NPC dialogue survive camera changes, quality changes and restarting play', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = await open(page), doc = expandSceneRecipe({ name: 'Peles no jogo', background: '#dce3ea', exposure: 1, lightIntensity: 1.5, duration: 8,
    environment: { sky: 'studio', motion: { wind: 0, grass: 'none', fauna: 'none' }, player: { spawn: [0, 0, 0], yaw: 0, speed: 3, jumpHeight: 1, mode: 'walk', avatar: 'wizard', weapon: 'staff', camera: 'third' } },
    nodes: [{ ...createNode('box'), id: 'floor', color: '#c5ccd4', metalness: 0, roughness: 0.8, dimensions: [12, 0.2, 12], position: [0, -0.1, 0], repeat },
      { ...actor('Guia', 'villager', [0, 0, -2.2]), behavior: { type: 'npc', speed: 0, range: 4, damage: 0, reaction: 'ignore' }, interaction: { trigger: 'click', key: '', radius: 4, action: 'dialogue', targetId: null, message: 'A pele acompanha o personagem.' } }] })
  await load(page, doc)
  const original = JSON.parse((await download(page, 'Exportar JSON')).toString())
  await page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
  const hud = page.getByRole('region', { name: 'Modo jogo' })
  await expect(hud).toContainText('Conversar')
  await page.screenshot({ path: '.cache/browser/three-skins-avatar.png' })
  await page.keyboard.press('e')
  await expect(page.getByRole('dialog', { name: 'Diálogo com Guia' })).toBeVisible()
  await page.keyboard.press('Escape')
  const pause = page.getByRole('dialog', { name: 'Pausa', exact: true })
  await expect(pause).toBeVisible()
  await pause.getByRole('button', { name: 'Configurações', exact: true }).click()
  await pause.getByRole('button', { name: 'Alta', exact: true }).click()
  await pause.getByRole('button', { name: 'Baixa', exact: true }).click()
  await page.keyboard.press('Escape'); await page.keyboard.press('v')
  await expect(hud).toContainText('1ª pessoa')
  await leaveGame(page)
  await page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
  await expect(hud).toContainText('Conversar')
  await leaveGame(page)
  expect(JSON.parse((await download(page, 'Exportar JSON')).toString())).toEqual(original)
  expect(errors).toEqual([])
})
