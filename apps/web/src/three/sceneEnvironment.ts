import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Sky } from 'three/addons/objects/Sky.js'
import type { SceneEnvironment, SkyPreset } from './sceneDocument.ts'
import { hashNoise } from './sceneGeometrySpec.ts'
import { reflectionRefresh, smoothRange, type DayState, type ReflectionStamp } from './sceneDayCycle.ts'

interface Atmosphere { turbidity: number; rayleigh: number; mie: number; g: number; clouds: number; density: number; fog: string; sky: string; ground: string; sun: string }
type SkyParameters = Pick<Atmosphere, 'turbidity' | 'rayleigh' | 'mie' | 'g' | 'clouds' | 'density'>
const atmosphere: Record<Exclude<SkyPreset, 'studio' | 'night' | 'space'>, Atmosphere> = {
  day: { turbidity: 2.5, rayleigh: 1.2, mie: 0.005, g: 0.8, clouds: 0.35, density: 0.4, fog: '#c6d8ea', sky: '#bcd6f5', ground: '#6d5c47', sun: '#fff3e2' },
  sunset: { turbidity: 5, rayleigh: 2.2, mie: 0.005, g: 0.82, clouds: 0.45, density: 0.5, fog: '#e2a98a', sky: '#f2b48e', ground: '#4c3a3a', sun: '#ffb070' },
  overcast: { turbidity: 10, rayleigh: 3, mie: 0.01, g: 0.7, clouds: 0.95, density: 0.85, fog: '#b6bec6', sky: '#cfd6dd', ground: '#5d6064', sun: '#e9eef3' },
}
const nightPalette = { sky: '#4a5f8f', ground: '#0b0f18', moon: '#b8c8ff', fog: '#0b1322', background: '#070d1c' }
/** The physical sky is calibrated for exposure 0.5. Halving and clamping its radiance keeps it consistent with studio lighting; directions below the horizon reuse the horizon color instead of black.
 * `uDay` fades it into the night background for the day cycle; at 1 the output equals the static sky. */
function createSky(): Sky {
  const sky = new Sky()
  sky.material.uniforms.uDay = { value: 1 }
  sky.material.uniforms.uNightColor = { value: new THREE.Color(nightPalette.background) }
  sky.material.fragmentShader = 'uniform float uDay;\nuniform vec3 uNightColor;\n' + sky.material.fragmentShader
    .replace('vec3 direction = normalize( vWorldPosition - cameraPosition );', 'vec3 direction = normalize( vWorldPosition - cameraPosition ); direction = normalize( vec3( direction.x, max( direction.y, 0.02 ), direction.z ) );')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( mix( uNightColor, min( texColor * 0.5, vec3( 6.0 ) ), uDay ), 1.0 );')
  sky.material.fog = false
  return sky
}
function skyParameters(sky: Sky, settings: SkyParameters) {
  const uniforms = sky.material.uniforms
  uniforms.turbidity.value = settings.turbidity; uniforms.rayleigh.value = settings.rayleigh; uniforms.mieCoefficient.value = settings.mie; uniforms.mieDirectionalG.value = settings.g
  uniforms.cloudCoverage.value = settings.clouds; uniforms.cloudDensity.value = settings.density
}
const towards = (elevation: number, azimuth: number) => new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth))
export const SKY_LAYER = 2
export const toneMappings = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }
export function sunDirection(env: SceneEnvironment): THREE.Vector3 { return towards(env.sunElevation ?? 38, env.sunAzimuth ?? 35) }

export interface TimeOfDayLighting {
  sky: SkyParameters
  /** 1 physical sky → 0 night background. */
  skyFade: number
  sun: THREE.Vector3
  /** Direction towards the shadow-casting light: the sun by day, the moon once the sun is below the horizon. */
  light: THREE.Vector3
  lightColor: THREE.Color
  lightIntensity: number
  hemisphereSky: THREE.Color
  hemisphereGround: THREE.Color
  hemisphereIntensity: number
  fog: THREE.Color
  environmentIntensity: number
  stars: number
}
/** Pure: continuous blend of the day (or overcast), sunset and night presets for one day-cycle state; the sun hands over to the moon while both are dark. */
export function timeOfDayLighting(env: SceneEnvironment, day: DayState): TimeOfDayLighting {
  const overcast = env.sky === 'overcast', base = atmosphere[overcast ? 'overcast' : 'day'], dusk = atmosphere.sunset, strength = env.lightIntensity
  const tw = day.twilight * (overcast ? 0.4 : 1), n = day.night, elevation = day.sunElevation, dayHemisphere = overcast ? 1.1 : 0.6
  const lerp = (a: number, b: number) => a + (b - a) * tw
  const color = (a: string, b: string, night: string) => new THREE.Color(a).lerp(new THREE.Color(b), tw).lerp(new THREE.Color(night), n)
  const sun = towards(elevation, day.sunAzimuth), moon = elevation <= -1
  return {
    sky: { turbidity: lerp(base.turbidity, dusk.turbidity), rayleigh: lerp(base.rayleigh, dusk.rayleigh), mie: lerp(base.mie, dusk.mie), g: lerp(base.g, dusk.g), clouds: lerp(base.clouds, dusk.clouds), density: lerp(base.density, dusk.density) },
    skyFade: smoothRange(-12, 0, elevation),
    sun,
    light: moon ? towards(THREE.MathUtils.clamp(25 - elevation * 0.5, 25, 60), day.sunAzimuth + 180) : sun.clone(),
    lightColor: moon ? new THREE.Color(nightPalette.moon) : new THREE.Color(base.sun).lerp(new THREE.Color(dusk.sun), tw),
    lightIntensity: moon ? strength * 0.35 * smoothRange(-2, -10, elevation) : strength * (overcast ? 0.7 : 2.2) * THREE.MathUtils.clamp(elevation / 25, 0, 1),
    hemisphereSky: color(base.sky, dusk.sky, nightPalette.sky),
    hemisphereGround: color(base.ground, dusk.ground, nightPalette.ground),
    hemisphereIntensity: strength * (dayHemisphere + (0.25 - dayHemisphere) * n),
    fog: color(base.fog, dusk.fog, nightPalette.fog),
    environmentIntensity: 0.6 + (0.12 - 0.6) * n,
    stars: smoothRange(0.35, 0.85, n),
  }
}

export interface EnvironmentRig {
  /** True when the procedural sky is drawn in its own pass, after bloom and behind scene depth. */
  skyVisible: () => boolean
  sun: THREE.DirectionalLight
  hemisphere: THREE.HemisphereLight
  /** Applies the preset and returns the effective tone-mapping exposure. */
  apply: (env: SceneEnvironment) => number
  /** Day cycle on top of `apply`: blends sky, sun/moon, hemisphere, fog and stars without touching the document; reflections are recaptured at most every few play seconds. */
  setTimeOfDay: (env: SceneEnvironment, day: DayState) => void
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
  let skyTarget: THREE.WebGLRenderTarget | null = null, skyKey = '', direction = new THREE.Vector3(1, 2, 1.5).normalize(), shadowRadius = 24
  let cycle = false, stamp: ReflectionStamp | null = null
  const capture = (key: string, settings: SkyParameters, sunPosition: THREE.Vector3, fade: number) => {
    if (key !== skyKey || !skyTarget) {
      const probe = createSky(), uniforms = probe.material.uniforms
      probe.scale.setScalar(50)
      skyParameters(probe, settings)
      uniforms.showSunDisc.value = 0; uniforms.uDay.value = fade
      uniforms.sunPosition.value.copy(sunPosition)
      const captureScene = new THREE.Scene().add(probe)
      skyTarget?.dispose()
      skyTarget = pmrem.fromScene(captureScene, 0, 0.1, 100)
      probe.geometry.dispose(); probe.material.dispose()
      skyKey = key
    }
    return skyTarget.texture
  }
  const skyEnvironment = (env: SceneEnvironment, preset: keyof typeof atmosphere) => capture(`${preset}:${env.sunElevation}:${env.sunAzimuth}`, atmosphere[preset], sunDirection(env), 1)
  // Stars join the sky pass during a cycle so they fade in behind scene depth over the physical sky.
  const starsInSkyPass = (value: boolean) => {
    if (cycle === value) return
    cycle = value
    stars.layers.set(value ? SKY_LAYER : 0)
    stars.renderOrder = value ? 1 : 0
    stars.material.transparent = value
    stars.material.opacity = 1
    stars.material.needsUpdate = true
    sky.material.uniforms.uDay.value = 1
  }
  const placeSun = () => sun.position.copy(sun.target.position).addScaledVector(direction, shadowRadius * 2.5)
  return {
    sun, hemisphere, skyVisible: () => sky.visible,
    apply(env) {
      const preset = env.sky ?? 'studio', strength = env.lightIntensity
      direction = sunDirection(env)
      starsInSkyPass(false)
      stamp = null
      renderer.toneMapping = toneMappings[env.toneMapping ?? 'aces']
      renderer.toneMappingExposure = env.exposure
      sky.visible = preset in atmosphere
      stars.visible = preset === 'night' || preset === 'space'
      let fog = env.background
      if (preset in atmosphere) {
        const settings = atmosphere[preset as keyof typeof atmosphere]
        skyParameters(sky, settings)
        sky.material.uniforms.sunPosition.value.copy(direction)
        scene.background = null
        scene.environment = env.reflections ? skyEnvironment(env, preset as keyof typeof atmosphere) : null
        scene.environmentIntensity = 0.6
        hemisphere.color.set(settings.sky); hemisphere.groundColor.set(settings.ground); sun.color.set(settings.sun)
        const daylight = THREE.MathUtils.clamp((env.sunElevation ?? 38) / 25, 0.08, 1)
        hemisphere.intensity = strength * (preset === 'overcast' ? 1.1 : 0.6)
        sun.intensity = strength * (preset === 'overcast' ? 0.7 : 2.2) * daylight
        fog = settings.fog
      } else if (preset === 'night' || preset === 'space') {
        scene.background = new THREE.Color(preset === 'night' ? nightPalette.background : '#020308')
        scene.environment = env.reflections ? studio.texture : null
        scene.environmentIntensity = preset === 'night' ? 0.12 : 0.3
        hemisphere.color.set(preset === 'night' ? nightPalette.sky : '#8090b0'); hemisphere.groundColor.set(nightPalette.ground)
        hemisphere.intensity = strength * (preset === 'night' ? 0.25 : 0.15)
        sun.color.set(preset === 'night' ? nightPalette.moon : '#ffffff')
        sun.intensity = strength * (preset === 'night' ? 0.35 : 2.6)
        fog = preset === 'night' ? nightPalette.fog : '#020308'
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
    setTimeOfDay(env, day) {
      const look = timeOfDayLighting(env, day)
      starsInSkyPass(true)
      sky.visible = true
      skyParameters(sky, look.sky)
      sky.material.uniforms.sunPosition.value.copy(look.sun)
      sky.material.uniforms.uDay.value = look.skyFade
      stars.material.opacity = look.stars
      stars.visible = look.stars > 0.01
      scene.background = null
      hemisphere.color.copy(look.hemisphereSky); hemisphere.groundColor.copy(look.hemisphereGround); hemisphere.intensity = look.hemisphereIntensity
      sun.color.copy(look.lightColor); sun.intensity = look.lightIntensity
      direction = look.light
      placeSun()
      if (scene.fog) scene.fog.color.copy(look.fog)
      scene.environmentIntensity = look.environmentIntensity
      if (!env.reflections) scene.environment = null
      else if (reflectionRefresh(stamp, day) || !skyKey.startsWith('cycle:')) {
        scene.environment = capture(`cycle:${day.elapsed}:${day.hour}`, look.sky, look.sun, look.skyFade)
        stamp = { elapsed: day.elapsed, hour: day.hour, night: day.night }
      } else scene.environment = skyTarget!.texture
    },
    frame(center, radius) {
      // Snap the shadow projection in light space to avoid crawling texels while walking.
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize()
      if (right.lengthSq()<0.5) right.set(1,0,0)
      const up = new THREE.Vector3().crossVectors(direction,right).normalize(), texel=radius*2/sun.shadow.mapSize.x
      const focus=center.clone().addScaledVector(right,Math.round(center.dot(right)/texel)*texel-center.dot(right))
        .addScaledVector(up,Math.round(center.dot(up)/texel)*texel-center.dot(up))
      shadowRadius = radius
      sun.target.position.copy(focus)
      placeSun()
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
