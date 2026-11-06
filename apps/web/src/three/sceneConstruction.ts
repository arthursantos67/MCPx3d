import { createEmptyScene, createNode, validateMaterial, validateScene, type Vector3Tuple } from './sceneDocument.ts'
import { prefabParts, type PrefabSpec } from './scenePrefabs.ts'
import type { PlacedStructure } from './sceneLoadout.ts'
import * as THREE from 'three'

export function constructionScene(kind: PlacedStructure['kind']) {
  if(kind==='workbench')return validateScene({...createEmptyScene(),nodes:[
    {...createNode('box'),id:'top',name:'Tampo da bancada',position:[0,.88,0],dimensions:[1.5,.16,.8],material:validateMaterial({color:'#986a43',texture:'wood',roughness:.9,metalness:0})},
    ...[-1,1].flatMap(x=>[-1,1].map(z=>({...createNode('box'),id:`leg${x}${z}`,name:'Pé da bancada',position:[x*.58,.4,z*.28],dimensions:[.13,.8,.13],material:validateMaterial({color:'#65442e',roughness:.95,metalness:0})}))),
    {...createNode('box'),id:'shelf',name:'Prateleira',position:[0,.23,0],dimensions:[1.26,.1,.65],material:validateMaterial({color:'#765337',texture:'wood',roughness:.9,metalness:0})},
  ]})
  const spec: PrefabSpec = { type: kind, size: 1, seed: 23, primary: null, secondary: null, text: '', lit: true, interactive: false }
  const parts = prefabParts(spec).filter(part => part.kind !== 'light'), ids = new Set(parts.map(part => part.id))
  return validateScene({ ...createEmptyScene(), nodes: parts.map(part => ({ ...createNode(part.kind), id: part.id, parentId: part.parentId && ids.has(part.parentId) ? part.parentId : null,
    name: part.name, position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions, collidable: part.collidable ?? true,
    material: validateMaterial({ color: '#ad8b5d', roughness: 0.8, metalness: 0, ...part.material }), geometry: { ...createNode(part.kind).geometry, ...part.geometry } })) })
}
export function workbenchFootprint(yaw:number):[number,number][] {
  return [-1,1].flatMap(x=>[-1,1].map(z=>[x*.58*Math.cos(yaw)+z*.28*Math.sin(yaw),-x*.58*Math.sin(yaw)+z*.28*Math.cos(yaw)] as [number,number]))
}
export function workbenchLeg(ground:number,base:number):{height:number;center:number} {
  const bottom=ground-base,top=.8
  return {height:Math.max(.1,top-bottom),center:(top+bottom)/2}
}
export function fitWorkbenchSupport(root:THREE.Object3D,holders:ReadonlyMap<string,THREE.Object3D>,heightAt:(x:number,z:number)=>number|null):void {
  root.traverse(object=>{object.matrixWorldAutoUpdate=true})
  const feet=workbenchFootprint(root.rotation.y);let i=0
  for(const x of[-1,1])for(const z of[-1,1]){
    const leg=holders.get(`leg${x}${z}`),foot=feet[i++],height=heightAt(root.position.x+foot[0],root.position.z+foot[1])
    if(!leg||height==null)continue
    const fit=workbenchLeg(height,root.position.y)
    leg.position.y=fit.center;leg.scale.y=fit.height/.8;leg.updateMatrix()
  }
  root.updateMatrixWorld(true)
}
export function placementSupport(position: Vector3Tuple, radius: number, heightAt: (x: number, z: number) => number | null, waterAt: (x: number, z: number) => number | null,footprint?:[number,number][]): { valid: boolean; reason: string; height: number } {
  const [x, , z] = position, heights: number[] = []
  for (const [dx, dz] of footprint??[[0, 0], [-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius]]) {
    const h = heightAt(x + dx, z + dz), water = waterAt(x + dx, z + dz)
    if (h === null || !Number.isFinite(h)) return { valid: false, reason: 'Não há apoio neste local', height: 0 }
    if (water !== null && water > h + 0.05) return { valid: false, reason: 'Escolha um local fora da água', height: h }
    heights.push(h)
  }
  const low = Math.min(...heights), high = Math.max(...heights)
  return { valid: high - low <= 0.45, reason: high - low > 0.45 ? 'O terreno está muito inclinado' : '', height: high }
}
