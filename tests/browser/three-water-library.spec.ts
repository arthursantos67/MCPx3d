import {test,expect} from '@playwright/test'

test('the official water library renders reflection and refraction then releases its GPU targets',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text())})
 await page.goto('/')
 const result=await page.evaluate(async()=>{
  const source=await(await fetch('/src/three/sceneLibraryWater.ts')).text(),url=source.match(/from\s*["']([^"']*three[^"']*)["']/)![1]
  const THREE=await import(/* @vite-ignore */url),{createLibraryWater}=await import('/src/three/sceneLibraryWater.ts')
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(160,120)
  const scene=new THREE.Scene();scene.background=new THREE.Color('#91bdce')
  const camera=new THREE.PerspectiveCamera(50,4/3,.1,100);camera.position.set(3,3,3);camera.lookAt(0,0,0)
  const normal=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1);normal.needsUpdate=true
  const geometry=new THREE.PlaneGeometry(12,12),water=createLibraryWater(geometry,normal,12,0);water.setCaptureEnabled(true);scene.add(water.object)
  renderer.render(scene,camera)
  const allocated=renderer.info.memory.textures,programs=renderer.info.programs!.length
  water.object.removeFromParent();water.dispose();renderer.render(scene,camera)
  const remaining=renderer.info.memory.textures;geometry.dispose();normal.dispose();renderer.dispose();renderer.forceContextLoss()
  return{allocated,remaining,programs}
 })
 expect(result.programs).toBeGreaterThan(0);expect(result.allocated).toBeGreaterThanOrEqual(3);expect(result.remaining).toBe(0);expect(errors).toEqual([])
})
