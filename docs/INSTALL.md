# Instalar o HubCli

## macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.sh | bash
```

> Nota: a URL `github.com/.../releases/latest/download/install.sh` (o padrão
> "via GitHub Release") **não funciona** enquanto só existirem prereleases
> (toda `hubcli-v*-rc.N` até agora) — o endpoint `/releases/latest` do
> GitHub só reconhece releases não-prerelease. Por isso o comando acima usa
> `raw.githubusercontent.com` direto da branch `dev`, que sempre funciona.
> O `install.sh` baixado por essa URL resolve a versão certa sozinho (ele
> tem seu próprio fallback para pegar a última release, incluindo
> prereleases).

**Alternativa mais segura** — baixar, inspecionar e só então rodar:

```bash
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.sh -o install.sh
less install.sh          # leia antes de executar
bash install.sh
```

Não é preciso Git nem Bun instalados — `install.sh` baixa um binário compilado
para sua plataforma (`hubcli-<os>-<arch>.tar.gz`), valida o checksum SHA-256
antes de extrair, e nunca continua se o checksum não bater.

## Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1 | iex
```

(mesmo motivo do macOS/Linux acima: a URL `releases/latest/download/` não funciona só com prereleases publicadas.)

Alternativa segura (baixar e inspecionar primeiro):

```powershell
irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -File install.ps1
```

> `install.ps1` foi escrito e revisado nesta sessão, mas **não foi executado
> em uma máquina Windows real** (nenhuma estava disponível). Trate como
> não-verificado até rodar de fato — veja [docs/WINDOWS.md](WINDOWS.md).

## Plataformas suportadas

| Plataforma | Artefato | Status |
|---|---|---|
| macOS Intel (darwin-x64) | `hubcli-darwin-x64.tar.gz` | validado por humano (nesta máquina) **e** por CI real (`macos-15-intel`) |
| macOS Apple Silicon (darwin-arm64) | `hubcli-darwin-arm64.tar.gz` | validado por CI real (`macos-14`) — build + `--version`/`--help`/`doctor`/`doctor --mcp` num runner limpo, sem checkout do repo |
| Linux x64 | `hubcli-linux-x64.tar.gz` | validado por CI real (`ubuntu-latest`), mesmo processo acima |
| Linux ARM64 | `hubcli-linux-arm64.tar.gz` | construído por cross-compile em CI; **não smoke-testado** (GitHub não tem runner ARM64 Linux gratuito) |
| Windows x64 | `hubcli-windows-x64.zip` | validado por CI real (`windows-latest`) — build + smoke test automatizado; **ainda não confirmado por um humano numa máquina Windows física** |

Todos os 5 artefatos são gerados pelo workflow `hubcli-release.yml` a cada
release, usando o mecanismo oficial de build do OpenCode
(`packages/opencode/script/build.ts`) com cross-compilação nativa do Bun.
O job `verify-package` roda em runner **sem checkout do repositório** — só
baixa o pacote publicado e executa os binários, provando que eles não
dependem do repo/Bun/Git/path de build.

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
