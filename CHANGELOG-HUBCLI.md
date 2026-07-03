# Changelog — HubCli

Registro das mudanças do fork sobre o OpenCode. Formato reverso-cronológico.

## v0.1.0-rc.1 (2026-07-02)

Primeiro release candidate do MVP.

### Recursos

- **Branding condicional**: tudo do HubCli existe apenas com `HUBCLI_BRAND=1` (injetado pelo launcher). Sem a flag, o OpenCode original é preservado — comandos, seletor, logo e wordmark.
- **16 modelos validados** por chamadas reais em 4 providers: OpenCode Zen (GPT‑5.2, GPT‑5.2 Codex, Kimi K2.7 Code, Kimi K2.5, Claude Fable 5 experimental), DeepSeek direto (V4 Pro, V4 Flash), NVIDIA NIM (MiniMax M3, M2.7, DeepSeek V4 Pro), Alibaba Token Plan (Qwen 3.7/3.6, GLM 5.x — degradado por entitlement).
- **Seletor curado** em grupos: OpenAI → Kimi → DeepSeek → NVIDIA NIM → Qwen → GLM → Experimental.
- **`hubcli doctor`** (`--verbose`, `--connect`, `--mcp`, `--all`): config, permissões, credenciais (presença apenas), perfis, integrações, conectividade real e handshake MCP. Exit codes 0/1/2/3/4.
- **`hubcli profile`** (list/show/use/current) + **`hubcli run --profile`** + **`hubcli route explain`**: roteamento determinístico com fallback de seleção limitado (`--no-fallback` para desativar). Persistência versionada em `~/.hubcli/profiles.json` com backup.
- **`hubcli auth`** (status/providers): presença de credenciais sem nunca exibir valores.
- **`hubcli mcp serve`**: servidor MCP stdio com 6 tools read-only; integrado e testado de verdade com Codex CLI 0.140 e Claude Code 2.1.
- **`hubcli maintenance`** (status/fetch/preview/sync): sincronização assistida com o upstream (merge --no-ff, nunca rebase/stash/reset).
- **`hubcli upgrade`** bloqueado com redirecionamento ao maintenance.
- **Instalação**: `setup.sh` idempotente (--check/--dry-run/--repair) com launcher gerado de template canônico; `uninstall.sh` seguro (dados preservados por padrão).
- **Documentação**: README-HUBCLI + docs/ (mcp, providers, profiles, maintenance, security).

### Segurança

- Launcher com parser whitelist (sem source/eval), credenciais 600 obrigatórias, `sanitizeError` em toda saída de erro, subprocessos sem shell com timeout/maxBuffer, MCP server 100% read-only.

### Upstream

- Merge limpo de 116 commits do upstream/dev (verificado por merge-tree antes; typechecks, 95 testes e smoke E2E pós-merge todos verdes).

### Problemas conhecidos

- Alibaba Token Plan retorna `AccessDenied.Unpurchased` — Qwen/GLM degradados (WARN no doctor, pulados no roteamento).
- Fallback automático é de seleção, não de runtime.
- `deepseek-ai/deepseek-v4-pro` via NVIDIA é lento (~2 min).
- Fable 5 experimental com latência alta (13–47s).
- Codex exec exige `default_tools_approval_mode = "approve"` para chamar tools MCP em modo não interativo.
