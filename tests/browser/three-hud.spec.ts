import { expect, test, type Page } from '@playwright/test'

// The HUD is mounted alone over a painted backdrop (bright sky over a dark ground) with a rich sample model, so layout and legibility are reviewed without WebGL.
const sizes = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }] as const

async function mount(page: Page, size: { width: number; height: number }) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()) })
  await page.setViewportSize(size)
  await page.route('http://127.0.0.1:8011/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/')
  await page.evaluate(async () => {
    // Reuse the exact optimized React URLs the app uses, so the HUD and the harness share one React instance.
    const main = await (await fetch('/src/main.tsx')).text()
    const url = (name: string) => { const match = main.match(new RegExp(`from\\s+["'](/[^"']*${name}[^"']*)["']`)); if (!match) throw new Error(`no ${name} in main.tsx`); return match[1] }
    const reactModule = await import(/* @vite-ignore */ url('react\\.js'))
    const React = reactModule.createElement ? reactModule : reactModule.default
    const client = await import(/* @vite-ignore */ url('react-dom_client'))
    const createRoot = client.createRoot ?? client.default.createRoot
    const { default: ThreeHud } = await import(/* @vite-ignore */ '/src/three/ThreeHud.tsx')
    const { portraitFor } = await import(/* @vite-ignore */ '/src/three/sceneHud.ts')
    document.getElementById('root')!.style.display = 'none'
    const host = document.createElement('div')
    host.id = 'hud-harness'
    Object.assign(host.style, { position: 'fixed', inset: '0', background: 'linear-gradient(180deg, #9fd3ff 0%, #d9efff 46%, #6f8a54 52%, #23301f 78%, #101410 100%)' })
    const ruler = document.createElement('div')
    Object.assign(ruler.style, { position: 'absolute', left: '0', right: '0', top: '50%', height: '1px', background: 'rgba(255,255,255,0.25)' })
    host.appendChild(ruler)
    document.body.appendChild(host)
    const deg = (value: number) => value * Math.PI / 180
    const base = {
      phase: 'playing', title: { name: 'Ruínas de Valemar', premise: 'A névoa cobriu o vale e o dragão acordou sob o castelo. Recupere os três cristais antes do anoitecer.', objective: 'Recupere os cristais e derrote o dragão' },
      health: 62, maxHealth: 100, stamina: 40, maxStamina: 100, objective: 'Recupere os cristais do santuário e derrote o Dragão Ancião', objectiveDone: false,
      tracker: { label: 'Santuário do Leste', distance: 48, bearing: deg(38) },
      compass: { heading: deg(12), markers: [
        { id: 'o', kind: 'objective', bearing: deg(38), distance: 48, label: 'Santuário' }, { id: 'n', kind: 'npc', bearing: deg(-28), distance: 9, label: 'Mercadora' },
        { id: 'e1', kind: 'enemy', bearing: deg(60), distance: 14, label: 'Goblin' }, { id: 'g', kind: 'goal', bearing: deg(200), distance: 140, label: 'Portal' }, { id: 'i', kind: 'item', bearing: deg(-5), distance: 6, label: 'Chave' }] },
      score: 1240, collected: 2, total: 3, defeated: 4, enemyTotal: 7, time: 187, limit: 0, clock: '17:40',
      weapon: 'sword', weaponLabel: 'Espada', items: [{ name: 'Chave de ferro', count: 1 }, { name: 'Poção de vida', count: 3 }, { name: 'Moeda antiga', count: 12 }, { name: 'Pergaminho', count: 1 }],
      effects: [{ power: 'shield', seconds: 7.2, total: 10 }, { power: 'speed', seconds: 2.4, total: 10 }],
      prompt: { verb: 'Atacar', target: 'Dragão Ancião', locked: null, enemy: true, health: { value: 14, max: 24 } },
      boss: { name: 'Dragão Ancião', health: 14, max: 24 }, dialogue: null, subtitle: null,
      stats: { time: 187, score: 1240, collected: 2, total: 3, defeated: 4, enemyTotal: 7, damageTaken: 38, falls: 1 },
      fly: false, view: 'third', muted: false, pointerLocked: false, help: false, device: 'keyboard', omitted: 0, fps: 58, hurt: 0,
    }
    const dialogue = { ...base, boss: null, prompt: { verb: 'Conversar', target: 'Mercadora', locked: null, enemy: false, health: null },
      dialogue: { name: 'Mercadora Ilsa', line: 'Os cristais brilham à noite, viajante. Se quiser a chave do santuário, traga-me três moedas antigas.', index: 2, total: 4,
        portrait: portraitFor('villager', 3, { hairStyle: 'bun', outfit: '#8a3f3f' }), options: ['Aceito a troca.', 'Quem guarda o santuário?', 'Talvez mais tarde.'] } }
    const settings = { volume: 0.8, sensitivity: 1, invertY: false, quality: 'auto', subtitles: true, showFps: true }
    const overlay = { current: null as null | Record<string, (...args: unknown[]) => void> }
    const root = createRoot(host.appendChild(document.createElement('div')))
    const noop = () => {}
    const w = window as unknown as Record<string, unknown>
    w.hudModels = { base, dialogue }
    w.renderHud = (model: unknown, toasts: unknown[] = [{ id: 1, text: 'Cristal coletado · 2/3' }]) => root.render(React.createElement(ThreeHud, { model, toasts, overlay, settings, onResume: noop, onRestart: noop, onExit: noop,
      onDismissOutcome: noop, onCaptureMouse: noop, onDialogueOption: noop, onSettings: noop, onPause: noop }))
    w.hudOverlay = overlay
  })
  return errors
}
const render = (page: Page, model: string, patch: Record<string, unknown> = {}, toasts?: unknown[]) =>
  page.evaluate(([name, extra, list]) => { const w = window as unknown as { hudModels: Record<string, object>; renderHud: (model: unknown, toasts?: unknown[]) => void }; w.renderHud({ ...w.hudModels[name as string], ...(extra as object) }, list as unknown[] | undefined) }, [model, patch, toasts] as const)
async function box(page: Page, selector: string) {
  const value = await page.locator(selector).first().boundingBox()
  expect(value, selector).not.toBeNull()
  return value!
}
// Headless pages only paint when asked; drive real frames so CSS animations advance like on screen.
const frames = (page: Page, ms: number) => page.evaluate((duration) => new Promise<void>((resolve) => { const start = performance.now(); const step = () => performance.now() - start >= duration ? resolve() : requestAnimationFrame(step); requestAnimationFrame(step) }), ms)
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
async function expectLayout(page: Page, size: { width: number; height: number }, selectors: string[], freeCentre = true) {
  const boxes = await Promise.all(selectors.map(async (selector) => ({ selector, box: await box(page, selector) })))
  for (const { selector, box: item } of boxes) {
    expect(item.x, `${selector} left`).toBeGreaterThanOrEqual(0); expect(item.y, `${selector} top`).toBeGreaterThanOrEqual(0)
    expect(item.x + item.width, `${selector} right`).toBeLessThanOrEqual(size.width); expect(item.y + item.height, `${selector} bottom`).toBeLessThanOrEqual(size.height)
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i].box, boxes[j].box), `${boxes[i].selector} × ${boxes[j].selector}`).toBe(false)
  // The centre stays free: nothing but the crosshair and the prompt within 110 px of the screen centre.
  const centre = { x: size.width / 2 - 110, y: size.height / 2 - 110, width: 220, height: 220 }
  if (freeCentre) for (const { selector, box: item } of boxes) if (!/crosshair|prompt|title/.test(selector)) expect(overlaps(item, centre), `${selector} × centre`).toBe(false)
}

for (const size of sizes) {
  test(`HUD layout and screens at ${size.width}×${size.height}`, async ({ page }) => {
    const errors = await mount(page, size)
    const tag = `${size.width}x${size.height}`
    const hud = page.getByRole('region', { name: 'Modo jogo' })
    await render(page, 'base')
    await expect(hud.getByLabel('Itens coletados')).toHaveText('Itens 2/3')
    await expect(hud.getByLabel('Inimigos derrotados')).toHaveText('Inimigos 4/7')
    await expect(hud.getByRole('meter', { name: 'Vida' })).toHaveAttribute('aria-valuenow', '62')
    await expect(hud).toContainText('Atacar · Dragão Ancião')
    await expect(hud).toContainText('3ª pessoa')
    await expect(hud.getByRole('status')).toContainText('Cristal coletado · 2/3')
    await expect(hud.getByRole('button', { name: 'Sair do jogo', exact: true })).toBeVisible()
    await page.evaluate(([width, height]) => {
      const overlay = (window as unknown as { hudOverlay: { current: Record<string, (...args: unknown[]) => void> } }).hudOverlay.current
      overlay.frame([{ id: 'dragon', x: width * 0.5, y: height * 0.36, distance: 9, name: 'Dragão Ancião', kind: 'boss', health: 14, max: 24, focus: true },
        { id: 'g1', x: width * 0.68, y: height * 0.44, distance: 8, name: 'Goblin', kind: 'enemy', health: 1, max: 3, focus: false },
        { id: 'g2', x: width * 0.79, y: height * 0.47, distance: 16, name: 'Goblin batedor', kind: 'enemy', health: 2, max: 2, focus: false },
        { id: 'npc', x: width * 0.3, y: height * 0.45, distance: 7, name: 'Mercadora', kind: 'npc', health: null, max: null, focus: false }])
      overlay.damage(width * 0.52, height * 0.4, 2, 'dealt'); overlay.damage(width * 0.53, height * 0.4, 4, 'crit'); overlay.damage(width * 0.68, height * 0.42, 1, 'dealt')
      overlay.damage(width * 0.22, height * 0.8, 12, 'taken'); overlay.damage(width * 0.24, height * 0.76, 25, 'heal')
      overlay.hit('hit'); overlay.hurtFrom(-Math.PI / 2.5); overlay.pickup({ name: 'Cristal do Leste', count: 1, icon: 'gem' }); overlay.pickup({ name: 'Moeda antiga', count: 3, icon: 'coin' })
    }, [size.width, size.height])
    await frames(page, 320)
    await expect(page.locator('.forma-plate')).toHaveCount(4)
    await page.screenshot({ path: `.cache/browser/three-hud-combat-${tag}.png` })
    await expectLayout(page, size, ['.forma-tracker', '.forma-compass', '.forma-boss', '.forma-hud__cell--end .forma-info', '.forma-vitals', '.forma-hotbar', '.forma-hints', '.forma-capture', '.forma-pickups', '.forma-crosshair'])
    const prompt = await box(page, '.forma-prompt'), crosshair = await box(page, '.forma-crosshair')
    expect(overlaps(prompt, crosshair)).toBe(false)
    expect(Math.abs(crosshair.x + crosshair.width / 2 - size.width / 2)).toBeLessThan(1)

    await render(page, 'dialogue', { help: true, pointerLocked: true, device: 'gamepad' })
    await expect(page.getByRole('dialog', { name: 'Diálogo com Mercadora Ilsa' })).toContainText('Quem guarda o santuário?')
    await expect(hud.getByLabel('Controles do jogo')).toBeVisible()
    await frames(page, 2600)
    await page.screenshot({ path: `.cache/browser/three-hud-dialogue-${tag}.png` })
    await expectLayout(page, size, ['.forma-tracker', '.forma-compass', '.forma-hud__cell--end .forma-info', '.forma-vitals', '.forma-dialogue', '.forma-help'])
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.forma-dialogue__options button[aria-current]')).toHaveText(/Quem guarda/)

    await render(page, 'base', { phase: 'title', boss: null, prompt: null, health: 100, effects: [] }, [])
    await frames(page, 900)
    await page.screenshot({ path: `.cache/browser/three-hud-title-${tag}.png` })
    expect(overlaps(await box(page, '.forma-title'), await box(page, '.forma-crosshair'))).toBe(false)
    await expectLayout(page, size, ['.forma-title', '.forma-tracker', '.forma-compass', '.forma-vitals', '.forma-hotbar'])
    await expect(hud.getByLabel('Itens coletados')).toHaveText('Itens 2/3')

    await render(page, 'base', { phase: 'paused' }, [])
    const pause = page.getByRole('dialog', { name: 'Pausa' })
    await expect(pause.getByRole('button', { name: 'Sair do jogo', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sair do jogo', exact: true })).toHaveCount(1)
    await expect(pause.getByRole('button', { name: 'Continuar', exact: true })).toBeFocused()
    await pause.getByRole('button', { name: 'Configurações', exact: true }).click()
    await expect(pause.getByRole('switch', { name: 'Inverter eixo Y' })).toHaveAttribute('aria-checked', 'false')
    await expect(pause.getByRole('button', { name: 'Alta', exact: true })).toBeVisible()
    await page.screenshot({ path: `.cache/browser/three-hud-pause-${tag}.png` })
    await expectLayout(page, size, ['.forma-pause__menu', '.forma-pause__panel'], false)
    await pause.getByRole('button', { name: 'Controles', exact: true }).click()
    await expect(pause).toContainText('Ataque pesado')
    await page.screenshot({ path: `.cache/browser/three-hud-controls-${tag}.png` })

    await render(page, 'base', { phase: 'won', objectiveDone: true, boss: null }, [])
    const won = page.getByRole('dialog', { name: 'Vitória' })
    await expect(won.getByRole('button', { name: 'Jogar de novo', exact: true })).toBeVisible()
    await expect(won.getByRole('button', { name: 'Continuar explorando', exact: true })).toBeVisible()
    await expect(won.getByRole('button', { name: 'Sair', exact: true })).toBeVisible()
    await expect(hud).toContainText('Inimigos 4/7')
    await frames(page, 700)
    await page.screenshot({ path: `.cache/browser/three-hud-victory-${tag}.png` })
    await expectLayout(page, size, ['.forma-outcome__card'], false)

    await render(page, 'base', { phase: 'lost', limit: 120, time: 120, boss: null, health: 12 }, [])
    await expect(page.getByRole('dialog', { name: 'Fim de jogo' })).toContainText('Tempo esgotado')
    await frames(page, 500)
    await page.screenshot({ path: `.cache/browser/three-hud-defeat-${tag}.png` })
    expect(errors).toEqual([])
  })
}
