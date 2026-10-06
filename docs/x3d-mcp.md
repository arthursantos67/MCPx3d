# Biblioteca X3D e transporte MCP opcional

Upstream: [Web3D Consortium x3d_mcp](https://github.com/Web3DConsortium/x3d_mcp). Submódulo: `services/x3d-mcp/vendor`. Commit fixado: `74da0ec46f477f0048aee813ecfc5fc87e655537`. Licença: veja `services/x3d-mcp/vendor/LICENSE`; preserve seus avisos em redistribuições.

## Modo padrão: local

`apps/api` instala o submódulo como dependência editable para conservar os caminhos dos recursos/schema usados pelo upstream. Isso é intencional: uma instalação do wheel upstream sem os recursos pode não encontrar os schemas. Inicialize o submódulo antes de instalar a API:

```bash
git submodule update --init --recursive
```

`X3D_BACKEND=local` usa serialização determinística da aplicação e chama os validadores upstream diretamente em threads. Não inicia o servidor MCP e não faz chamadas HTTP para construir ou validar a cena. Escala, transparência e rotação usam o mesmo contrato do domínio.

A biblioteca também fornece extração HTML e conversão ClassicVRML. O HTML usa X3DOM 1.8.2 externo. O cabeçalho ClassicVRML local é normalizado para `#X3D V...`; o serializer upstream devolve `#VRML V...` mesmo para a versão 4.0.

## Modo opcional: MCP

Para interoperar com um servidor existente, configure em `apps/api/.env`:

```dotenv
X3D_BACKEND=mcp
MCP_BASE_URL=http://localhost:8000
```

A inicialização do servidor está em [services/x3d-mcp/README.md](../services/x3d-mcp/README.md). O modo remoto mantém composição em lote quando compatível e chamadas granulares para campos que o workflow upstream não representa. Ambos passam pela mesma validação antes de publicar uma revisão.

A dependência `mcp<2` mantém compatibilidade com a API FastMCP deste commit. `GET /api/health/engines` informa o backend selecionado; `/api/health/mcp` continua disponível para diagnóstico do serviço opcional.

## Limitações e atualização

A conversão X3DJ upstream retorna JSON malformado neste commit. A aplicação detecta isso, anuncia o formato como indisponível e não libera esse download. O manifesto JSON do domínio continua disponível e é um formato diferente de X3DJ.

Não modifique silenciosamente o submódulo. Para atualizar, teste o novo commit, recursos/schema, validação local, conversões e integração MCP; atualize o pin e o lock da API e execute as suítes correspondentes.

Artefatos possuem cache limitado por projeto/revisão/formato, TTL e deduplicação de requisições concorrentes. A troca de backend não altera as garantias de revisão nem a regra de preservar a última cena válida.
