import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createArchitectureScene,createValleyScene } from '../../apps/web/src/three/sceneShowcase.ts'
import { serializeSceneDraft } from '../../apps/web/src/three/sceneDraft.ts'
import { projectAction } from './threeHelpers.ts'

async function boot(page:Page) {
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(/Shader Error|THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text())})
  await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"detail":"offline"}'}))
  await page.goto('/')
  await expect(page.getByRole('img',{name:'Cena Three.js interativa'})).toBeVisible()
  return errors
}
async function exported(page:Page) {
  const pending=page.waitForEvent('download');await projectAction(page,'Exportar JSON')
  return JSON.parse(await readFile((await (await pending).path())!,'utf8'))
}

test('detailed vegetation saves within the real browser quota and restores the complete playable world',async({page})=>{
  await page.addInitScript(draft=>{localStorage.setItem('modeler:workspace','three');localStorage.setItem('modeler:three-scene:v1',draft)},serializeSceneDraft(createValleyScene()))
  const errors=await boot(page)
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('modeler:three-scene:v1')?.includes('geometryLibrary'))).toBe(true)
  const before=await exported(page)
  expect(before.nodes.filter((node:{asset?:{type:string}})=>node.asset?.type==='tree').length).toBeGreaterThan(20)
  expect(before.geometryLibrary).toBeUndefined()
  await page.reload()
  await expect(page.getByRole('img',{name:'Cena Three.js interativa'})).toBeVisible()
  expect(await exported(page)).toEqual(before)
  await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  await expect(page.getByRole('region',{name:'Modo jogo'})).toContainText('Itens 0/7')
  expect(errors).toEqual([])
})

test('a legacy indoor floor is repaired on opening, rendered and persisted without replacing house details',async({page})=>{
  const scene=createArchitectureScene(),stone=scene.nodes.find(n=>n.id==='casa.foundation')!,g=stone.geometry
  stone.geometry={...g,vertices:[...g.vertices.slice(0,72).map((v,i)=>i%3===1&&Math.abs(v-0.15)<0.00001?0.22:v),...g.vertices.slice(360)],indices:[...g.indices.slice(0,36),...g.indices.slice(180).map(i=>i-96)],uvs:[...g.uvs.slice(0,48),...g.uvs.slice(240)],normals:[]}
  stone.material.color='#8d8274'
  scene.environment.player!.spawn=[0,0.22,-2.8];scene.environment.player!.yaw=180
  await page.addInitScript(value=>{localStorage.setItem('modeler:workspace','three');localStorage.setItem('modeler:three-scene:v1',JSON.stringify(value))},scene)
  const errors=await boot(page),fixed=await exported(page),after=fixed.nodes.find((n:{id:string})=>n.id===stone.id)
  expect(after.geometry.indices).not.toEqual(stone.geometry.indices)
  expect(after.material.color).toBe('#8d8274')
  expect(fixed.nodes.filter((n:{id:string})=>n.id!==stone.id)).toEqual(scene.nodes.filter(n=>n.id!==stone.id))
  await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  await expect(page.getByRole('region',{name:'Modo jogo'})).toBeVisible()
  await page.screenshot({path:'.cache/browser/architecture-ground-floor-fixed.png'})
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})
