import { useEffect, useRef, useState } from 'react'
import type { CadProgramMesh } from '../api/client.ts'

const vertexShader = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform vec3 uCenter;
uniform vec2 uAspect;
uniform float uExtent;
uniform float uAzimuth;
uniform float uElevation;
uniform float uZoom;
varying float vLight;
varying vec3 vColor;

void main() {
  float ca = cos(uAzimuth), sa = sin(uAzimuth);
  float ce = cos(uElevation), se = sin(uElevation);
  vec3 p = aPosition - uCenter;
  float horizontal = p.x * ca - p.y * sa;
  float depth = p.x * sa + p.y * ca;
  float vertical = p.z * ce - depth * se;
  float cameraDepth = depth * ce + p.z * se;
  gl_Position = vec4(1.5 * uZoom * uAspect.x * horizontal / uExtent,
                     1.5 * uZoom * uAspect.y * vertical / uExtent,
                     -2.0 * cameraDepth / uExtent, 1.0);

  vec3 n = normalize(aNormal);
  float normalDepth = n.x * sa + n.y * ca;
  vec3 viewNormal = vec3(n.x * ca - n.y * sa,
                         n.z * ce - normalDepth * se,
                         normalDepth * ce + n.z * se);
  vLight = 0.5 + 0.5 * abs(dot(viewNormal, normalize(vec3(-0.35, 0.6, 0.72))));
  vColor = aColor;
}`

const fragmentShader = `
precision mediump float;
varying float vLight;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor * vLight, 1.0);
}`

interface Renderer {
  readonly gl: WebGLRenderingContext
  readonly program: WebGLProgram
  readonly buffer: WebGLBuffer
  readonly shaders: readonly WebGLShader[]
  readonly uniforms: {
    readonly center: WebGLUniformLocation
    readonly aspect: WebGLUniformLocation
    readonly extent: WebGLUniformLocation
    readonly azimuth: WebGLUniformLocation
    readonly elevation: WebGLUniformLocation
    readonly zoom: WebGLUniformLocation
  }
  mesh: CadProgramMesh | null
  center: readonly [number, number, number]
  extent: number
  vertexCount: number
}

function compileShader(gl: WebGLRenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind)
  if (!shader) throw new Error('CAD preview shader is unavailable')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const diagnostic = gl.getShaderInfoLog(shader) ?? 'unknown shader error'
    gl.deleteShader(shader)
    throw new Error(`CAD preview shader failed: ${diagnostic}`)
  }
  return shader
}

function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: true })
  if (!gl) throw new Error('WebGL is required for an accurate CAD preview')
  const shaders = [compileShader(gl, gl.VERTEX_SHADER, vertexShader), compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader)]
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  if (!program || !buffer) throw new Error('CAD preview graphics resources are unavailable')
  for (const shader of shaders) gl.attachShader(program, shader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`CAD preview program failed: ${gl.getProgramInfoLog(program)}`)
  const uniform = (name: string): WebGLUniformLocation => {
    const location = gl.getUniformLocation(program, name)
    if (!location) throw new Error(`CAD preview uniform ${name} is unavailable`)
    return location
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  const position = gl.getAttribLocation(program, 'aPosition')
  const normal = gl.getAttribLocation(program, 'aNormal')
  const color = gl.getAttribLocation(program, 'aColor')
  if (position < 0 || normal < 0 || color < 0) throw new Error('CAD preview vertex attributes are unavailable')
  gl.enableVertexAttribArray(position)
  gl.enableVertexAttribArray(normal)
  gl.enableVertexAttribArray(color)
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 36, 0)
  gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 36, 12)
  gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 36, 24)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LESS)
  gl.clearColor(1, 1, 1, 1)
  return {
    gl, program, buffer, shaders,
    uniforms: {
      center: uniform('uCenter'), aspect: uniform('uAspect'), extent: uniform('uExtent'),
      azimuth: uniform('uAzimuth'), elevation: uniform('uElevation'), zoom: uniform('uZoom'),
    },
    mesh: null, center: [0, 0, 0], extent: 1, vertexCount: 0,
  }
}

function uploadMesh(renderer: Renderer, mesh: CadProgramMesh | null): void {
  if (renderer.mesh === mesh) return
  renderer.mesh = mesh
  const { gl } = renderer
  if (!mesh || !mesh.vertices.length) {
    renderer.vertexCount = 0
    return
  }
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
  for (const vertex of mesh.vertices) for (let axis = 0; axis < 3; axis++) {
    low[axis] = Math.min(low[axis], vertex[axis])
    high[axis] = Math.max(high[axis], vertex[axis])
  }
  renderer.center = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2]
  renderer.extent = Math.hypot(...mesh.boundsMm) || 1
  const data = new Float32Array(mesh.triangles.length * 27)
  let offset = 0
  const colors = [[0.27, 0.57, 0.73], [0.76, 0.46, 0.25], [0.38, 0.62, 0.41],
    [0.64, 0.39, 0.67], [0.69, 0.61, 0.28], [0.28, 0.64, 0.65], [0.63, 0.39, 0.39], [0.47, 0.48, 0.7]]
  let componentIndex = 0
  let componentEnd = mesh.components?.[0]?.triangles ?? mesh.triangles.length
  for (const [triangleIndex, triangle] of mesh.triangles.entries()) {
    while (mesh.components && triangleIndex >= componentEnd && componentIndex + 1 < mesh.components.length) {
      componentIndex++
      componentEnd += mesh.components[componentIndex].triangles
    }
    const color = colors[componentIndex % colors.length]
    const a = mesh.vertices[triangle[0]], b = mesh.vertices[triangle[1]], c = mesh.vertices[triangle[2]]
    if (!a || !b || !c) continue
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz)
    if (length < 1e-10) continue
    for (const point of [a, b, c]) {
      data.set([point[0], point[1], point[2], nx / length, ny / length, nz / length, ...color], offset)
      offset += 9
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, offset), gl.STATIC_DRAW)
  renderer.vertexCount = offset / 9
}

function draw(renderer: Renderer, canvas: HTMLCanvasElement, angles: { azimuth: number; elevation: number }, zoom: number): void {
  const { gl, uniforms } = renderer
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const ratio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio))
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
  gl.viewport(0, 0, width, height)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  if (!renderer.vertexCount) return
  gl.useProgram(renderer.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffer)
  gl.uniform3f(uniforms.center, ...renderer.center)
  gl.uniform2f(uniforms.aspect, Math.min(width, height) / width, Math.min(width, height) / height)
  gl.uniform1f(uniforms.extent, renderer.extent)
  gl.uniform1f(uniforms.azimuth, angles.azimuth)
  gl.uniform1f(uniforms.elevation, angles.elevation)
  gl.uniform1f(uniforms.zoom, zoom)
  gl.drawArrays(gl.TRIANGLES, 0, renderer.vertexCount)
}

export default function CadMeshView({ mesh }: { readonly mesh: CadProgramMesh | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const [angles, setAngles] = useState({ azimuth: -0.65, elevation: 0.55 })
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try { rendererRef.current = createRenderer(canvas) }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const timer = window.setTimeout(() => setError(message), 0)
      return () => window.clearTimeout(timer)
    }
    const observer = new ResizeObserver(() => drawRef.current())
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      const renderer = rendererRef.current
      if (!renderer) return
      renderer.gl.deleteBuffer(renderer.buffer)
      renderer.gl.deleteProgram(renderer.program)
      for (const shader of renderer.shaders) renderer.gl.deleteShader(shader)
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current, renderer = rendererRef.current
    if (!canvas || !renderer) return
    uploadMesh(renderer, mesh)
    drawRef.current = () => draw(renderer, canvas, angles, zoom)
    drawRef.current()
  }, [mesh, angles, zoom])

  return <>
    <canvas ref={canvasRef} aria-label="CAD 3D preview; drag to rotate and scroll to zoom" style={{ width: '100%', height: '100%', minHeight: 320, touchAction: 'none', cursor: 'grab' }}
      onPointerDown={(event) => { dragRef.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={(event) => {
        if (!dragRef.current) return
        const dx = event.clientX - dragRef.current.x, dy = event.clientY - dragRef.current.y
        dragRef.current = { x: event.clientX, y: event.clientY }
        setAngles((value) => ({ azimuth: value.azimuth + dx * 0.008, elevation: Math.max(-1.5, Math.min(1.5, value.elevation - dy * 0.008)) }))
      }}
      onPointerUp={() => { dragRef.current = null }}
      onPointerCancel={() => { dragRef.current = null }}
      onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(0.25, Math.min(4, value * (event.deltaY > 0 ? 0.9 : 1.1)))) }} />
    {error && <p role="alert">{error}</p>}
  </>
}
