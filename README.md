# Forma

Estúdio de modelagem com agentes de IA e um editor visual de cenas: **CAD**, para peças e conjuntos compostos com download STEP/STL, e **X3D**, para cenas editadas por conversa. **Three.js**, para composição visual e geração de cenas animadas. A API constrói e valida a geometria CAD/X3D; a IA propõe somente dados estruturados.

## Iniciar

Requisitos: Node.js 24, Python 3.12+, Git e uv. No Windows, `python -m pip install uv` instala uv; os scripts também funcionam quando apenas `python -m uv` está disponível.

Na raiz:

```bash
git submodule update --init --recursive
npm ci
npm run dev
```

Abra **http://127.0.0.1:5173**. A API fica em **http://127.0.0.1:8001**, com contratos interativos em `/docs`. O primeiro início instala as dependências Python, incluindo CadQuery; os seguintes reutilizam o ambiente. `Ctrl+C` encerra os processos iniciados pelo comando. Em PowerShell com scripts bloqueados, use `npm.cmd`.

**Não é necessário iniciar um servidor MCP.** O submódulo fornece a biblioteca e os schemas de validação X3D usados localmente. O modo remoto continua opcional: [docs/x3d-mcp.md](docs/x3d-mcp.md).

Em **Configurar IA**, escolha WebLLM, um endpoint compatível com OpenAI, **Codex · assinatura ChatGPT** ou **Claude Code · assinatura Claude**. WebLLM precisa de WebGPU. O endpoint externo recebe os pedidos diretamente do navegador e exige chave, modelo e CORS. Os modos de assinatura usam o cliente oficial instalado e autenticado no computador do servidor; pedidos passam pela API local, sem transferir tokens ao navegador. Os limites da conta continuam valendo.

Para assinaturas, instale o cliente oficial e execute `codex login` ou `claude auth login` no terminal. Reinicie o servidor após instalar o cliente. Deixe **Modelo** vazio no primeiro teste. **Verificar instalação e login** não gera uma resposta; **Testar conexão** faz uma pequena chamada real, confere JSON e mostra erros antes de qualquer validação CAD/X3D. Testar não salva nem troca o provedor ativo: use **Salvar e aplicar** depois. [Detalhes da integração](docs/ai-providers.md).

## Usar

No CAD, descreva uma peça ou conjunto no **Projeto livre**. O agente escolhe um sólido ou planeja componentes independentes; **Conjunto composto** permite pedir uma montagem diretamente. A proposta aprovada é salva automaticamente e libera STEP/STL. Cada componente também pode ser exportado nos dois formatos. Ajustes manuais e movimentos pedem uma nova revisão antes do download.

Se a geração falhar, **Baixar rascunho STEP/STL (ZIP)** exporta os sólidos disponíveis com a receita original e um relatório de etapas/peças omitidas. Rascunhos não recebem aprovação de montagem e ficam guardados no navegador para prévia/download após reload. [Recuperação CAD](docs/cad-drafts.md) explica os limites e a retomada.

No X3D, descreva a cena, peça alterações ou aplique uma receita da biblioteca. Baixe X3D, HTML, ClassicVRML ou JSON do projeto. O JSON permite importar a cena depois de reiniciar a API. A prévia HTML utiliza X3DOM e precisa de internet para carregar esse visualizador.

No menu **Three.js · Estúdio de cenas**, crie cenas ou escolha **Exemplo detalhado** para explorar o Observatório Helix. O catálogo inclui perfis extrudados/de revolução, tubos por curvas e malhas, além de primitivas. Use **Importar GLB** para modelos estáticos detalhados e **Tela cheia** para inspecioná-los com materiais físicos, texturas, reflexões e sombras. A timeline oferece rotação, flutuação e órbita.

Em **Ação da IA**, escolha **Criar nova cena**, **Editar cena atual** ou **Corrigir sobreposições**. Edição envia o contexto existente e aplica patches por ID; reparo inspeciona superfícies e movimentos em poses amostradas, preservando os objetos. **Verificar sobreposições** funciona localmente, sem IA. Criação/edição recusam interferências novas e uma proposta inválida conserva a cena anterior. O painel mostra etapa, tempo e histórico; o prazo total é de 2, 5 (padrão) ou 10 minutos.

Three.js exporta/importa projeto JSON 1.1 e migra arquivos 1.0. Edição/reprodução funcionam sem API/IA; o viewport requer WebGL2. Rascunhos usam o navegador; malhas/texturas grandes podem exceder sua quota, com aviso para exportar JSON. GLB aceita o perfil estático documentado; skins, clipes e arquivos comprimidos ainda exigem expansão. [Capacidades, limites e próximos passos](docs/threejs-studio.md).

CAD e receitas usam SQLite em `apps/api/data`. Projetos X3D são temporários e expiram após uma hora de inatividade por padrão. A linguagem CAD possui limites explícitos: [formatos e capacidades](docs/cad-readiness.md).

O catálogo CAD oferece 21 recursos, incluindo roscas reais, engrenagens/cremalheiras, curvas de tubo, molas e trajetórias 3D segmentadas. Acabamentos podem ser limitados por região. [Melhorias e avaliação real de confiabilidade](docs/project-improvements-2026-10-08.md) registram resultados e limitações.

## Desenvolvimento

```bash
npm run dev:api
npm run dev:web
npm run typecheck
npm run lint:web
npm test
npm run build
npm run test:browser
```

Para configurar os testes de navegador e executar as suítes Python, consulte [docs/testing.md](docs/testing.md). Os scripts direcionam arquivos temporários e caches Python para `.cache` neste checkout, evitando consumo desnecessário do disco C: neste ambiente.

## Organização

| Pasta | Responsabilidade |
|---|---|
| `apps/web/src/cad` | Agente CAD, editores, movimento e visualizador de malha |
| `apps/web/src/three` | Editor de cenas, contrato JSON e motor Three.js local |
| `apps/web/src/chat` e `src/x3d` | Conversa e área X3D |
| `apps/web/src/ai` e `src/workspace` | Provedor configurado e navegação compartilhada |
| `apps/api/src/api` | Motores, validação, persistência e rotas |
| `packages/agent` | Provedores, prompts, planejamento e reparos estruturados |
| `packages/domain` | Schemas compartilhados e regras TS/Python |
| `services/x3d-mcp` | Biblioteca upstream fixada e servidor opcional |
| `scripts`, `tests`, `examples`, `docs` | Execução, testes, exemplos e documentação |

Referências atuais: [PRD](PRD.md), [estado e próximos trabalhos](ISSUES.md), [arquitetura](docs/architecture.md). O histórico está em [docs/archive](docs/archive/README.md).
