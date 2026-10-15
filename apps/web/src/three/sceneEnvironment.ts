import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Sky } from 'three/addons/objects/Sky.js'
import type { SceneEnvironment, SkyPreset } from './sceneDocument.ts'
import { hashNoise } from './sceneGeometrySpec.ts'

const atmosphere: Record<Exclude<SkyPreset, 'studio' | 'night' | 'space'>, { turbidity: number; rayleigh: number; mie: number; g: number; clouds: number; density: number; fog: string; sky: string; ground: string; sun: string }> = {
  day: { turbidity: 2.5, rayleigh: 1.2, mie: 0.005, g: 0.8, clouds: 0.35, density: 0.4, fog: '#c6d8ea', sky: '#bcd6f5', ground: '#6d5c47', sun: '#fff3e2' },
  sunset: { turbidity: 5, rayleigh: 2.2, mie: 0.005, g: 0.82, clouds: 0.45, density: 0.5, fog: '#e2a98a', sky: '#f2b48e', ground: '#4c3a3a', sun: '#ffb070' },
  overcast: { turbidity: 10, rayleigh: 3, mie: 0.01, g: 0.7, clouds: 0.95, density: 0.85, fog: '#b6bec6', sky: '#cfd6dd', ground: '#5d6064', sun: '#e9eef3' },
}
/** The physical sky is calibrated for exposure 0.5. Halving and clamping its radiance keeps it consistent with studio lighting; directions below the horizon reuse the horizon color instead of black. */
function createSky(): Sky {
  const sky = new Sky()
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('vec3 direction = normalize( vWorldPosition - cameraPosition );', 'vec3 direction = normalize( vWorldPosition - cameraPosition ); direction = normalize( vec3( direction.x, max( direction.y, 0.02 ), direction.z ) );')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * 0.5, vec3( 6.0 ) ), 1.0 );')
  sky.material.fog = false
  return sky
}
export const SKY_LAYER = 2
export const toneMappings = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }
export function sunDirection(env: SceneEnvironment): THREE.Vector3 {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - (env.sunElevation ?? 38)), THREE.MathUtils.degToRad(env.sunAzimuth ?? 35))
}

export interface EnvironmentRig {
  /** True when the procedural sky is drawn in its own pass, after bloom and behind scene depth. */
  skyVisible: () => boolean
  sun: THREE.DirectionalLight
  hemisphere: THREE.HemisphereLight
  /** Applies the preset and returns the effective tone-mapping exposure. */
  apply: (env: SceneEnvironment) => number
  frame: (center: THREE.Vector3, radius: number) => void
  follow: (camera: THREE.Camera) => void
  dispose: () => void
}
/** Studio, procedural sky and starfield presets; reflections come from the same sky through PMREM. */
export function createEnvironmentRig(renderer: THREE.WebGLRenderer, scene: THREE.Scene): EnvironmentRig {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const studio = pmrem.fromScene(room, 0.04)
  room.dispose()
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#657583', 2)
  const sun = new THREE.DirectionalLight('#fff1dd', 3)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.normalBias = 0.025
  sun.shadow.bias = -0.0001
  sun.shadow.radius = 3
  scene.add(hemisphere, sun, sun.target)
  const sky = createSky()
  sky.layers.set(SKY_LAYER)
  sky.visible = false
  scene.add(sky)
  const starPositions: number[] = []
  for (let i = 0; i < 2600; i++) {
    const u = hashNoise(i, 1, 7) * 2 - 1, theta = hashNoise(i, 2, 7) * Math.PI * 2, r = Math.sqrt(1 - u * u)
    starPositions.push(r * Math.cos(theta), Math.abs(u) * (i % 5 ? 1 : -1), r * Math.sin(theta))
  }
  const starGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false }))
  stars.visible = false
  stars.frustumCulled = false
  scene.add(stars)
  let skyTarget: THREE.WebGLRenderTarget | null = null, skyKey = '', direction = new THREE.Vector3(1, 2, 1.5).normalize()
  const skyEnvironment = (env: SceneEnvironment, preset: keyof typeof atmosphere) => {
    const key = `${preset}:${env.sunElevation}:${env.sunAzimuth}`
    if (key !== skyKey) {
      const capture = createSky(), uniforms = capture.material.uniforms, settings = atmosphere[preset]
      capture.scale.setScalar(50)
      uniforms.turbidity.value = settings.turbidity; uniforms.rayleigh.value = settings.rayleigh; uniforms.mieCoefficient.value = settings.mie; uniforms.mieDirectionalG.value = settings.g
      uniforms.cloudCoverage.value = settings.clouds; uniforms.cloudDensity.value = settings.density; uniforms.showSunDisc.value = 0
      uniforms.sunPosition.value.copy(sunDirection(env))
      const captureScene = new THREE.Scene().add(capture)
      skyTarget?.dispose()
      skyTarget = pmrem.fromScene(captureScene, 0, 0.1, 100)
      capture.geometry.dispose(); capture.material.dispose()
      skyKey = key
    }
    return skyTarget!.texture
  }
  return {
    sun, hemisphere, skyVisible: () => sky.visible,
    apply(env) {
      const preset = env.sky ?? 'studio', strength = env.lightIntensity
      direction = sunDirection(env)
      renderer.toneMapping = toneMappings[env.toneMapping ?? 'aces']
      renderer.toneMappingExposure = env.exposure
      sky.visible = preset in atmosphere
      stars.visible = preset === 'night' || preset === 'space'
      let fog = env.background
      if (preset in atmosphere) {
        const settings = atmosphere[preset as keyof typeof atmosphere], uniforms = sky.material.uniforms
        uniforms.turbidity.value = settings.turbidity; uniforms.rayleigh.value = settings.rayleigh; uniforms.mieCoefficient.value = settings.mie; uniforms.mieDirectionalG.value = settings.g
        uniforms.cloudCoverage.value = settings.clouds; uniforms.cloudDensity.value = settings.density
        uniforms.sunPosition.value.copy(direction)
        scene.background = null
        scene.environment = env.reflections ? skyEnvironment(env, preset as keyof typeof atmosphere) : null
        scene.environmentIntensity = 0.6
        hemisphere.color.set(settings.sky); hemisphere.groundColor.set(settings.ground); sun.color.set(settings.sun)
        const daylight = THREE.MathUtils.clamp((env.sunElevation ?? 38) / 25, 0.08, 1)
        hemisphere.intensity = strength * (preset === 'overcast' ? 1.1 : 0.6)
        sun.intensity = strength * (preset === 'overcast' ? 0.7 : 2.2) * daylight
        fog = settings.fog
      } else if (preset === 'night' || preset === 'space') {
        scene.background = new THREE.Color(preset === 'night' ? '#070d1c' : '#020308')
        scene.environment = env.reflections ? studio.texture : null
        scene.environmentIntensity = preset === 'night' ? 0.12 : 0.3
        hemisphere.color.set(preset === 'night' ? '#4a5f8f' : '#8090b0'); hemisphere.groundColor.set('#0b0f18')
        hemisphere.intensity = strength * (preset === 'night' ? 0.25 : 0.15)
        sun.color.set(preset === 'night' ? '#b8c8ff' : '#ffffff')
        sun.intensity = strength * (preset === 'night' ? 0.35 : 2.6)
        fog = preset === 'night' ? '#0b1322' : '#020308'
      } else {
        scene.background = new THREE.Color(env.background)
        scene.environment = env.reflections ? studio.texture : null
        scene.environmentIntensity = 1
        hemisphere.color.set('#ffffff'); hemisphere.groundColor.set('#657583'); sun.color.set('#fff1dd')
        hemisphere.intensity = strength
        sun.intensity = strength * 2
      }
      scene.fog = env.fog && preset !== 'space' ? new THREE.FogExp2(fog, env.fog) : null
      sun.castShadow = env.shadows ?? true
      return renderer.toneMappingExposure
    },
    frame(center, radius) {
      // Snap the shadow projection in light space to avoid crawling texels while walking.
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize()
      if (right.lengthSq()<0.5) right.set(1,0,0)
      const up = new THREE.Vector3().crossVectors(direction,right).normalize(), texel=radius*2/sun.shadow.mapSize.x
      const focus=center.clone().addScaledVector(right,Math.round(center.dot(right)/texel)*texel-center.dot(right))
        .addScaledVector(up,Math.round(center.dot(up)/texel)*texel-center.dot(up))
      sun.position.copy(focus).addScaledVector(direction, radius * 2.5)
      sun.target.position.copy(focus)
      Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 6 })
      sun.shadow.camera.updateProjectionMatrix()
    },
    follow(camera) {
      const far = camera instanceof THREE.PerspectiveCamera ? camera.far : 1000
      sky.position.copy(camera.position); sky.scale.setScalar(far * 0.5)
      stars.position.copy(camera.position); stars.scale.setScalar(far * 0.45)
    },
    dispose() {
      studio.dispose(); skyTarget?.dispose(); pmrem.dispose()
      sky.geometry.dispose(); sky.material.dispose(); starGeometry.dispose(); stars.material.dispose()
      scene.remove(hemisphere, sun, sun.target, sky, stars)
    },
  }
}
