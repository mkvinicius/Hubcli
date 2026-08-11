# Troubleshooting

| Sintoma | Ação |
|---|---|
| `curl: command not found` (install.sh) | instale curl (já vem por padrão em quase todo macOS/Linux) |
| `Checksum mismatch ... Nothing was installed` | não tente forçar — baixe de novo; se persistir, o artefato pode estar corrompido no release, reporte um issue |
| `hubcli: runtime binary not found` | reinstale: `bash install.sh --repair` |
| `<dir> is not on PATH` | rode o `export PATH=...` sugerido pelo instalador, ou adicione ao seu shell profile |
| `credentials file has insecure permissions` | `chmod 600 ~/.hubcli/credentials.env` |
| Modelo Alibaba `AccessDenied` | verifique a assinatura do Token Plan — ver [docs/PROVIDERS.md](PROVIDERS.md) |
| NVIDIA NIM instável/HTTP 500 | esperado — provider opcional e advisory, ver [docs/hubcli-providers.md](hubcli-providers.md) |
| Codex cancela chamadas MCP | adicione `default_tools_approval_mode = "approve"` em `~/.codex/config.toml` — ver [docs/hubcli-mcp.md](hubcli-mcp.md) |
| `doctor` exit 3 (conectividade) | `hubcli doctor --connect --verbose` e cheque o provider indicado |
| Windows: comando `hubcli` não encontrado | confirme que o diretório de instalação foi adicionado ao PATH do usuário (o instalador oferece fazer isso) |
| `HUBCLI_DEV=1 hubcli --version` mostra algo diferente de `local` | você está numa instalação distribuída (sem source) — `HUBCLI_DEV` só é significativo em checkouts de desenvolvedor via `setup.sh` |

Se nada acima resolver, rode `hubcli doctor --all` e inclua a saída (sem
editar/apagar nada sensível — ela já nunca mostra valores de credenciais) ao
abrir um issue.
