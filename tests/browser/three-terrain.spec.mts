import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createNode, createEmptyScene, validateScene, type ThreeSceneDocument } from '../../apps/web/src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../apps/web/src/three/sceneGeneration.ts'
import { terrainHeightAt } from '../../apps/web/src/three/sceneGeometrySpec.ts'
import { inspectGroundQuality } from '../../apps/web/src/three/sceneGroundQuality.ts'
import { projectAction } from './threeHelpers.ts'

const single={mode:'linear',count:1,offset:[0,0,0],radius:0,axis:'y'}
const node=(id:string,kind:Parameters<typeof createNode>[0],position:number[],patch={})=>({...createNode(kind),id,name:id,position,color:'#ffffff',metalness:0,roughness:0.9,repeat:single,...patch})
const prefab=(type:string,patch={})=>({type,size:1,seed:5,primary:null,secondary:null,text:'',lit:true,interactive:true,...patch})
function recipe(biome='meadow',floors=2,roads=true) {
  return {name:'Clareira habitável',background:'#cbdce2',exposure:1,lightIntensity:1.2,duration:12,
    environment:{sky:'day',sunElevation:38,ambientOcclusion:true,bloom:0.05,toneMapping:'agx',objective:{type:'collectAll',title:'Encontre os sete cristais',timeLimit:0}},
    nodes:[node('ground','terrain',[0,0,0],{dimensions:[80,6,70],geometry:{...createNode('terrain').geometry,segments:64,biome,seed:84}}),
      node('home','group',[-18,0,0],{prefab:prefab('house',{building:{style:'townhouse',floors,width:9.4,depth:9,furnished:true}}),repeat:{...single,onto:'ground'}}),
      node('tree','group',[18,0,4],{prefab:prefab('tree'),repeat:{...single,onto:'ground'}}),
      node('bench','group',[13,0,-5],{prefab:prefab('bench'),repeat:{...single,onto:'ground'}}),
      ...Array.from({length:7},(_,i)=>node(`crystal-${i}`,'group',[i*3-9,0.8,9],{prefab:prefab('gem'),repeat:{...single,onto:'ground'}}))],
    ...(roads?{roads:[{name:'Trilha larga',points:[[0,20],[0,0],[16,-14]],width:5,onto:'ground',texture:'tiles'},{name:'Travessa',points:[[-11,0],[24,0]],width:3,onto:'ground',texture:'rock'}]}:{})}
}
async function open(page:Page,scene?:ThreeSceneDocument) {
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(/Shader Error|THREE.WebGLProgram|GL_INVALID|VALIDATE_STATUS/.test(message.text())) errors.push(message.text())})
  await page.setViewportSize({width:1100,height:760})
  await page.addInitScript(value=>{localStorage.setItem('modeler:workspace','three');if(value)localStorage.setItem('modeler:three-scene:v1',JSON.stringify(value));localStorage.setItem('ai-web3d-modeler.provider-config.v1',JSON.stringify({mode:'byok',baseUrl:'http://provider.test/v1',apiKey:'fixture',model:'fixture'}))},scene)
  await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"detail":"offline"}'}))
  await page.goto('/')
  await expect(page.getByRole('img',{name:'Cena Three.js interativa'})).toBeVisible()
  return errors
}
async function exported(page:Page) {
  const pending=page.waitForEvent('download');await projectAction(page,'Exportar JSON')
  return JSON.parse(await readFile((await (await pending).path())!,'utf8')) as ThreeSceneDocument
}

for(const biome of ['meadow','alpine']) test(`physical ${biome} terrain layers render with continuous wide paths in first person`,async({page})=>{
  const scene=expandSceneRecipe(recipe(biome)),ground=scene.nodes.find(n=>n.id==='ground')!
  scene.environment.player!.spawn=[0,terrainHeightAt(ground.geometry,0,16/70)*6+0.07,16]
  scene.environment.player!.yaw=0
  expect(inspectGroundQuality(scene)).toEqual([])
  const errors=await open(page,scene)
  await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  await expect(page.getByRole('region',{name:'Modo jogo'})).toContainText('Itens 0/7')
  await page.screenshot({path:`.cache/browser/terrain-${biome}-paths.png`})
  await page.keyboard.press('Escape')
  const saved=await exported(page)
  expect(inspectGroundQuality(saved)).toEqual([])
  expect(saved.nodes.find(n=>n.id==='ground')!.geometry.biome).toBe(biome)
  expect(saved.nodes.filter(n=>n.path).length).toBe(2)
  expect(errors).toEqual([])
})

test('the real UI runs planner, builder and verified refinement and realizes the approved routes',async({page})=>{
  const errors=await open(page)
  const plan={title:'Clareira habitável',identity:'Casa de dois pavimentos e jardim conectado',extent:[80,70],palette:['#bda47f','#556d48','#c4cbd2'],terrain:{style:'rolling',biome:'meadow',relief:6},spawnZoneId:'arrival',
    zones:[{id:'arrival',name:'Chegada',role:'arrival',center:[-18,0],radius:14,landmark:'Casa',activities:['Explorar o sobrado']},{id:'garden',name:'Jardim',role:'nature',center:[18,0],radius:14,landmark:'Árvore',activities:['Buscar cristais']}],
    routes:[{from:'arrival',to:'garden',width:3}],buildings:[{zoneId:'arrival',style:'townhouse',floors:2,width:9.4,depth:9,count:1,furnished:true}],objective:{type:'collectAll',title:'Encontre os sete cristais',zoneId:'garden'}}
  let calls=0;const sent:string[]=[]
  await page.route('http://provider.test/v1/chat/completions',async route=>{
    sent.push(JSON.stringify(route.request().postDataJSON().messages))
    const result=calls++===0?plan:recipe('meadow',calls===2?1:2,false)
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}]})})
  })
  await page.getByRole('textbox',{name:'Descreva a cena Three.js',exact:true}).fill('Crie uma vila pequena com casa mobiliada de dois pavimentos, árvores, caminhos e sete cristais para coletar.')
  await page.getByRole('button',{name:'Criar cena com IA',exact:true}).click()
  await expect(page.locator('.three-commandbar__identity strong')).toHaveText('Clareira habitável')
  await expect(page.getByRole('textbox',{name:'Descreva a cena Three.js',exact:true})).toHaveValue('')
  const built=await exported(page)
  expect(calls).toBe(3)
  expect(sent[1]).toContain('PLANO ESPACIAL VALIDADO')
  expect(sent[2]).toContain('Plano não realizado')
  expect(built.nodes.find(n=>n.id==='home')!.asset!.building!.floors).toBe(2)
  expect(built.nodes.filter(n=>n.path&&n.geometry.indices.length>6).length).toBeGreaterThan(0)
  expect(built.nodes.filter(n=>n.interaction?.action==='collect')).toHaveLength(7)
  expect(built.environment.player!.spawn).not.toBeNull()
  expect(inspectGroundQuality(built)).toEqual([])
  await page.getByRole('button',{name:'Atividade',exact:true}).click()
  await expect(page.getByRole('region',{name:'Progresso da geração Three.js'})).toContainText('Revisão do plano construído')
  await expect(page.getByRole('region',{name:'Progresso da geração Three.js'})).toContainText('chamada 3 de até 3')
  expect(errors).toEqual([])
})

test('opening an old flat ribbon recovers its missing support and repairs the entire surface',async({page})=>{
  const ground={...createNode('terrain'),id:'ground',position:[0,0,0],dimensions:[40,8,40],geometry:{...createNode('terrain').geometry,segments:32,seed:84,biome:'meadow'},material:{...createNode('terrain').material,color:'#ffffff'}}
  const base=createNode('mesh'),old={...base,id:'legacy-road',name:'Trilha antiga',role:'path',position:[0,0.06,0],dimensions:[4,0.01,20],overlapWith:[],
    geometry:{...base.geometry,vertices:[-2,0.06,-10,2,0.06,-10,-2,0.06,10,2,0.06,10],indices:[0,2,1,1,2,3],uvs:[0,0,1,0,0,5,1,5]},material:{...base.material,color:'#dbd0bb',texture:'rock',textureScale:1}}
  const document=validateScene({...createEmptyScene(),name:'Trilha antiga recuperada',nodes:[ground,old],environment:{...createEmptyScene().environment,grid:false,sky:'day',player:{spawn:[0,terrainHeightAt(ground.geometry,0,12/40)*8+0.07,12],yaw:0,speed:4.5,jumpHeight:1.1,mode:'walk'}}})
  expect(inspectGroundQuality(document).length).toBeGreaterThan(0)
  const errors=await open(page,document),recovered=await exported(page),path=recovered.nodes.find(n=>n.id===old.id)!
  expect(path.path!.supportId).toBe('ground')
  expect(path.geometry.indices.length).toBeGreaterThan(6)
  expect(inspectGroundQuality(recovered)).toEqual([])
  await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
  await expect(page.getByRole('region',{name:'Modo jogo'})).toBeVisible()
  await page.screenshot({path:'.cache/browser/terrain-legacy-road-recovered.png'})
  expect(errors).toEqual([])
})
