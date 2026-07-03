# HubCli

HubCli é um fork do [OpenCode](https://github.com/anomalyco/opencode) com curadoria de modelos, diagnóstico e manutenção próprios, mantendo 100% de compatibilidade com o OpenCode original — todo o comportamento HubCli só existe quando `HUBCLI_BRAND=1` (injetado pelo launcher).

## Diferenças para o OpenCode

| | OpenCode | HubCli |
|---|---|---|
| Modelos | catálogo completo | 16 modelos validados por chamadas reais, em grupos curados |
| Config | `~/.config/opencode` | `~/.hubcli/` (isolada) |
| Diagnóstico | — | `hubcli doctor` (config, credenciais, conectividade, MCP) |
| Manutenção do fork | — | `hubcli maintenance` (sync assistido com upstream) |
| Perfis | — | `hubcli profile` + `run --profile` com roteamento explícito |
| Servidor MCP | — | `hubcli mcp serve` (6 tools read-only p/ Codex e Claude Code) |

## Instalação

```bash
git clone https://github.com/mkvinicius/Hubcli ~/Hubcli
cd ~/Hubcli && bun install
bash script/hubcli/setup.sh          # idempotente; --check / --dry-run / --repair
```

O setup cria `~/.local/bin/hubcli` (launcher), `~/.hubcli/opencode.json` (config) e `~/.hubcli/credentials.env` (600, template vazio). Nunca sobrescreve sem backup e nunca copia segredos.

## Primeiro uso

```bash
# adicione suas chaves com um editor (nunca via argumento de CLI):
nano ~/.hubcli/credentials.env       # DEEPSEEK_API_KEY=, NVIDIA_API_KEY=, DASHSCOPE_API_KEY=
chmod 600 ~/.hubcli/credentials.env
hubcli providers login               # conta OpenCode (Zen: GPT, Kimi, Fable)
hubcli doctor                        # tudo verde?
hubcli run "Olá"                     # usa o modelo padrão (opencode/gpt-5.2-codex)
```

## Providers e modelos

Grupos no seletor (ordem atual): **OpenAI** (GPT‑5.2, GPT‑5.2 Codex via OpenCode Zen) → **Kimi** (K2.7 Code, K2.5 via Zen) → **DeepSeek** (V4 Pro, V4 Flash, direto) → **NVIDIA NIM** (MiniMax M3/M2.7, DeepSeek V4 Pro) → **Qwen** / **GLM** (Alibaba Token Plan — degradado enquanto o plano retorna `AccessDenied.Unpurchased`) → **Experimental** (Claude Fable 5).

Detalhes: [docs/hubcli-providers.md](docs/hubcli-providers.md).

## Perfis e roteamento

```bash
hubcli profile list                  # coding | fast | reasoning | review | long-context
hubcli run --profile coding "..."    # roteia para o 1º modelo disponível do perfil
hubcli route explain --profile fast  # mostra a decisão passo a passo
```

Fallback é limitado e transparente: pula providers degradados/sem credencial na **seleção** (nunca em runtime), no máximo dentro da lista do perfil, com `--no-fallback` para desativar. Detalhes: [docs/hubcli-profiles.md](docs/hubcli-profiles.md).

## Diagnóstico

```bash
hubcli doctor            # local: config, permissões, perfis, integrações
hubcli doctor --connect  # + chamadas reais (Zen obrigatório, DeepSeek obrigatório, NVIDIA/Fable advisory)
hubcli doctor --mcp      # + handshake real do servidor MCP
hubcli doctor --all      # tudo
hubcli auth status       # presença de credenciais (nunca valores)
```

Exit codes: 0 ok · 1 config · 2 permissões · 3 conectividade · 4 MCP.

## Servidor MCP

`hubcli mcp serve` expõe 6 tools **somente leitura** por stdio. Registro:

```bash
codex mcp add hubcli -- ~/.local/bin/hubcli mcp serve
claude mcp add --scope user hubcli -- ~/.local/bin/hubcli mcp serve
```

Para o Codex, adicione `default_tools_approval_mode = "approve"` ao bloco `[mcp_servers.hubcli]` em `~/.codex/config.toml` (senão o modo não interativo cancela as chamadas). Detalhes: [docs/hubcli-mcp.md](docs/hubcli-mcp.md).

## Atualização (sync com upstream OpenCode)

```bash
hubcli maintenance status   # divergência
hubcli maintenance fetch    # baixa commits
hubcli maintenance preview  # conflitos previstos
hubcli maintenance sync     # merge --no-ff assistido (nunca rebase, nunca stash)
```

Detalhes: [docs/hubcli-maintenance.md](docs/hubcli-maintenance.md).

## Segurança

Chaves só em `~/.hubcli/credentials.env` (600) ou no auth nativo do OpenCode; parser whitelist sem `source`/`eval`; nenhum comando imprime valores de credenciais; MCP server sem shell e sem escrita. Detalhes: [docs/hubcli-security.md](docs/hubcli-security.md).

## Desinstalação

```bash
bash ~/Hubcli/script/hubcli/uninstall.sh   # remove só o launcher; dados preservados
```

## Limitações conhecidas

- Alibaba Token Plan indisponível (entitlement) — Qwen/GLM listados mas degradados.
- Fallback automático é de seleção, não de runtime: se o modelo escolhido falhar no meio da sessão, não há retry automático.
- Fable 5 é experimental (latência 13–47s) e nunca obrigatório.
- `deepseek-ai/deepseek-v4-pro` via NVIDIA é lento (~2min); prefira `deepseek/deepseek-v4-pro` direto.

## Troubleshooting

| Sintoma | Ação |
|---|---|
| `hubcli: bun not found` | instale bun: `curl -fsSL https://bun.sh/install \| bash` |
| `credentials file has insecure permissions` | `chmod 600 ~/.hubcli/credentials.env` |
| Modelo Alibaba `AccessDenied` | verifique a assinatura do Token Plan |
| Codex cancela tools MCP | veja a nota `default_tools_approval_mode` acima |
| doctor exit 3 | `hubcli doctor --connect --verbose` e cheque o provider indicado |
