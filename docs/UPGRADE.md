# Atualizar o HubCli

## Instalação distribuída (via install.sh/install.ps1) — recomendado

```bash
bash install.sh --repair              # reinstala os binários na versão mais recente
# ou, para uma versão específica:
bash install.sh --repair --version hubcli-v0.1.0-rc.5
```

```powershell
powershell -File install.ps1 -Repair
```

`--repair` nunca exige Git, Bun ou o repositório local. Ele:

1. baixa o artefato da versão alvo do GitHub Releases;
2. valida o checksum SHA-256 (aborta se não bater — nada é instalado);
3. faz backup dos binários atuais antes de sobrescrever;
4. instala atomicamente;
5. roda um smoke test (`hubcli --version`);
6. se o smoke test falhar, restaura o backup automaticamente (rollback).

`~/.hubcli/opencode.json`, `~/.hubcli/credentials.env` e
`~/.hubcli/profiles.json` **nunca são tocados** por `--repair`.

Um `hubcli upgrade` nativo (que faria essa mesma checagem/download de dentro
do próprio binário, sem precisar rodar `install.sh` manualmente) ainda não
existe nesta sessão — é trabalho futuro; hoje `hubcli upgrade` (herdado do
OpenCode) permanece redirecionado para a orientação de usar
`install.sh --repair` ou `hubcli maintenance` (ver abaixo).

## Instalação de desenvolvedor (git checkout via setup.sh)

Se você instalou via `bash script/hubcli/setup.sh` (clone do repositório,
não pelo `install.sh` distribuído), continue usando:

```bash
hubcli maintenance status
hubcli maintenance fetch
hubcli maintenance preview
hubcli maintenance sync      # merge --no-ff assistido, nunca rebase/stash
bash script/hubcli/setup.sh --repair   # reconstrói launcher/fast/runtime do código atual
```

Esse fluxo é apenas para quem trabalha no fork (desenvolvedores). Usuários
finais devem usar `install.sh`/`install.ps1`.
