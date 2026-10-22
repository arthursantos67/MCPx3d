import { useId, type ReactNode } from 'react'
import type { Glyph } from './sceneGamepad.ts'
import { hudIconNames, safePortraitImage, type HudIconName, type HudPortrait } from './sceneHud.ts'

const star = (cx: number, cy: number, outer: number, inner: number, points = 5) => Array.from({ length: points * 2 }, (_, index) => {
  const radius = index % 2 ? inner : outer, angle = Math.PI * index / points - Math.PI / 2
  return `${index ? 'L' : 'M'}${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`
}).join('') + 'Z'
const gear = (cx: number, cy: number, outer: number, inner: number, teeth = 8) => Array.from({ length: teeth * 4 }, (_, index) => {
  const radius = index % 4 < 2 ? outer : inner, angle = Math.PI * 2 * (index + 0.5) / (teeth * 4)
  return `${index ? 'L' : 'M'}${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`
}).join('') + 'Z'
const dark = 'rgba(8,12,20,.55)'
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** Pictograms on a 24-unit grid: filled silhouettes for game objects, strokes for interface verbs. */
const shapes: Record<HudIconName, ReactNode> = {
  fist: <path {...S} d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10m0-.5V6a1.5 1.5 0 0 1 3 0v3.5m0 0V6.5a1.5 1.5 0 0 1 3 0V10m0 .5V9a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 5 13.5V12a1.5 1.5 0 0 1 3 0" />,
  sword: <><path fill="currentColor" d="M21 3l-1.3 4.7-9.1 9.1-3.4-3.4 9.1-9.1z" /><path {...S} strokeWidth={2.2} d="M5 11.6l7.4 7.4M7.6 16.4L3.6 20.4" /><circle cx="3.4" cy="20.6" r="1.4" fill="currentColor" /></>,
  blaster: <><path fill="currentColor" d="M2.5 8.5h13l1.8-1.8H21v5.4h-3l-1 1h-4.6L11 19.5H6.2L7.8 13H2.5z" /><path fill={dark} d="M10 9.8h4.5v1.6H10z" /></>,
  bow: <><path {...S} strokeWidth={2.2} d="M6 3c8 1.5 13.5 8.5 12 18" /><path {...S} strokeWidth={1} d="M6 3l12 18" /><path {...S} d="M3 13.5L15 9.5M12.4 7.6l2.6 1.9-1.4 2.9" /></>,
  staff: <><path {...S} strokeWidth={2.4} d="M5 21l9-12" /><circle cx="16.5" cy="6.5" r="3.6" fill="currentColor" /><path {...S} strokeWidth={1.4} d="M20.5 2.5l.9.9M21.6 9.3l1 .2M12.8 2.6l.2-1" /></>,
  heart: <path fill="currentColor" d="M12 20.6S3 15.1 3 8.9A4.7 4.7 0 0 1 12 6.7a4.7 4.7 0 0 1 9 2.2c0 6.2-9 11.7-9 11.7z" />,
  bolt: <path fill="currentColor" d="M13.2 2L4.6 13.4H11L10 22l8.5-11.5h-6.3z" />,
  shield: <><path fill="currentColor" d="M12 2.4l8.2 3.1v6.2c0 5.1-3.5 8.7-8.2 10.1-4.7-1.4-8.2-5-8.2-10.1V5.5z" /><path fill={dark} d="M12 5v14.3c-3.3-1.2-5.5-4-5.5-7.6V7.1z" /></>,
  speed: <path {...S} d="M3 8.5h10.5a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 16.5h6.5" />,
  jump: <><path fill="currentColor" d="M12 2.5l6.5 6.5H14.3v5H9.7V9H5.5z" /><path {...S} d="M6 18h12M8 21.5h8" /></>,
  strength: <path {...S} strokeWidth={2.4} d="M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5M6.5 12h11" />,
  key: <><circle {...S} strokeWidth={2.4} cx="7.5" cy="12" r="4" /><path {...S} strokeWidth={2.4} d="M11.5 12H21M18 12v3.2M21 12v2.4" /></>,
  coin: <><circle cx="12" cy="12" r="9" fill="currentColor" /><circle cx="12" cy="12" r="6.2" fill="none" stroke={dark} strokeWidth="1.4" /><path fill={dark} d="M11 8h2v8h-2z" /></>,
  gem: <><path fill="currentColor" d="M7 3.5h10l4.5 5.5L12 21 2.5 9z" /><path fill="none" stroke={dark} strokeWidth="1.2" strokeLinejoin="round" d="M2.5 9h19M8.8 3.5L12 9l3.2-5.5M12 9v12M7 9l5 12 5-12" /></>,
  potion: <><path {...S} d="M9 3h6M10 3v5.2L5.4 16.6A3 3 0 0 0 8 21h8a3 3 0 0 0 2.6-4.4L14 8.2V3" /><path fill="currentColor" d="M7.4 14.5h9.2l1.1 2.2A1.9 1.9 0 0 1 16 19.5H8a1.9 1.9 0 0 1-1.7-2.8z" /></>,
  scroll: <><path {...S} d="M7 21a3 3 0 0 1 0-6h1V5.5A2.5 2.5 0 0 1 10.5 3H19a2 2 0 0 1 2 2v11.5A4.5 4.5 0 0 1 16.5 21z" /><path {...S} strokeWidth={1.6} d="M11.5 8h6M11.5 11.5h6M11.5 15h4" /></>,
  food: <><path fill="currentColor" d="M12 7.6C10 5.5 4.6 6 4.6 11.4c0 4.6 3 9.1 5.2 9.1 1 0 1.4-.5 2.2-.5s1.2.5 2.2.5c2.2 0 5.2-4.5 5.2-9.1C19.4 6 14 5.5 12 7.6z" /><path {...S} d="M12 7.6c0-2.2 1-3.8 3.2-4.6" /></>,
  herb: <><path fill="currentColor" d="M4.5 19.5C4.5 10.4 10.6 4 20 4c0 9.4-6.4 15.5-15.5 15.5z" /><path fill="none" stroke={dark} strokeWidth="1.4" strokeLinecap="round" d="M4.5 19.5l9.5-9.5" /></>,
  relic: <><path {...S} strokeWidth={1.6} d="M7.5 2.5L12 9l4.5-6.5" /><circle cx="12" cy="14.8" r="6" fill="currentColor" /><path fill={dark} d={star(12, 14.8, 3.6, 1.6)} /></>,
  gear: <><path fill="currentColor" d={gear(12, 12, 10, 7.6)} /><circle cx="12" cy="12" r="3.2" fill={dark} /></>,
  settings: <><path fill="currentColor" d={gear(12, 12, 10, 7.6)} /><circle cx="12" cy="12" r="3.4" fill={dark} /></>,
  bag: <><path {...S} d="M8.5 8.5V6.5a3.5 3.5 0 0 1 7 0v2" /><path fill="currentColor" d="M4.5 8.5h15l-1.2 11a1.8 1.8 0 0 1-1.8 1.6h-9a1.8 1.8 0 0 1-1.8-1.6z" /></>,
  star: <path fill="currentColor" d={star(12, 12.6, 10, 4.3)} />,
  clock: <><circle {...S} cx="12" cy="12" r="9" /><path {...S} d="M12 7v5.2l3.4 2" /></>,
  skull: <><path fill="currentColor" d="M12 2.8a8.2 8.2 0 0 0-8.2 8.2c0 3 1.5 4.8 3.1 5.7v3.8h10.2v-3.8c1.6-.9 3.1-2.7 3.1-5.7A8.2 8.2 0 0 0 12 2.8z" /><circle cx="8.8" cy="11.4" r="2.2" fill={dark} /><circle cx="15.2" cy="11.4" r="2.2" fill={dark} /><path fill="none" stroke={dark} strokeWidth="1.2" d="M10 17v3.5M12 17v3.5M14 17v3.5" /></>,
  target: <><circle {...S} cx="12" cy="12" r="8.5" /><circle {...S} cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></>,
  check: <path {...S} strokeWidth={2.8} d="M5 12.5l4.5 4.5L19 7.5" />,
  pause: <path fill="currentColor" d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" />,
  exit: <path {...S} d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14M10 12h11M17 8l4 4-4 4" />,
  volume: <><path fill="currentColor" d="M3.5 9h4l5-4.2v14.4l-5-4.2h-4z" /><path {...S} d="M16 8.5a5 5 0 0 1 0 7M18.8 5.8a9 9 0 0 1 0 12.4" /></>,
  mute: <><path fill="currentColor" d="M3.5 9h4l5-4.2v14.4l-5-4.2h-4z" /><path {...S} d="M16 9l5 6M21 9l-5 6" /></>,
  eye: <><path {...S} d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3.2" fill="currentColor" /></>,
  wing: <path fill="currentColor" d="M2.5 18.5C5.6 9.6 11.6 5 21.5 4c-1.8 3-3.4 5-6.9 6.1 1.8.1 3.2-.1 5-.9-1.9 3-4.8 5-8.8 5.3 1 .8 2.2 1 3.8.9-3 2.9-7 3.4-12.1 3.1z" />,
  flag: <><path {...S} strokeWidth={2.2} d="M5 21.5V3.5" /><path fill="currentColor" d="M6 4h12.5l-2.6 4.2 2.6 4.3H6z" /></>,
  banner: <path fill="currentColor" d="M6.5 2.5h11v18l-5.5-3.8-5.5 3.8z" />,
  speech: <path fill="currentColor" d="M5 3.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-7.5l-5.5 4.5v-4.5H5A2.5 2.5 0 0 1 2.5 14V6A2.5 2.5 0 0 1 5 3.5z" />,
  sparkle: <path fill="currentColor" d="M12 1.5l2.3 8.2 8.2 2.3-8.2 2.3-2.3 8.2-2.3-8.2L1.5 12l8.2-2.3z" />,
  lock: <><path {...S} strokeWidth={2.4} d="M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7" /><rect x="4.5" y="10" width="15" height="11" rx="2.2" fill="currentColor" /><circle cx="12" cy="15.5" r="1.7" fill={dark} /></>,
  arrow: <path fill="currentColor" d="M12 2.2l7.6 18.6L12 16.6l-7.6 4.2z" />,
  diamond: <><path fill="currentColor" d="M12 1.8L22.2 12 12 22.2 1.8 12z" /><path fill={dark} d="M12 7.2L16.8 12 12 16.8 7.2 12z" /></>,
  restart: <path {...S} d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 3.5v4h4" />,
  play: <path fill="currentColor" d="M7 4.2v15.6a.8.8 0 0 0 1.2.7l12.3-7.8a.8.8 0 0 0 0-1.4L8.2 3.5A.8.8 0 0 0 7 4.2z" />,
  trophy: <><path fill="currentColor" d="M7 3.5h10v5.2a5 5 0 0 1-10 0zM10.6 13.5h2.8v3.8h-2.8zM7.5 17.3h9V21h-9z" /><path {...S} d="M7 5.5H4.2v1.7A3.8 3.8 0 0 0 7.6 11M17 5.5h2.8v1.7a3.8 3.8 0 0 1-3.4 3.8" /></>,
  controls: <><path fill="currentColor" d="M7.2 6.5h9.6a5.2 5.2 0 0 1 5 6.6l-1.2 4.3a2.6 2.6 0 0 1-4.5 1l-2.3-2.6h-3.6l-2.3 2.6a2.6 2.6 0 0 1-4.5-1l-1.2-4.3a5.2 5.2 0 0 1 5-6.6z" /><path fill={dark} d="M6.8 9.6h1.6v1.6H10v1.6H8.4v1.6H6.8v-1.6H5.2v-1.6h1.6z" /><circle cx="16.2" cy="10.4" r="1.1" fill={dark} /><circle cx="18" cy="12.6" r="1.1" fill={dark} /></>,
}

export function HudIcon({ name, className, size }: { name: HudIconName; className?: string; size?: number | string }) {
  return <svg className={`forma-icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">{shapes[name] ?? shapes.bag}</svg>
}
/** Symbols for the imperative overlay layer, which clones icons with `<use>` instead of rendering React. */
export function HudIconSprite({ prefix }: { prefix: string }) {
  return <svg className="forma-hud__sprite" aria-hidden="true" focusable="false"><defs>{[...hudIconNames].map((name) => <symbol key={name} id={`${prefix}-${name}`} viewBox="0 0 24 24">{shapes[name]}</symbol>)}</defs></svg>
}

const mouse = (side: 'left' | 'right' | null) => <svg className="forma-glyph__mouse" viewBox="0 0 16 22" aria-hidden="true" focusable="false">
  <rect x="1.2" y="1.2" width="13.6" height="19.6" rx="6.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
  {side === 'left' && <path d="M8 1.2A6.8 6.8 0 0 0 1.2 8v1.2H8z" fill="currentColor" />}
  {side === 'right' && <path d="M8 1.2A6.8 6.8 0 0 1 14.8 8v1.2H8z" fill="currentColor" />}
  <path d="M8 1.6v7.6" stroke="currentColor" strokeWidth="1.2" />
</svg>
/** Keycap, mouse button or Xbox control drawn inline; the text label stays in the accessible text. */
export function InputGlyph({ glyph }: { glyph: Glyph }) {
  if (glyph.kind === 'mouse-left' || glyph.kind === 'mouse-right' || glyph.kind === 'mouse') return <span className="forma-glyph forma-glyph--mouse" title={glyph.label}>{mouse(glyph.kind === 'mouse-left' ? 'left' : glyph.kind === 'mouse-right' ? 'right' : null)}<span className="forma-sr">{glyph.label}</span></span>
  if (glyph.kind === 'dpad') return <span className="forma-glyph forma-glyph--dpad" title={`Direcional ${glyph.label}`}><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M7 1.5h6v5.5h5.5v6H13v5.5H7V13H1.5V7H7z" fill="currentColor" opacity=".35" />
    <path d={glyph.label === '↑' ? 'M7 1.5h6v5.5H7z' : glyph.label === '↓' ? 'M7 13h6v5.5H7z' : glyph.label === '←' ? 'M1.5 7H7v6H1.5z' : 'M13 7h5.5v6H13z'} fill="currentColor" /></svg><span className="forma-sr">{glyph.label}</span></span>
  return <kbd className={`forma-glyph forma-glyph--${glyph.kind}${glyph.tone ? ` forma-glyph--${glyph.tone}` : ''}${glyph.label.length > 2 ? ' forma-glyph--wide' : ''}`}>{glyph.label}</kbd>
}

/** Bust portrait drawn from palette and style; a validated data URL image replaces the drawing when present. */
export function Portrait({ portrait, name }: { portrait: HudPortrait | null; name: string }) {
  const id = useId().replace(/:/g, '')
  const look = portrait ?? { species: 'human', skin: '#d9a47c', hair: '#5a3a22', outfit: '#3d6a8a', accent: '#f2c46d', eyes: '#3b2a20', hairStyle: 'short', beard: 'none', headwear: 'none', age: 'adult' } as HudPortrait
  const image = safePortraitImage(look.image)
  const child = look.age === 'child', elder = look.age === 'elder', head = child ? 1.08 : 1
  const shadow = 'rgba(40,20,10,.28)'
  return <svg className="forma-portrait" viewBox="0 0 96 96" role="img" aria-label={`Retrato de ${name}`}>
    <defs>
      <radialGradient id={`${id}-bg`} cx="50%" cy="35%" r="75%"><stop offset="0" stopColor={look.accent} stopOpacity=".55" /><stop offset="1" stopColor="#0b1220" /></radialGradient>
      <clipPath id={`${id}-clip`}><rect x="0" y="0" width="96" height="96" rx="14" /></clipPath>
    </defs>
    <g clipPath={`url(#${id}-clip)`}>
      <rect width="96" height="96" fill={`url(#${id}-bg)`} />
      {image ? <image href={image} x="0" y="0" width="96" height="96" preserveAspectRatio="xMidYMid slice" /> : <>
        <path d="M10 98c2-19 17-28 38-28s36 9 38 28z" fill={look.outfit} />
        <path d="M36 70l12 9 12-9" fill="none" stroke={look.accent} strokeWidth="3" strokeLinejoin="round" />
        {look.species === 'robot' ? <>
          <rect x="44" y="58" width="8" height="12" fill={look.outfit} />
          <path d="M48 14v8" stroke={look.skin} strokeWidth="2.5" /><circle cx="48" cy="13" r="3" fill={look.accent} />
          <rect x="28" y="22" width="40" height="38" rx="10" fill={look.skin} />
          <rect x="32" y="32" width="32" height="13" rx="6" fill="#0b1220" />
          <circle cx="41" cy="38.5" r="3" fill={look.eyes} /><circle cx="55" cy="38.5" r="3" fill={look.eyes} />
          <path d="M38 52h20" stroke="#0b1220" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 2.5" />
          <rect x="24" y="34" width="5" height="12" rx="2" fill={look.outfit} /><rect x="67" y="34" width="5" height="12" rx="2" fill={look.outfit} />
        </> : look.species === 'skeleton' ? <>
          <rect x="43" y="58" width="10" height="12" rx="3" fill={look.skin} opacity=".85" />
          <path d="M48 18c-12 0-19 8-19 19 0 7 3 11 7 13v8h24v-8c4-2 7-6 7-13 0-11-7-19-19-19z" fill={look.skin} />
          <ellipse cx="40.5" cy="38" rx="5" ry="5.5" fill="#0b1220" /><ellipse cx="55.5" cy="38" rx="5" ry="5.5" fill="#0b1220" />
          <circle cx="40.5" cy="38.5" r="1.8" fill={look.eyes} /><circle cx="55.5" cy="38.5" r="1.8" fill={look.eyes} />
          <path d="M48 44l-3 5h6z" fill="#0b1220" /><path d="M41 54v4M44.5 54v4M48 54v4M51.5 54v4M55 54v4" stroke="#0b1220" strokeWidth="1.5" />
        </> : look.species === 'beast' ? <>
          <path d="M30 26l-4-14 13 8zM66 26l4-14-13 8z" fill={look.hair} />
          <ellipse cx="48" cy="40" rx="19" ry="18" fill={look.skin} />
          <ellipse cx="48" cy="54" rx="11" ry="10" fill={look.hair} />
          <ellipse cx="48" cy="49" rx="4.5" ry="3" fill="#0b1220" />
          <path d="M43 58c3 2 7 2 10 0" fill="none" stroke="#0b1220" strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="39" cy="36" rx="3" ry="3.4" fill={look.eyes} /><ellipse cx="57" cy="36" rx="3" ry="3.4" fill={look.eyes} />
          <circle cx="39" cy="36" r="1.3" fill="#0b1220" /><circle cx="57" cy="36" r="1.3" fill="#0b1220" />
        </> : <>
          {(look.hairStyle === 'long' || look.hairStyle === 'braids') && <path d="M27 42c0-18 9-27 21-27s21 9 21 27v24c-4 3-8 3-11 1V44H38v23c-3 2-7 2-11-1z" fill={look.hair} />}
          {look.hairStyle === 'ponytail' && <path d="M60 30c9 4 11 16 6 30-2-6-5-10-9-12z" fill={look.hair} />}
          <rect x="42" y="56" width="12" height="15" rx="4" fill={look.skin} /><rect x="42" y="56" width="12" height="6" fill={shadow} />
          {look.species === 'creature' ? <><path d="M31 44L14 32l14 18zM65 44l17-12-14 18z" fill={look.skin} /></> : <><ellipse cx="30.5" cy="45" rx="3.4" ry="5" fill={look.skin} /><ellipse cx="65.5" cy="45" rx="3.4" ry="5" fill={look.skin} /></>}
          <g transform={`translate(48 43) scale(${head}) translate(-48 -43)`}>
            <ellipse cx="48" cy="43" rx="17" ry="20" fill={look.skin} />
            <path d="M31 47c2 9 8 15 17 15s15-6 17-15c-3 6-9 9-17 9s-14-3-17-9z" fill={shadow} opacity=".5" />
            <ellipse cx="41" cy="44" rx={child ? 4 : 3.4} ry={child ? 3.2 : 2.5} fill="#f8f4ee" /><ellipse cx="55" cy="44" rx={child ? 4 : 3.4} ry={child ? 3.2 : 2.5} fill="#f8f4ee" />
            <circle cx="41.4" cy="44.2" r={child ? 2.3 : 1.8} fill={look.eyes} /><circle cx="55.4" cy="44.2" r={child ? 2.3 : 1.8} fill={look.eyes} />
            <circle cx="41.4" cy="44.2" r=".9" fill="#0b1220" /><circle cx="55.4" cy="44.2" r=".9" fill="#0b1220" />
            <circle cx="42.2" cy="43.4" r=".55" fill="#fff" /><circle cx="56.2" cy="43.4" r=".55" fill="#fff" />
            <path d={look.species === 'creature' ? 'M36 39l9 2M60 39l-9 2' : 'M37 39.5c2-1.4 5-1.6 7.5-.6M59 39.5c-2-1.4-5-1.6-7.5-.6'} fill="none" stroke={look.species === 'creature' ? '#2a2a1a' : look.hair} strokeWidth="2.2" strokeLinecap="round" />
            <path d="M48 46c-1.2 3.4-2.2 5.4-.4 6.6" fill="none" stroke={shadow} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M43 55.5c3 2 7 2 10 0" fill="none" stroke="#7a3b32" strokeWidth="1.8" strokeLinecap="round" />
            {look.species === 'creature' && <path d="M44 56.5l1.2 3 1.2-3M50 56.5l1.2 3 1.2-3" fill="#f8f4ee" />}
            {elder && <path d="M35.5 48.5c1.5 1 2.8 1.2 4 .9M60.5 48.5c-1.5 1-2.8 1.2-4 .9M42 33.5h12" fill="none" stroke={shadow} strokeWidth="1.2" strokeLinecap="round" />}
            {look.beard !== 'none' && <path d={look.beard === 'long' ? 'M32 47c0 18 7 30 16 30s16-12 16-30c-3 6-8 9-16 9s-13-3-16-9z' : 'M32.5 48c1.5 10 7.5 15 15.5 15s14-5 15.5-15c-3 5-8 7.5-15.5 7.5S35.5 53 32.5 48z'} fill={look.hair} />}
            {look.beard !== 'none' && <path d="M43 55.5c3 1.6 7 1.6 10 0" fill="none" stroke="#3a2418" strokeWidth="1.6" strokeLinecap="round" />}
            {look.headwear === 'none' && look.hairStyle !== 'bald' && look.hairStyle !== 'mohawk' && <path d="M30.5 42c-1-14 7-21.5 17.5-21.5S66.5 28 65.5 42c-2.5-6.5-8-10.5-13-11-1.5 2.5-6 4-11 3.5-5-.5-8 1.5-11 7.5z" fill={look.hair} />}
            {look.headwear === 'none' && look.hairStyle === 'bun' && <circle cx="48" cy="19" r="7" fill={look.hair} />}
            {look.headwear === 'none' && look.hairStyle === 'mohawk' && <path d="M43.5 17c3-2.5 6-2.5 9 0l1.5 17h-12z" fill={look.hair} />}
            {look.headwear === 'none' && look.hairStyle === 'braids' && <path d="M30 50c-2 8-1 14 2 18M66 50c2 8 1 14-2 18" fill="none" stroke={look.hair} strokeWidth="4" strokeLinecap="round" strokeDasharray="4 1.5" />}
            {look.headwear === 'hood' && <path d="M26 50c0-22 10-33 22-33s22 11 22 33l-5 14c0-12-1-20-3-24-3-6-8-9-14-9s-11 3-14 9c-2 4-3 12-3 24z" fill={look.outfit} />}
            {look.headwear === 'helmet' && <><path d="M29 40c0-14 8-22 19-22s19 8 19 22v4H29z" fill={look.outfit} /><path d="M29 40h38" stroke={look.accent} strokeWidth="3" /><path d="M48 18v22" stroke="rgba(0,0,0,.2)" strokeWidth="3" /></>}
            {look.headwear === 'wizard' && <><path d="M28 34c6-3 14-4.5 20-4.5S62 31 68 34L52 2z" fill={look.outfit} /><path d="M29 33.5c6-2.5 13-3.5 19-3.5s13 1 19 3.5" stroke={look.accent} strokeWidth="3.4" fill="none" /><path d={star(55, 18, 3, 1.3)} fill={look.accent} /></>}
            {look.headwear === 'crown' && <path d="M33 30l4-12 6 7 5-10 5 10 6-7 4 12z" fill={look.accent} stroke="rgba(0,0,0,.25)" strokeWidth="1" />}
            {look.headwear === 'cap' && <><path d="M31 36c0-11 7.5-17 17-17s17 6 17 17z" fill={look.outfit} /><path d="M58 35.5c6 0 11 .8 13 2.5-4 1.4-9 1.6-13 1z" fill={look.outfit} /><path d="M31 36h34" stroke={look.accent} strokeWidth="2.5" /></>}
          </g>
        </>}
      </>}
      <rect x="1" y="1" width="94" height="94" rx="13" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="2" />
    </g>
  </svg>
}
