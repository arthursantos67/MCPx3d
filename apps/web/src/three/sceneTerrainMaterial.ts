import * as THREE from 'three'
import type { SceneNode } from './sceneDocument.ts'
import type { SurfaceTextureKind } from './sceneTextures.ts'

type LayerTexture = (kind:SurfaceTextureKind,channel:'map'|'normal'|'rough')=>THREE.Texture

/** Standard glTF has one normal/albedo layer; preserve its physical detail scale as a fallback. */
export function terrainGeometryForExport(source:THREE.BufferGeometry,metresPerTile:number):THREE.BufferGeometry {
  const geometry=source.clone(),physical=source.getAttribute('terrainUv')
  if(physical) {
    const uv=new Float32Array(physical.count*2)
    for(let i=0;i<physical.count;i++){uv[i*2]=physical.getX(i)/metresPerTile;uv[i*2+1]=physical.getY(i)/metresPerTile}
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2))
  }
  geometry.deleteAttribute('terrainUv');geometry.deleteAttribute('terrainLayers')
  return geometry
}

/** Explicit artistic materials/images keep their own shading; natural biomes get ground layers. */
export function usesTerrainLayers(node:SceneNode):boolean {
  return node.kind==='terrain' && !!node.geometry.biome && node.geometry.biome!=='none' && !node.material.textureImage
    && (!node.material.texture || ['none','grass','rock','sand','leaves'].includes(node.material.texture))
}

/** Metre-based UVs prevent a larger map from stretching the same grass patch over the whole valley. */
export function prepareTerrainLayers(node:SceneNode,parameters:THREE.MeshPhysicalMaterialParameters,texture:LayerTexture): (material:THREE.MeshPhysicalMaterial)=>void {
  const biome=node.geometry.biome, base=biome==='desert'||biome==='lunar'?'groundSand':biome==='volcanic'?'groundRock':biome==='snow'?'groundSnow':'groundGrass'
  const peak=biome==='alpine'||biome==='snow'?'groundSnow':biome==='desert'||biome==='tropical'?'groundSand':'groundRock'
  const map=texture(base,'map'), normal=texture(base,'normal'), rough=texture(base,'rough')
  const rockMap=texture('groundRock','map'),rockNormal=texture('groundRock','normal'),peakMap=texture(peak,'map'),peakNormal=texture(peak,'normal')
  parameters.map=map;parameters.normalMap=normal;parameters.roughnessMap=rough
  parameters.normalScale=new THREE.Vector2((node.material.normalStrength??1)*0.65,(node.material.normalStrength??1)*0.65)
  const frequency=0.5*THREE.MathUtils.clamp(Math.sqrt((node.material.textureScale??8)/8),0.5,2.8)
  return material=>{
    material.userData.terrainTextures=[map,normal,rough,rockMap,rockNormal,peakMap,peakNormal]
    material.userData.terrainLayering={biome,metresPerTile:1/frequency}
    material.customProgramCacheKey=()=>`terrain-layers-v2:${biome}`
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{terrainRockMap:{value:rockMap},terrainRockNormal:{value:rockNormal},terrainPeakMap:{value:peakMap},terrainPeakNormal:{value:peakNormal},terrainFrequency:{value:frequency}})
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec2 terrainLayers;
attribute vec2 terrainUv;
varying vec2 vTerrainUv;
varying vec2 vTerrainLayers;`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
vTerrainUv=terrainUv;
vTerrainLayers=terrainLayers;`)
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform sampler2D terrainRockMap;
uniform sampler2D terrainRockNormal;
uniform sampler2D terrainPeakMap;
uniform sampler2D terrainPeakNormal;
uniform float terrainFrequency;
varying vec2 vTerrainUv;
varying vec2 vTerrainLayers;`)
        .replace('#include <map_fragment>',`
vec2 groundUv=vTerrainUv*terrainFrequency;
vec2 groundLayers=clamp(vTerrainLayers,0.0,1.0);
vec3 groundColor=mix(texture2D(map,groundUv).rgb,texture2D(terrainRockMap,groundUv*0.73).rgb,groundLayers.x);
groundColor=mix(groundColor,texture2D(terrainPeakMap,groundUv*0.86).rgb,groundLayers.y);
// Macro colours come from the biome; albedo adds fine fibres, grains and fissures.
float groundMicro=texture2D(map,groundUv*5.73+vec2(0.31,0.57)).g;
diffuseColor.rgb*=clamp(vec3(0.66)+groundColor*0.53+groundMicro*0.1,vec3(0.66),vec3(1.24));`)
        .replace('#include <normal_fragment_maps>',`
vec3 groundN=texture2D(normalMap,groundUv).xyz*2.0-1.0;
groundN=mix(groundN,texture2D(terrainRockNormal,groundUv*0.73).xyz*2.0-1.0,groundLayers.x);
groundN=mix(groundN,texture2D(terrainPeakNormal,groundUv*0.86).xyz*2.0-1.0,groundLayers.y);
groundN.xy*=normalScale;
mat3 groundTbn=tbn;
#ifndef USE_TANGENT
  groundTbn=getTangentFrame(-vViewPosition,normal,groundUv);
  #ifdef DOUBLE_SIDED
    groundTbn[0]*=faceDirection;
    groundTbn[1]*=faceDirection;
  #endif
#endif
normal=normalize(groundTbn*normalize(groundN));`)
        .replace('#include <roughnessmap_fragment>',`
float roughnessFactor=clamp(roughness*mix(texture2D(roughnessMap,groundUv).g,0.92,groundLayers.x),0.55,1.0);`)
    }
  }
}
