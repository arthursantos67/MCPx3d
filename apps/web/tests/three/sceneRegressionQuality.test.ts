import assert from 'node:assert/strict'
import {test} from 'node:test'
import * as THREE from 'three'
import {arrangeBagCells,CURSOR_SLOT,releaseBagCursor,syncBagCells} from '../../src/three/sceneInventory.ts'
import {constructionScene,fitWorkbenchSupport,placementSupport,workbenchFootprint,workbenchLeg} from '../../src/three/sceneConstruction.ts'
import {buildScene,createResources} from '../../src/three/sceneBuild.ts'
import {createEquipment,poseFirstPersonEquipment} from '../../src/three/sceneEquipment.ts'
import {createAnimator,updateAnimator} from '../../src/three/sceneCharacterAnimator.ts'
import {createLibraryWater} from '../../src/three/sceneLibraryWater.ts'

test('cursor half pickup, single deposit, swap and close conserve every item with an actually empty source',()=>{
  const items=new Map([['Wood',11],['Stone',3]]),move=(from:number,to:number,n:number)=>{cells=arrangeBagCells(cells,from,to,n).cells}
  let cells=syncBagCells([],items)
  move(0,CURSOR_SLOT,6);assert.equal(cells[0]!.amount,5);assert.equal(cells[CURSOR_SLOT]!.amount,6)
  move(CURSOR_SLOT,3,1);assert.equal(cells[CURSOR_SLOT]!.amount,5);assert.equal(cells[3]!.amount,1)
  move(CURSOR_SLOT,1,5);assert.equal(cells[1]!.item,'Wood');assert.equal(cells[CURSOR_SLOT]!.item,'Stone')
  cells=releaseBagCursor(cells);assert.equal(cells[CURSOR_SLOT],null)
  const totals=new Map<string,number>();for(const cell of cells)if(cell)totals.set(cell.item,(totals.get(cell.item)??0)+cell.amount)
  assert.deepEqual(totals,items)
})

test('each workbench foot reaches sloping ground after rotation while its top stays level',()=>{
  const heightAt=(x:number,z:number)=>.18*x+.12*z
  for(const yaw of[0,.6,Math.PI/2,Math.PI]){
    const feet=workbenchFootprint(yaw),base=placementSupport([3,0,4],.75,heightAt,()=>null,feet)
    assert.ok(base.valid)
    for(const [x,z]of feet){const h=heightAt(3+x,4+z),fit=workbenchLeg(h,base.height);assert.ok(Math.abs(base.height+fit.center-fit.height/2-h)<1e-9);assert.ok(Math.abs(fit.center+fit.height/2-.8)<1e-9)}
  }
})

test('first person axe sweeps sideways at constant depth with its cutting edge pointing into the scene',()=>{
  const axe=createEquipment('axe'),animator=createAnimator('biped',0)
  updateAnimator(animator,{dt:0,time:0,speed:0,grounded:true,verticalSpeed:0,dead:false,talk:false,attack:'light',armed:true})
  assert.ok(animator.swing)
  animator.time=animator.swing.a;poseFirstPersonEquipment(axe,animator);const start=axe.object.position.clone()
  animator.time=animator.swing.a+animator.swing.s;poseFirstPersonEquipment(axe,animator)
  const delta=axe.object.position.clone().sub(start),edge=new THREE.Vector3(1,0,0).applyQuaternion(axe.object.quaternion)
  assert.ok(Math.abs(delta.x)>.45);assert.ok(Math.abs(delta.z)<.05);assert.ok(edge.z<-.3)
  axe.dispose()
})

test('frozen construction matrices are updated so the rendered feet actually meet the ground',()=>{
  const resources=createResources(1),built=buildScene(constructionScene('workbench'),resources,{helpers:false,instancing:false}),root=built.root,heightAt=(x:number,z:number)=>.15*x+.12*z
  root.position.set(3,0,4);root.rotation.y=.7
  root.position.y=placementSupport([3,0,4],.75,heightAt,()=>null,workbenchFootprint(.7)).height
  fitWorkbenchSupport(root,built.holders,heightAt)
  for(const x of[-1,1])for(const z of[-1,1]){
    const leg=built.holders.get(`leg${x}${z}`)!,center=leg.getWorldPosition(new THREE.Vector3()),bounds=new THREE.Box3().setFromObject(leg)
    assert.ok(Math.abs(bounds.min.y-heightAt(center.x,center.z))<1e-6)
  }
  built.dispose();resources.dispose()
})

test('library water uses bounded reflection targets and releases their framebuffers exactly once',()=>{
  const geometry=new THREE.PlaneGeometry(),normal=new THREE.Texture(),water=createLibraryWater(geometry,normal,20,2)
  assert.equal(water.object.userData.liquidLibrary,'three/Water2')
  let disposed=0
  for(const name of['tReflectionMap','tRefractionMap']){const target=(water.object.material.uniforms[name].value as THREE.Texture).renderTarget!;assert.equal(target.width,256);target.addEventListener('dispose',()=>disposed++)}
  water.dispose();water.dispose();assert.equal(disposed,2);geometry.dispose();normal.dispose()
})
