# Configurar provedores de IA

Abra Configurar IA, escolha a opção, preencha os campos e use Testar conexão. Depois clique Salvar e aplicar. O teste faz uma chamada pequena real e não altera o provedor ativo; verificação de instalação/login não gera conteúdo.

| Provedor | Configuração |
|---|---|
| WebLLM | Navegador com WebGPU e memória para baixar/carregar o modelo |
| Endpoint compatível com OpenAI | URL base, chave, modelo e CORS aceitando a origem do frontend |
| Codex | Cliente oficial instalado e autenticado no computador da API |
| Claude Code | Cliente oficial instalado e autenticado no computador da API |

## Clientes locais

Instale e autentique o cliente no terminal do computador da API. Use a documentação oficial de [Codex CLI](https://developers.openai.com/codex/cli) ou [Claude Code](https://code.claude.com/docs/en/setup). Reinicie a API após instalar para atualizar o PATH.

1. Selecione o cliente em Configurar IA.
2. Deixe Modelo vazio para usar o padrão do cliente, ou informe um identificador disponível para a conta.
3. Execute Verificar instalação e login.
4. Execute Testar conexão e confira o JSON retornado.
5. Clique Salvar e aplicar.

A ponte recebe mensagens e retorna JSON sem expor tokens ao navegador ou executar ferramentas propostas pela IA. Ela é restrita a loopback/origens locais permitidas, aceita uma geração por vez e encerra o processo no timeout/cancelamento. Modelos, quotas e políticas da conta são definidos pelo provedor.

## Falhas e retomada

| Diagnóstico | Ação |
|---|---|
| Cliente ausente | Instalar e reiniciar API |
| Login necessário | Refazer autenticação no cliente oficial |
| Modelo indisponível | Esvaziar Modelo ou selecionar um disponível |
| CORS no endpoint | Permitir a origem do frontend no servidor do provedor |
| Quota esgotada | Aguardar renovação ou aplicar outro provedor |
| Limite temporário | Respeitar o prazo informado |
| JSON inválido/truncado | Reduzir complexidade ou escolher modelo com saída adequada |
| CAD/X3D recusado | Ler diagnóstico do motor; conexão não comprova validade geométrica |

Retentativas de formato e reparo têm orçamentos por ação/provedor. Quota ou cancelamento não iniciam continuação automática. O usuário pode retomar CAD na mesma aba para aproveitar componentes concluídos; exporte o JSON antes de fechar. Uma falha apenas no salvamento permite reutilizar o resultado concluído sem outra inferência. Veja [recuperação CAD](cad.md#recuperação-e-rascunhos).

Three.js permite edição/reprodução local sem IA. Usar WebLLM ao mesmo tempo que CAD ou cenas pesadas aumenta o consumo de RAM/VRAM; escolha um provedor externo/local quando necessário.
