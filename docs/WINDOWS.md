# Windows

**Status: autoria concluída, execução real pendente.** Nenhuma máquina
Windows estava disponível nesta sessão. `install.ps1` e o launcher
`hubcli.ps1`/`hubcli.cmd` foram escritos e revisados por leitura, com
validação de sintaxe YAML/JSON onde aplicável, mas **nunca executados em
PowerShell real**. Não declare Windows "pronto" até o workflow
`hubcli-release.yml` rodar de verdade em `windows-latest` e alguém confirmar
manualmente.

## Design

- O pacote Windows (`hubcli-windows-x64.zip`) contém `hubcli.ps1` (launcher),
  `hubcli.cmd` (shim de uma linha para `hubcli` funcionar em `cmd.exe` e no
  PATH sem precisar digitar `powershell -File`), `hubcli-runtime.exe`,
  `hubcli-fast.exe`, `LICENSE`, `README.txt`.
- Diferente do launcher POSIX (`script/hubcli/launcher-template.sh`), o
  launcher Windows **não tem fallback para código-fonte** — o pacote
  distribuído não inclui TypeScript nem Bun. `HUBCLI_DEV` não é lido no
  Windows distribuído (não há o que "modo dev" significaria sem o repositório
  completo).
- Config e credenciais ficam em `%USERPROFILE%\.hubcli\` (mesmo padrão do
  `~/.hubcli` em Unix): `opencode.json`, `credentials.env`, `profiles.json`.
- `install.ps1` nunca usa `Invoke-Expression` sobre conteúdo baixado, nunca
  monta comandos por interpolação de string, e só baixa de
  `github.com/mkvinicius/Hubcli`.

## Incompatibilidades conhecidas / auditadas por leitura de código (não testadas)

| Área | Situação |
|---|---|
| Paths (`~`, `/`) | launcher Windows usa `%USERPROFILE%` e `Join-Path`, não paths estilo Unix |
| chmod / permissões 600 | não existe equivalente direto no NTFS; `install.ps1` não tenta aplicar chmod — pendente de decisão (ACL do Windows?) antes de um release estável |
| shebang (`#!/usr/bin/env bash`) | irrelevante — o launcher Windows é `.ps1`/`.cmd`, não script POSIX |
| Sinais (SIGINT etc.) | não auditado — depende de como o runtime compilado (Bun) trata Ctrl+C no console do Windows; requer teste real |
| Diretório temporário | `install.ps1` usa `[System.IO.Path]::GetTempPath()`, correto para Windows |
| `HOME` vs `USERPROFILE` | launcher usa `$env:USERPROFILE` consistentemente |
| MCP via stdio | deve funcionar (stdio é multiplataforma no Node/Bun), mas **não testado** no Windows |
| Git opcional | o pacote distribuído não depende de Git; apenas `hubcli maintenance` (para devs/forks) precisaria |
| Watchers/snapshot | não auditado — dependem de bindings nativos do OpenCode (`@parcel/watcher` etc.) que têm builds Windows publicados, mas não testados aqui |

## Pendências antes de declarar Windows suportado

1. Rodar `hubcli-release.yml` em `windows-latest` de verdade.
2. Baixar o zip resultante numa VM/máquina Windows real e rodar
   `install.ps1`.
3. Validar `hubcli --version`, `--help`, `doctor`, `profile list`, `mcp serve`.
4. Validar `install.ps1 -Uninstall` e `-Repair`.
5. Só então atualizar este documento e o relatório de release para "testado".
