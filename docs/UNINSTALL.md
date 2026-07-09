# Desinstalar o HubCli

## Instalação distribuída

```bash
bash install.sh --uninstall
```

```powershell
powershell -File install.ps1 -Uninstall
```

Remove apenas os binários (`hubcli`, `hubcli-runtime`, `hubcli-fast` — ou os
`.exe`/`.ps1`/`.cmd` equivalentes no Windows) do diretório de instalação.
**Nunca apaga `~/.hubcli`** (config, credenciais, perfis) — essa pasta fica
preservada para uma reinstalação futura ou para você fazer backup manual.

## Instalação de desenvolvedor (git checkout via setup.sh)

```bash
bash ~/Hubcli/script/hubcli/uninstall.sh              # preserva dados por padrão
bash ~/Hubcli/script/hubcli/uninstall.sh --purge-data  # também apaga ~/.hubcli — exige digitar "APAGAR"
```

`--purge-data` é a única forma de remover credenciais/config, e exige
confirmação explícita digitada — nunca é feito por acidente ou
automaticamente.
