# Providers e modelos HubCli

Todos os modelos abaixo foram validados por chamadas reais (resposta "OK" + tool calling) na data indicada no registry (`packages/opencode/src/cli/hubcli/model-registry.ts`). O espelho visual do TUI fica em `packages/tui/src/hubcli/model-display.ts` — os dois têm o total fixado em testes.

## opencode (OpenCode Zen) — auth: conta OpenCode (`hubcli providers login`)

| Modelo | Grupo | Notas |
|---|---|---|
| `opencode/gpt-5.2` | OpenAI | reasoning |
| `opencode/gpt-5.2-codex` | OpenAI | **modelo padrão** |
| `opencode/kimi-k2.7-code` | Kimi | coding |
| `opencode/kimi-k2.5` | Kimi | mais barato |
| `opencode/claude-fable-5` | Experimental | 1M ctx; latência alta; nunca obrigatório |

Não é o provider oficial da OpenAI/Moonshot/Anthropic — os modelos são servidos pela API Zen com créditos da conta OpenCode.

## deepseek (direto) — auth: `DEEPSEEK_API_KEY`

| Modelo | Notas |
|---|---|
| `deepseek/deepseek-v4-pro` | melhor custo/qualidade; rápido (~1s conectividade) |
| `deepseek/deepseek-v4-flash` | mais rápido/barato |

## nvidia (NVIDIA NIM) — auth: `NVIDIA_API_KEY` (build.nvidia.com)

Endpoint `https://integrate.api.nvidia.com/v1`, adapter OpenAI-compatible, uma chave para todos.

| Modelo | Notas |
|---|---|
| `nvidia/minimaxai/minimax-m3` | principal; 1M ctx; multimodal declarado (não testado) |
| `nvidia/minimaxai/minimax-m2.7` | fallback |
| `nvidia/deepseek-ai/deepseek-v4-pro` | funcional mas lento (~2min) — prefira o direto |

## alibaba-token-plan — auth: `DASHSCOPE_API_KEY` — **DEGRADADO**

Qwen 3.7 Max / 3.6 Plus / 3.6 Flash e GLM 5 / 5.1 / 5.2 continuam configurados, mas o plano retorna `AccessDenied.Unpurchased` (2026-07). O doctor trata como WARN; o roteamento de perfis pula o provider (lista `degraded_providers` em `~/.hubcli/profiles.json` — remova a entrada quando o plano voltar).

## Adicionando uma chave

1. `nano ~/.hubcli/credentials.env` (nunca passe chave como argumento de CLI)
2. `chmod 600 ~/.hubcli/credentials.env`
3. Se for variável nova, adicione ao whitelist do launcher (`script/hubcli/launcher-template.sh` + `setup.sh --repair`)
4. `hubcli auth status` para conferir presença.
