import {test,expect} from '@playwright/test'
import {createClimateWorld} from '../../apps/web/src/three/world/worldExamples.ts'
import {buildWorldMacro} from '../../apps/web/src/three/world/worldJobs.ts'
import {createHeightSource} from '../../apps/web/src/three/world/worldTerrain.ts'
import {detailedWaterMesh,waterMeshHeightAt} from '../../apps/web/src/three/world/worldHydrology.ts'

test('Aurora renders a supported river beside a dry bank with the same level used by fluid physics',async({page},testInfo)=>{
 test.setTimeout(300000)
 const world=createClimateWorld(),macro=buildWorldMacro(world),source=createHeightSource(world,macro),mesh=detailedWaterMesh(macro,source.heightAt)
 let chosen:{x:number;z:number;bx:number;bz:number;by:number;level:number;score:number}|null=null
 for(let j=1;j<macro.points[1]-2;j++)for(let i=1;i<macro.points[0]-2;i++){
  const k=j*macro.points[0]+i;if(!Number.isFinite(macro.water[k])||macro.lake?.[k]||macro.river[k]<.5)continue
  const x=macro.origin[0]+(i+.5)*macro.cell,z=macro.origin[1]+(j+.5)*macro.cell,level=waterMeshHeightAt(mesh,macro,x,z)
  if(level===null||level-source.heightAt(x,z)<1.5||world.locations.some(site=>Math.hypot(x-site.position[0],z-site.position[1])<site.footprint+30))continue
  for(const [dx,dz]of[[0,1],[1,0],[0,-1],[-1,0]])for(const offset of[8,12,18,24]){
   const bx=x+dx*offset,bz=z+dz*offset,by=source.heightAt(bx,bz),depth=by-level,wet=waterMeshHeightAt(mesh,macro,bx,bz)
   if(depth<.2||depth>3.5||wet!==null&&wet>by-.2||by<(world.terrain.seaLevel??-Infinity)+1)continue
   const slope=Math.hypot(source.heightAt(bx+1,bz)-source.heightAt(bx-1,bz),source.heightAt(bx,bz+1)-source.heightAt(bx,bz-1))/2;if(slope>.5)continue
   const score=Math.hypot(x+160,z+384)+depth*10+offset*.3
   if(!chosen||score<chosen.score)chosen={x,z,bx,bz,by,level,score}
  }
 }
 expect(chosen).not.toBeNull();const at=chosen!
 world.environment.player={...world.environment.player!,spawn:[at.bx,at.by+.05,at.bz],yaw:Math.atan2(at.bx-at.x,at.bz-at.z)*180/Math.PI}
 world.environment.dayCycle={enabled:false,duration:900,start:9};world.environment.shadows=false
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/Shader Error|GL_INVALID|VALIDATE_STATUS/.test(message.text()))errors.push(message.text())})
 await page.addInitScript(()=>{localStorage.setItem('modeler:workspace','three');HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.reject(new Error('Drag look'))})
 await page.route('http://127.0.0.1:8011/api/**',route=>route.fulfill({status:503,body:'{}'}))
 await page.goto('/?bench=1&ratio=.7')
 await page.evaluate(async doc=>{const request=indexedDB.open('forma-worlds',1);await new Promise<void>((resolve,reject)=>{request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('worlds'))request.result.createObjectStore('worlds',{keyPath:'key'})};request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)});const db=request.result;await new Promise<void>((resolve,reject)=>{const tx=db.transaction('worlds','readwrite');tx.objectStore('worlds').put({key:'atual',world:doc,savedAt:Date.now()});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});db.close()},world)
 await page.evaluate(name=>localStorage.setItem('modeler:three-world',name),world.name)
 await page.reload();await page.waitForFunction(()=>(window.__formaBench?.marks.worldPrepared??0)>0,null,{timeout:200000})
 await page.getByRole('button',{name:'▶ Jogar',exact:true}).click();await page.waitForFunction(()=>(window.__formaBench?.marks.firstGameFrame??0)>0)
 await expect(page.locator('.three-world-travel')).toBeHidden({timeout:120000})
 const actual=await page.evaluate(({x,z})=>({liquid:window.__formaBench!.liquid!(x,z),bed:window.__formaBench!.ground!(x,z)}),at)
 expect(actual.liquid?.kind).toBe('water');expect(actual.liquid!.level-actual.bed).toBeGreaterThan(.05);expect(actual.liquid!.level-actual.bed).toBeLessThan(2.53)
 const canvas=page.getByRole('img',{name:'Cena Three.js interativa'}),box=(await canvas.boundingBox())!
 const tilt=Math.atan2(at.by+1.62-at.level,Math.hypot(at.bx-at.x,at.bz-at.z)),cx=box.x+box.width/2,cy=box.y+box.height/2
 await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx,cy+tilt/.005,{steps:8});await page.mouse.up()
 await canvas.screenshot({path:'.cache/browser/three-aurora-river-bank.png'})
 await page.keyboard.down('w')
 await page.waitForFunction(()=>{const bench=window.__formaBench!,at=bench.position()!,water=bench.liquid!(at[0],at[2]);return water&&at[1]<water.level-.8&&water.level-bench.ground!(at[0],at[2])>1.4},null,{timeout:90000})
 await page.keyboard.up('w')
 const swimming=await page.evaluate(()=>{const bench=window.__formaBench!,at=bench.position()!,water=bench.liquid!(at[0],at[2])!;return{depth:water.level-at[1],clearance:at[1]-bench.ground!(at[0],at[2])}})
 expect(swimming.depth).toBeLessThan(1.8);expect(swimming.clearance).toBeGreaterThan(.1)
 await testInfo.attach('river-geometry',{body:JSON.stringify({bank:at,actual}),contentType:'application/json'})
 expect(errors).toEqual([])
})
