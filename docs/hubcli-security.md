# Segurança do HubCli

## Credenciais

- Chaves vivem em `~/.hubcli/credentials.env` com permissão **600** (o launcher recusa executar se estiver diferente) ou no auth nativo do OpenCode (`~/.local/share/opencode/auth.json`).
- O launcher carrega credenciais com parser **whitelist-only** (`DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY`), linha a linha, sem `source` e sem `eval`; variáveis desconhecidas são ignoradas com aviso; valores já presentes no ambiente nunca são sobrescritos.
- Nenhum comando aceita chave como argumento de CLI; nenhum comando imprime valor, prefixo, sufixo ou tamanho de chave. `hubcli auth status` e o doctor reportam apenas present/missing/permissões.
- Erros de API passam por `sanitizeError()` (mascara padrões `sk-...`) e são truncados.
- Tokens do Claude Code, cookies e OAuth de terceiros **nunca** são lidos ou reutilizados.

## Subprocessos

- Todos os spawns usam args em array, sem shell, com `timeout` e `maxBuffer`; timeouts distinguem-se de falhas normais.
- O servidor MCP é 100% read-only: sem escrita, sem git mutável, sem comandos do cliente, sem caminhos externos, saída limitada a 256KB com truncamento explícito.

## Scripts

- `setup.sh` / `sync-upstream.sh` / `uninstall.sh`: `set -euo pipefail`, sem `eval`, sem `curl | sh`, backups com timestamp antes de qualquer sobrescrita, segredos jamais copiados para backups do repositório.
- `sync-upstream.sh` nunca executa rebase, reset --hard, push --force, stash automático ou clean.
- `uninstall.sh` preserva `~/.hubcli` por padrão; apagar dados exige digitar `APAGAR`.

## O que verificar periodicamente

```bash
hubcli doctor --all          # permissões, conectividade, MCP
hubcli auth status           # presença de credenciais
ls -l ~/.hubcli/credentials.env   # deve mostrar -rw-------
```

Se suspeitar de vazamento de chave (commit acidental, log): **rotacione a chave no provider** imediatamente; não tente apenas apagar o histórico.
