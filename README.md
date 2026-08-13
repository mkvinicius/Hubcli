# HubCli

HubCli é um fork do [OpenCode](https://github.com/anomalyco/opencode) com curadoria de modelos, diagnóstico e manutenção próprios, mantendo 100% de compatibilidade com o OpenCode original — todo o comportamento HubCli só existe quando `HUBCLI_BRAND=1` (injetado pelo launcher).

## Instalação

**Sem precisar de Git nem Bun** (macOS/Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.sh | bash
```

Windows (PowerShell, sem precisar de administrador):

```powershell
irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1 | iex
```

Alternativa mais segura — baixar, inspecionar e só então rodar — instalação offline, e detalhes de plataformas suportadas: [docs/INSTALL.md](docs/INSTALL.md) e [docs/WINDOWS.md](docs/WINDOWS.md).

Depois de instalar, abra um terminal **novo** (para o PATH valer) e rode `hubcli --version`.

**Instalação de desenvolvedor** (clona o repositório, para quem vai contribuir com o fork):

```bash
git clone https://github.com/mkvinicius/Hubcli ~/Hubcli
cd ~/Hubcli && bun install
bash script/hubcli/setup.sh          # idempotente; --check / --dry-run / --repair
```

O setup cria `~/.local/bin/hubcli` (launcher), `~/.hubcli/opencode.json` (config) e `~/.hubcli/credentials.env` (600, template vazio). Nunca sobrescreve sem backup e nunca copia segredos.

## Primeiro uso

```bash
hubcli --version
hubcli doctor                        # providers ausentes aparecem como WARN, nunca crash
```

```bash
# adicione suas chaves com um editor (nunca via argumento de CLI):
nano ~/.hubcli/credentials.env       # DEEPSEEK_API_KEY=, NVIDIA_API_KEY=, DASHSCOPE_API_KEY=
chmod 600 ~/.hubcli/credentials.env
hubcli providers login               # conta OpenCode (Zen: GPT, Kimi, Fable)
hubcli run "Olá"                     # usa o modelo padrão (opencode/gpt-5.2-codex)
```

## Diferenças para o OpenCode

| | OpenCode | HubCli |
|---|---|---|
| Modelos | catálogo completo | 16 modelos validados por chamadas reais, em grupos curados |
| Config | `~/.config/opencode` | `~/.hubcli/` (isolada) |
| Diagnóstico | — | `hubcli doctor` (config, credenciais, conectividade, MCP) |
| Manutenção do fork | — | `hubcli maintenance` (sync assistido com upstream) |
| Perfis | — | `hubcli profile` + `run --profile` com roteamento explícito |
| Servidor MCP | — | `hubcli mcp serve` (6 tools read-only p/ Codex e Claude Code) |

## Providers e modelos

Grupos no seletor (ordem atual): **OpenAI** (GPT‑5.2, GPT‑5.2 Codex via OpenCode Zen) → **Kimi** (K2.7 Code, K2.5 via Zen) → **DeepSeek** (V4 Pro, V4 Flash, direto) → **NVIDIA NIM** (MiniMax M3/M2.7, DeepSeek V4 Pro) → **Qwen** / **GLM** (Alibaba Token Plan — degradado enquanto o plano retorna `AccessDenied.Unpurchased`) → **Experimental** (Claude Fable 5).

Detalhes: [docs/PROVIDERS.md](docs/PROVIDERS.md), [docs/hubcli-providers.md](docs/hubcli-providers.md).

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

## Atualização

Instalação distribuída (a recomendada para a maioria das pessoas):

```bash
bash install.sh --repair             # reinstala na versão mais recente, preserva ~/.hubcli
```

Instalação de desenvolvedor (sync com upstream OpenCode):

```bash
hubcli maintenance status   # divergência
hubcli maintenance fetch    # baixa commits
hubcli maintenance preview  # conflitos previstos
hubcli maintenance sync     # merge --no-ff assistido (nunca rebase, nunca stash)
```

Detalhes: [docs/UPGRADE.md](docs/UPGRADE.md), [docs/hubcli-maintenance.md](docs/hubcli-maintenance.md).

## Runtime compilado e modo dev

`setup.sh` compila e instala três binários em `~/.local/bin/`:

| Binário | Origem | Uso |
|---|---|---|
| `hubcli` | `script/hubcli/launcher-template.sh` | launcher — sempre o ponto de entrada |
| `hubcli-fast` | `bun build --compile` de `fast.ts` | atalho instantâneo p/ `--version`, `--help`, `profile`, `auth`, `route explain` |
| `hubcli-runtime` | `bun run script/build.ts --single` (mecanismo oficial do OpenCode) | binário completo (TUI, run, doctor, etc.) |

O launcher prefere `hubcli-runtime` por padrão. Para forçar execução a partir do código-fonte, use `HUBCLI_DEV=1`:

```bash
HUBCLI_DEV=1 hubcli doctor     # roda a partir do source, ignora hubcli-runtime
```

### Versionamento

Fonte única de verdade, resolvida por `script/hubcli/resolve-version.sh`:

1. tag git exata em `HEAD` no formato `hubcli-v*` (o release real);
2. arquivo `script/hubcli/VERSION` (a "próxima" versão, antes da tag existir);
3. fallback `local`.

## Segurança

Chaves só em `~/.hubcli/credentials.env` (600) ou no auth nativo do OpenCode; parser whitelist sem `source`/`eval`; nenhum comando imprime valores de credenciais; MCP server sem shell e sem escrita. Detalhes: [docs/SECURITY.md](docs/SECURITY.md), [docs/hubcli-security.md](docs/hubcli-security.md).

## Desinstalação

Instalação distribuída: `bash install.sh --uninstall` (preserva `~/.hubcli`).
Instalação de desenvolvedor: `bash ~/Hubcli/script/hubcli/uninstall.sh`. Detalhes: [docs/UNINSTALL.md](docs/UNINSTALL.md).

## Limitações conhecidas

- Alibaba Token Plan indisponível (entitlement) — Qwen/GLM listados mas degradados.
- NVIDIA NIM é opcional/advisory no `doctor` — instabilidade intermitente do lado do provider já observada para MiniMax M3; nunca declarado estável, nunca bloqueia o exit code.
- Fallback automático é de seleção, não de runtime.
- Fable 5 é experimental (latência 13–47s) e nunca obrigatório.
- `deepseek-ai/deepseek-v4-pro` via NVIDIA é lento (~2min); prefira `deepseek/deepseek-v4-pro` direto.
- `install.ps1` (Windows) validado via CI em runner real, mas ainda não confirmado por um humano numa máquina Windows física.

## Troubleshooting

Ver [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). Resumo:

| Sintoma | Ação |
|---|---|
| `curl`/`irm` não baixa nada, comando não encontrado | confirme que copiou o comando inteiro, incluindo `\| bash` / `\| iex` |
| `hubcli: bun not found` (só no modo desenvolvedor) | instale bun: `curl -fsSL https://bun.sh/install \| bash` |
| `credentials file has insecure permissions` | `chmod 600 ~/.hubcli/credentials.env` |
| Modelo Alibaba `AccessDenied` | verifique a assinatura do Token Plan |
| Codex cancela tools MCP | veja a nota `default_tools_approval_mode` acima |
| doctor exit 3 | `hubcli doctor --connect --verbose` e cheque o provider indicado |

## Créditos

HubCli é baseado no [OpenCode](https://github.com/anomalyco/opencode), licenciado sob MIT. Este fork não é afiliado nem mantido pela equipe oficial do OpenCode, OpenAI, Anthropic, NVIDIA ou qualquer outro provider integrado. Ver [NOTICE](NOTICE).
