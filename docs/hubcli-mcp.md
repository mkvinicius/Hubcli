# HubCli MCP Server

`hubcli mcp serve` inicia um servidor MCP por **stdio** com seis tools **somente leitura**. stdout carrega exclusivamente o protocolo; logs vão para stderr. Registrado apenas quando `HUBCLI_BRAND=1` (o launcher injeta).

## Tools

| Tool | O que retorna |
|---|---|
| `hubcli_doctor` | overall_status, default_model, providers, presença de credenciais (booleanos), warnings/errors. `connect=true` roda 1 probe real (até 180s) |
| `hubcli_models` | os 16 modelos validados: provider, id, nome, grupo, default, configured, catalog_status, experimental, capabilities. Sem rede |
| `hubcli_project_status` | cwd do cliente, git branch/contadores, package manager, tipo de projeto, arquivos de projeto detectados. Nunca lê conteúdo |
| `hubcli_git_status` | branch, arquivos alterados (máx. 200), último commit. Argumentos git fixos |
| `hubcli_maintenance_status` | estado do fork (branch, remotes, divergência). Sem fetch |
| `hubcli_maintenance_preview` | commits/conflitos previstos do upstream. Pedidos de fetch são rejeitados |

## Limites e segurança

- Sem shell (`spawnSync` com args em array), cwd fixo no diretório do cliente (`HUBCLI_CALLER_PWD` preservado pelo launcher).
- Timeout 10s por subprocess (180s só no doctor connect), `maxBuffer` 1MB, resposta ≤256KB com flag `truncated`.
- Nenhuma escrita, nenhum comando do cliente aceito, nenhum caminho externo aceito, nenhum valor de credencial jamais incluído.
- Tool desconhecida → `isError`; JSON inválido não derruba o servidor; EOF encerra limpo.

## Registro nos clientes

```bash
# Codex CLI (≥0.140)
codex mcp add hubcli -- ~/.local/bin/hubcli mcp serve
# em ~/.codex/config.toml, no bloco [mcp_servers.hubcli], adicione:
#   startup_timeout_sec = 120
#   tool_timeout_sec = 120
#   default_tools_approval_mode = "approve"   # obrigatório p/ codex exec

# Claude Code
claude mcp add --scope user hubcli -- ~/.local/bin/hubcli mcp serve
```

Verificação: `hubcli doctor --mcp` faz o handshake real (initialize + tools/list) contra o servidor spawnado.

## Teste manual

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | hubcli mcp serve 2>/dev/null
```
