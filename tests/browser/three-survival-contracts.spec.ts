import {test,expect,type Page} from '@playwright/test'
import {createEmptyScene,createNode,validateScene,type ThreeSceneDocument} from '../../apps/web/src/three/sceneDocument.ts'

const base=()=>validateScene({...createEmptyScene(),name:'Contratos de sobrevivência',nodes:[{...createNode('box'),id:'floor',position:[0,-.1,0],dimensions:[30,.2,30]}],environment:{...createEmptyScene().environment,sky:'day',shadows:false,reflections:false,ambientOcclusion:false,bloom:0,motion:{wind:0,grass:'none',fauna:'none'},player:{spawn:[0,0,0],yaw:0,speed:4.5,jumpHeight:1,mode:'walk',weapon:'none'},gameplay:{quests:[],recipes:[],naturalResources:false,startingItems:[{item:'Madeira',amount:11},{item:'Pedra',amount:2}]}}})
async function open(page:Page,scene:ThreeSceneDocument){
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text())})
 await page.addInitScript(doc=>{localStorage.setItem('modeler:workspace','three');localStorage.setItem('modeler:three-scene:v1',JSON.stringify(doc));HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.reject(new Error('Drag look'))},scene)
 await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,body:'{}'}))
 await page.goto('/?bench=1&invulnerable=0');await page.getByRole('button',{name:'▶ Jogar',exact:true}).click()
 await expect(page.getByRole('region',{name:'Modo jogo'})).toBeVisible()
 return errors
}
test('right click splits a stack, deposits single units, and keeps the layout when reopening inventory',async({page})=>{
 const errors=await open(page,base());await page.keyboard.press('b')
 const inventory=page.getByRole('dialog',{name:'Inventário',exact:true}),grid=inventory.getByRole('group',{name:'Itens na mochila'})
 await grid.getByRole('button',{name:'Mochila: Madeira, 11',exact:true}).click({button:'right'})
 await expect(page.getByLabel('Carregando 6 Madeira')).toBeVisible()
 await expect(grid.getByRole('button',{name:'Mochila: Madeira, 5',exact:true})).toBeVisible()
 await grid.getByRole('button',{name:'Espaço vazio 3',exact:true}).click()
 await expect(grid.getByRole('button',{name:'Mochila: Madeira, 5',exact:true})).toBeVisible()
 await grid.getByRole('button',{name:'Mochila: Madeira, 6',exact:true}).click({button:'right'})
 await grid.getByRole('button',{name:'Espaço vazio 4',exact:true}).click({button:'right'})
 await expect(grid.getByRole('button',{name:'Mochila: Madeira, 1',exact:true})).toBeVisible()
 await page.keyboard.press('Escape');await page.keyboard.press('b')
 await expect(grid.getByRole('button',{name:'Mochila: Madeira, 7',exact:true})).toBeVisible()
 await expect(grid.getByRole('button',{name:'Mochila: Madeira, 3',exact:true})).toBeVisible()
 await expect(grid.getByRole('button',{name:'Mochila: Madeira, 1',exact:true})).toBeVisible()
 expect(errors).toEqual([])
})

test('the default game keeps instructions and resource health off the screen and crafting slots stay usable',async({page})=>{
 const scene=base();scene.nodes.push({...createNode('box'),id:'tree',name:'Árvore',position:[0,1,-1.3],dimensions:[.5,2,.5],resource:{item:'Madeira',amount:3,health:12,kind:'wood',method:'strike'}})
 scene.environment.gameplay!.recipes=[{id:'bench',name:'Bancada',inputs:[{item:'Madeira',amount:4}],output:{item:'Bancada',amount:1},healing:0}]
 const errors=await open(page,scene)
 await expect(page.locator('.forma-prompt')).toBeHidden();await expect(page.locator('.forma-hints')).toBeHidden();await expect(page.locator('.forma-capture')).toBeHidden()
 await page.keyboard.press('e');await expect(page.locator('.forma-toasts')).not.toContainText('Clique para')
 await page.keyboard.press('b');const inventory=page.getByRole('dialog',{name:'Inventário e fabricação'}),cells=inventory.getByRole('group',{name:'Grade de fabricação'}).getByRole('button')
 await expect(cells).toHaveCount(4);const box=(await cells.first().boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(60);expect(box.height).toBeGreaterThanOrEqual(60)
 await expect(inventory).not.toContainText('Uma descoberta');await expect(inventory).not.toContainText('Arraste o resultado')
 await page.screenshot({path:'.cache/browser/three-inventory-clean.png'});expect(errors).toEqual([])
})

test('crafting results accumulate on the cursor and swapping stacks preserves every remaining ingredient',async({page})=>{
 const scene=base();scene.environment.gameplay!.recipes=[{id:'bench',name:'Bancada',inputs:[{item:'Madeira',amount:4}],output:{item:'Bancada',amount:1},healing:0}]
 const errors=await open(page,scene);await page.keyboard.press('b')
 const inventory=page.getByRole('dialog',{name:'Inventário e fabricação'})
 await inventory.getByRole('button',{name:'Mochila: Madeira, 11',exact:true}).click()
 await inventory.getByRole('button',{name:'Bancada 1: vazio',exact:true}).click()
 const result=inventory.getByRole('button',{name:'Retirar resultado: Bancada',exact:true})
 await result.click();await expect(page.getByLabel('Carregando 1 Bancada')).toBeVisible()
 await result.click();await expect(page.getByLabel('Carregando 2 Bancada')).toBeVisible()
 await inventory.getByRole('button',{name:'Mochila: Pedra, 2',exact:true}).click()
 await expect(page.getByLabel('Carregando 2 Pedra')).toBeVisible()
 await expect(inventory.getByRole('button',{name:'Mochila: Bancada, 2',exact:true})).toBeVisible()
 await page.keyboard.press('Escape');await page.keyboard.press('b')
 for(const name of['Mochila: Madeira, 3','Mochila: Pedra, 2','Mochila: Bancada, 2'])await expect(inventory.getByRole('button',{name,exact:true})).toBeVisible()
 expect(errors).toEqual([])
})
test('an advanced recipe unlocks only near a workbench crafted and placed on the ground',async({page})=>{
 const scene=base(),rules=scene.environment.gameplay!
 rules.startingItems=[{item:'Madeira',amount:12},{item:'Pedra',amount:5}]
 rules.items=[{name:'Bancada',description:'Estação de trabalho',placeable:'workbench',station:'workbench'},{name:'Espada',description:'Lâmina avançada',equipment:'sword',damage:4}]
 rules.recipes=[{id:'bench',name:'Bancada',inputs:[{item:'Madeira',amount:4}],output:{item:'Bancada',amount:1},healing:0},{id:'sword',name:'Espada',inputs:[{item:'Madeira',amount:2},{item:'Pedra',amount:2}],output:{item:'Espada',amount:1},healing:0,station:'workbench'}]
 const errors=await open(page,validateScene(scene));await page.keyboard.press('b')
 const inventory=page.getByRole('dialog',{name:'Inventário e fabricação'})
 const prepare=async(name:string)=>{await inventory.getByRole('tab',{name:/Receitas/}).click();await inventory.getByRole('button',{name:`Preparar receita: ${name}`,exact:true}).click()}
 await prepare('Espada');await expect(inventory.getByRole('button',{name:'Retirar resultado: Espada',exact:true})).toBeDisabled()
 await prepare('Bancada');await inventory.getByRole('button',{name:'Retirar resultado: Bancada',exact:true}).click();await page.keyboard.press('Escape')
 await expect(page.locator('.forma-placement')).toBeVisible()
 await page.keyboard.press('e');await expect(page.locator('.forma-placement')).toBeHidden()
  await page.keyboard.down('w');await expect.poll(async()=>(await page.evaluate(()=>window.__formaBench!.position()!))[2],{timeout:15000}).toBeLessThan(-.8);await page.keyboard.up('w')
 await page.keyboard.press('b');await expect(inventory.getByRole('tab',{name:'Bancada de criação',exact:true})).toBeVisible()
 await prepare('Espada');await expect(inventory.getByRole('button',{name:'Retirar resultado: Espada',exact:true})).toBeEnabled()
 await inventory.getByRole('button',{name:'Retirar resultado: Espada',exact:true}).click()
 await expect(inventory.getByRole('button',{name:'Atalho 2: Espada',exact:true})).toBeVisible()
 expect(errors).toEqual([])
})
test('striking a resource uses the animated impact, while E leaves wood unchanged',async({page})=>{
 const scene=base();scene.nodes.push({...createNode('box'),id:'tree',name:'Tronco de teste',position:[0,1,-1.3],dimensions:[.5,2,.5],resource:{item:'Madeira',amount:3,health:10,kind:'wood',method:'strike'}});scene.environment.player!.weapon='axe'
 scene.environment.gameplay!.hud='full'
 const errors=await open(page,validateScene(scene)),prompt=page.locator('.forma-prompt')
 await expect(prompt.getByLabel('Resistência 10/10')).toBeVisible()
 await page.keyboard.press('e');await expect(prompt.getByLabel('Resistência 10/10')).toBeVisible()
 await page.getByRole('img',{name:'Cena Three.js interativa'}).click({position:{x:200,y:200}})
 await expect(prompt.getByLabel('Resistência 5/10')).toBeVisible()
 await page.screenshot({path:'.cache/browser/three-first-person-harvest.png'})
 expect(errors).toEqual([])
})
test('lava uses the fluid surface and damages the player after entering it',async({page})=>{
 const scene=base();scene.nodes.push({...createNode('plane'),id:'lava',name:'Lava',position:[0,.5,0],dimensions:[5,1,5],collidable:false,liquid:{kind:'lava',viscosity:6,damage:30}});scene.environment.player!.spawn=[0,.02,4]
 scene.environment.gameplay!.hud='full'
 const errors=await open(page,validateScene(scene)),health=page.getByRole('meter',{name:'Vida',exact:true})
 await expect(health).toHaveAttribute('aria-valuenow','100');await page.keyboard.down('w')
 await expect.poll(async()=>Number(await health.getAttribute('aria-valuenow')),{timeout:15000}).toBeLessThan(100)
 await page.keyboard.up('w');await page.screenshot({path:'.cache/browser/three-lava-contact.png'})
 expect(errors).toEqual([])
})
for(const [equipment,damage,left]of[['sword',8,2],['blaster',2,8]] as const)test(`item-specific ${equipment} combat damage is applied once at impact`,async({page})=>{
 const scene=base();scene.environment.gameplay!.startingItems=[{item:'Arma temática',amount:1}];scene.environment.gameplay!.items=[{name:'Arma temática',description:'Dano específico do tema',equipment,damage}]
 scene.environment.gameplay!.hud='full'
 scene.nodes.push({...createNode('box'),id:'target',name:'Alvo',position:[0,.9,-1.2],dimensions:[.5,1.8,.5],behavior:{type:'enemy',speed:0,range:3,damage:0,health:10,attack:'touch'}})
 const errors=await open(page,validateScene(scene));await page.keyboard.press('b')
 const inventory=page.getByRole('dialog',{name:'Inventário',exact:true})
 await inventory.getByRole('button',{name:'Mochila: Arma temática, 1',exact:true}).dragTo(inventory.getByRole('button',{name:'Atalho 2: Vazio',exact:true}))
 await page.keyboard.press('Escape');await page.keyboard.press('2');await page.keyboard.press('e')
 await expect(page.locator('.forma-prompt').getByLabel(`Resistência ${left}/10`)).toBeVisible()
 expect(errors).toEqual([])
})
