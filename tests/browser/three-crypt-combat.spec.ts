import { test,expect } from '@playwright/test'
import { createCryptScene } from '../../apps/web/src/three/sceneExperiences.ts'
import { serializeSceneDraft } from '../../apps/web/src/three/sceneDraft.ts'

for(const camera of ['first','third'] as const)test(`native knight approaches and defeats a crypt skeleton at body contact in ${camera} person`,async({page})=>{
  test.setTimeout(180000)
  const scene=createCryptScene(),target=scene.nodes.find(node=>node.id==='skeleton-a')!,errors:string[]=[]
  target.behavior!.speed=0;target.behavior!.damage=0
  scene.environment.player={...scene.environment.player!,spawn:[target.position[0],.02,target.position[2]+1.5],yaw:0,camera,health:1000}
  scene.environment.shadows=false;scene.environment.ambientOcclusion=false;scene.environment.bloom=0
  scene.environment.gameplay={quests:[],recipes:[],naturalResources:false,startingItems:[],hud:'full'}
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(/Shader Error|No target node found|GL_INVALID/.test(message.text()))errors.push(message.text())})
  await page.addInitScript(draft=>{localStorage.setItem('modeler:workspace','three');localStorage.setItem('modeler:three-scene:v1',draft);HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.reject(new Error('drag look'))},serializeSceneDraft(scene))
  await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,body:'{}'}))
  await page.goto('/?bench=1')
  await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  const hud=page.getByRole('region',{name:'Modo jogo'})
  await expect(hud).toBeVisible()
  await page.keyboard.down('w')
  await expect.poll(async()=>{const position=await page.evaluate(()=>window.__formaBench.position());return Math.hypot(position![0]-target.position[0],position![2]-target.position[2])},{timeout:20000}).toBeLessThan(.9)
  await page.keyboard.up('w')
  const position=await page.evaluate(()=>window.__formaBench.position())
  const distance=Math.hypot(position![0]-target.position[0],position![2]-target.position[2])
  expect(distance).toBeGreaterThan(.5);expect(distance).toBeLessThan(1)
  await expect(async()=>{await page.keyboard.press('e');await expect(hud.getByLabel('Inimigos derrotados')).toHaveText('Inimigos 1/3',{timeout:1500})}).toPass({timeout:20000,intervals:[800]})
  if(camera==='third')await page.screenshot({path:'.cache/browser/three-crypt-combat.png'})
  await page.keyboard.down('w')
  await expect.poll(async()=>{const position=await page.evaluate(()=>window.__formaBench.position());return position![2]},{timeout:10000}).toBeLessThan(target.position[2]+.2)
  await page.keyboard.up('w')
  const after=await page.evaluate(()=>window.__formaBench.position())
  expect(after![2]).toBeLessThan(target.position[2]+.4)
  expect(errors).toEqual([])
})
