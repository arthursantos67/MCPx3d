import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createArchitectureScene } from '../../apps/web/src/three/sceneShowcase.ts'
import { applySceneEdit } from '../../apps/web/src/three/sceneGeneration.ts'
import { createNode, type ThreeSceneDocument } from '../../apps/web/src/three/sceneDocument.ts'
import { projectAction, leaveGame } from './threeHelpers.ts'

async function open(page: Page, scene: ThreeSceneDocument) {
  const errors: string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(/Shader Error|THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text())})
  await page.setViewportSize({width:1100,height:760})
  await page.addInitScript(value=>{
    localStorage.setItem('modeler:workspace','three')
    localStorage.setItem('modeler:three-scene:v1',JSON.stringify(value))
    localStorage.setItem('ai-web3d-modeler.provider-config.v1',JSON.stringify({mode:'byok',baseUrl:'http://provider.test/v1',apiKey:'fixture',model:'fixture'}))
  },scene)
  await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"detail":"offline"}'}))
  await page.goto('/')
  await expect(page.getByRole('img',{name:'Cena Three.js interativa'})).toBeVisible()
  return errors
}
async function exported(page:Page) {
  const pending=page.waitForEvent('download')
  await projectAction(page,'Exportar JSON')
  return JSON.parse(await readFile((await (await pending).path())!,'utf8'))
}

test('a two-storey house renders, opens its entry and preserves the authored project after exploration',async({page})=>{
  test.setTimeout(90_000)
  const original=createArchitectureScene(), errors=await open(page,original)
  expect((await page.locator('.three-stage').boundingBox())!.height).toBeGreaterThan(300)
  await page.screenshot({path:'.cache/browser/architecture-exterior.png'})
  await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  const hud=page.getByRole('region',{name:'Modo jogo'})
  await expect(hud).toContainText('Porta de entrada')
  await page.keyboard.press('e')
  await expect(hud.getByRole('status')).toContainText('Abrir / fechar porta')
  await page.waitForTimeout(1200)
  await page.screenshot({path:'.cache/browser/architecture-entry.png'})
  await leaveGame(page)
  expect(await exported(page)).toEqual(JSON.parse(JSON.stringify(original)))
  expect(errors).toEqual([])
})

test('upper-floor interior, windows, stairs and balcony render with contact shading without shader errors',async({page})=>{
  test.setTimeout(90_000)
  const scene=createArchitectureScene()
  scene.environment.player!.spawn=[0,3.57,1.5]
  scene.environment.player!.yaw=180
  const errors=await open(page,scene)
  await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  await expect(page.getByRole('region',{name:'Modo jogo'})).toBeVisible()
  await page.screenshot({path:'.cache/browser/architecture-upper-interior.png'})
  await leaveGame(page)
  expect(errors).toEqual([])
})

test('a conversational request rebuilds a cottage into a furnished two-storey house',async({page})=>{
  const scene=createArchitectureScene(), asset=scene.nodes.find(n=>n.id==='casa')!.asset!
  const original=applySceneEdit(scene,{updates:[],additions:[],rebuilds:[{id:'casa',prefab:{...asset,building:{...asset.building,style:'cottage',floors:1}}}]})
  const errors=await open(page,original)
  let calls=0
  await page.route('http://provider.test/v1/chat/completions',route=>{
    calls++
    if(calls===2) expect(route.request().postDataJSON().messages.at(-1).content).toContain('Corrija o patch a partir da cena ORIGINAL')
    const reward={...createNode('sphere','casa'),id:'reward',name:'Recompensa no quarto',position:[0,4.67,-2.8],dimensions:[0.3,0.3,0.3],color:'#d8bc65',metalness:0.6,roughness:0.3,collidable:false,
      repeat:{mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'},interaction:{trigger:'proximity',key:'',radius:1.4,action:'collect',targetId:null,message:''}}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({updates:[],additions:[reward],removals:[],environment:null,rebuilds:[{id:'casa',prefab:asset}]})}}]})})
  })
  await page.getByRole('textbox',{name:'Descreva a cena Three.js',exact:true}).fill('Adicione um primeiro andar mobiliado à casa, com escada, varanda e uma recompensa no quarto')
  await page.getByRole('button',{name:'Editar cena com IA',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Descreva a cena Three.js',exact:true})).toHaveValue('')
  const edited=await exported(page)
  expect(edited.nodes.find((n:{id:string})=>n.id==='casa').asset.building.floors).toBe(2)
  expect(edited.nodes.some((n:{id:string})=>n.id==='casa.balcony-door')).toBe(true)
  expect(edited.nodes.find((n:{id:string})=>n.id==='casa').position).toEqual(original.nodes.find(n=>n.id==='casa')!.position)
  expect(edited.nodes.find((n:{id:string})=>n.id==='reward').position).toEqual([0,4.67,-2.8])
  expect(calls).toBe(2)
  expect(errors).toEqual([])
})
