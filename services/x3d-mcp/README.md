# Serviço X3D/MCP

A aplicação usa esta dependência como biblioteca local por padrão. O servidor é opcional para integrações MCP; consulte [a configuração dos backends](../../docs/x3d-mcp.md).

| Arquivo | Responsabilidade |
|---|---|
| `vendor/` | Submódulo do [Web3D Consortium x3d_mcp](https://github.com/Web3DConsortium/x3d_mcp), fixado em um commit explícito |
| `run.sh` | Entrada POSIX para iniciar Streamable HTTP com as dependências compatíveis |
| `.env.example` | Referência das variáveis de transporte, host e porta |

## Iniciar o servidor opcional

Em um terminal POSIX, com uv no PATH:

```bash
git submodule update --init --recursive services/x3d-mcp/vendor
./services/x3d-mcp/run.sh
```

O script lê as variáveis do ambiente: `MCP_TRANSPORT=streamable-http`, `PORT=8000` e `HOST=0.0.0.0` são os padrões. Para limitar a interface, exporte `HOST=127.0.0.1` antes de executar. O arquivo `.env.example` é uma referência; `run.sh` não carrega arquivos `.env` automaticamente.

| Endpoint | Uso |
|---|---|
| `GET http://localhost:8000/pulse` | Saúde do servidor |
| `GET http://localhost:8000/` | Informações do serviço |
| `http://localhost:8000/mcp` | Conexão Streamable HTTP por um cliente MCP |

Um GET simples em `/mcp` pode retornar 406: utilize um cliente MCP para negociar o protocolo. Na API Forma, selecione `X3D_BACKEND=mcp` e configure `MCP_BASE_URL` para esse servidor.

## Dependência e manutenção

O servidor fixado importa `mcp.server.fastmcp` e exige `mcp<2`. A entrada aplica essa restrição com `uv run --with "mcp<2"`, sem modificar o submódulo.

Atualizações do submódulo devem apontar para um commit explícito, preservar licenças/recursos e passar pelos testes de validação local, conversão e protocolo MCP. Registre o pin em [docs/x3d-mcp.md](../../docs/x3d-mcp.md) e mantenha o lock da API compatível. Evite alterações locais dentro de `vendor/`.
