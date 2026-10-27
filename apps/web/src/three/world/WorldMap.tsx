import { useEffect, useRef } from 'react'

export interface WorldMapMarker { id: string; name: string; x: number; z: number; visited: boolean }
export interface WorldMapProps {
  image: ImageData | null
  /** World size in metres (square). */
  size: number
  fog: { cells: Uint8Array; nx: number; nz: number } | null
  player: { x: number; z: number; heading: number }
  markers: WorldMapMarker[]
  onTravel(id: string): void
  onClose(): void
}

/** World map with fog of war: discovered locations can be fast-travelled to (Tab or Esc closes). */
export default function WorldMap({ image, size, fog, player, markers, onTravel, onClose }: WorldMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pixels = 512, toMap = (x: number, z: number) => [(x / size + 0.5) * 100, (0.5 - z / size) * 100]
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    if (image) context.putImageData(image, 0, 0); else { context.fillStyle = '#2b3a40'; context.fillRect(0, 0, pixels, pixels) }
    if (!fog) return
    // Undiscovered ground stays dark parchment; the map image shows through what the player has seen. The fog is one
    // pixel per cell (north up), scaled onto the map in a single draw.
    const mask = new ImageData(fog.nx, fog.nz)
    for (let j = 0; j < fog.nz; j++) for (let i = 0; i < fog.nx; i++) if (!fog.cells[j * fog.nx + i]) { const p = ((fog.nz - 1 - j) * fog.nx + i) * 4; mask.data[p] = 22; mask.data[p + 1] = 28; mask.data[p + 2] = 32; mask.data[p + 3] = 219 }
    const layer = document.createElement('canvas')
    layer.width = fog.nx; layer.height = fog.nz
    layer.getContext('2d')?.putImageData(mask, 0, 0)
    context.imageSmoothingEnabled = false
    context.drawImage(layer, 0, 0, pixels, pixels)
  }, [image, fog])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.code === 'Tab' || event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  const [px, pz] = toMap(player.x, player.z)
  return <div className="three-world-map" role="dialog" aria-label="Mapa do mundo">
    <div className="three-world-map__sheet">
      <canvas ref={canvas} width={pixels} height={pixels} aria-hidden="true" />
      {markers.map((marker) => { const [x, z] = toMap(marker.x, marker.z); return <button key={marker.id} type="button" className={`three-world-map__marker${marker.visited ? ' is-visited' : ''}`}
        style={{ left: `${x}%`, top: `${z}%` }} title={`Viajar para ${marker.name}`} onClick={() => onTravel(marker.id)}><span>{marker.name}</span></button> })}
      <span className="three-world-map__player" style={{ left: `${px}%`, top: `${pz}%`, transform: `translate(-50%, -50%) rotate(${-player.heading}rad)` }} aria-label="Você está aqui" />
    </div>
    <p className="three-world-map__hint">Clique num local descoberto para viajar · Tab fecha</p>
  </div>
}
