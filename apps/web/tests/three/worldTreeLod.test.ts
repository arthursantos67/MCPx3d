import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { distantTreeParts } from '../../src/three/world/worldTreeLod.ts'
import { buildScene,createResources } from '../../src/three/sceneBuild.ts'
import { createEmptyScene,createNode,validateScene } from '../../src/three/sceneDocument.ts'

test('distant trees have rooted 3D geometry with a small triangle budget for every species',()=>{
  for(const type of ['tree','pine','palm'] as const){
    const parts=distantTreeParts({type,size:1,seed:3,primary:null,secondary:null,text:'',lit:false,interactive:false})
    const nodes=parts.map(part=>({...createNode(part.kind),...part,id:part.id}))
    const resources=createResources(),built=buildScene(validateScene({...createEmptyScene(),nodes}),resources,{helpers:false,instancing:false})
    built.root.updateMatrixWorld(true)
    let triangles=0
    built.root.traverse(object=>{if(object instanceof THREE.Mesh)triangles+=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3})
    const bounds=new THREE.Box3().setFromObject(built.root),size=bounds.getSize(new THREE.Vector3())
    assert.ok(Math.abs(bounds.min.y)<1e-5,`${type} grounded`)
    assert.ok(size.y>5&&size.z>2&&size.x>2,`${type} volumetric`)
    assert.ok(triangles<=240,`${type}: ${triangles} triangles`)
    built.dispose();resources.dispose()
  }
})
