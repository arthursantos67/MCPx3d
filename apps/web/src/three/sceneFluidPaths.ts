import type {SceneNode,Vector3Tuple} from './sceneDocument.ts'
import {terrainHeightAt} from './sceneGeometrySpec.ts'

/** Fluid ribbons use the carved channel and clip their banks; road reprojection would bury them again. */
export function compileFluidPath(node:SceneNode,support:SceneNode):Pick<SceneNode,'geometry'|'position'|'dimensions'>|null {
  if(!node.path)return null
  const width=support.dimensions[0]*support.scale[0],depth=support.dimensions[2]*support.scale[2],height=support.dimensions[1]*support.scale[1]
  const floor=(x:number,z:number)=>{const u=(x-support.position[0])/width,v=(z-support.position[2])/depth;return Math.abs(u)>.5||Math.abs(v)>.5?null:support.position[1]+terrainHeightAt(support.geometry,u,v)*height}
  const vertices:number[]=[],indices:number[]=[],uvs:number[]=[]
  type Point={x:number;y:number;z:number;d:number}
  const triangle=(points:Point[])=>{
    const polygon:Point[]=[]
    for(let i=0;i<3;i++){const a=points[i],b=points[(i+1)%3];if(a.d>0)polygon.push(a);if((a.d>0)!==(b.d>0)){const t=a.d/(a.d-b.d);polygon.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,d:0})}}
    const offset=vertices.length/3;for(const p of polygon){vertices.push(p.x,p.y,p.z);uvs.push(p.x/2,p.z/2)}
    for(let i=1;i+1<polygon.length;i++)indices.push(offset,offset+i,offset+i+1)
  }
  // Use the terrain's own triangulation: a separate ribbon can bridge a sharp bed valley between its samples.
  const n=support.geometry.segments,points=node.path.points,half=node.path.width/2,cache=new Map<number,Point>()
  const at=(i:number,j:number):Point=>{
    const key=j*(n+1)+i,known=cache.get(key);if(known)return known
    const x=support.position[0]+(i/n-.5)*width,z=support.position[2]+(j/n-.5)*depth,bed=floor(x,z)??support.position[1]
    let nearest=Infinity,cx=x,cz=z
    for(let k=1;k<points.length;k++){const a=points[k-1],b=points[k],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1))),px=a[0]+dx*t,pz=a[1]+dz*t,distance=Math.hypot(x-px,z-pz);if(distance<nearest){nearest=distance;cx=px;cz=pz}}
    const y=Math.min((floor(cx,cz)??bed)+.65,bed+1.2),point={x,y,z,d:Math.min(y-bed,half-nearest)};cache.set(key,point);return point
  }
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);if(Math.max(a.d,b.d,c.d,d.d)<=0)continue;triangle([a,d,b]);triangle([b,d,c])}
  if(!indices.length)return null
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];vertices.forEach((value,i)=>{min[i%3]=Math.min(min[i%3],value);max[i%3]=Math.max(max[i%3],value)})
  return{geometry:{...node.geometry,vertices,indices,uvs,normals:[]},position:min.map((value,i)=>(value+max[i])/2) as Vector3Tuple,dimensions:min.map((value,i)=>Math.max(.01,max[i]-value)) as Vector3Tuple}
}
