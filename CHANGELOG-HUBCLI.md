# Changelog — HubCli

Registro das mudanças do fork sobre o OpenCode. Formato reverso-cronológico.

## v0.1.0-rc.9 (2026-08-13)

Instalação realmente utilizável por outras pessoas. Motivada por um relato real:
não foi possível instalar num Windows de trabalho.

A causa de fundo não foi um bug só — era que **`install.sh` e `install.ps1` nunca
eram executados em lugar nenhum**: o CI apenas os copiava como anexo da release.
O `install.ps1` chegou a ser publicado sem jamais ter rodado.

### Correções — Windows (`install.ps1`)

- **Download parecia travado**: `$ProgressPreference` no padrão faz o Windows
  PowerShell 5.1 renderizar barra de progresso a cada bloco; num arquivo de ~95 MB
  isso domina o tempo. Silenciado antes de qualquer chamada de rede.
- **TLS**: PS 5.1 em Windows antigo/corporativo negocia TLS 1.0/1.1, que o GitHub
  recusa. Agora força TLS 1.2 (+1.3 quando disponível).
- **Arquitetura detectada errado**: lia só `PROCESSOR_ARCHITECTURE`; num Windows
  64-bit rodando PowerShell 32-bit isso reporta `x86`, e o instalador **recusava
  instalar** em máquina suportada. Agora lê a arquitetura do SO, com mensagem
  própria para ARM64.
- **`exit` encerrava a sessão inteira** do usuário quando rodado via `irm | iex`.
- **`Read-Host` travava** execução não-interativa; agora depende de
  `UserInteractive` e existe `-NoPathPrompt`.
- **PATH não valia na sessão atual**, deixando `hubcli` "não encontrado" logo após
  instalar com sucesso.
- **`Unblock-File`** nos arquivos extraídos (mark-of-the-web / SmartScreen).
- **Arquivo passou a ser ASCII puro** — havia um traço longo dentro de string, e o
  PS 5.1 lê `.ps1` sem BOM na codepage ANSI.
- Paridade com o `install.sh`: passou a respeitar `HUBCLI_BIN_DIR`.

### Correções — Linux

- **`hubcli` não iniciava no Linux.** Os launchers checavam a permissão do
  `credentials.env` com `stat -f "%Lp" || stat -c "%a"`. No Linux, `stat -f`
  significa "status do *filesystem*" e **tem sucesso**, imprimindo dados do disco,
  então o fallback GNU nunca rodava e a comparação via um blob em vez de `600`.
  Como o próprio instalador cria o `credentials.env`, qualquer usuário Linux batia
  em "credentials file has insecure permissions" e o launcher abortava. Corrigido
  em `setup.sh`, `launcher-template.sh` e `hubcli-dist-launcher.sh`.

### CI

- Novo job **`verify-installer`** (ubuntu/macos/windows) que executa os
  instaladores de verdade contra o pacote recém-construído: instalação limpa,
  rodar o binário instalado, `--check`, `--repair` (verificando que credenciais do
  usuário sobrevivem), checksum inválido (verificando que **nada** é instalado) e
  `--uninstall` (verificando que dados são preservados). Foi esse job que
  encontrou o bug do Linux acima.
- O `hubcli-ci.yml` ainda disparava na branch `integration/upstream-20260702`, já
  mergeada — ou seja, **nenhum commit desde o merge estava sendo testado**. Agora
  dispara em `dev`.

### Projeto pronto para terceiros

- `README.md` (o que o GitHub mostra) estava com um stub sem instruções de
  instalação; todo o conteúdo vivia em `README-HUBCLI.md`, que ninguém vê.
- Metadados do repositório ainda eram do OpenCode (descrição e link para
  opencode.ai) e **Issues estava desabilitado**. Corrigidos; Issues aberto.
- Templates de issue mandavam para o Discord do OpenCode e pediam "OpenCode
  version"; agora perguntam SO, forma de instalação e saída do `doctor`.
- `CONTRIBUTING.md` e `SECURITY.md` eram os do OpenCode (time deles, canal de
  reporte deles); reescritos para o HubCli.
- As notas de release passam a trazer os comandos de instalação no topo.

## v0.1.0-rc.8 (2026-08-11)

Cherry-pick de um fix do upstream diretamente relevante à instabilidade do NVIDIA/MiniMax M3 investigada nesta sessão.

### Correções

- `provider/transform.ts`: MiniMax M3 via NVIDIA (`providerID: "nvidia"`) agora usa o formato de parâmetro correto para controlar "thinking" (`chat_template_kwargs.thinking_mode`) em vez do formato genérico Anthropic-style (`thinking.type`), que a API da NVIDIA não reconhece da mesma forma. Origem: upstream `50eee1f5a` (`fix(provider): correct MiniMax M3 thinking variants`, 22/07/2026), trazido via `git cherry-pick` — sem conflitos. Não resolve sozinho toda a instabilidade documentada em `docs/SECURITY.md`/investigação anterior (parte é mesmo instabilidade do provider), mas corrige um payload potencialmente incorreto que pode ter contribuído para ela.

## v0.1.0-rc.7 (2026-08-11)

Terceira cópia do logo antigo, esquecida na rc.6.

### Correções

- `packages/opencode/src/cli/ui.ts`: o `wordmark` usado no `--help` real (modo não-TTY) tinha sua própria cópia hardcoded do desenho antigo — não foi pega na rc.6 porque essa troca só cobriu `packages/tui/src/logo.ts`, `packages/tui/src/util/presentation.ts` e `fast.ts`. Confirmado por teste real (`hubcli --help` instalado da rc.6 ainda mostrava o logo velho). Agora usa a mesma fonte de blocos sólidos. Auditoria final: nenhuma outra ocorrência do desenho antigo restante no código.

## v0.1.0-rc.6 (2026-08-11)

Ajustes de legibilidade visual e um resíduo de branding não substituído.

### Correções

- **Logo redesenhado**: substituído o wordmark em meio-blocos com sombreado fino (difícil de ler em vários terminais) por uma fonte de blocos sólidos maiores — aplicado no TUI, no epílogo de sessão e no `--help` do binário rápido.
- **`tui.ts`**: a descrição do argumento posicional `project` ("path to start opencode in") não usava a constante `${BRAND}` que o resto do arquivo já usa — corrigido para "path to start HubCli in" (e a cópia estática equivalente em `fast.ts`).

## v0.1.0-rc.5 (2026-08-11)

Distribuição multiplataforma pronta para produção — instalador de um comando, CI e release publicados de ponta a ponta.

### Recursos

- **`install.sh` / `install.ps1`**: instalação sem Git nem Bun em macOS, Linux e Windows — download do artefato oficial do GitHub Releases, verificação de checksum SHA-256 (aborta sem instalar nada se não bater), instalação atômica com backup e rollback automático, preservação de `~/.hubcli` (config/credenciais/perfis), `--check`/`--repair`/`--dry-run`/`--uninstall`.
- **5 artefatos multiplataforma**: `hubcli-darwin-x64`, `hubcli-darwin-arm64`, `hubcli-linux-x64`, `hubcli-linux-arm64`, `hubcli-windows-x64` — build real via cross-compilação nativa do Bun, empacotados com `hubcli`/`hubcli-runtime`/`hubcli-fast` + LICENSE + README.txt, sem `.git`/`node_modules`/segredos.
- **CI e release automatizados** (`.github/workflows/hubcli-ci.yml`, `hubcli-release.yml`): jobs `verify-package` rodam em runner limpo, sem checkout do repositório — prova estrutural de que o pacote não depende do repo/Bun/Git/paths de build. Release real dispara só por tag `hubcli-v*`; modo dry-run via `workflow_dispatch` (`publish=false`) valida tudo sem publicar.
- **Validado de ponta a ponta em CI real**: darwin-x64/arm64, linux-x64/arm64 e windows-x64 — build, empacotamento e smoke test (`--version`/`--help`/`profile list`/`doctor`/`doctor --mcp`) todos verdes em runners reais do GitHub Actions.

### Correções

- Path de build pessoal investigado a fundo (dependência transitiva `pino`/`thread-stream`, usada só pelo provider GitLab não suportado pelo HubCli) — comprovado que não afeta nenhum comando suportado; releases devem sempre vir de CI (path genérico do runner), nunca de build local. Detalhes em `docs/SECURITY.md`.
- `test/tool/shell.test.ts`: teste de permissão de path relativo a drive no Windows tinha o drive `C:` fixo no código; CI redireciona `TEMP` para o drive do workspace (pode ser `D:`), quebrando o teste — corrigido para derivar o drive dinamicamente.
- `script/hubcli/release/generate-checksums.sh`: `cd "$OUT_DIR"` quebrava o path do arquivo de checksums quando `$OUT_DIR` era relativo (ex.: `dist-release`, exatamente o que o workflow de release passa) — corrigido resolvendo para path absoluto antes do `cd`.

## v0.1.0-rc.4 (2026-07-08, pendente de tag/commit)

Runtime compilado e versionamento single-source.

### Recursos

- **Runtime compilado instalado**: `setup.sh` agora compila e instala `hubcli-fast` (atalho para `--version`/`--help`/`profile`/`auth`/`route explain`) e `hubcli-runtime` (binário completo via mecanismo oficial de build do OpenCode). O launcher prefere o binário compilado por padrão; `HUBCLI_DEV=1` força execução a partir do source.
- **Fonte única de versão**: `script/hubcli/resolve-version.sh` resolve a versão por tag git exata em `HEAD` (`hubcli-v*`) → arquivo `script/hubcli/VERSION` → fallback `local`. Nada mais tem a versão hardcoded — launcher, fast bin e runtime compilado sempre mostram o mesmo valor. `HUBCLI_DEV=1 hubcli --version` agora corretamente mostra `local` (antes exibia a versão de release mesmo em modo dev).
- **Instalação atômica**: geração do launcher passou a usar arquivo temporário + `mv` (mesmo padrão já usado pelo fast bin e runtime bin).

### Testes

- `packages/opencode/test/cli/hubcli/version.test.ts` (novo): resolução de versão (tag > VERSION file > local), sem drift entre o arquivo VERSION do repo e o resolver, substituição de placeholders no template do launcher, comportamento `HUBCLI_DEV=1`, fallback de `fast.ts`.

### Validação manual desta RC

- Instalação limpa em `HOME` temporário (setup completo + segunda execução idempotente, sem tocar nada real do usuário).
- `hubcli --version` → `hubcli-v0.1.0-rc.4` (instalado); `HUBCLI_DEV=1 hubcli --version` → `local`.
- `hubcli run --model opencode/gpt-5.2-codex` e `--model deepseek/deepseek-v4-pro` → OK.
- `hubcli doctor` / `doctor --mcp` → exit 0, 6 tools MCP OK.
- Benchmark: modo instalado nitidamente mais rápido que `HUBCLI_DEV=1` (ex.: `--version` ~73ms vs ~4.3s; `doctor` ~1.7s vs ~2.9s).

### Problemas conhecidos (mantidos)

- NVIDIA NIM segue opcional/advisory — instabilidade intermitente do provider para MiniMax M3 (HTTP 500/vazio), nunca declarado estável.
- Alibaba Token Plan segue degradado (`AccessDenied.Unpurchased`).

## v0.1.0-rc.1 (2026-07-02)

Primeiro release candidate do MVP.

### Recursos

- **Branding condicional**: tudo do HubCli existe apenas com `HUBCLI_BRAND=1` (injetado pelo launcher). Sem a flag, o OpenCode original é preservado — comandos, seletor, logo e wordmark.
- **16 modelos validados** por chamadas reais em 4 providers: OpenCode Zen (GPT‑5.2, GPT‑5.2 Codex, Kimi K2.7 Code, Kimi K2.5, Claude Fable 5 experimental), DeepSeek direto (V4 Pro, V4 Flash), NVIDIA NIM (MiniMax M3, M2.7, DeepSeek V4 Pro), Alibaba Token Plan (Qwen 3.7/3.6, GLM 5.x — degradado por entitlement).
- **Seletor curado** em grupos: OpenAI → Kimi → DeepSeek → NVIDIA NIM → Qwen → GLM → Experimental.
- **`hubcli doctor`** (`--verbose`, `--connect`, `--mcp`, `--all`): config, permissões, credenciais (presença apenas), perfis, integrações, conectividade real e handshake MCP. Exit codes 0/1/2/3/4.
- **`hubcli profile`** (list/show/use/current) + **`hubcli run --profile`** + **`hubcli route explain`**: roteamento determinístico com fallback de seleção limitado (`--no-fallback` para desativar). Persistência versionada em `~/.hubcli/profiles.json` com backup.
- **`hubcli auth`** (status/providers): presença de credenciais sem nunca exibir valores.
- **`hubcli mcp serve`**: servidor MCP stdio com 6 tools read-only; integrado e testado de verdade com Codex CLI 0.140 e Claude Code 2.1.
- **`hubcli maintenance`** (status/fetch/preview/sync): sincronização assistida com o upstream (merge --no-ff, nunca rebase/stash/reset).
- **`hubcli upgrade`** bloqueado com redirecionamento ao maintenance.
- **Instalação**: `setup.sh` idempotente (--check/--dry-run/--repair) com launcher gerado de template canônico; `uninstall.sh` seguro (dados preservados por padrão).
- **Documentação**: README-HUBCLI + docs/ (mcp, providers, profiles, maintenance, security).

### Segurança

- Launcher com parser whitelist (sem source/eval), credenciais 600 obrigatórias, `sanitizeError` em toda saída de erro, subprocessos sem shell com timeout/maxBuffer, MCP server 100% read-only.

### Upstream

- Merge limpo de 116 commits do upstream/dev (verificado por merge-tree antes; typechecks, 95 testes e smoke E2E pós-merge todos verdes).

### Problemas conhecidos

- Alibaba Token Plan retorna `AccessDenied.Unpurchased` — Qwen/GLM degradados (WARN no doctor, pulados no roteamento).
- Fallback automático é de seleção, não de runtime.
- `deepseek-ai/deepseek-v4-pro` via NVIDIA é lento (~2 min).
- Fable 5 experimental com latência alta (13–47s).
- Codex exec exige `default_tools_approval_mode = "approve"` para chamar tools MCP em modo não interativo.
