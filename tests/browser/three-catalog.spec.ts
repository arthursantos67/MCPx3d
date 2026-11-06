import { test,expect } from '@playwright/test'
import { createEmptyScene,createNode,validateScene } from '../../apps/web/src/three/sceneDocument.ts'
import { projectAction } from './threeHelpers.ts'

test('the full catalogue searches thousands of local assets, previews and imports a model with bounded cards',async({page})=>{
  test.setTimeout(180000)
  const scene=validateScene({...createEmptyScene(),nodes:[{...createNode('box'),id:'floor',position:[0,-.1,0],dimensions:[20,.2,20]}]}),errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(doc=>{localStorage.setItem('modeler:workspace','three');localStorage.setItem('modeler:three-scene:v1',JSON.stringify(doc))},scene)
  await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,body:'{}'}))
  await page.goto('/');await projectAction(page,'Biblioteca de modelos')
  const library=page.getByRole('dialog',{name:'Biblioteca de modelos'})
  await library.getByRole('button',{name:'Catálogo completo · 3.145 modelos',exact:true}).click()
  await expect(library.getByRole('button',{name:/^Visualizar modelo:/})).toHaveCount(36)
  await library.getByLabel('Coleção',{exact:true}).selectOption('nature-kit')
  await library.getByLabel('Buscar modelos').fill('árvore')
  const cards=library.getByRole('button',{name:/^Visualizar modelo:/})
  await expect.poll(()=>cards.count()).toBeGreaterThan(5)
  await expect.poll(()=>cards.first().locator('img').evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true)
  await page.screenshot({path:'.cache/browser/three-model-catalog.png'})
  await cards.first().click()
  await expect(library.locator('.catalog-preview-canvas canvas')).toBeVisible()
  await library.getByLabel('Altura no mundo (metros)').fill('3')
  await library.getByRole('button',{name:'Adicionar à cena',exact:true}).click()
  await expect(library).toBeHidden()
  const imported=await page.evaluate(async()=>{const {parseScene}=await import('/src/three/sceneDocument.ts');return parseScene(localStorage.getItem('modeler:three-scene:v1')!).nodes.map(node=>({kind:node.kind,name:node.name,scale:node.scale}))})
  expect(imported.some(node=>node.kind==='mesh')).toBe(true)
  await page.reload();await expect(page.getByRole('img',{name:'Cena Three.js interativa'})).toBeVisible()
  expect(errors).toEqual([])
})

test('generation resolves an actual catalogue model and repeats its editable meshes on a supporting floor',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('modeler:workspace','three'))
 await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,body:'{}'}))
 await page.goto('/')
 const result=await page.evaluate(async()=>{
  const {loadModelCatalog}=await import('/src/three/sceneModelCatalog.ts'),{catalogBrief,resolveCatalogParts}=await import('/src/three/sceneCatalogGeneration.ts'),{expandSceneRecipe}=await import('/src/three/sceneGeneration.ts')
  const catalog=await loadModelCatalog(),model=catalog.models.find(model=>model.pack==='nature-kit'&&/tree/i.test(model.name))!,brief=catalogBrief(catalog,'árvore e rocha')
  const recipe={name:'Modelos reais',nodes:[{id:'tree',name:'Árvore',kind:'group',position:[0,0,0],catalog:{id:model.id,height:3},repeat:{mode:'linear',count:2,offset:[5,0,0],radius:0,axis:'y',columns:1,jitter:0,seed:1,onto:null}}]}
  const parts=await resolveCatalogParts(recipe,catalog,new AbortController().signal),doc=expandSceneRecipe(recipe,()=>{},[],{lenient:true,catalogParts:parts})
  return {advertised:brief.includes(model.id),meshCount:doc.nodes.filter(node=>node.kind==='mesh').length,roots:doc.nodes.filter(node=>node.parentId===null).length,hasVertices:doc.nodes.some(node=>node.geometry.vertices.length>30)}
 })
 expect(result.advertised).toBe(true);expect(result.meshCount).toBeGreaterThanOrEqual(2);expect(result.roots).toBe(2);expect(result.hasVertices).toBe(true)
})
