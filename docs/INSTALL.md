# Instalar o HubCli

## macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/main/install.sh | bash
```

Ou, via GitHub Release (depois que uma release existir):

```bash
curl -fsSL https://github.com/mkvinicius/Hubcli/releases/latest/download/install.sh | bash
```

**Alternativa mais segura** — baixar, inspecionar e só então rodar:

```bash
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/main/install.sh -o install.sh
less install.sh          # leia antes de executar
bash install.sh
```

Não é preciso Git nem Bun instalados — `install.sh` baixa um binário compilado
para sua plataforma (`hubcli-<os>-<arch>.tar.gz`), valida o checksum SHA-256
antes de extrair, e nunca continua se o checksum não bater.

## Windows (PowerShell)

```powershell
irm https://github.com/mkvinicius/Hubcli/releases/latest/download/install.ps1 | iex
```

Alternativa segura (baixar e inspecionar primeiro):

```powershell
irm https://raw.githubusercontent.com/mkvinicius/Hubcli/main/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -File install.ps1
```

> `install.ps1` foi escrito e revisado nesta sessão, mas **não foi executado
> em uma máquina Windows real** (nenhuma estava disponível). Trate como
> não-verificado até rodar de fato — veja [docs/WINDOWS.md](WINDOWS.md).

## Plataformas suportadas

| Plataforma | Artefato | Status |
|---|---|---|
| macOS Intel (darwin-x64) | `hubcli-darwin-x64.tar.gz` | construído e testado nesta sessão (máquina nativa) |
| macOS Apple Silicon (darwin-arm64) | `hubcli-darwin-arm64.tar.gz` | construído (cross-compile); binário nunca executado em hardware ARM real |
| Linux x64 | `hubcli-linux-x64.tar.gz` | construído (cross-compile); binário nunca executado em Linux real |
| Linux ARM64 | `hubcli-linux-arm64.tar.gz` | construído (cross-compile); binário nunca executado em hardware real |
| Windows x64 | `hubcli-windows-x64.zip` | construído (cross-compile); binário nunca executado no Windows |

Todos os 5 artefatos foram gerados a partir do mecanismo oficial de build do
OpenCode (`packages/opencode/script/build.ts`, cross-compilação nativa do
Bun) nesta sessão, rodando em uma máquina macOS Intel. Apenas o alvo nativo
(darwin-x64) foi de fato executado e testado ponta a ponta.

## Requisitos

- Nenhum provider é obrigatório para instalar ou abrir o HubCli.
- Para usar modelos, adicione credenciais depois de instalar — veja
  [docs/PROVIDERS.md](PROVIDERS.md). Nunca passe chaves como argumento de
  linha de comando.

## Flags do instalador

```
install.sh [--version <v>] [--install-dir <dir>] [--check] [--repair] [--dry-run] [--uninstall] [--help]
install.ps1 [-Version <v>] [-InstallDir <dir>] [-Check] [-Repair] [-DryRun] [-Uninstall] [-Help]
```
