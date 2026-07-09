# Segurança da distribuição

Segurança do produto (parser de credenciais, MCP read-only, etc.):
[docs/hubcli-security.md](hubcli-security.md). Este documento cobre
especificamente a cadeia de distribuição (build → release → install).

## Cadeia de confiança

1. **Build**: artefatos oficiais devem vir de `hubcli-release.yml` rodando em
   runners do GitHub Actions (`macos-13`, `macos-14`, `ubuntu-latest`,
   `windows-latest`) — nunca da máquina pessoal de um desenvolvedor. Builds
   locais embutem o path absoluto do disco de build em pelo menos uma
   dependência de logging (`pino`/`thread-stream`) — ver achado abaixo.
2. **Checksums**: `checksums-sha256.txt` é gerado no mesmo job que empacota
   os artefatos e publicado junto na release.
3. **Instalação**: `install.sh`/`install.ps1` só baixam de
   `github.com/mkvinicius/Hubcli`, calculam o SHA-256 localmente e **abortam
   sem instalar nada** se não bater com o checksum publicado.

## Achado desta sessão: paths pessoais embutidos em build local

Um build local (nesta máquina, para prova de conceito) do `hubcli-runtime`
contém 4 ocorrências do path absoluto do desenvolvedor:

```
/Users/maikonviniciussilva/Hubcli/node_modules/.bun/{pino,thread-stream,write-file-atomic}
```

Causa: `thread-stream` (usado pelo pino, dependência transitiva de logging)
embute o path absoluto de build para resolver o worker thread em tempo de
execução. Isso é um comportamento do bundler/dependência, não algo
introduzido pelo HubCli.

**Mitigação adotada**: os artefatos publicados numa release real **devem**
vir do workflow `hubcli-release.yml` (runners do GitHub Actions, paths
genéricos como `/Users/runner/...` ou `/home/runner/...`), nunca de uma
build local. O próprio workflow inclui um passo de verificação
(`grep` por `/Users/[a-z]+/(Hubcli|Documents|Desktop)`) que falha o build se
detectar um path de desenvolvedor.

**Não resolvido**: o mecanismo de embutir o path de build ainda existe — ele
só deixa de ser *pessoal* porque o path do runner de CI é genérico. Se
alguém rodar `bun install`/build numa máquina com um `$HOME` "identificável"
mesmo em CI customizado, o mesmo problema pode se repetir. Trate como um
limite conhecido do pipeline de build do Bun/pino, não como algo já
corrigido.

## Checklist antes de publicar uma release

- [ ] artefatos vieram de `hubcli-release.yml`, não de build local
- [ ] `checksums-sha256.txt` gerado no mesmo job de empacotamento
- [ ] nenhum segredo real usado nos testes de CI (grep automatizado no
      workflow, mais revisão manual)
- [ ] `credentials.env` nunca incluído em nenhum pacote (`package-platform.sh`
      só copia `hubcli-runtime`, `hubcli-fast`, `LICENSE`, `README.txt` — sem
      `~/.hubcli`)
- [ ] nenhum `.git`, `node_modules` ou código-fonte TypeScript no pacote
- [ ] SBOM/provenance (ver item 19 do super prompt) — não implementado nesta
      sessão, classificado como pós-v0.1.0 sem bloquear a RC5
