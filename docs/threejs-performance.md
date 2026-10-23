# Desempenho do runtime Three.js

23 de outubro de 2026. Vale para cenas geradas por IA, exemplos e projetos importados; o documento e a aparência autorada não mudam.

## Causas medidas

Medição em Chrome com GPU real (NVIDIA GT 710, Direct3D 11, 1440×900, modo de desenvolvimento), entrando no jogo nos exemplos maiores e com perfil de CPU via DevTools.

- **Compilação de shaders bloqueante.** Trocar para o Mercado de Valemar congelava a página por ~50 s; 21 s eram `getProgramInfoLog` esperando o driver no primeiro uso de cada programa.
- **Sombra cúbica refeita em todo quadro.** Chamas animadas e vaga-lumes projetavam sombra dentro do alcance da fogueira; cada quadro redesenhava as seis faces do mapa cúbico. No Vale dos Ventos, as passadas de sombra desenhavam ~3× a geometria da própria cena.
- **Céu recompilado no ciclo do dia.** A captura de reflexos descartava a sonda do céu a cada recaptura (≈3 s de jogo), recompilando seu shader: pausas de ~1,5 s.
- **Programas reavaliados a cada quadro.** O passe do céu renderizava a cena principal com uma câmera filtrada; sem luzes nesse passe, a versão do estado de luzes mudava e todos os ~250 materiais refaziam parâmetros e chave de programa no quadro seguinte. Materiais compartilhados entre malhas comuns e instanciadas tinham o mesmo efeito.
- **Vegetação sem descarte.** Cada lote instanciado cobria o mapa inteiro; câmera e sombra do sol nunca o descartavam.
- **CPU por quadro.** Raycast de mira triângulo a triângulo contra todos os objetos (22% do quadro no Vale) e matrizes de mundo recompostas ~5 vezes por quadro, inclusive nas partes estáticas.
- **Árvore do editor quadrática.** A lista de hierarquia filtrava todos os nós para cada nó (8,5 s na troca de cena do Mercado).

## Correções

- `ThreeViewport.tsx` pré-compila os programas com `compileAsync` (paralelo quando há `KHR_parallel_shader_compile`) antes do primeiro quadro de uma cena nova e antes de entrar no jogo. A compilação usa o mesmo alvo do compositor, porque tone mapping e espaço de cor fazem parte da chave do programa, e aplica antes o agendamento de sombras. Enquanto compila, a página continua respondendo.
- `sceneBuild.ts`: superfícies emissivas translúcidas (chamas, energia) e emissivas menores que 25 cm (vaga-lumes, lâmpadas, gemas) não projetam sombra. Lotes instanciados pesados (≥30 mil triângulos) são divididos em até 4×4 blocos espaciais. Lotes instanciados têm material próprio. Partes estáticas mantêm a matriz local, e subárvores totalmente estáticas são puladas na atualização de mundo.
- `sceneShadows.ts`: vagas de sombra fixas por tipo de luz (pontual/spot). Luzes apagadas pelo ciclo do dia mantêm a vaga sem redesenhar o mapa; assim o número de luzes com sombra não muda durante o jogo e nenhum material recompila.
- `sceneEnvironment.ts`: sonda de céu persistente para reflexos e cena própria para o passe do céu.
- `ThreeViewport.tsx`: uma atualização de matrizes por quadro (o renderer não a repete em cada passe); a mira testa apenas inimigos, interativos e partes móveis, usando a BVH estática do colisor como oclusão. O golpe corpo a corpo em primeira pessoa amostra o arco a 60 Hz quando o quadro é mais longo, de modo que o acerto não depende do FPS.
- `sceneTextures.ts`: uma textura na GPU por tipo e canal, compartilhada entre escalas. `ThreeWorkspace.tsx`: hierarquia em tempo linear.

## Resultados

| Cena | Carga (antes → depois) | Triângulos/quadro | Draw calls | FPS médio na GT 710 |
|---|---|---|---|---|
| Vale dos Ventos | 28 s bloqueados → página responsiva | 1,26 M → 0,57 M | 528 → 342 | 6 → 13,5 |
| Mercado de Valemar | 50 s bloqueados → página responsiva | 0,50 M → 0,50 M | 793 → 799 | 8 → 9 |
| Floresta encantada | 6 s → responsiva | 2,42 M → 0,97 M | 393 → 267 | 10 → 14 |
| Exemplo jogável | 7,5 s → responsiva | 1,28 M → 0,64 M | 260 → 154 | 8 → 13 |

Sem limitação de GPU (resolução interna reduzida para isolar a CPU), a mediana do quadro no Mercado caiu de 28 ms para 22 ms em modo de desenvolvimento. Na GT 710 o tempo restante é custo por pixel (material físico, SSAO, MSAA 4× e bloom); essa placa é de entrada e não representa máquinas medianas. Não há medição em outras GPUs; os números não prometem FPS no hardware do usuário. Testes de navegador continuam em SwiftShader e não medem desempenho.

## Limites

Lotes instanciados leves continuam em um único draw call. A sombra do sol é redesenhada a cada quadro na área de 48 m em torno do jogador. Sem `KHR_parallel_shader_compile`, a pré-compilação ainda ocupa a thread principal, mas uma vez por cena e não durante o jogo. Em terceira pessoa, o golpe usa as poses dos quadros, sem subamostragem.
