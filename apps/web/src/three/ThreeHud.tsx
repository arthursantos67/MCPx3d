import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react'
import './ThreeHud.css'
import { actionNames, controlActions, glyph, type GameAction, type InputDevice } from './sceneGamepad.ts'
import { barFraction, bossPhase, bossPhases, compassTicks, createBar, DAMAGE_LIFE, DAMAGE_MAX, damageText, formatDistance, formatScore, hotbarItems, isHudIcon, itemIcon,
  layoutAnchors, lowHealth, markerIcon, outcomeSummary, placeMarkers, powerIcon, pushDamage, qualityOptions, relativeBearing, ringOffset, stepBar, timerText, toDegrees, TYPE_CPS, typedLength,
  vitalTone, weaponIcon, type DamageEntry, type HudAnchor, type HudDialogue, type HudModel, type HudOverlayHandle, type HudPrompt, type MenuAction } from './sceneHud.ts'
import { HudIcon, HudIconSprite, InputGlyph, Portrait } from './sceneHudIcons.tsx'
import { powerLabels } from './sceneLabels.ts'
import { SENSITIVITY_RANGE, sanitizeSettings, type PlaySettings } from './sceneSettings.ts'

export interface ThreeHudProps {
  model: HudModel
  toasts: { id: number; text: string }[]
  overlay?: Ref<ThreeHudHandle | null>
  settings: PlaySettings
  /** Presentation mode never shows the frame counter. */
  presentation?: boolean
  onResume(): void
  onRestart(): void
  onExit(): void
  /** "Continuar explorando" after a victory. */
  onDismissOutcome(): void
  onCaptureMouse(): void
  onDialogueOption?(index: number): void
  onSettings(settings: PlaySettings): void
  /** Shows the pause button in the corner when provided. */
  onPause?(): void
  onInventory?(): void
  onSlot?(slot: number): void
}
/** Overlay handle plus `skipTyping()`: true when it completed a line still being typed, so the caller can swallow that confirm press. */
export interface ThreeHudHandle extends HudOverlayHandle { skipTyping(): boolean }
type MenuHandler = (action: MenuAction) => boolean
type Register = (slot: 'pause' | 'outcome' | 'dialogue' | 'skip', handler: MenuHandler | (() => boolean) | null) => void

const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
const percent = (value: number, max: number) => `${(barFraction(value, max) * 100).toFixed(2)}%`
const same = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b)

/** Keeps a leaving element mounted long enough for its exit animation. */
function usePresence(visible: boolean, ms = 320) {
  const [mounted, setMounted] = useState(visible)
  if (visible && !mounted) setMounted(true)
  useEffect(() => {
    if (visible || !mounted) return
    const timer = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(timer)
  }, [visible, mounted, ms])
  return { mounted: mounted || visible, leaving: mounted && !visible }
}
/** Damage trail drawn imperatively: the ghost bar follows `stepBar` without re-rendering React. */
function useTrail(value: number, max: number) {
  const ghost = useRef<HTMLDivElement>(null), bar = useRef(createBar(value))
  useLayoutEffect(() => {
    let frame = 0, last = 0
    const paint = () => { if (ghost.current) ghost.current.style.width = percent(bar.current.ghost, max) }
    const tick = (time: number) => {
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 0
      last = time
      bar.current = stepBar(bar.current, value, max, dt)
      paint()
      frame = bar.current.ghost > value + 1e-3 || bar.current.hold > 0 ? requestAnimationFrame(tick) : 0
    }
    bar.current = stepBar(bar.current, value, max, 0)
    paint()
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, max])
  return ghost
}
function focusables(container: HTMLElement | null) {
  return container ? [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')].filter((element) => element.getClientRects().length > 0) : []
}
function moveFocus(container: HTMLElement | null, step: number) {
  const items = focusables(container)
  if (!items.length) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  items[index < 0 ? 0 : (index + step + items.length) % items.length].focus()
}
function confirmFocus(container: HTMLElement | null) {
  const active = document.activeElement as HTMLElement | null
  if (container && active && container.contains(active)) active.click()
  else focusables(container)[0]?.focus()
}
const arrowNavigation = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault(); event.stopPropagation()
  moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1)
}

const Tracker = memo(function Tracker({ objective, done, collected, total, defeated, enemyTotal, tracker, heading, omitted, steps }: { objective: string; done: boolean; collected: number; total: number
  defeated: number; enemyTotal: number; tracker: HudModel['tracker']; heading: number; omitted: number; steps?: HudModel['questSteps'] }) {
  return <section className="forma-tracker" data-done={done || undefined} aria-label="Missão">
    <header className="forma-kicker"><HudIcon name={done ? 'check' : 'diamond'} />{done ? 'Objetivo concluído' : 'Objetivo'}</header>
    {objective && <p className="forma-tracker__text" aria-label="Objetivo">{objective}</p>}
    {!!steps?.length && <ul className="forma-quest-steps">{steps.map((step, i) => <li key={i}>{step.value >= step.count ? '✓' : '○'} {step.label} · {step.value}/{step.count}</li>)}</ul>}
    {(total > 0 || enemyTotal > 0) && <div className="forma-tracker__chips">
      {total > 0 && <span className="forma-chip" data-complete={collected >= total || undefined} style={{ '--progress': percent(collected, total) } as CSSProperties} aria-label="Itens coletados">
        <HudIcon name="sparkle" />Itens {collected}/{total}</span>}
      {enemyTotal > 0 && <span className="forma-chip forma-chip--enemy" data-complete={defeated >= enemyTotal || undefined} style={{ '--progress': percent(defeated, enemyTotal) } as CSSProperties}
        aria-label="Inimigos derrotados"><HudIcon name="skull" />Inimigos {defeated}/{enemyTotal}</span>}
    </div>}
    {tracker && <div className="forma-tracker__nav">
      <span className="forma-tracker__arrow" style={{ transform: `rotate(${toDegrees(relativeBearing(tracker.bearing, heading)).toFixed(1)}deg)` }}><HudIcon name="arrow" /></span>
      <span className="forma-tracker__label">{tracker.label}</span><b>{formatDistance(tracker.distance)}</b>
    </div>}
    {omitted > 0 && <p className="forma-tracker__warning">{omitted.toLocaleString('pt-BR')} triângulos ficaram fora da colisão para respeitar o orçamento.</p>}
  </section>
}, same)

const Compass = memo(function Compass({ heading, markers }: HudModel['compass']) {
  const ticks = compassTicks(heading), placed = placeMarkers(markers, heading), degrees = Math.round((toDegrees(heading) + 360) % 360)
  return <div className="forma-compass" aria-label={`Bússola, rumo ${degrees}°`}>
    <div className="forma-compass__strip">
      {ticks.map((tick) => <span key={tick.degrees} className={`forma-compass__tick${tick.label ? ' forma-compass__tick--label' : ''}${tick.major ? ' forma-compass__tick--major' : ''}`}
        style={{ left: `${(tick.x * 100).toFixed(2)}%` }} aria-hidden="true">{tick.label}</span>)}
      {placed.map((marker) => {
        const close = Math.abs(marker.relative) < 0.35 || marker.kind === 'objective' || marker.kind === 'goal'
        return <span key={marker.id} className="forma-compass__marker" data-kind={marker.kind} data-pinned={marker.pinned ? (marker.x < 0.5 ? 'left' : 'right') : undefined}
          style={{ left: `${(marker.x * 100).toFixed(2)}%` }} title={marker.label}>
          <HudIcon name={markerIcon[marker.kind]} />{close && <small>{formatDistance(marker.distance)}</small>}
        </span>
      })}
    </div>
    <span className="forma-compass__needle" aria-hidden="true" />
    <span className="forma-compass__heading" aria-hidden="true">{degrees}°</span>
  </div>
}, same)

const BossBar = memo(function BossBar({ name, health, max }: NonNullable<HudModel['boss']>) {
  const ghost = useTrail(health, max), phase = bossPhase(health, max)
  return <div className="forma-boss" data-phase={phase}>
    <div className="forma-boss__name"><HudIcon name="skull" /><span>{name}</span>{phase > 0 && <small>Fase {phase + 1}</small>}</div>
    <div className="forma-boss__bar" role="meter" aria-label={`Chefe: ${name}`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={health}>
      <div className="forma-boss__ghost" ref={ghost} /><div className="forma-boss__fill" style={{ width: percent(health, max) }} />
      {bossPhases(max).map((threshold) => <i key={threshold} style={{ left: `${threshold * 100}%` }} data-passed={barFraction(health, max) <= threshold || undefined} />)}
    </div>
  </div>
}, same)

const Vitals = memo(function Vitals({ health, maxHealth, stamina, maxStamina, effects }: Pick<HudModel, 'health' | 'maxHealth' | 'stamina' | 'maxStamina' | 'effects'>) {
  const ghost = useTrail(health, maxHealth), staminaGhost = useTrail(stamina, maxStamina), tone = vitalTone(health, maxHealth)
  const ring = 2 * Math.PI * 17
  return <div className="forma-vitals">
    {effects.length > 0 && <ul className="forma-effects" aria-label="Poderes ativos">{effects.map((effect) => <li key={effect.power} className="forma-effect" data-power={effect.power}
      data-ending={effect.seconds <= 3 || undefined} title={powerLabels[effect.power]}>
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="17" className="forma-effect__track" />
        <circle cx="20" cy="20" r="17" className="forma-effect__ring" strokeDasharray={ring.toFixed(2)} strokeDashoffset={ringOffset(effect.seconds, effect.total, ring).toFixed(2)} /></svg>
      <HudIcon name={powerIcon[effect.power]} /><span className="forma-sr">{powerLabels[effect.power]}</span><b>{Math.ceil(effect.seconds)}</b>
    </li>)}</ul>}
    <div className="forma-vital" data-tone={tone} data-low={lowHealth(health, maxHealth) || undefined}>
      <span className="forma-vital__badge"><HudIcon name="heart" /></span>
      <div className="forma-vital__body">
        <div className="forma-meter" role="meter" aria-label="Vida" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={health}>
          <div className="forma-meter__ghost" ref={ghost} />
          <div className="forma-meter__fill" style={{ width: percent(health, maxHealth) }} />
          <div className="forma-meter__ticks" style={{ backgroundSize: `${Math.min(100, 2500 / Math.max(1, maxHealth))}% 100%` }} />
        </div>
        <span className="forma-vital__value"><b>{Math.max(0, Math.ceil(health))}</b>/{maxHealth}</span>
      </div>
    </div>
    {maxStamina > 0 && <div className="forma-vital forma-vital--stamina" data-tone={vitalTone(stamina, maxStamina)}>
      <span className="forma-vital__badge"><HudIcon name="bolt" /></span>
      <div className="forma-meter forma-meter--thin" role="meter" aria-label="Estamina" aria-valuemin={0} aria-valuemax={maxStamina} aria-valuenow={Math.round(stamina)}>
        <div className="forma-meter__ghost" ref={staminaGhost} /><div className="forma-meter__fill" style={{ width: percent(stamina, maxStamina) }} />
      </div>
    </div>}
  </div>
}, same)

const Hotbar = memo(function Hotbar({ weapon, weaponLabel, items, quickbar, onSlot }: Pick<HudModel, 'weapon' | 'weaponLabel' | 'items' | 'quickbar'> & { onSlot?: (slot: number) => void }) {
  const fallback = [{ item: null, name: 'Mãos vazias', count: 0, icon: 'fist' as const }, ...(weapon === 'none' ? [] : [{ item: '@weapon', name: weaponLabel, count: 1, icon: weaponIcon[weapon] }]), ...hotbarItems(items).slots.map(slot => ({ ...slot, item: slot.name }))]
  const slots = quickbar?.slots ?? Array.from({ length: 5 }, (_, i) => fallback[i] ?? { item: null, name: 'Vazio', count: 0, icon: 'bag' as const })
  return <div className="forma-hotbar" role="toolbar" aria-label="Barra de atalhos · scroll ou 1 a 5">
    {slots.map((slot, i) => <button type="button" key={i} className={`forma-slot${i === (quickbar?.selected ?? (weapon === 'none' ? 0 : 1)) ? ' forma-slot--weapon' : ''}`} aria-label={`Slot ${i + 1}: ${slot.name}`} aria-pressed={i === (quickbar?.selected ?? 0)} title={`${slot.name} · ${i + 1}`} onClick={() => onSlot?.(i)}>
      <span className="forma-slot__key">{i + 1}</span>{(i === 0 || slot.item) && <HudIcon name={slot.icon} />}{slot.count > 1 && <b className="forma-slot__count">×{slot.count}</b>}<span className="forma-slot__name">{slot.name}</span>
    </button>)}
  </div>
}, same)

function Prompt({ prompt, device }: { prompt: HudPrompt; device: InputDevice }) {
  return <div className="forma-prompt" data-enemy={prompt.enemy || undefined} data-locked={prompt.locked ? true : undefined}>
    {prompt.locked ? <span className="forma-prompt__lock"><HudIcon name="lock" /></span> : <InputGlyph glyph={glyph(prompt.enemy ? 'attack' : 'interact', device)} />}
    <span className="forma-prompt__text"><span>{prompt.verb}</span> · <b>{prompt.target}</b></span>
    {prompt.health && prompt.health.max > 1 && <span className="forma-prompt__health" aria-label={`Resistência ${prompt.health.value}/${prompt.health.max}`}><i style={{ width: percent(prompt.health.value, prompt.health.max) }} /></span>}
    {prompt.locked && <small className="forma-prompt__needs">{prompt.locked}</small>}
  </div>
}

function Dialogue({ dialogue, device, onOption, register }: { dialogue: HudDialogue; device: InputDevice; onOption?: (index: number) => void; register: Register }) {
  const key = `${dialogue.name}\n${dialogue.index}\n${dialogue.line}`
  const [typing, setTyping] = useState({ key, count: 0 })
  const [choice, setChoice] = useState({ key, index: 0 })
  const count = typing.key === key ? typing.count : 0, selected = choice.key === key ? choice.index : 0
  const options = dialogue.options, done = count >= dialogue.line.length
  useEffect(() => {
    const started = performance.now(), cps = reducedMotion() ? 1e6 : TYPE_CPS
    const timer = setInterval(() => {
      const next = typedLength(dialogue.line, performance.now() - started, cps)
      setTyping((previous) => previous.key === key && previous.count >= next ? previous : { key, count: Math.max(next, previous.key === key ? previous.count : 0) })
      if (next >= dialogue.line.length) clearInterval(timer)
    }, 33)
    return () => clearInterval(timer)
  }, [key, dialogue.line])
  useEffect(() => {
    const choose = (index: number) => { if (options.length) onOption?.(Math.min(options.length - 1, Math.max(0, index))) }
    const move = (step: number) => setChoice({ key, index: (selected + step + options.length) % options.length })
    register('skip', () => { if (done) return false; setTyping({ key, count: dialogue.line.length }); return true })
    register('dialogue', (action: MenuAction) => {
      if (!options.length) return false
      if (action === 'up' || action === 'down') move(action === 'down' ? 1 : -1)
      else if (action === 'confirm') choose(selected)
      return true
    })
    const keyDown = (event: KeyboardEvent) => {
      if (!options.length || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code === 'ArrowDown' || event.code === 'ArrowUp') { move(event.code === 'ArrowDown' ? 1 : -1) }
      else if (event.code === 'Enter' || event.code === 'KeyE' || event.code === 'NumpadEnter') { if (!event.repeat) choose(selected) }
      else return
      event.preventDefault(); event.stopPropagation()
    }
    window.addEventListener('keydown', keyDown, true)
    return () => { window.removeEventListener('keydown', keyDown, true); register('dialogue', null); register('skip', null) }
  }, [register, key, selected, options.length, done, dialogue.line.length, onOption])
  return <section className="forma-dialogue" role="dialog" aria-label={`Diálogo com ${dialogue.name}`}>
    <Portrait portrait={dialogue.portrait} name={dialogue.name} />
    <div className="forma-dialogue__body">
      <header><strong>{dialogue.name}</strong>{dialogue.total > 1 && <span className="forma-dialogue__step" aria-label={`Fala ${dialogue.index} de ${dialogue.total}`}>
        {Array.from({ length: Math.min(dialogue.total, 8) }, (_, index) => <i key={index} data-on={index < dialogue.index || undefined} />)}<small>{dialogue.index}/{dialogue.total}</small></span>}</header>
      <p className="forma-dialogue__line"><span>{dialogue.line.slice(0, count)}</span><span className="forma-dialogue__pending">{dialogue.line.slice(count)}</span></p>
      {options.length > 0 ? <ol className="forma-dialogue__options" aria-label="Respostas">{options.map((option, index) => <li key={index}>
        <button type="button" aria-current={index === selected || undefined} onMouseEnter={() => setChoice({ key, index })} onClick={() => onOption?.(index)}>
          <span className="forma-dialogue__bullet">{index + 1}</span>{option}</button></li>)}</ol>
        : <footer className="forma-dialogue__next"><InputGlyph glyph={glyph('interact', device)} />{done ? dialogue.index < dialogue.total ? 'Continuar' : 'Encerrar' : 'Pular'}</footer>}
    </div>
  </section>
}

function HelpPanel({ device }: { device: InputDevice }) {
  return <dl className="forma-help" aria-label="Controles do jogo">
    {controlActions.map((action) => <div key={action}><dt><InputGlyph glyph={glyph(action, device)} /></dt><dd>{actionNames[action]}</dd></div>)}
    <div><dt><kbd className="forma-glyph forma-glyph--wide">0–9</kbd></dt><dd>Gatilhos definidos na cena</dd></div>
    <div><dt><kbd className="forma-glyph">B</kbd></dt><dd>Inventário e fabricação</dd></div>
    <div><dt><kbd className="forma-glyph forma-glyph--wide">C / Espaço</kbd></dt><dd>Mergulhar / subir na água</dd></div>
    <div><dt><HudIcon name="jump" /></dt><dd>Pular em cima derrota inimigos</dd></div>
  </dl>
}

function Hints({ device, fly }: { device: InputDevice; fly: boolean }) {
  const hints: [GameAction, string][] = [['interact', 'Interagir'], ['jump', fly ? 'Subir' : 'Pular'], ...(fly ? [['down', 'Descer'] as [GameAction, string]] : []), ['dodge', 'Esquivar'],
    ['camera', 'Câmera'], ['help', 'Ajuda'], ['pause', 'Pausa']]
  return <ul className="forma-hints" aria-label="Atalhos">{hints.map(([action, label]) => <li key={action}><InputGlyph glyph={glyph(action, device)} />{label}</li>)}</ul>
}

function TitleCard({ title, leaving }: { title: HudModel['title']; leaving: boolean }) {
  return <div className="forma-title" data-leaving={leaving || undefined}>
    <span className="forma-kicker">Nova fase</span>
    <h2>{title.name}</h2>
    <span className="forma-title__rule" aria-hidden="true" />
    {title.premise && <p className="forma-title__premise">{title.premise}</p>}
    {title.objective && <p className="forma-title__objective"><HudIcon name="diamond" />{title.objective}</p>}
  </div>
}

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  const id = useId(), clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next / step) * step))
  return <div className="forma-setting">
    <label htmlFor={id}>{label}</label>
    <div className="forma-range">
      <button type="button" aria-label={`Diminuir ${label.toLowerCase()}`} onClick={() => onChange(clamp(value - step * 5))}>−</button>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(clamp(Number(event.currentTarget.value)))} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as CSSProperties} />
      <button type="button" aria-label={`Aumentar ${label.toLowerCase()}`} onClick={() => onChange(clamp(value + step * 5))}>+</button>
      <span className="forma-range__value">{format(value)}</span>
    </div>
  </div>
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="forma-setting forma-setting--toggle"><span>{label}</span>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="forma-switch" onClick={() => onChange(!checked)}><i /></button></div>
}
function SettingsPanel({ settings, onSettings }: { settings: PlaySettings; onSettings: (settings: PlaySettings) => void }) {
  const set = (patch: Partial<PlaySettings>) => onSettings(sanitizeSettings({ ...settings, ...patch }))
  return <div className="forma-settings" aria-label="Configurações">
    <h3>Configurações</h3>
    <Range label="Volume" value={Math.round(settings.volume * 100)} min={0} max={100} step={1} format={(value) => `${value}%`} onChange={(value) => set({ volume: value / 100 })} />
    <Range label="Sensibilidade do mouse" value={Math.round(settings.sensitivity * 100)} min={SENSITIVITY_RANGE[0] * 100} max={SENSITIVITY_RANGE[1] * 100} step={5}
      format={(value) => `${(value / 100).toFixed(2).replace('.', ',')}×`} onChange={(value) => set({ sensitivity: value / 100 })} />
    <Toggle label="Inverter eixo Y" checked={settings.invertY} onChange={(invertY) => set({ invertY })} />
    <div className="forma-setting"><span id="forma-quality-label">Qualidade gráfica</span>
      <div className="forma-segmented" role="group" aria-labelledby="forma-quality-label">{qualityOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={settings.quality === value}
        onClick={() => set({ quality: value })}>{label}</button>)}</div></div>
    <Toggle label="Legendas" checked={settings.subtitles} onChange={(subtitles) => set({ subtitles })} />
    <Toggle label="Mostrar FPS" checked={settings.showFps} onChange={(showFps) => set({ showFps })} />
  </div>
}
function ControlsPanel() {
  return <div className="forma-controls" aria-label="Controles">
    <h3>Controles</h3>
    <table><thead><tr><th>Ação</th><th>Teclado e mouse</th><th>Controle</th></tr></thead>
      <tbody>{controlActions.map((action) => <tr key={action}><td>{actionNames[action]}</td><td><InputGlyph glyph={glyph(action, 'keyboard')} /></td><td><InputGlyph glyph={glyph(action, 'gamepad')} /></td></tr>)}</tbody></table>
  </div>
}

function PauseMenu({ model, settings, onSettings, onResume, onRestart, onExit, register }: Pick<ThreeHudProps, 'settings' | 'onSettings' | 'onResume' | 'onRestart' | 'onExit'> & { model: HudModel; register: Register }) {
  const [tab, setTab] = useState<'menu' | 'settings' | 'controls'>('menu')
  const root = useRef<HTMLDivElement>(null), first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    register('pause', (action) => {
      if (action === 'up' || action === 'down') moveFocus(root.current, action === 'down' ? 1 : -1)
      else if (action === 'confirm') confirmFocus(root.current)
      else if (tab !== 'menu') { setTab('menu'); first.current?.focus() }
      else onResume()
      return true
    })
    return () => register('pause', null)
  }, [register, tab, onResume])
  const timer = timerText(model.time, model.limit), stats = model.stats
  return <div className="forma-overlay forma-pause" role="dialog" aria-modal="true" aria-label="Pausa" ref={root} onKeyDown={arrowNavigation}>
    <div className="forma-pause__menu">
      <span className="forma-kicker">{model.title.name || 'Modo jogo'}</span>
      <h2>Pausa</h2>
      <nav aria-label="Menu de pausa">
        <button type="button" ref={first} className="forma-menu-item forma-menu-item--primary" onClick={onResume}><HudIcon name="play" />Continuar</button>
        <button type="button" className="forma-menu-item" onClick={onRestart}><HudIcon name="restart" />Reiniciar</button>
        <button type="button" className="forma-menu-item" aria-pressed={tab === 'settings'} onClick={() => setTab(tab === 'settings' ? 'menu' : 'settings')}><HudIcon name="settings" />Configurações</button>
        <button type="button" className="forma-menu-item" aria-pressed={tab === 'controls'} onClick={() => setTab(tab === 'controls' ? 'menu' : 'controls')}><HudIcon name="controls" />Controles</button>
        <button type="button" className="forma-menu-item forma-menu-item--danger" onClick={onExit}><HudIcon name="exit" />Sair do jogo</button>
      </nav>
      <p className="forma-pause__hint"><InputGlyph glyph={glyph('back', model.device)} />Voltar ao jogo</p>
    </div>
    <div className="forma-pause__panel">
      {tab === 'settings' ? <SettingsPanel settings={settings} onSettings={onSettings} /> : tab === 'controls' ? <ControlsPanel /> : <div className="forma-pause__summary">
        <span className="forma-kicker"><HudIcon name={model.objectiveDone ? 'check' : 'diamond'} />Objetivo atual</span>
        <p>{model.objective || 'Explore livremente.'}</p>
        <dl>
          <div><dt>{timer.countdown ? 'Restante' : 'Tempo'}</dt><dd>{timer.text}</dd></div>
          <div><dt>Pontuação</dt><dd>{formatScore(stats.score)}</dd></div>
          {stats.total > 0 && <div><dt>Coletados</dt><dd>{stats.collected}/{stats.total}</dd></div>}
          {stats.enemyTotal > 0 && <div><dt>Derrotados</dt><dd>{stats.defeated}/{stats.enemyTotal}</dd></div>}
        </dl>
      </div>}
    </div>
  </div>
}

function Outcome({ model, onRestart, onExit, onDismissOutcome, register }: Pick<ThreeHudProps, 'onRestart' | 'onExit' | 'onDismissOutcome'> & { model: HudModel; register: Register }) {
  const won = model.phase === 'won', summary = outcomeSummary(model.stats, won), timeout = !won && model.limit > 0 && model.time >= model.limit
  const root = useRef<HTMLDivElement>(null), primary = useRef<HTMLButtonElement>(null)
  useEffect(() => { primary.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    register('outcome', (action) => {
      if (action === 'up' || action === 'down') moveFocus(root.current, action === 'down' ? 1 : -1)
      else if (action === 'confirm') confirmFocus(root.current)
      return true
    })
    return () => register('outcome', null)
  }, [register])
  return <div className="forma-overlay forma-outcome" data-result={won ? 'won' : 'lost'} role="dialog" aria-modal="true" aria-label={won ? 'Vitória' : 'Fim de jogo'} ref={root} onKeyDown={arrowNavigation}>
    <div className="forma-outcome__card">
      <span className="forma-outcome__emblem"><HudIcon name={won ? 'trophy' : timeout ? 'clock' : 'skull'} /></span>
      {model.title.name && <span className="forma-kicker">{model.title.name}</span>}
      <h2>{won ? 'Vitória!' : timeout ? 'Tempo esgotado' : 'Derrota'}</h2>
      {won && <div className="forma-stars" role="img" aria-label={`${summary.stars} de 3 estrelas`}>{[0, 1, 2].map((index) => <HudIcon key={index} name="star" className={index < summary.stars ? 'is-on' : ''} />)}</div>}
      <dl className="forma-outcome__stats">{summary.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      <div className="forma-outcome__actions">
        <button type="button" ref={primary} className="forma-button forma-button--primary" onClick={onRestart}><HudIcon name="restart" />Jogar de novo</button>
        {won && <button type="button" className="forma-button" onClick={onDismissOutcome}><HudIcon name="play" />Continuar explorando</button>}
        <button type="button" className="forma-button forma-button--quiet" onClick={onExit}><HudIcon name="exit" />Sair</button>
      </div>
    </div>
  </div>
}

interface Plate { root: HTMLDivElement; name: HTMLSpanElement; icon: SVGUseElement; key: HTMLElement; fill: HTMLElement; text: string; state: string }
const svgNs = 'http://www.w3.org/2000/svg'
const iconNode = (prefix: string, name: string) => {
  const svg = document.createElementNS(svgNs, 'svg'), use = document.createElementNS(svgNs, 'use')
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'forma-icon')
  use.setAttribute('href', `#${prefix}-${name}`)
  svg.appendChild(use)
  return { svg, use }
}
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const removeAfter = (node: HTMLElement, ms: number) => {
  const done = () => node.remove()
  node.addEventListener('animationend', (event) => { if (event.target === node) done() })
  setTimeout(done, ms)
}

/** Game-mode HUD. React renders the model; per-frame plates, damage numbers, hit markers, pickups and hurt arcs go through the `overlay` handle. */
export default function ThreeHud({ model, toasts, overlay, settings, presentation = false, onResume, onRestart, onExit, onDismissOutcome, onCaptureMouse, onDialogueOption, onSettings, onPause, onInventory, onSlot }: ThreeHudProps) {
  const prefix = `forma-hud-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const ui = useRef<HTMLDivElement>(null), plates = useRef<HTMLDivElement>(null), numbers = useRef<HTMLDivElement>(null), marker = useRef<HTMLDivElement>(null)
  const arcs = useRef<HTMLDivElement>(null), pickups = useRef<HTMLDivElement>(null)
  const pool = useRef(new Map<string, Plate>()), size = useRef({ width: 0, height: 0 }), damage = useRef<DamageEntry[]>([]), sequence = useRef(0)
  const handlers = useRef<{ pause: MenuHandler | null; outcome: MenuHandler | null; dialogue: MenuHandler | null; skip: (() => boolean) | null }>({ pause: null, outcome: null, dialogue: null, skip: null })
  const register = useCallback<Register>((slot, handler) => { (handlers.current as Record<string, unknown>)[slot] = handler }, [])
  const device = useRef(model.device), phase = useRef(model.phase)
  useEffect(() => { device.current = model.device; phase.current = model.phase }, [model.device, model.phase])
  useEffect(() => {
    const node = ui.current
    if (!node) return
    const measure = () => { size.current = { width: node.clientWidth, height: node.clientHeight } }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useImperativeHandle(overlay, () => ({
    frame(anchors: HudAnchor[]) {
      const layer = plates.current
      if (!layer) return
      const views = layoutAnchors(anchors, size.current.width, size.current.height), seen = new Set<string>()
      const interact = glyph('interact', device.current).label
      for (const view of views) {
        seen.add(view.id)
        let plate = pool.current.get(view.id)
        if (!plate) {
          const root = element('div', 'forma-plate'), head = element('div', 'forma-plate__head'), name = element('span', 'forma-plate__name'), key = element('kbd', 'forma-glyph forma-plate__key')
          const bar = element('div', 'forma-plate__bar'), fill = element('i', ''), icon = iconNode(prefix, 'skull')
          bar.appendChild(fill); head.append(icon.svg, name, key); root.append(head, bar); layer.appendChild(root)
          plate = { root, name, icon: icon.use, key, fill, text: '', state: '' }
          pool.current.set(view.id, plate)
        }
        if (plate.text !== view.name) { plate.text = view.name; plate.name.textContent = view.name }
        const state = `${view.kind}|${view.focus}|${view.showName}|${view.showBar}|${interact}`
        if (plate.state !== state) {
          plate.state = state
          plate.root.dataset.kind = view.kind
          plate.root.dataset.focus = String(view.focus)
          plate.root.dataset.name = String(view.showName)
          plate.root.dataset.bar = String(view.showBar)
          plate.icon.setAttribute('href', `#${prefix}-${view.kind === 'npc' ? 'speech' : 'skull'}`)
          plate.key.textContent = interact
        }
        plate.root.style.display = ''
        plate.root.style.opacity = view.opacity.toFixed(2)
        plate.root.style.transform = `translate3d(${view.x.toFixed(1)}px, ${view.y.toFixed(1)}px, 0) scale(${view.scale.toFixed(3)})`
        plate.fill.style.width = `${(view.fraction * 100).toFixed(1)}%`
      }
      for (const [id, plate] of pool.current) {
        if (seen.has(id)) continue
        if (pool.current.size > 32) { plate.root.remove(); pool.current.delete(id) } else plate.root.style.display = 'none'
      }
    },
    damage(x: number, y: number, amount: number, kind) {
      const layer = numbers.current
      if (!layer || !Number.isFinite(amount)) return
      const id = ++sequence.current
      damage.current = pushDamage(damage.current, { x, y, amount, kind }, performance.now(), id)
      const entry = damage.current[damage.current.length - 1], node = element('span', `forma-damage forma-damage--${kind}`, damageText(amount, kind))
      node.style.left = `${x.toFixed(1)}px`; node.style.top = `${y.toFixed(1)}px`
      node.style.setProperty('--stack', `${-entry.offset}px`)
      node.style.setProperty('--drift', `${(id * 37) % 29 - 14}px`)
      layer.appendChild(node)
      while (layer.childElementCount > DAMAGE_MAX) layer.firstElementChild?.remove()
      removeAfter(node, DAMAGE_LIFE + 250)
    },
    hit(kind) {
      const node = marker.current
      if (!node) return
      node.dataset.kind = kind
      node.classList.remove('is-active')
      void node.offsetWidth
      node.classList.add('is-active')
    },
    pickup(card) {
      const layer = pickups.current
      if (!layer) return
      const node = element('div', 'forma-pickup'), badge = element('span', 'forma-pickup__icon'), text = element('span', 'forma-pickup__text')
      badge.appendChild(iconNode(prefix, isHudIcon(card.icon) ? card.icon : itemIcon(card.name)).svg)
      text.append(element('small', '', 'Item obtido'), element('b', '', card.name))
      node.append(badge, text)
      if (card.count > 1) node.appendChild(element('span', 'forma-pickup__count', `×${card.count}`))
      layer.appendChild(node)
      while (layer.childElementCount > 3) layer.firstElementChild?.remove()
      removeAfter(node, 3400)
    },
    hurtFrom(angle: number) {
      const layer = arcs.current
      if (!layer || !Number.isFinite(angle)) return
      const node = element('div', 'forma-hurtdir')
      node.style.setProperty('--angle', `${toDegrees(angle).toFixed(1)}deg`)
      layer.appendChild(node)
      while (layer.childElementCount > 4) layer.firstElementChild?.remove()
      removeAfter(node, 1300)
    },
    menu(action) {
      const current = phase.current
      handlers.current[current === 'paused' ? 'pause' : current === 'won' || current === 'lost' ? 'outcome' : 'dialogue']?.(action)
    },
    skipTyping: () => handlers.current.skip?.() ?? false,
  }), [prefix])

  const title = usePresence(model.phase === 'title', 520)
  const playing = model.phase === 'playing' || model.phase === 'title'
  const showFps = settings.showFps && !presentation && model.fps !== null
  const timer = timerText(model.time, model.limit)
  const view = model.fly ? 'Voo' : model.view === 'third' ? '3ª pessoa' : '1ª pessoa'
  const subtitle = settings.subtitles && model.subtitle && !model.dialogue ? model.subtitle : null
  return <div className="forma-hud" role="region" aria-label="Modo jogo" data-device={model.device} data-phase={model.phase}>
    <HudIconSprite prefix={prefix} />
    <div className="forma-hud__ui" ref={ui}>
      <div className="forma-vignette" data-low={lowHealth(model.health, model.maxHealth) || undefined} aria-hidden="true" />
      {model.hurt > 0 && <div key={model.hurt} className="forma-hurt" aria-hidden="true" />}
      <div className="forma-hud__plates" ref={plates} aria-hidden="true" />
      <div className="forma-hud__arcs" ref={arcs} aria-hidden="true" />
      <div className="forma-hud__numbers" ref={numbers} aria-hidden="true" />
      <div className="forma-crosshair" data-target={model.prompt ? model.prompt.enemy ? 'enemy' : 'interact' : undefined} aria-hidden="true"><i /><i /><i /><i /><b /></div>
      <div className="forma-hitmarker" ref={marker} aria-hidden="true"><i /><i /><i /><i /></div>
      {model.prompt && !model.dialogue && model.phase !== 'paused' && <Prompt prompt={model.prompt} device={model.device} />}

      <div className="forma-hud__row forma-hud__row--top">
        <div className="forma-hud__cell">
          {model.hudStyle !== 'minimal' && (model.playStyle === 'sandbox' ? <section className="forma-tracker forma-exploration" aria-label="Exploração"><header className="forma-kicker"><HudIcon name="wing" />Sua jornada</header><p>Explore, experimente, construa.</p><small>{model.discoveries ?? 0} locais descobertos · sem destino obrigatório</small></section> : <Tracker objective={model.objective} done={model.objectiveDone} collected={model.collected} total={model.total} defeated={model.defeated} enemyTotal={model.enemyTotal}
            tracker={model.tracker} heading={model.compass.heading} omitted={model.omitted} steps={model.questSteps} />)}
        </div>
        <div className="forma-hud__cell forma-hud__cell--center">
          {model.hudStyle !== 'minimal' && <Compass heading={model.compass.heading} markers={model.compass.markers} />}
          {model.boss && <BossBar name={model.boss.name} health={model.boss.health} max={model.boss.max} />}
          <ul className="forma-toasts" role="status">{toasts.map((item) => <li key={item.id}>{item.text}</li>)}</ul>
        </div>
        <div className="forma-hud__cell forma-hud__cell--end">
          <div className="forma-info">
            {model.hudStyle !== 'minimal' && model.playStyle !== 'sandbox' && <span className="forma-pill forma-pill--score" aria-label="Pontuação"><HudIcon name="star" />{formatScore(model.score)}</span>}
            {(model.hudStyle !== 'minimal' || model.limit > 0) && model.playStyle !== 'sandbox' && <span className="forma-pill" aria-label="Tempo de jogo" data-urgent={timer.urgent || undefined}><HudIcon name="clock" />{timer.text}{timer.countdown && <small>restantes</small>}</span>}
            {model.clock && <span className="forma-pill" aria-label="Hora do dia">{model.clock}</span>}
          </div>
          <div className="forma-info forma-info--meta">
            <span className="forma-pill forma-pill--quiet">{model.muted && <HudIcon name="mute" />}<HudIcon name={model.fly ? 'wing' : 'eye'} />{view}</span>
            {showFps && <span className="forma-pill forma-pill--quiet" aria-label="Quadros por segundo">{model.fps} FPS</span>}
            {playing && onInventory && (model.hudStyle !== 'minimal' || !!model.items.length || !!model.recipes?.length) && <button type="button" className="forma-corner-button" onClick={onInventory}><HudIcon name="bag" />Inventário · B</button>}
            {playing && onPause && <button type="button" className="forma-corner-button" aria-label="Pausar" title="Pausar" onClick={onPause}><HudIcon name="pause" /></button>}
            {playing && <button type="button" className="forma-corner-button forma-corner-button--exit" onClick={onExit}><HudIcon name="exit" />Sair do jogo</button>}
          </div>
        </div>
      </div>

      <div className="forma-hud__row forma-hud__row--middle">
        <div className="forma-hud__cell" />
        <div className="forma-hud__cell" />
        <div className="forma-hud__cell forma-hud__cell--end"><div className="forma-pickups" ref={pickups} aria-hidden="true" /></div>
      </div>

      <div className="forma-hud__row forma-hud__row--bottom">
        <div className="forma-hud__cell">
          {(model.hudStyle !== 'minimal' || model.health < model.maxHealth || model.effects.length > 0) && <Vitals health={model.health} maxHealth={model.maxHealth} stamina={model.stamina} maxStamina={model.maxStamina} effects={model.effects} />}
          {model.oxygen !== undefined && model.oxygen < 100 && <div className="forma-oxygen" role="meter" aria-label="Fôlego" aria-valuenow={model.oxygen} aria-valuemin={0} aria-valuemax={100}>Fôlego {model.oxygen}%<span style={{ width: `${model.oxygen}%` }} /></div>}
        </div>
        <div className="forma-hud__cell forma-hud__cell--center">
          {model.dialogue && <Dialogue dialogue={model.dialogue} device={model.device} onOption={onDialogueOption} register={register} />}
          {subtitle && <p className="forma-subtitle" aria-live="polite"><b>{subtitle.speaker}</b>{subtitle.text}</p>}
          {model.hudStyle !== 'minimal' && <Hotbar weapon={model.weapon} weaponLabel={model.weaponLabel} items={model.items} quickbar={model.quickbar} onSlot={onSlot} />}
          {model.placement && <p className="forma-placement" data-valid={model.placement.valid}>{model.placement.name} · {model.placement.reason}</p>}
        </div>
        <div className="forma-hud__cell forma-hud__cell--end">
          {playing && !model.pointerLocked && model.device === 'keyboard' && <button type="button" className="forma-capture" onClick={onCaptureMouse}>
            <InputGlyph glyph={glyph('attack', 'keyboard')} />Clique para capturar o mouse · ou arraste para olhar</button>}
          {model.help ? <HelpPanel device={model.device} /> : <Hints device={model.device} fly={model.fly} />}
        </div>
      </div>

      {title.mounted && <TitleCard title={model.title} leaving={title.leaving} />}
      {model.phase === 'paused' && <PauseMenu model={model} settings={settings} onSettings={onSettings} onResume={onResume} onRestart={onRestart} onExit={onExit} register={register} />}
      {(model.phase === 'won' || model.phase === 'lost') && <Outcome key={model.phase} model={model} onRestart={onRestart} onExit={onExit} onDismissOutcome={onDismissOutcome} register={register} />}
    </div>
  </div>
}

