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

## Achado desta sessão: paths pessoais embutidos em build local — investigado a fundo

Um build local (nesta máquina, para prova de conceito) do `hubcli-runtime`
contém 6 ocorrências do path absoluto do desenvolvedor:

```
/Users/maikonviniciussilva/Hubcli/node_modules/.bun/{pino,thread-stream,write-file-atomic}
```

### Causa raiz (comprovada, não presumida)

- `thread-stream` (dependência transitiva de `pino`, que por sua vez é
  dependência transitiva de `fastify`) chama, em
  `thread-stream/index.js`, função `createWorker()`:
  `join(__dirname, 'lib', 'worker.js')`. O bundler do Bun substitui
  `__dirname` pelo path absoluto de disco no momento do build — daí o path
  pessoal embutido como *string literal* no binário.
- Quem depende de `fastify`/`pino` no grafo de dependências é
  exclusivamente `gitlab-ai-provider` / `opencode-gitlab-auth` (confirmado
  via `bun.lock`) — o provider GitLab do OpenCode, que o HubCli **não usa
  nem configura** (o registro curado do HubCli só inclui
  opencode/deepseek/nvidia/alibaba).
- `provider.ts` importa `gitlab-ai-provider` via `import()` **dinâmico**
  (lazy), duas vezes, ambas só executadas se o provider `gitlab` for
  efetivamente carregado. `createWorker()` só roda se algum código
  realmente instanciar um `ThreadStream` (transporte assíncrono do pino),
  o que só aconteceria dentro do fluxo de auth/uso do GitLab provider.

### Prova empírica (não apenas análise estática)

Nesta sessão, tornei `thread-stream/lib/worker.js` inacessível de propósito
(`chmod 000`, revertido logo em seguida — nenhuma alteração permanente no
repositório) e rodei o pacote `hubcli-darwin-x64` **extraído fora do
checkout**, com `HOME` isolado:

```
--version        → hubcli-v0.1.0-rc.4   (OK)
--help            → OK, exit 0
profile list      → OK, exit 0
doctor            → OK, exit 0 (WARNs esperados por falta de credenciais)
doctor --mcp      → OK, exit 0
```

Todos os comandos exigidos pela validação funcionaram normalmente mesmo com
o path de build inacessível. Isso é a situação **C** do critério pedido: "o
pacote executa com o path de build indisponível" — confirmada, não
presumida.

### Conclusão

- **Não é usado em runtime** para nenhum comando suportado pelo HubCli
  (situação A) — e isso decorre diretamente de nenhum desses comandos jamais
  tocar no provider `gitlab` (situação B, o import dinâmico "resolve
  corretamente" no sentido de nunca ser avaliado).
- O binário **funciona normalmente com o path de build indisponível**
  (situação C, comprovada empiricamente acima).
- **Não precisou de correção de código** (situação D) para os comandos e
  providers que o HubCli suporta hoje.

### Limitação real que permanece (não escondida)

Se algum dia o HubCli vier a suportar o provider `gitlab`, e esse provider
tentar usar um transporte pino assíncrono, `createWorker()` falharia com
`ENOENT` num binário distribuído rodando fora da máquina de build — porque
o `__dirname` embutido aponta para um path que não existe na máquina do
usuário final. Isso é um limite conhecido do pipeline de bundling do
Bun/pino/thread-stream, não uma falha introduzida pelo HubCli, e não afeta
nenhum provider validado hoje.

**Mitigação para builds locais → não publicar**: os artefatos publicados
numa release real **devem** vir do workflow `hubcli-release.yml` (runners do
GitHub Actions, paths genéricos como `/Users/runner/...` ou
`/home/runner/...`), nunca de uma build local — isso resolve o problema de
*privacidade* (o path deixa de ser pessoal), ainda que o mecanismo de
embutir `__dirname` continue existindo. Os workflows `hubcli-ci.yml` e
`hubcli-release.yml` incluem:
1. um passo de `grep` que falha o build se um path pessoal for detectado no
   binário;
2. um job `verify-package` **sem checkout do repositório** (roda numa VM
   totalmente nova) que baixa só o artefato empacotado e executa
   `--version`/`--help`/`profile list`/`doctor`/`doctor --mcp` — prova
   estrutural equivalente ao teste de `chmod 000` feito manualmente aqui,
   repetida automaticamente a cada release.

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
