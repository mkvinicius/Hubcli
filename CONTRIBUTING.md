# Contribuindo com o HubCli

HubCli é um fork independente do [OpenCode](https://github.com/anomalyco/opencode),
mantido por uma pessoa só. Isso muda o que faz sentido contribuir aqui.

## Onde reportar o quê

| Tipo | Onde |
|---|---|
| Instalação (`install.sh` / `install.ps1`), empacotamento, releases | **aqui** |
| `hubcli doctor`, perfis (`hubcli profile`/`route`), `hubcli maintenance`, servidor MCP do HubCli | **aqui** |
| Curadoria de modelos e providers do HubCli | **aqui** |
| Bug no núcleo do agente, na TUI, em ferramentas, LSP, etc. | [OpenCode](https://github.com/anomalyco/opencode) — o fork herda essas correções via sync |

Se não tiver certeza, abra aqui mesmo; é fácil redirecionar depois.

## Rodando a partir do código-fonte

```bash
git clone https://github.com/mkvinicius/Hubcli ~/Hubcli
cd ~/Hubcli && bun install
bash script/hubcli/setup.sh          # instala launcher + binários
HUBCLI_DEV=1 hubcli doctor           # roda a partir do source, sem recompilar
```

Depois de alterar código em `packages/opencode/src/`, reconstrua os binários
instalados com `bash script/hubcli/setup.sh --repair`.

## Antes de abrir um PR

```bash
bun run --filter opencode typecheck
bun run --filter @opencode-ai/tui typecheck
cd packages/opencode && bun test test/cli/cmd/doctor.test.ts test/cli/hubcli/ --timeout 60000
```

O CI (`.github/workflows/hubcli-ci.yml`) roda isso em Linux, macOS e Windows,
mais o build/empacotamento das plataformas e — importante — a execução real dos
instaladores ponta a ponta.

Alguns princípios que o projeto segue e que os PRs precisam respeitar:

- **Nada de HubCli sem a flag.** Todo comportamento próprio do fork só existe
  quando `HUBCLI_BRAND=1`. Sem a flag, o binário deve se comportar como o
  OpenCode original.
- **Credenciais nunca aparecem.** Nenhum comando imprime valores de chave;
  `doctor`/`auth status` mostram só presença. Nada de `eval`/`source` em
  arquivos de credencial.
- **Não afirme suporte sem teste.** Se uma plataforma não foi construída e
  executada de verdade, a documentação diz isso explicitamente.

## Convenções

- Commits seguem [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix(hubcli): ...`, `feat(hubcli): ...`, `ci(hubcli): ...`).
- Mudanças em código do upstream (fora de `hubcli/`) devem ser mínimas — quanto
  menor a divergência, mais fácil o `hubcli maintenance sync`.

## Sincronizando com o upstream

```bash
hubcli maintenance status    # quantos commits atrás estamos
hubcli maintenance preview   # conflitos previstos
hubcli maintenance sync      # merge --no-ff assistido (nunca rebase)
```

Ver [docs/hubcli-maintenance.md](docs/hubcli-maintenance.md).
