import { smoothstep } from './worldNoise.ts'
import { waterHeightAt, waterMesh, type WaterMesh, type WorldMacro } from './worldMacro.ts'

type ChannelGrid=Pick<WorldMacro,'cell'|'points'|'origin'> & Partial<Pick<WorldMacro,'water'|'river'|'channels'>>
const channelIndices=new WeakMap<Float32Array,Map<string,number[]>>()
function channelCandidates(segments:Float32Array,x:number,z:number):number[] {
  let index=channelIndices.get(segments)
  if(!index){
    index=new Map();channelIndices.set(segments,index)
    for(let i=0;i<segments.length;i+=8){
      const reach=segments[i+6]*1.5
      for(let z=Math.floor((Math.min(segments[i+1],segments[i+4])-reach)/16);z<=Math.floor((Math.max(segments[i+1],segments[i+4])+reach)/16);z++)for(let x=Math.floor((Math.min(segments[i],segments[i+3])-reach)/16);x<=Math.floor((Math.max(segments[i],segments[i+3])+reach)/16);x++){
        const key=`${x}:${z}`;let list=index.get(key);if(!list){list=[];index.set(key,list)}list.push(i)
      }
    }
  }
  return index.get(`${Math.floor(x/16)}:${Math.floor(z/16)}`)??[]
}
interface ChannelProfile {level:number;strength:number;ratio?:number;depth?:number}
function waterDatum(grid:ChannelGrid,x:number,z:number):{level:number;coverage:number}|null {
  if(!grid.water)return null
  const [nx,nz]=grid.points,u=(x-grid.origin[0])/grid.cell,v=(z-grid.origin[1])/grid.cell,i=Math.min(nx-2,Math.floor(u)),j=Math.min(nz-2,Math.floor(v))
  if(u<0||v<0||u>nx-1||v>nz-1)return null
  const fx=u-i,fz=v-j,weights=[(1-fx)*(1-fz),fx*(1-fz),(1-fx)*fz,fx*fz],ids=[j*nx+i,j*nx+i+1,(j+1)*nx+i,(j+1)*nx+i+1]
  let level=0,coverage=0
  for(let p=0;p<4;p++)if(Number.isFinite(grid.water[ids[p]])){level+=grid.water[ids[p]]*weights[p];coverage+=weights[p]}
  if(coverage>1e-8)return{level:level/coverage,coverage}
  let nearest=Infinity,edge:number|null=null
  for(let dz=-1;dz<=2;dz++)for(let dx=-1;dx<=2;dx++){
    const gx=i+dx,gz=j+dz;if(gx<0||gz<0||gx>=nx||gz>=nz)continue
    const value=grid.water[gz*nx+gx],distance=(u-gx)**2+(v-gz)**2
    if(Number.isFinite(value)&&distance<nearest){nearest=distance;edge=value}
  }
  return edge===null?null:{level:edge,coverage:0}
}
/** Continuous river profile: dry neighbours contribute no water datum, rather than smearing NaNs or flattening the valley. */
export function channelAt(grid:ChannelGrid,x:number,z:number):ChannelProfile|null {
  if(grid.channels?.length){
    const segments=grid.channels;let nearest=Infinity,found:ChannelProfile|null=null
    for(const i of channelCandidates(segments,x,z)){
      const ax=segments[i],az=segments[i+1],dx=segments[i+3]-ax,dz=segments[i+4]-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1))),ratio=Math.hypot(x-ax-dx*t,z-az-dz*t)/segments[i+6]
      if(ratio>=1.5||ratio>=nearest)continue
      nearest=ratio;found={level:segments[i+2]+(segments[i+5]-segments[i+2])*t,strength:1-smoothstep(.65,1.5,ratio),ratio,depth:segments[i+7]}
    }
    return found
  }
  if(!grid.water||!grid.river)return null
  const [nx,nz]=grid.points,u=(x-grid.origin[0])/grid.cell,v=(z-grid.origin[1])/grid.cell,i=Math.floor(u),j=Math.floor(v)
  if(i<0||j<0||i>=nx-1||j>=nz-1)return null
  const fx=u-i,fz=v-j,k=j*nx+i,ids=[k,k+1,k+nx,k+nx+1],weights=[(1-fx)*(1-fz),fx*(1-fz),(1-fx)*fz,fx*fz]
  let level=0,coverage=0,river=0
  for(let p=0;p<4;p++){river+=grid.river[ids[p]]*weights[p];if(Number.isFinite(grid.water[ids[p]])){level+=grid.water[ids[p]]*weights[p];coverage+=weights[p]}}
  if(coverage<.05||river<=.15)return null
  return{level:level/coverage,strength:smoothstep(.15,.65,river)}
}
export function carveChannel(height:number,profile:ReturnType<typeof channelAt>):number {
  if(!profile)return height
  if(profile.ratio!==undefined){
    const u=profile.ratio,target=profile.level-profile.depth!*(1-Math.min(1,u*u))
    return u<=1?target:target+(height-target)*smoothstep(1,1.5,u)
  }
  const target=profile.level-(.45+profile.strength*1.55)
  return height+(Math.min(height,target)-height)*profile.strength
}

/** Sparse one-metre water patches: refine wet cells only, with a triangle index shared by rendering and swimming. */
export function detailedWaterMesh(macro:WorldMacro,heightAt:(x:number,z:number)=>number):WaterMesh {
  const channels=!!macro.channels?.length,water=channels?macro.water.map((value,index)=>macro.lake?.[index]?value:NaN):macro.water
  const lakeGrid={...macro,water},coarse=waterMesh(lakeGrid,heightAt),[nx,nz]=macro.points
  if(!coarse.indices.length&&!channels)return coarse
  const steps=Math.max(1,Math.round(macro.cell)),fineWidth=(nx-1)*steps+1,positions:number[]=[],indices:number[]=[]
  const vertices=new Map<number,number>(),edges=new Map<string,number>(),cellOffsets=new Uint32Array((nx-1)*(nz-1)+1)
  interface Point {key:number;x:number;y:number;z:number;depth:number}
  const vertex=(point:Point)=>{let index=vertices.get(point.key);if(index===undefined){index=positions.length/3;positions.push(point.x,point.y,point.z);vertices.set(point.key,index)}return index}
  const triangle=(points:Point[])=>{
    const polygon:number[]=[]
    for(let p=0;p<3;p++){
      const a=points[p],b=points[(p+1)%3]
      if(a.depth>0)polygon.push(vertex(a))
      if((a.depth>0)===(b.depth>0))continue
      const key=a.key<b.key?`${a.key}:${b.key}`:`${b.key}:${a.key}`
      let index=edges.get(key)
      if(index===undefined){const t=a.depth/(a.depth-b.depth);index=positions.length/3;positions.push(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);edges.set(key,index)}
      polygon.push(index)
    }
    for(let p=1;p+1<polygon.length;p++)indices.push(polygon[0],polygon[p],polygon[p+1])
  }
  for(let j=0;j<nz-1;j++)for(let i=0;i<nx-1;i++){
    const cell=j*(nx-1)+i,k=j*nx+i;cellOffsets[cell]=indices.length
    const ids=[k,k+1,k+nx+1,k+nx]
    const nearChannel=channels&&channelCandidates(macro.channels!,macro.origin[0]+(i+.5)*macro.cell,macro.origin[1]+(j+.5)*macro.cell).length>0
    if(!nearChannel&&!ids.some(index=>Number.isFinite(water[index])))continue
    const read=(field:Float32Array,x:number,z:number)=>x>=z?field[ids[0]]+x*(field[ids[1]]-field[ids[0]])+z*(field[ids[2]]-field[ids[1]]):field[ids[0]]+x*(field[ids[2]]-field[ids[3]])+z*(field[ids[3]]-field[ids[0]])
    const samples=new Map<number,Point>()
    const at=(x:number,z:number):Point=>{
      const key=(j*steps+z)*fineWidth+i*steps+x,known=samples.get(key);if(known)return known
      const wx=macro.origin[0]+(i+x/steps)*macro.cell,wz=macro.origin[1]+(j+z/steps)*macro.cell,bed=heightAt(wx,wz),level=read(coarse.levels,x/steps,z/steps)
      // Ownership is per world vertex, not per coarse cell: lake/river neighbours must share the same edge height.
      const datum=waterDatum(lakeGrid,wx,wz),channel=channels?channelAt(macro,wx,wz):null
      // A river has one continuous water datum and a bed beneath it. Do not
      // drape its surface over relief or cut it with an unrelated coarse mask.
      const lakeWet=datum&&datum.coverage>.02,riverWet=channel?.ratio!==undefined&&channel.ratio<=1
      const y=lakeWet?datum.level:channel?.level??datum?.level??(Number.isFinite(level)?level:bed),depth=Math.min(y-bed,lakeWet||riverWet||!channels&&datum&&datum.coverage>.02?Infinity:-.02)
      const point={key,x:wx,y,z:wz,depth};samples.set(key,point);return point
    }
    // Flat, fully supported interiors need two triangles, not 128. Inspect the fine floor before coarsening;
    // shorelines and locally capped river profiles retain the one-metre patches.
    let coarseEnough=!!coarse.triangles?.[cell*2]&&!!coarse.triangles?.[cell*2+1]&&ids.every(index=>coarse.depths![index]>.05)
    if(coarseEnough)outer:for(let z=0;z<=steps;z++)for(let x=0;x<=steps;x++){
      const sample=at(x,z)
      if(sample.depth<=.05||Math.abs(sample.y-read(coarse.levels,x/steps,z/steps))>1e-5){coarseEnough=false;break outer}
    }
    if(coarseEnough){const a=at(0,0),b=at(steps,0),c=at(steps,steps),d=at(0,steps);triangle([a,c,b]);triangle([a,d,c]);continue}
    for(let z=0;z<steps;z++)for(let x=0;x<steps;x++){
      const a=at(x,z),b=at(x+1,z),c=at(x+1,z+1),d=at(x,z+1)
      triangle([a,c,b]);triangle([a,d,c])
    }
  }
  cellOffsets[cellOffsets.length-1]=indices.length
  const packedPositions=new Float32Array(positions),packedIndices=new Uint32Array(indices),normals=new Float32Array(positions.length)
  for(let t=0;t<packedIndices.length;t+=3){
    const a=packedIndices[t]*3,b=packedIndices[t+1]*3,c=packedIndices[t+2]*3
    const ux=packedPositions[c]-packedPositions[b],uy=packedPositions[c+1]-packedPositions[b+1],uz=packedPositions[c+2]-packedPositions[b+2]
    const vx=packedPositions[a]-packedPositions[b],vy=packedPositions[a+1]-packedPositions[b+1],vz=packedPositions[a+2]-packedPositions[b+2]
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx
    for(const index of[a,b,c]){normals[index]+=x;normals[index+1]+=y;normals[index+2]+=z}
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);if(length>1e-10){normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length}else normals[i+1]=1}
  const groups=new Map<string,{indices:number[];min:[number,number,number];max:[number,number,number]}>()
  for(let j=0;j<nz-1;j++)for(let i=0;i<nx-1;i++){
    const cell=j*(nx-1)+i,from=cellOffsets[cell],to=cellOffsets[cell+1];if(from===to)continue
    const key=`${Math.floor(i/8)}:${Math.floor(j/8)}`
    let group=groups.get(key);if(!group){group={indices:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};groups.set(key,group)}
    for(let k=from;k<to;k++){const index=packedIndices[k];group.indices.push(index);for(let axis=0;axis<3;axis++){const value=packedPositions[index*3+axis];group.min[axis]=Math.min(group.min[axis],value);group.max[axis]=Math.max(group.max[axis],value)}}
  }
  const patches=[...groups].map(([key,group])=>({key,indices:new Uint32Array(group.indices),min:group.min,max:group.max}))
  return{...coarse,positions:packedPositions,indices:packedIndices,cellOffsets,normals,patches}
}

/** Read precisely the triangles drawn in the current coarse cell, including clipped banks and local cascades. */
export function waterMeshHeightAt(mesh:WaterMesh,grid:Pick<WorldMacro,'cell'|'points'|'origin'>,x:number,z:number):number|null {
  if(!mesh.cellOffsets)return waterHeightAt(mesh.levels,grid,x,z,mesh.triangles,mesh.depths)
  const i=Math.floor((x-grid.origin[0])/grid.cell),j=Math.floor((z-grid.origin[1])/grid.cell),[nx,nz]=grid.points
  if(i<0||j<0||i>=nx-1||j>=nz-1)return null
  const cell=j*(nx-1)+i,p=mesh.positions
  for(let t=mesh.cellOffsets[cell];t<mesh.cellOffsets[cell+1];t+=3){
    const a=mesh.indices[t]*3,b=mesh.indices[t+1]*3,c=mesh.indices[t+2]*3
    const den=(p[b+2]-p[c+2])*(p[a]-p[c])+(p[c]-p[b])*(p[a+2]-p[c+2]);if(Math.abs(den)<1e-10)continue
    const u=((p[b+2]-p[c+2])*(x-p[c])+(p[c]-p[b])*(z-p[c+2]))/den,v=((p[c+2]-p[a+2])*(x-p[c])+(p[a]-p[c])*(z-p[c+2]))/den
    if(u>=-1e-5&&v>=-1e-5&&u+v<=1.00001)return u*p[a+1]+v*p[b+1]+(1-u-v)*p[c+1]
  }
  return null
}
