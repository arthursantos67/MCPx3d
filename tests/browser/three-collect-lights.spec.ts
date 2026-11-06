import { test,expect } from '@playwright/test'
import { createEmptyScene,createNode,validateScene } from '../../apps/web/src/three/sceneDocument.ts'

test('collecting a glowing item keeps the renderer program cache stable',async({page})=>{
  const scene=validateScene({...createEmptyScene(),nodes:[
    {...createNode('box'),id:'floor',position:[0,-.1,0],dimensions:[20,.2,20]},
    {...createNode('group'),id:'item',interaction:{trigger:'proximity',key:'',radius:1.2,action:'collect',targetId:null,message:'Chave recolhida',item:'Chave'}},
    {...createNode('polyhedron','item'),id:'gem',position:[0,1,0],dimensions:[.4,.4,.4],material:{color:'#ffd366',metalness:0,roughness:.5,emissive:'#ffc422',emissiveIntensity:1}},
    {...createNode('light','item'),id:'glow',position:[0,1,0],light:{type:'point',color:'#ffd088',intensity:8,distance:6,angle:35,penumbra:.5,castShadow:false}},
  ],environment:{...createEmptyScene().environment,shadows:false,reflections:false,ambientOcclusion:false,bloom:0,player:{spawn:[0,0,3],yaw:0,speed:4.5,jumpHeight:1,mode:'walk',weapon:'none'}}})
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  scene.environment.gameplay={quests:[],recipes:[],naturalResources:false,startingItems:[],hud:'full'}
  await page.addInitScript(doc=>{localStorage.setItem('modeler:workspace','three');localStorage.setItem('modeler:three-scene:v1',JSON.stringify(doc))},scene)
  await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,body:'{}'}))
  await page.goto('/?bench=1');await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  await page.waitForFunction(()=>window.__formaBench.marks.firstGameFrame>0)
  const before=await page.evaluate(()=>window.__formaBench.memory().programs)
  await page.keyboard.down('w')
  await expect(page.getByRole('region',{name:'Modo jogo'}).getByLabel('Itens coletados')).toHaveText('Itens 1/1',{timeout:15000})
  await page.keyboard.up('w')
  const after=await page.evaluate(()=>window.__formaBench.memory().programs)
  expect(after).toBe(before)
  expect(errors).toEqual([])
})
