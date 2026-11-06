// Run after vendor-game-assets.py with Vite on 5181. Uses the real editor's import pipeline.
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try {
  const page=await browser.newPage()
  await page.goto('http://127.0.0.1:5181');await page.waitForLoadState('networkidle')
  const models=await page.evaluate(async()=>{
    const {importGlb}=await import('/src/three/importGlb.ts'),{createEmptyScene}=await import('/src/three/sceneDocument.ts')
    const {Box3,Vector3}=await import('/node_modules/.vite/deps/three.js'),{sceneMatrices}=await import('/src/three/scenePlacement.ts')
    const result={}
    for(const id of ['wall','wall_pillar','floor_tile_large','barrel_large','pillar','pillar_decorated','chest','torch']) {
      const {document}=await importGlb(await(await fetch(`/models/kaykit/dungeon_${id}.glb`)).arrayBuffer(),id,createEmptyScene())
      const nodes=document.nodes, matrices=sceneMatrices(document),bounds=new Box3()
      for(const node of nodes) if(node.kind==='mesh') bounds.union(new Box3(new Vector3(-.5,-.5,-.5),new Vector3(.5,.5,.5)).applyMatrix4(matrices.get(node.id).clone().scale(new Vector3(...node.dimensions))))
      const remap=new Map(nodes.map((node,index)=>[node.id,`part${index}`]))
      for(const node of nodes) {node.id=remap.get(node.id);node.parentId=node.parentId?remap.get(node.parentId):null}
      result[id]={nodes:nodes.map(node=>({id:node.id,parentId:node.parentId,kind:node.kind,name:node.name,position:node.position,rotation:node.rotation,dimensions:node.dimensions,scale:node.scale,
        ...(node.kind==='mesh'?{material:node.material,geometry:{vertices:node.geometry.vertices,indices:node.geometry.indices,normals:node.geometry.normals,uvs:node.geometry.uvs}}:{})})),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}}
    }
    return result
  })
  await mkdir('apps/web/src/three/data',{recursive:true})
  const textureImage=models.wall.nodes.find(node=>node.material?.textureImage).material.textureImage
  for(const model of Object.values(models))for(const node of model.nodes)if(node.material?.textureImage)delete node.material.textureImage
  await writeFile('apps/web/src/three/data/crypt-kit.json',JSON.stringify({textureImage,models},(_key,value)=>typeof value==='number'?Math.round(value*1e5)/1e5:value)+'\n')
  console.log(Object.entries(models).map(([id,value])=>({id,bounds:value.bounds})))
} finally {await browser.close()}
