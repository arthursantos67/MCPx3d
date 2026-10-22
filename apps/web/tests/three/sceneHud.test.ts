import assert from 'node:assert/strict'
import { test } from 'node:test'
import { barFraction, bearingTo, bossPhase, bossPhases, compassMarker, compassTicks, createBar, DAMAGE_LIFE, DAMAGE_MAX, damageMotion, damageText, formatClock, formatDistance, headingFromYaw,
  hotbarItems, hudPhase, hurtAngle, itemIcon, layoutAnchors, lowHealth, nearestTarget, normalizeAngle, outcomeSummary, placeMarkers, portraitFor, promptText, pushDamage, relativeBearing,
  ringOffset, safePortraitImage, screenFromNdc, selectBoss, stepBar, timerText, TITLE_SECONDS, typedLength, vitalTone, type DamageEntry, type HudMarker } from '../../src/three/sceneHud.ts'

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
const deg = (value: number) => value * Math.PI / 180

test('bearings follow the camera convention: north is -Z, east is +X, positive relative bearing is to the right', () => {
  near(bearingTo({ x: 0, z: 0 }, { x: 0, z: -5 }), 0)
  near(bearingTo({ x: 0, z: 0 }, { x: 5, z: 0 }), Math.PI / 2)
  near(bearingTo({ x: 0, z: 0 }, { x: -5, z: 0 }), -Math.PI / 2)
  near(Math.abs(bearingTo({ x: 0, z: 0 }, { x: 0, z: 5 })), Math.PI)
  near(headingFromYaw(0), 0)
  near(headingFromYaw(Math.PI / 2), -Math.PI / 2)
  near(relativeBearing(deg(10), deg(350)), deg(20))
  near(normalizeAngle(deg(540)), Math.PI)
  near(normalizeAngle(-Math.PI), Math.PI)
  near(hurtAngle({ x: 0, z: 0 }, { x: 3, z: 0 }, 0), Math.PI / 2)
})

test('compass ticks cover only the visible span, sorted, with cardinal labels in Portuguese', () => {
  const ticks = compassTicks(0)
  assert.ok(ticks.every((tick) => tick.x >= 0 && tick.x <= 1))
  assert.deepEqual(ticks.map((tick) => tick.x), [...ticks.map((tick) => tick.x)].sort((a, b) => a - b))
  const north = ticks.find((tick) => tick.label === 'N')!
  near(north.x, 0.5); assert.equal(north.major, true)
  assert.ok(ticks.some((tick) => tick.label === 'NE') && ticks.some((tick) => tick.label === 'NO'))
  assert.ok(!ticks.some((tick) => tick.label === 'L') && compassTicks(Math.PI / 2).some((tick) => tick.label === 'L' && Math.abs(tick.x - 0.5) < 1e-9))
  assert.ok(!ticks.some((tick) => tick.label === 'S'))
  assert.ok(compassTicks(Math.PI).some((tick) => tick.label === 'S' && Math.abs(tick.x - 0.5) < 1e-9))
})

test('compass markers: in view by position, objectives pinned at the edge, far or unimportant ones dropped, limited and ordered', () => {
  const markers: HudMarker[] = [
    { id: 'goal', kind: 'objective', bearing: deg(170), distance: 300, label: 'Portal' },
    { id: 'npc', kind: 'npc', bearing: deg(-30), distance: 10, label: 'Mercadora' },
    { id: 'behind', kind: 'enemy', bearing: deg(150), distance: 5, label: 'Goblin' },
    { id: 'far', kind: 'enemy', bearing: deg(5), distance: 200, label: 'Orc' },
    { id: 'item', kind: 'item', bearing: deg(40), distance: 8, label: 'Chave' },
  ]
  const placed = placeMarkers(markers, 0)
  assert.deepEqual(placed.map((item) => item.id), ['npc', 'item', 'goal'])
  const goal = placed.find((item) => item.id === 'goal')!
  assert.equal(goal.pinned, true); assert.equal(goal.x, 1)
  near(placed[0].x, 0.5 - 30 / 150)
  const many = Array.from({ length: 20 }, (_, index): HudMarker => ({ id: `n${index}`, kind: 'npc', bearing: deg(index - 10), distance: index, label: '' }))
  const limited = placeMarkers([...many, markers[0]], 0, undefined, 8)
  assert.equal(limited.length, 8)
  assert.ok(limited.some((item) => item.id === 'goal'), 'objective outranks nearby NPCs')
  near(compassMarker('m', 'goal', 'Portal', { x: 0, z: 0 }, { x: 3, z: -4 }).distance, 5)
})

test('quest tracker picks the nearest target', () => {
  assert.equal(nearestTarget({ x: 0, z: 0 }, []), null)
  const best = nearestTarget({ x: 0, z: 0 }, [{ label: 'A', x: 10, z: 0 }, { label: 'B', x: 0, z: -3 }])!
  assert.equal(best.label, 'B'); near(best.distance, 3); near(best.bearing, 0)
})

test('formatting of distance, clock, countdown and prompts', () => {
  assert.equal(formatDistance(12.4), '12 m')
  assert.equal(formatDistance(1530), '1,5 km')
  assert.equal(formatClock(0), '0:00'); assert.equal(formatClock(75.9), '1:15'); assert.equal(formatClock(3725), '1:02:05'); assert.equal(formatClock(-4), '0:00'); assert.equal(formatClock(NaN), '0:00')
  assert.deepEqual(timerText(30, 0), { text: '0:30', countdown: false, urgent: false })
  assert.deepEqual(timerText(52.2, 60), { text: '0:08', countdown: true, urgent: true })
  assert.deepEqual(timerText(90, 60), { text: '0:00', countdown: true, urgent: true })
  assert.equal(promptText({ verb: 'Conversar', target: 'Mercadora' }), 'Conversar · Mercadora')
})

test('damage trail: ghost holds, then drains to the value; healing snaps it; fraction and tones are clamped', () => {
  let bar = createBar(100)
  bar = stepBar(bar, 60, 100, 0.016)
  assert.equal(bar.value, 60); assert.equal(bar.ghost, 100); assert.ok(bar.hold > 0); assert.ok(bar.flash > 0.9)
  bar = stepBar(bar, 60, 100, 0.3)
  assert.equal(bar.ghost, 100, 'still holding')
  for (let i = 0; i < 40; i++) bar = stepBar(bar, 60, 100, 0.05)
  assert.equal(bar.ghost, 60)
  let combo = stepBar(createBar(100), 80, 100, 0)
  combo = stepBar(combo, 50, 100, 0.016)
  assert.equal(combo.ghost, 100, 'consecutive hits keep the highest ghost')
  assert.equal(stepBar(stepBar(createBar(40), 40, 100, 0), 90, 100, 0.016).ghost, 90)
  assert.equal(barFraction(150, 100), 1); assert.equal(barFraction(-5, 100), 0); assert.equal(barFraction(5, 0), 0)
  assert.equal(vitalTone(100, 100), 'full'); assert.equal(vitalTone(70, 100), 'ok'); assert.equal(vitalTone(40, 100), 'low'); assert.equal(vitalTone(20, 100), 'critical')
  assert.equal(lowHealth(30, 100), true); assert.equal(lowHealth(31, 100), false); assert.equal(lowHealth(0, 100), false)
})

test('boss selection prefers engaged, then explicit bosses in range; phases split the bar', () => {
  const base = { health: 10, max: 10, active: true, boss: false }
  assert.equal(selectBoss([{ ...base, id: 'goblin', name: 'Goblin', max: 3, health: 3, distance: 4 }]), null)
  const pool = [{ ...base, id: 'golem', name: 'Golem', distance: 10 }, { ...base, id: 'dragon', name: 'Dragão', boss: true, distance: 30 }, { ...base, id: 'far', name: 'Longe', boss: true, distance: 90 }]
  assert.equal(selectBoss(pool)!.id, 'dragon')
  assert.equal(selectBoss(pool.map((item) => ({ ...item, engaged: item.id === 'golem' })))!.id, 'golem')
  assert.equal(selectBoss([{ ...base, id: 'dead', name: 'X', boss: true, distance: 1, health: 0 }]), null)
  assert.deepEqual(bossPhases(20), [0.75, 0.5, 0.25]); assert.deepEqual(bossPhases(6), [0.66, 0.33]); assert.deepEqual(bossPhases(2), [0.5])
  assert.equal(bossPhase(20, 20), 0); assert.equal(bossPhase(9, 20), 2); assert.equal(bossPhase(1, 20), 3)
})

test('damage numbers stack, expire, cap and animate', () => {
  let list: DamageEntry[] = []
  list = pushDamage(list, { x: 100, y: 100, amount: 2, kind: 'dealt' }, 0, 1)
  list = pushDamage(list, { x: 104, y: 98, amount: 2, kind: 'crit' }, 100, 2)
  list = pushDamage(list, { x: 400, y: 100, amount: 2, kind: 'dealt' }, 120, 3)
  assert.deepEqual(list.map((item) => item.offset), [0, 18, 0])
  list = pushDamage(list, { x: 0, y: 0, amount: 1, kind: 'heal' }, DAMAGE_LIFE + 200, 4)
  assert.deepEqual(list.map((item) => item.id), [4])
  for (let i = 0; i < 40; i++) list = pushDamage(list, { x: i * 100, y: 0, amount: 1, kind: 'dealt' }, 2000, 10 + i)
  assert.equal(list.length, DAMAGE_MAX)
  assert.equal(damageText(2, 'dealt'), '2'); assert.equal(damageText(2.5, 'crit'), '2,5!'); assert.equal(damageText(10, 'taken'), '−10'); assert.equal(damageText(25, 'heal'), '+25')
  const entry: DamageEntry = { id: 1, x: 0, y: 0, amount: 1, kind: 'crit', at: 0, offset: 18 }
  const start = damageMotion(entry, 0), end = damageMotion(entry, DAMAGE_LIFE)
  assert.equal(start.opacity, 1); assert.ok(start.scale > 1.3); near(end.opacity, 0); near(end.dy, -64)
})

test('overhead plates: on screen, in range, focus always shown, bars only for damaged or close enemies, limited', () => {
  const anchor = (id: string, kind: 'enemy' | 'npc' | 'boss', distance: number, extra = {}) => ({ id, x: 500, y: 300, distance, name: id, kind, health: 3 as number | null, max: 3 as number | null, focus: false, ...extra })
  const views = layoutAnchors([anchor('near', 'enemy', 5), anchor('hurt', 'enemy', 20, { health: 1 }), anchor('gone', 'enemy', 60), anchor('aim', 'enemy', 60, { focus: true }),
    anchor('off', 'enemy', 5, { x: -200 }), anchor('npc', 'npc', 10, { health: null, max: null }), anchor('boss', 'boss', 30, { max: 20, health: 10 })], 1280, 720)
  const byId = new Map(views.map((view) => [view.id, view]))
  assert.deepEqual([...byId.keys()].sort(), ['aim', 'boss', 'hurt', 'near', 'npc'])
  assert.equal(byId.get('near')!.showBar, true); assert.equal(byId.get('hurt')!.showBar, true); assert.equal(byId.get('hurt')!.showName, false)
  assert.equal(byId.get('aim')!.opacity, 1); assert.equal(byId.get('npc')!.showName, true); assert.equal(byId.get('npc')!.showBar, false); assert.equal(byId.get('boss')!.showBar, false)
  near(byId.get('hurt')!.fraction, 1 / 3)
  assert.equal(views[views.length - 1].id, 'near', 'nearest painted last')
  assert.equal(layoutAnchors(Array.from({ length: 30 }, (_, index) => anchor(`e${index}`, 'enemy', index % 10)), 1280, 720).length, 14)
  assert.deepEqual(screenFromNdc(0, 0, 0.5, 1280, 720), { x: 640, y: 360 })
  assert.deepEqual(screenFromNdc(-1, 1, 0.5, 1280, 720), { x: 0, y: 0 })
  assert.equal(screenFromNdc(0, 0, 1.2, 1280, 720), null)
})

test('inventory icons, hotbar overflow, effect rings and portrait safety', () => {
  assert.equal(itemIcon('Chave de Ferro'), 'key'); assert.equal(itemIcon('Poção de vida'), 'potion'); assert.equal(itemIcon('Moeda antiga'), 'coin'); assert.equal(itemIcon('Esmeralda'), 'gem')
  assert.equal(itemIcon('Coisa estranha'), 'bag'); assert.equal(itemIcon('Engrenagem'), 'gear')
  const bar = hotbarItems([{ name: 'A', count: 1 }, { name: 'B', count: 0 }, ...Array.from({ length: 6 }, (_, index) => ({ name: `I${index}`, count: 2 }))])
  assert.equal(bar.slots.length, 5); assert.equal(bar.overflow, 2); assert.ok(!bar.slots.some((slot) => slot.name === 'B'))
  near(ringOffset(5, 10, 100), 50); near(ringOffset(20, 10, 100), 0); near(ringOffset(1, 0, 100), 100)
  assert.equal(safePortraitImage('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(safePortraitImage('https://example.com/a.png'), null); assert.equal(safePortraitImage('data:image/svg+xml;base64,PHN2Zz4='), null)
  assert.equal(portraitFor('robot').species, 'robot'); assert.equal(portraitFor('wizard').headwear, 'wizard'); assert.equal(portraitFor('villager', 3, { hairStyle: 'bald' }).hairStyle, 'bald')
  assert.deepEqual(portraitFor('villager', 7), portraitFor('villager', 7))
})

test('phase, typing and outcome summary', () => {
  const base = { outcome: 'playing' as const, paused: false, elapsed: 0, interacted: false, dismissed: false }
  assert.equal(hudPhase(base), 'title')
  assert.equal(hudPhase({ ...base, interacted: true }), 'playing')
  assert.equal(hudPhase({ ...base, elapsed: TITLE_SECONDS }), 'playing')
  assert.equal(hudPhase({ ...base, paused: true }), 'paused')
  assert.equal(hudPhase({ ...base, outcome: 'won', paused: true }), 'won')
  assert.equal(hudPhase({ ...base, outcome: 'won', dismissed: true, elapsed: 10 }), 'playing')
  assert.equal(typedLength('Olá, viajante', 0), 0); assert.equal(typedLength('Olá, viajante', 100, 50), 5); assert.equal(typedLength('Olá', 10_000), 3)
  const stats = { time: 95, score: 1234, collected: 3, total: 3, defeated: 2, enemyTotal: 2, damageTaken: 10, falls: 0 }
  const won = outcomeSummary(stats, true)
  assert.equal(won.stars, 3)
  assert.deepEqual(won.rows.map((row) => `${row.label}=${row.value}`), ['Tempo=1:35', 'Pontuação=1.234', 'Itens=3/3', 'Inimigos=2/2', 'Dano sofrido=10', 'Quedas=0'])
  assert.equal(outcomeSummary({ ...stats, collected: 1, falls: 2 }, true).stars, 1)
  assert.equal(outcomeSummary(stats, false).stars, 0)
  assert.deepEqual(outcomeSummary({ ...stats, total: 0, enemyTotal: 0 }, true).rows.map((row) => row.label), ['Tempo', 'Pontuação', 'Dano sofrido', 'Quedas'])
})
