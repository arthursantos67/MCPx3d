import kit from './data/crypt-kit.json' with { type:'json' }
import { isCharacterType } from './sceneCharacters.ts'
import { createNode, hasSurface, validateMaterial, validateScene, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'

/** KayKit Dungeon Remastered, CC0. Baked by the same GLB importer used by the editor. */
export function cryptKitNodes(model:keyof typeof kit.models,id:string,position:Vector3Tuple,rotation=0,scale:Vector3Tuple=[1,1,1]): SceneNode[] {
  return kit.models[model].nodes.map((part,index)=>{
    const base=createNode(part.kind as SceneNode['kind'])
    const node:SceneNode={...base,id:`${id}-${part.id}`,name:part.name,parentId:part.parentId?`${id}-${part.parentId}`:null,
      position:part.position as Vector3Tuple,rotation:part.rotation as Vector3Tuple,dimensions:part.dimensions as Vector3Tuple,scale:part.scale as Vector3Tuple}
    if(part.kind==='mesh'&&'geometry'in part&&'material'in part){node.geometry={...base.geometry,...part.geometry};node.material=validateMaterial({...base.material,...part.material,textureImage:kit.textureImage})}
    if(!index){node.position=position;node.rotation=[0,rotation,0];node.scale=scale;node.name=`KayKit · ${model}`}
    return node
  })
}

/** One coherent example: native stone modules, the same palette family as the imported characters, readable amber/cyan light. */
export function styleCrypt(scene:ThreeSceneDocument):ThreeSceneDocument {
  const nodes=scene.nodes
  // Fit the encounter to a room sized for the 1.75 m avatar. Prefab anatomy and weapon lengths retain their authored scale.
  for(const node of nodes)if(!node.parentId){node.position[0]*=.8;node.position[2]*=.75}
  const player=scene.environment.player!
  if(player.spawn){player.spawn[0]*=.8;player.spawn[2]*=.75}
  const byId=new Map(nodes.map(node=>[node.id,node]))
  const characterPart=(node:SceneNode):boolean=>!!(node.asset&&isCharacterType(node.asset.type))||!!(node.parentId&&byId.get(node.parentId)&&characterPart(byId.get(node.parentId)!))
  for(const node of nodes)if(hasSurface(node.kind)&&!characterPart(node)){
    node.material.texture='none';node.material.normalStrength=0;node.material.roughness=Math.max(.65,node.material.roughness)
    node.material.metalness=Math.min(.35,node.material.metalness);node.material.flatShading=true
  }
  for(const node of nodes)if(node.id==='crypt-floor'||/^crypt-(wall|end)/.test(node.id)){node.visible=false;node.collidable=false}
  const crenels=nodes.find(node=>node.id==='crypt-gate.battlement')
  if(crenels){crenels.visible=false;crenels.collidable=false}
  for(const side of [-1,1]){
    const divider=nodes.find(node=>node.id===`divider${side}`)
    if(divider){const gap=20-2*divider.dimensions[0]+.2,span=(16-gap)/2;divider.visible=false;divider.collidable=false;nodes.push(...cryptKitNodes('wall',`crypt-kit-divider-${side}`,[side*(gap/2+span/2),0,0],0,[span/4,1,.8]))}
    for(let row=0;row<8;row++)nodes.push(...cryptKitNodes(row%3===0?'wall_pillar':'wall',`crypt-kit-wall-${side}-${row}`,[side*8.5,0,-14+row*4],90))
    for(let column=0;column<4;column++)nodes.push(...cryptKitNodes('wall',`crypt-kit-end-${side}-${column}`,[-6+column*4,0,side*16.5]))
    for(const z of [-11,-5,5,11])nodes.push(...cryptKitNodes(z<0?'pillar_decorated':'pillar',`crypt-kit-pillar-${side}-${z}`,[side*6.4,0,z],side<0?90:-90,[.72,.85,.72]))
  }
  for(let x=0;x<4;x++)for(let z=0;z<8;z++)nodes.push(...cryptKitNodes('floor_tile_large',`crypt-kit-floor-${x}-${z}`,[-6+x*4,-.15,-14+z*4]))
  for(const [index,position]of [[-5.2,0,10],[-6.3,0,9],[5.2,0,-9],[6.4,0,-9]].entries())nodes.push(...cryptKitNodes('barrel_large',`crypt-kit-barrel-${index}`,position as Vector3Tuple,index*23,[.45,.45,.45]))
  const ceiling=(id:string,position:Vector3Tuple,dimensions:Vector3Tuple)=>({...createNode('box'),id,name:'Abóbada da cripta',position,dimensions,role:'structure' as const,material:{color:'#393c43',metalness:0,roughness:.92,flatShading:true}})
  for(const side of[-1,1]){
    nodes.push(ceiling(`crypt-roof-${side}`,[0,4.15,side*9],[17,.3,14]))
    nodes.push(ceiling(`crypt-vault-side-${side}`,[side*8.5,4.8125,0],[1,1.625,4]))
    nodes.push(ceiling(`crypt-vault-step-${side}`,[0,4.9625,side*2],[16,1.325,.3]))
  }
  nodes.push(ceiling('crypt-vault-roof',[0,5.8,0],[17,.35,4]))
  scene.environment.bloom=.18;scene.environment.grade='none';scene.environment.fog=.012
  scene.environment.background='#17202a';scene.environment.exposure=1.25
  return validateScene(scene)
}
