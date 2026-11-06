// Start Vite on 5181, then run: node scripts/bake-library-thumbnails.mjs
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage()
  await page.goto(process.env.MODEL_PREVIEW_URL ?? 'http://127.0.0.1:5181')
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const { modelLibrary, loadLibraryModel } = await import('/src/three/sceneModelLibrary.ts')
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(320, 240); renderer.setPixelRatio(1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1
    const output = []
    for (const entry of modelLibrary) {
      const gltf = await loadLibraryModel(entry.id), object = gltf.scene, scene = new THREE.Scene()
      scene.background = new THREE.Color('#252d35')
      const mixer = new THREE.AnimationMixer(object), idle = gltf.animations.find(clip => clip.name === 'Idle')
      if (idle) { mixer.clipAction(idle).play(); mixer.update(0) }
      scene.add(object, new THREE.HemisphereLight('#ffffff', '#b2a38a', 2.5))
      const key = new THREE.DirectionalLight('#fff2da', 3); key.position.set(4, 7, 5); scene.add(key)
      const rim = new THREE.DirectionalLight('#a5d8f5', 2); rim.position.set(-3, 4, -3); scene.add(rim)
      const bounds = new THREE.Box3().setFromObject(object), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
      const radius = Math.max(size.y, size.x * 0.8, size.z * 0.8), camera = new THREE.PerspectiveCamera(32, 4 / 3, 0.01, 1000)
      camera.position.copy(center).add(new THREE.Vector3(1.2, 0.7, 2.2).normalize().multiplyScalar(radius * 2.4))
      camera.lookAt(center)
      await renderer.compileAsync(scene, camera); renderer.render(scene, camera)
      output.push({ id: entry.id, png: renderer.domElement.toDataURL('image/png').split(',')[1] })
      mixer.stopAllAction(); mixer.uncacheRoot(object); object.removeFromParent()
    }
    renderer.dispose()
    return output
  })
  for (const { id, png } of results) { await writeFile(resolve('apps/web/public/models/kaykit', `${id}.png`), Buffer.from(png, 'base64')); console.log(id) }
} finally { await browser.close() }
