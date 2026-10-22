# Forma 0.6 — estado, planejamento e como continuar

> Registro de uma parada anterior. O viewport atual já integra os módulos da 0.6; as correções posteriores de movimento, combate, equipamento e desempenho estão em [threejs-motion-fixes.md](threejs-motion-fixes.md). As pendências e medições abaixo descrevem o momento da interrupção, não o checkout atual.

Documento de passagem de trabalho, escrito em 22/10/2026 quando o trabalho da 0.6 foi interrompido a pedido do usuário. Especificação da versão: seção 0.6 do [ROADMAP](../ROADMAP.md). Regras locais: `CLAUDE.md` (não versionado).

## 1. Resumo

- **Na `main` do GitHub:** commit `38ac234` ("Start 0.6: ThreeSceneDocument 1.4 contract, editor fields and module groundwork"). Inclui o contrato 1.4, os painéis do editor, os pontos de extensão do `sceneBuild.ts`, as fases de exemplo enriquecidas, a versão 0.6.0 e versões parciais de vários módulos.
- **Só na árvore local (sem commit):** tudo o que os subagentes escreveram depois do commit. Veja `git status`; a seção 3 lista cada arquivo.
- **Nada da 0.6 está ligado ao viewport (`ThreeViewport.tsx`).** O jogo ainda se comporta como a 0.5. Só os painéis do editor e os dados novos do Mercado de Valemar aparecem.
- **Verificação no momento da parada:**
  - typecheck com 8 erros, em `sceneNavigation.ts` e `sceneGroundField.ts`;
  - testes unitários do Three.js: 209, dos quais 206 passam e 3 falham (os três de navegação/rotina);
  - lint, build e testes de navegador não foram rodados depois do commit.

## 2. Como o trabalho estava sendo feito

O agente principal agiu como integrador e dividiu a 0.6 em 7 módulos com arquivos disjuntos, cada um com um subagente dono dos seus arquivos e testes. O integrador ficou dono do contrato e da integração:

- `sceneDocument.ts`, `scenePrefabs.ts`, `sceneRuntimeTypes.ts`;
- `sceneBuild.ts`, `ThreeViewport.tsx`, `ThreeWorkspace.tsx`;
- `sceneExperiences.ts`, `sceneLabels.ts`, `sceneAssetEdit.ts`;
- documentação e testes de navegador.

Regras dadas a todos os subagentes:

- **Antes de começar:** ler `CLAUDE.md`, o `ROADMAP` e `docs/threejs-living-worlds.md`.
- **Estilo:** imitar o do repositório (TypeScript denso, sem ponto e vírgula, aspas simples, poucos comentários, `erasableSyntaxOnly`). Funções puras testáveis ficam separadas do código que depende de WebGL. Textos de interface em português.
- **Invariantes:**
  - a IA só devolve dados validados;
  - nenhum asset por URL ou CDN;
  - o jogo nunca modifica o documento;
  - nada de afirmar FPS ou qualidade sem medir.
- **Arquivos:** editar só os próprios. Dependências entre módulos passam pelas interfaces da seção 5 e pelos tipos de `sceneRuntimeTypes.ts`.
- **Testes:** rodar só os próprios enquanto outros editam, porque arquivos pela metade geram falsas falhas.
- **Git:** não fazer commit nem push.
- **Relatório final:** API, testes com resultados exatos, números medidos e código de integração pronto para colar.

Os subagentes foram interrompidos duas vezes: uma por limite de uso da API e outra a pedido do usuário. Só o módulo AI terminou e entregou relatório.

## 3. O que foi feito, por área

### 3.1 Contrato `ThreeSceneDocument` 1.4 — pronto e testado (integrador)
`sceneDocument.ts` importa 1.0–1.4 e exporta 1.4. Os campos novos são todos opcionais e, quando ausentes, não são preenchidos (um projeto 1.3 abre sem ganhar campos):

- `SceneBehavior.routine?: { activity: 'wander'|'work'|'sit'|'chat'|'patrol'|'guard'|'sleep'|'perform'; target: nodeId|null; from: 0–24; to: 0–24 }[]`:
  - até 6 períodos (`MAX_ROUTINE_STEPS`);
  - só para NPCs;
  - os alvos são validados: precisam existir e não podem ser o próprio nó.
- `SceneBehavior.reaction?: 'greet'|'ignore'|'flee'|'alert'`, só para NPCs.
- `SceneNode.emitter?: { preset: 'fire'|'smoke'|'sparks'|'magic'|'steam'|'fountain'|'leaves'|'dust'|'embers'; rate: 0.1–4; spread: 0–20 }`.
- `SceneEnvironment.motion?: { wind: 0–2; grass: 'auto'|'none'|'dense'; fauna: 'auto'|'none'|'rich' }`. O padrão de runtime é `DEFAULT_MOTION` (wind 0,6, auto, auto).
- `SceneEnvironment.dayCycle?: { enabled; duration: 60–7200 s; start: 0–24 h }`.
- `SceneEnvironment.premise?: string` (até 240 caracteres, `MAX_PREMISE`), mostrada no cartão de título.
- `PrefabSpec.character?: CharacterSpec`, em `sceneCharacterArchetype.ts` e lido por `prefabSpec` em `scenePrefabs.ts`:
  - campos: `{ age: child|young|adult|elder; build: slim|average|athletic|heavy; height: 0.85–1.15; style: stylized|realistic; skin: hex|null; hair: hex|null; hairStyle: auto|bald|short|long|bun|ponytail|braids|mohawk; beard: auto|none|short|long }`;
  - só vale para tipos de personagem;
  - no modo leniente, valores fora do contrato são corrigidos e registrados no log.
- `removeSubtree` troca por `null` os alvos de rotina removidos.
- Testes: `tests/three/sceneDocumentV14.test.ts`. Também foram ajustadas as expectativas de versão em `sceneGame.test.ts` e `tests/browser/three-quality.spec.ts`.

### 3.2 Tipos compartilhados — prontos
`sceneRuntimeTypes.ts` define:

- `QualityLevel`;
- `GroundSampler`;
- `FaceState` e `neutralFace()`;
- `SpringChainSpec`;
- `CharacterSkin`: `{ rootId, object, meshes: SkinnedMesh[], hidden: Set<nodeId>, springs, setFace, dispose }`.

### 3.3 Editor — pronto (integrador)
`ThreeWorkspace.tsx` ganhou:

- **painel "Personagem"** para raízes de personagem: idade, porte, estilo, altura, cabelo, barba, cores de pele e cabelo, semente e "Arquétipo padrão". Ele reconstrói o pré-fabricado por `rebuildPrefab` (`sceneAssetEdit.ts`, que usa `expandSceneRecipe` + `replaceAssetNodes`);
- **para NPCs:** reação e `RoutineEditor` (períodos com atividade, local, das/até);
- **seção "Partículas"** em qualquer objeto;
- **no ambiente:** "Mundo em movimento" (vento, grama, fauna), "Ciclo dia/noite no jogo" (duração, hora inicial) e "Premissa".

Os rótulos novos estão em `sceneLabels.ts` e os estilos em `ThreeWorkspace.css` (`.three-routine`).

### 3.4 Pontos de extensão do `sceneBuild.ts` — prontos, ainda sem uso
- `resources.material(node, wireframe, variant?, prepare?)` gera uma variante de material em cache, preparada uma única vez (para materiais com vento).
- `BuildOptions` passa a ter:
  - `variant(node) → { key, prepare, depth? } | null`;
  - `geometry(node)`, para substituir a geometria (ex.: água tesselada);
  - `skins(doc, holders) → CharacterSkin[]`.
- Partes de personagens nunca entram em InstancedMesh.
- As malhas listadas em `skin.hidden` ficam com `visible = false` e `castShadow = false`, saem do agendador de sombras e as malhas da pele entram em `pickables`.
- `BuiltScene.skins: Map<rootId, CharacterSkin>` é descartado em `dispose()`.

### 3.5 Fases de exemplo — prontas (integrador)
`sceneExperiences.ts`:

- As 4 fases da 0.5 ganharam premissa e `motion`.
- O Mercado de Valemar ganhou:
  - `dayCycle` (480 s, começando às 8 h);
  - dois bancos (`bench-a`, `bench-b`);
  - NPCs com arquétipos variados e rotinas: Mira trabalha em `stall0`, o guarda patrulha até `tower33`, o sábio senta em `bench-b` e toca no poço, o comprador e a criança conversam no chafariz, o idoso senta em `bench-a`;
  - reações (greet, flee, alert).
- O teste `sceneExperiences.test.ts` passa.

### 3.6 Módulo AI — pronto (subagente concluído)
Arquivos: `sceneGeneration.ts`, `sceneRecipeSanitize.ts` e `sceneDirection.ts`, com testes em `sceneGenerationV14.test.ts` (novo) e `sceneDirection.test.ts` e `sceneCreativity.test.ts` (estendidos). Resultado relatado: 73/73 nos testes do módulo, sem expectativas antigas alteradas.

- **Esquema estrito da receita:** `prefab.character`, `behavior.routine/reaction`, `emitter`, `environment.motion/dayCycle/premise`, todos `nullable`.
- **Esquema de edição:** `changes.emitter`, `behavior` completo, `rebuilds[].prefab.character` e ambiente.
- **Expansão:**
  - `routinePlaces`/`withoutPlaces`: a validação por template ignora os alvos, e eles são resolvidos depois, inclusive em cópias de repetição;
  - `clearRoutineTargets` limpa alvos;
  - `compactNode` inclui `emitter`.
- **Saneamento leniente:**
  - rotina em quem não é NPC é removida;
  - mais de 6 períodos são cortados;
  - atividade desconhecida vira `wander`;
  - horas são limitadas a 0–24;
  - alvo inválido vira `null`;
  - reação desconhecida vira `greet`;
  - emissor inválido é removido;
  - arquétipo em tipo errado é removido;
  - `motion`, `dayCycle` e `premise` são corrigidos.
- **Prompt `SYSTEM`:**
  - blocos ARQUÉTIPOS, ROTINAS e MUNDO VIVO;
  - tamanho: de 13.662 para 15.885 caracteres;
  - esquema da receita: de 13.937 para 16.293 caracteres.
- **Direção:**
  - intenções explícitas de dia/noite, ventania, sem vento, fauna, grama;
  - sugestões em 17 temas;
  - blocos VIDA DOS NPCS, MOVIMENTO e CICLO DIA/NOITE no `directionBrief`;
  - revisões: NPCs sem rotina, local inexistente, work/sit sem alvo, 3 ou mais personagens idênticos, dia/noite pedido e ausente, ventania fraca.
- **Defeitos que ele apontou no contrato:**
  - (1) `removeSubtree` não limpava alvos — **corrigido**;
  - (2) `duplicateSubtree` não remapeia alvos de rotina dentro da cópia — **pendente**;
  - (3) `replaceAssetNodes` (`sceneAssets.ts`) não resolve alvos de rotina pelo mapeamento de peças — **pendente**;
  - (4) `reaction` aceita em quem não é NPC — **corrigido**.
- **Atenção:** o prompt diz que fogueira, tocha, chafariz e reator "emitem sozinhos". Isso depende de `sceneEmitters` no módulo WORLD, que ainda não existe.

### 3.7 Módulos interrompidos (parciais, sem relatório)

| Módulo | Existe | Falta |
|---|---|---|
| **SKIN** (personagens com pele) — prioridade nº 1 | Em `sceneCharacterArchetype.ts`: `archetypeShape(character, base)`, que mapeia idade, porte e estilo para proporções do esqueleto e devolve escala; `archetypeSkin`, `archetypeHair` (grisalho para idosos), `archetypeHairIndex`, `archetypeBeard`. | **Quase tudo.** `sceneCharacters.ts` ainda não usa o arquétipo (bipedFrame e paletas). Não existem `sceneSkin.ts`, `sceneSkinGeometry.ts`, testes de pele nem o teste de variantes de arquétipo. |
| **ANIM** (estados, IK, molas) | `sceneCharacterAnimator.ts` (638 linhas: AnimState, AnimActivity, AnimMood, AnimEvent, AnimatorInput, AnimatorPose, createAnimator, animatorForBinding, updateAnimator, applyAnimatorPose, animatorJoints). `sceneCharacterIK.ts` (createFootIKMemory, createLookMemory, characterRoot, solveLeg, solveFootIK, solveLookAt). `sceneCharacterRig.ts` estendido (RigFoot, rigRootJoint, rigCollapse, rigUnit; RigBinding com pés). | `sceneSprings.ts` (`createSprings`, `rigSpringChains`). Testes: sceneCharacterAnimator, sceneCharacterIK, sceneSprings. Revisar o animador, que foi escrito sem testes. |
| **WORLD** (vento, grama, água, partículas) | `sceneGroundField.ts` (buildGroundField, groundUniforms, setGroundUniforms). `sceneWind.ts` (createWind, applyWind, windKind, windOffset, windShadowMaterials, attachWindShadows, clothGeometry...). `sceneGrass.ts` (grassBudget, createGrass...). `sceneWater.ts` (waterGeometry, prepareWater, waveScale, mantendo animateWater). | `sceneParticles.ts` (createParticles, sceneEmitters). Testes: sceneWind, sceneGrass, sceneWater, sceneParticles. Corrigir o erro TS6133 (import `terrainHeights` sem uso) em `sceneGroundField.ts`. Validar os shaders em navegador. |
| **LIFE** (fauna, dia/noite) | `sceneFauna.ts` (planFauna, createFauna, stepFlock, faunaTotals...) com `tests/three/sceneFauna.test.ts`, que passa. `sceneDayCycle.ts` (dayState, practicalLightFactor, nightAmount, reflectionRefresh, formatHour...). `sceneEnvironment.ts` (`timeOfDayLighting` / transição de céu). `sceneAudio.ts` (camada noturna). | `tests/three/sceneDayCycle.test.ts`. Confirmar que sceneAtmosphere e sceneAudio continuam passando, o que estava ocorrendo na última rodada. |
| **NAV** (navmesh, rotinas) | `sceneNavigation.ts` (loadRecast, buildNavigation, navigationFocus, createRouter...). `sceneRoutines.ts` (routineAt, activitySpot, chatSpot, planRoutines, routineTask...). `sceneEnemies.ts` alterado. Testes sceneNavigation, sceneRoutines e sceneEnemies. | Corrigir 7 erros de tipo de import em `sceneNavigation.ts`: o pacote `recast-navigation` reexporta o core, então `init`, `NavMeshQuery` e `NavMesh` vêm de `'recast-navigation'` e `generateSoloNavMesh` vem de `'recast-navigation/generators'`, como no teste de sondagem da seção 7. Corrigir os 3 testes que falham (lista abaixo). Medir o tempo de geração. Decidir se usa worker. |
| **HUD** | `ThreeHud.tsx` (572 linhas), `ThreeHud.css`, `sceneHud.ts` (HudModel, HudOverlayHandle, bússola, barras com rastro, chefe, números de dano, prompt, hotbar, título, resumo final, retrato...), `sceneHudIcons.tsx` (HudIcon, HudIconSprite, InputGlyph, Portrait), `sceneGamepad.ts` (readGamepad, pollGamepad, glyph...), `sceneSettings.ts` (loadSettings, saveSettings, sanitizeSettings, mouseScale, masterGain). | Testes: sceneHud, sceneGamepad, sceneSettings. Teste de navegador `tests/browser/three-hud.spec.ts` com capturas em 1280×720 e 1920×1080 e checagem de sobreposição. O agente estava rodando tipos e lint dos próprios arquivos quando parou. |

Testes unitários que falham na parada:
- `sceneEnemies.test.ts`: "a routed enemy leaves a dead-end cup that traps direct steering, without crossing its walls"
- `sceneRoutines.test.ts`: "NPC routines walk to a spot, settle facing its direction and expose pose, look target and anchor"
- `sceneRoutines.test.ts`: "chatting NPCs face each other; patrols go back and forth with guard pauses"

## 4. Decisões de arquitetura (manter)

- **Personagens com pele:** as peças rígidas do documento continuam como proxies (colisão, alvo de golpes, inspeção espacial, seleção), por isso `scenePrefabVariants.test.ts` continua válido e projetos 1.3 abrem iguais.
  - Na renderização, `sceneBuild` chama o módulo de pele.
  - Ele gera um `THREE.SkinnedMesh` contínuo a partir do `asset` (tipo, semente, tamanho, arquétipo) e das posições de repouso dos holders das juntas `j_*`.
  - Os ossos são `THREE.Bone` filhos dos holders das juntas (transformação identidade). Assim, o rig atual e o animador novo movem a pele sem mudanças.
  - As malhas anatômicas e de roupa substituídas ficam escondidas (`skin.hidden`).
  - Armaduras rígidas, armas e chapéus continuam rígidos sobre a pele.
  - Robô, drone, golem e esqueleto podem continuar rígidos.
  - Método sugerido: SDF de seções elípticas ao longo dos ossos com união suave, surface nets/marching cubes em faixa estreita, suavização Taubin, pesos por distância aos ossos (até 4) e LOD em 3 níveis com `THREE.LOD` partilhando o esqueleto.
  - Cache de geometria por chave do spec, que sobrevive a reconstruções.
- **Arquétipo:** sem `character`, o resultado deve ser idêntico à 0.5 (mesmas partes e juntas). `archetypeShape` já devolve a forma base inalterada nesse caso.
- **Vento:** campo contínuo no espaço do mundo, de modo que tronco e copa não se separam. A amplitude depende da altura acima do solo, amostrada da textura do campo de solo (RGBA UnsignedByte; nada de float ou inteiro) no vertex shader. Os nós com vento recebem uma variante de material exclusiva por `BuildOptions.variant`.
- **Navmesh:** Recast/Detour em WASM com o pacote npm `recast-navigation` 0.43.1, já instalado em `apps/web` e empacotado pelo Vite (nada por CDN). Ela é gerada no início do jogo a partir das entradas do colisor estático, recortadas ao redor dos agentes. Se falhar, o jogo segue com o steering atual. A evitação de multidão é feita por separação própria; o crowd do Detour não é usado.
- **HUD:**
  - **Pausa:** Esc passa a abrir a pausa (dialog "Pausa" com "Sair do jogo"). Perder o pointer lock durante o jogo também abre a pausa.
  - **Atualização:** a camada por quadro (rótulos e barras sobre personagens, números de dano) é imperativa e não re-renderiza o React a cada quadro.
  - **Controles:** Q esquiva; botão direito do mouse faz ataque pesado; Esc ou Start pausa; E ou clique interage e ataca.
- **Qualidade:** com WebGL por software (SwiftShader, usado nos testes), o padrão é qualidade baixa para grama, partículas e fauna. Os testes não medem FPS real.

## 5. Interfaces combinadas entre módulos

```ts
// SKIN (sceneSkin.ts)
export interface SkinOptions { quality: QualityLevel; shadows: boolean; avatar?: AvatarKind }
export function skinCharacter(rootId: string, spec: PrefabSpec, holders: Map<string, THREE.Object3D>, parts: Map<string /*assetPart*/, string /*nodeId*/>, options: SkinOptions): CharacterSkin | null
export function buildCharacterSkins(doc: ThreeSceneDocument, holders: Map<string, THREE.Object3D>, options: SkinOptions): CharacterSkin[]
// rosto via CharacterSkin.setFace(FaceState): olhos com esclera/íris/pupila, pálpebras (blink), sobrancelhas (brow), mandíbula interna (jaw), sorriso, olhar (gaze)
// cabelo em mechas/cartões; cabelo longo e capas entregam SpringChainSpec em CharacterSkin.springs

// ANIM
export interface AnimatorInput { dt: number; time: number; speed: number; grounded: boolean; verticalSpeed: number; dead: boolean; talk: boolean
  attack?: 'light'|'heavy'|null; dodge?: boolean; hurt?: boolean; interact?: boolean; wave?: boolean; crouch?: boolean
  activity?: 'sit'|'work'|'sleep'|'chat'|'perform'|'guard'|null }
export interface AnimatorPose { state: AnimState; joints: Map<string, Vector3Tuple>; bob: number; collapse: number; face: FaceState; combo: number; events: string[] }
createAnimator(kind, phase, seed?) / updateAnimator(animator, input) / applyAnimatorPose(binding, holders, pose)
solveFootIK(binding, holders, ground: GroundSampler, weight?) → { pelvis } ; solveLookAt(binding, holders, target | null, weight)
createSprings(chains: SpringChainSpec[]) → { step(dt, wind?), reset() } ; rigSpringChains(binding, holders)

// WORLD
buildGroundField(doc, resolution?) → GroundField | null   // altura + máscara de grama em textura RGBA UnsignedByte
createWind() → WindSystem { uniforms, setGround, setStrength, update(seconds, player), dispose }
windKind(node, root) → { kind: 'tree'|'foliage'|'grass'|'flag'; stiffness } | null ; applyWind(material, wind, kind, stiffness)
createGrass(field, wind, { density, quality, color? }) → { object, update(camera, seconds, player), setQuality, dispose } | null
prepareWater(material, wind, field, { flow? }) ; waterGeometry(node) → BufferGeometry | null
createParticles() → ParticleSystem { object, burst(kind, position, options?), setEmitters(list), update(camera, seconds, dt), setQuality, dispose }
sceneEmitters(doc) → { id, kind, rate, spread, offset }[]   // node.emitter + automáticos (fogueira, tocha, chaminé, chafariz, reator)

// LIFE
planFauna(doc, density) → FaunaPlan ; createFauna(plan, ground) → { object, update(camera, seconds, dt, player, night), scare(position, radius), setQuality, dispose }
dayState(env, elapsed) → DayState | null ; practicalLightFactor(day) ; EnvironmentRig: transição de céu/sol/hemisfério/neblina por hora, PMREM regenerado no máximo a cada poucos segundos

// NAV
buildNavigation(entries, focus: Box3, agent: { radius, height, climb }) → Promise<NavigationMesh | null>
createRouter(nav) → { next(agentId, from, to) }
EnemySettings ganha route?(from, to) e neighbors?: Vector3[] ; EnemyStep ganha activity? e face?
routineAt(routine, hour | null, elapsed) ; activitySpot(doc, targetId, npcIndex) → posição + orientação

// HUD (sceneHud.ts / ThreeHud.tsx)
HudModel { phase: 'title'|'playing'|'paused'|'won'|'lost'; title; health; maxHealth; stamina; maxStamina; objective; tracker; compass; score; collected; total; defeated; enemyTotal;
  time; limit; clock; weapon; items; effects; prompt; boss; dialogue (com retrato e opções); subtitle; stats; fly; view; muted; pointerLocked; help; device; omitted; fps; hurt }
HudOverlayHandle { frame(anchors), damage(x, y, amount, kind), hit(kind), pickup(card), hurtFrom(angle) }
```

O HUD precisa manter os textos e rótulos que os testes de navegador usam:

- região `role=region` "Modo jogo";
- "Itens coletados" com o texto "Itens X/Y";
- "Inimigos derrotados" com o texto "Inimigos X/Y";
- `meter` "Vida" com `aria-valuenow`;
- os prompts "Acionar · Porta", "Atacar · <nome>" e "Conversar · <nome>";
- "1ª pessoa", "3ª pessoa" e "Voo";
- os toasts em `role=status`;
- o dialog "Vitória" com o botão "Jogar de novo";
- o dialog "Fim de jogo".

## 6. O que falta, em ordem recomendada

1. **Deixar a árvore verde:**
   - corrigir os imports de `sceneNavigation.ts` e o import sem uso de `sceneGroundField.ts`;
   - corrigir os 3 testes de navegação/rotina;
   - rodar `npx.cmd tsc -b apps/web --noEmit` e a suíte unitária.
2. **SKIN (prioridade nº 1 do usuário):**
   - aplicar `archetypeShape`/paletas em `sceneCharacters.ts` (bipedFrame dos humanoides, cabelo, barba), mantendo o resultado idêntico sem `character`;
   - criar o teste de variantes de arquétipo com zero interseções e zero conflitos coplanares;
   - escrever `sceneSkinGeometry.ts` (puro) e `sceneSkin.ts`;
   - escrever os testes de pele: conexo, pesos normalizados, LOD decrescente, deformação, determinismo, tempo medido.
3. **ANIM:** escrever `sceneSprings.ts` e os testes do animador, do IK e das molas.
4. **WORLD:** escrever `sceneParticles.ts` e os testes de vento, grama, água e partículas.
5. **LIFE:** escrever o teste `sceneDayCycle`.
6. **HUD:** escrever os testes unitários e `tests/browser/three-hud.spec.ts` (1280×720 e 1920×1080).
7. **Integração no `ThreeViewport.tsx` (integrador):**
   - **No `engine.update`, passar para `buildScene`:**
     - `skins: (doc, holders) => buildCharacterSkins(doc, holders, { quality, shadows })`;
     - `variant` (vento por `windKind` + `applyWind`);
     - `geometry` (água por `waterGeometry`).
   - **Criar** WindSystem, GroundField, grama, partículas, fauna e dia/noite no viewport. Atualizá-los em `render()` e no laço do jogo; no editor, só quando a timeline ou a apresentação estiverem rodando.
   - **Ordem por quadro para cada personagem:**
     1. `updateAnimator` com a entrada derivada da velocidade real, de `EnemyAction`/`activity` e dos eventos;
     2. `applyAnimatorPose`;
     3. `solveFootIK` (GroundSampler pelo BVH do colisor);
     4. `solveLookAt` (jogador ou alvo `face`);
     5. molas;
     6. `skin.setFace(pose.face)`.
   - **Eventos do animador:** os passos disparam o som `step` e poeira de partículas; `impact` dispara o burst de impacto.
   - **Avatar:** montar um documento com raiz `avatar` (asset do tipo do avatar) e usar o mesmo caminho de pele. Conferir o erro GL_INVALID_OPERATION (`three-stability.spec.mts`).
   - **No `startGame`:**
     - `buildNavigation` assíncrono a partir das entradas do colisor;
     - `createRouter`;
     - `route` e `neighbors` por agente em `stepEnemyMotion`;
     - hora do dia para `routineAt`;
     - ameaças e guardas;
     - mapear `activity`/`face` para o animador.
   - **HUD:**
     - trocar o JSX atual por `<ThreeHud>`;
     - montar o `HudModel`;
     - projetar âncoras por quadro com a câmera;
     - Esc → pausa;
     - estamina (corrida e esquiva);
     - Q esquiva e ataque pesado no botão direito;
     - combo;
     - gamepad (`pollGamepad`);
     - configurações (volume, sensibilidade, qualidade);
     - cartão de título com `premise`;
     - telas de vitória e derrota com estatísticas;
     - retrato do diálogo;
     - legendas.
   - **Testes de navegador:** atualizar os testes que esperam que Esc saia direto. Hoje há `Escape` seguido de "hud oculto" em three-game, three-genres, three-experience, three-architecture, three-stability e three-terrain. Criar um auxiliar `leaveGame(page)` em `threeHelpers.ts` (Esc + clicar "Sair do jogo").
   - **Testes de navegador novos:** HUD, personagem com pele e NPC com navmesh.
8. **Defeitos pendentes do contrato:** `duplicateSubtree` (remapear alvos de rotina) e `replaceAssetNodes` (resolver alvos de rotina pelo mapeamento de peças).
9. **Documentação:**
   - criar `docs/threejs-characters-hud.md` (contrato, módulos, limites, o que não foi medido);
   - atualizar `PRD.md`, `ISSUES.md`, `docs/architecture.md`, `README.md`, `docs/README.md` e `docs/threejs-studio.md`;
   - no `ROADMAP.md`, marcar a 0.6 como entregue e mover pendências para a 0.7. A importação de GLB com esqueleto e clipes e o redirecionamento para o rig provavelmente ficam para a 0.7; documente se for o caso.
10. **Verificação final e envio** (seção 7).

## 7. Comandos, ambiente e regras

- **Temporários:** a máquina tem pouco espaço em C:. Use `TEMP`/`TMP` em `F:\projects\MCPx3d\.cache\tmp` e `npm.cmd`/`npx.cmd` no PowerShell.
- **Local:** `node scripts/dev.mjs` (ou `npm run dev`) sobe a API em 8001 e o Vite em 5173.
- **Verificações (raiz):**
  - `npm.cmd run typecheck`
  - `npm.cmd run lint:web`
  - `npm.cmd test`
  - `npm.cmd run build`
- **Unitários do Three.js:** `cd apps/web && node --test --test-concurrency=4 tests/three/*.test.ts` (cerca de 15 s).
- **Navegador:** `PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe" npx.cmd playwright test --config playwright.three.config.ts` (36+ testes, cerca de 15 min). Os testes falham com qualquer "Shader Error | THREE.WebGLProgram | GL_INVALID" no console.
- **Falha de navegador:** rode o teste isolado e compare com o código anterior (git worktree em `.cache` com junction para `node_modules`) para separar instabilidade de regressão.
- **Fases da 0.5:** abra as 4 (Cripta, Mercado, Ilhas Celestes, Ermo) e confirme que continuam jogáveis.
- **Sondagem da navmesh (Node), funciona:**
  ```js
  import { init, NavMeshQuery } from 'recast-navigation'
  import { generateSoloNavMesh } from 'recast-navigation/generators'
  await init(); const { navMesh } = generateSoloNavMesh(positions, indices, { cs: 0.2, ch: 0.2, walkableRadius: 2, walkableHeight: 9, walkableClimb: 2 })
  new NavMeshQuery(navMesh).computePath(from, to)
  ```
  Medido: cerca de 18 ms para um piso de 20×20 m com um obstáculo.
- **Commit e push:**
  - sem assinatura de nenhum tipo: nenhum Co-Authored-By, nenhuma linha "Generated with", sem GPG;
  - `git -c user.name="Arthur Santos" -c user.email="arthursantos.homeoffice@gmail.com" commit --no-gpg-sign`;
  - conferir com `git log -1 --format='%(trailers)|%G?'`; o esperado é vazio e `N`.
  - Push:
    1. `gh auth switch --user arthursantos67`;
    2. `gh repo view arthursantos67/MCPx3d --json viewerPermission`;
    3. `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main`;
    4. `gh auth switch --user EcoArthur`.

## 8. Armadilhas conhecidas

- **Erro de textura (lição da 0.5):** um avatar com um segundo `createResources()`, projetando sombra com materiais texturizados, gerou GL_INVALID_OPERATION "Mismatch between texture format and sampler type". Ao trocar o avatar por pele, verifique de novo.
- **Variantes de pré-fabricados:** `scenePrefabVariants.test.ts` e as auditorias de `sceneExperiences.test.ts` precisam continuar com zero interseções e zero faces coplanares.
- **Esquema estrito da IA:** toda propriedade nova precisa estar em `required`. Use `nullable` para o que é opcional e mantenha o esquema e o prompt compactos.
- **Documento:** o jogo nunca modifica o documento. Os testes comparam o JSON exportado antes e depois de jogar.
- **Medições:** não afirme FPS, qualidade visual ou qualidade de IA sem medir. Os testes usam WebGL por software e IA programada.
