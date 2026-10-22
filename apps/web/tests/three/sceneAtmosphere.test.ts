import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, gradePresets, weatherKinds } from '../../src/three/sceneDocument.ts'
import { createWeather, createWeatherPass, weatherProfile, MAX_WEATHER_PARTICLES } from '../../src/three/sceneWeather.ts'
import { createGradingPass, gradeSettings } from '../../src/three/sceneGrading.ts'
import { animateWater, collectWaterMaterials, isWaterMaterial } from '../../src/three/sceneWater.ts'

test('weather profiles are finite, bounded and only rain uses streaks',()=>{
  for(const kind of weatherKinds){
    const p=weatherProfile(kind)
    for(const value of [p.count,p.area,p.height,p.fall,p.drift,p.size]) assert.ok(Number.isFinite(value),kind)
    assert.ok(p.count>=0&&p.count<=(kind==='rain'?6000:3000),kind)
    assert.ok(p.area>0&&p.area<=60&&p.height>0&&p.height<=40,kind)
    assert.ok(Math.abs(p.fall)<=15&&p.drift>=0&&p.drift<=2&&p.size>0&&p.size<=0.2,kind)
    assert.match(p.color,/^#[0-9a-f]{6}$/)
    assert.equal(p.streak,kind==='rain')
    assert.ok(p.count<=MAX_WEATHER_PARTICLES)
  }
  assert.equal(weatherProfile('none').count,0)
  assert.ok(weatherProfile('embers').fall<0&&weatherProfile('bubbles').fall<0&&weatherProfile('snow').fall>0)
  assert.ok(weatherProfile('embers').additive&&weatherProfile('fireflies').additive&&!weatherProfile('rain').additive)
})

test('weather builds headless, follows the camera and wraps its drift',()=>{
  const weather=createWeather(),env=createEmptyScene().environment,camera=new THREE.PerspectiveCamera(60,1,0.1,500)
  const mesh=weather.object as THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>
  assert.equal(mesh.frustumCulled,false);assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.fog,true)
  for(const kind of weatherKinds){
    weather.apply(kind,{...env,sky:'night'})
    assert.equal(mesh.geometry.instanceCount,weatherProfile(kind).count);assert.equal(mesh.visible,kind!=='none')
  }
  weather.apply('rain',{...env,sky:'day'})
  camera.position.set(120,4,-30);camera.updateMatrixWorld()
  const uniforms=mesh.material.uniforms
  for(let t=0;t<=20;t+=0.05) weather.update(camera,t,new THREE.Vector3(2,0,1))
  assert.deepEqual(uniforms.uCamera.value.toArray(),[120,4,-30])
  const offset=uniforms.uOffsetA.value as THREE.Vector3,p=weatherProfile('rain')
  assert.ok(offset.x>=0&&offset.x<p.area&&offset.y>=0&&offset.y<p.height&&offset.z>=0&&offset.z<p.area)
  assert.ok(uniforms.uVelocity.value.y<0)
  weather.apply('fireflies',{...env,sky:'night'})
  assert.equal(mesh.material.blending,THREE.AdditiveBlending);assert.ok(uniforms.uGlow.value>1)
  const scene=new THREE.Scene(),pass=createWeatherPass(weather,scene,camera)
  assert.equal(pass.needsSwap,false);assert.ok(weather.object.parent)
  weather.dispose();assert.equal(weather.object.parent,null)
})

test('grade presets stay bounded and none is the identity',()=>{
  for(const preset of gradePresets){
    const s=gradeSettings(preset)
    assert.ok(s.exposure>=0.8&&s.exposure<=1.25,preset);assert.ok(s.contrast>=0.7&&s.contrast<=1.5,preset);assert.ok(s.saturation>=0&&s.saturation<=1.6,preset)
    assert.ok(Math.abs(s.warmth)<=1&&Math.abs(s.tint)<=1&&s.vignette>=0&&s.vignette<=0.7&&s.grain>=0&&s.grain<=0.1,preset)
    for(const v of s.lift) assert.ok(v>=-0.05&&v<=0.12,preset)
    for(const v of s.gain) assert.ok(v>=0.8&&v<=1.2,preset)
  }
  assert.deepEqual(gradeSettings('none'),{exposure:1,contrast:1,saturation:1,warmth:0,tint:0,vignette:0,lift:[0,0,0],gain:[1,1,1],grain:0})
  assert.ok(gradeSettings('noir').saturation<0.2);assert.ok(gradeSettings('vivid').saturation>1.2)
  gradeSettings('warm').lift[0]=9;assert.notEqual(gradeSettings('warm').lift[0],9)
})

test('grading pass toggles with the preset and loads uniforms',()=>{
  const grading=createGradingPass(),u=(grading.pass as unknown as {uniforms:Record<string,THREE.IUniform>}).uniforms
  assert.equal(grading.pass.enabled,false)
  grading.apply('cinematic');assert.equal(grading.pass.enabled,true);assert.equal(u.contrast.value,1.15);assert.equal(u.gain.value.x,1.06)
  grading.setTime(12.5);assert.equal(u.time.value,12.5)
  grading.pass.setSize(1920,1080);assert.equal(u.resolution.value.x,1920)
  grading.apply('none');assert.equal(grading.pass.enabled,false)
  grading.dispose()
})

test('water animation drifts only flagged materials and is idempotent per time',()=>{
  const texture=()=>{const t=new THREE.Texture();t.offset.set(0.1,0.2);return t}
  const water=new THREE.MeshPhysicalMaterial({map:texture(),normalMap:texture(),roughnessMap:texture(),normalScale:new THREE.Vector2(0.8,0.8)})
  water.userData.water=true
  const other=new THREE.MeshPhysicalMaterial({normalMap:texture()})
  assert.ok(isWaterMaterial(water));assert.ok(!isWaterMaterial(other))
  const root=new THREE.Group().add(new THREE.Mesh(new THREE.PlaneGeometry(),water),new THREE.Mesh(new THREE.PlaneGeometry(),other))
  assert.deepEqual(collectWaterMaterials(root),[water])
  animateWater([water,other],0)
  const start=water.normalMap!.offset.clone()
  assert.deepEqual(start.toArray(),[0.1,0.2])
  animateWater([water,other],10)
  const later=water.normalMap!.offset.clone()
  assert.ok(later.distanceTo(start)>0.1)
  assert.notDeepEqual(water.roughnessMap!.offset.toArray(),[0.1,0.2])
  assert.notEqual(water.normalScale.x,0.8)
  assert.deepEqual(other.normalMap!.offset.toArray(),[0.1,0.2])
  animateWater([water],10);assert.deepEqual(water.normalMap!.offset.toArray(),later.toArray())
  animateWater([water],0);assert.deepEqual(water.normalMap!.offset.toArray(),[0.1,0.2]);assert.ok(Math.abs(water.normalScale.x-0.8)<1e-9)
})
