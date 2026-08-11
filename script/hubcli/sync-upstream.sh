#!/usr/bin/env bash
# =============================================================================
# sync-upstream.sh — Fluxo assistido de sincronização do fork HubCli com
# o repositório original OpenCode.
#
# Uso:
#   bash sync-upstream.sh status          # somente leitura, relatório de estado
#   bash sync-upstream.sh fetch           # git fetch upstream + origin
#   bash sync-upstream.sh preview         # diff e análise de conflitos potenciais
#   bash sync-upstream.sh sync            # merge assistido com confirmação explícita
#   bash sync-upstream.sh sync --dry-run  # simula sync sem alterar nada
#
# Garantias de segurança:
#   ✗ Nunca executa git rebase
#   ✗ Nunca executa git push (nem --force)
#   ✗ Nunca executa git stash automaticamente
#   ✗ Nunca executa git reset --hard
#   ✗ Nunca executa git clean
#   ✗ Nunca faz merge automático sem confirmação explícita
#   ✗ Nunca exibe valores de credenciais
#   ✗ Nunca copia credentials.env para backup
#   ✗ Nunca modifica .zshrc
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
HUBCLI_SRC="${HUBCLI_SRC:-${HOME}/Hubcli}"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="${UPSTREAM_REMOTE}/dev"
EXPECTED_BRANCH="feature/hubcli-branding"
GIT="git"

# Arquivos modificados por NÓS que o upstream também pode ter modificado
HIGH_RISK_FILES=(
  "packages/opencode/src/cli/cmd/run.ts"
  "packages/opencode/src/cli/cmd/tui.ts"
  "packages/tui/src/app.tsx"
)

# Arquivos exclusivos do HubCli (baixo risco — criados por nós)
HUBCLI_ONLY_FILES=(
  "packages/opencode/src/cli/brand.ts"
  "packages/opencode/src/cli/cmd/doctor.ts"
  "packages/opencode/src/cli/cmd/maintenance.ts"
  "packages/opencode/test/cli/cmd/doctor.test.ts"
  "packages/tui/src/hubcli/model-display.ts"
  "packages/tui/test/hubcli/model-display.test.ts"
)

DRY_RUN=0
SUBCOMMAND=""

# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------
_info()  { printf '  \033[0;34m•\033[0m %s\n' "$*"; }
_ok()    { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
_warn()  { printf '  \033[0;33m!\033[0m %s\n' "$*"; }
_fail()  { printf '  \033[0;31m✗\033[0m %s\n' "$*" >&2; }
_head()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
_sep()   { printf '%s\n' "─────────────────────────────────────────────"; }
_cmd()   { printf '  \033[0;36m$\033[0m %s\n' "$*"; }

abort() { _fail "$*"; exit 1; }

confirm() {
  printf '  \033[0;33m?\033[0m %s [s/N] ' "$1"
  read -r _resp
  case "${_resp:-n}" in [sS]|[yY]) return 0 ;; *) return 1 ;; esac
}

usage() {
  printf 'Uso: %s <subcomando> [--dry-run]\n\n' "$0"
  printf 'Subcomandos:\n'
  printf '  status   — estado atual: branch, working tree, divergência\n'
  printf '  fetch    — executa git fetch upstream + origin\n'
  printf '  preview  — análise de commits e conflitos potenciais\n'
  printf '  sync     — merge assistido com confirmação explícita\n'
  printf '\nOpções:\n'
  printf '  --dry-run  simula sem alterar nada (apenas válido para fetch e sync)\n'
  exit 0
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
for _arg in "${@:-}"; do
  case "$_arg" in
    status|fetch|preview|sync) SUBCOMMAND="$_arg" ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h) usage ;;
    *) _warn "Argumento desconhecido: $_arg"; usage ;;
  esac
done

[ -z "$SUBCOMMAND" ] && usage

# ---------------------------------------------------------------------------
# Validação do repositório
# ---------------------------------------------------------------------------
if [ ! -d "${HUBCLI_SRC}/.git" ]; then
  abort "Repositório não encontrado em $HUBCLI_SRC. Execute setup.sh primeiro."
fi

cd "$HUBCLI_SRC"

# ---------------------------------------------------------------------------
# Helpers de estado git
# ---------------------------------------------------------------------------
_current_branch() { "$GIT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "DETACHED"; }
_is_clean()        { [ -z "$("$GIT" status --porcelain)" ]; }
_merge_base()      { "$GIT" merge-base HEAD "$UPSTREAM_BRANCH" 2>/dev/null || echo ""; }

_upstream_available() {
  "$GIT" rev-parse --verify "$UPSTREAM_BRANCH" &>/dev/null
}

# ===========================================================================
# SUBCOMANDO: status
# ===========================================================================
cmd_status() {
  _head "HubCli — Status"
  _sep

  local _branch; _branch="$(_current_branch)"
  _info "Branch atual: $_branch"

  if _is_clean; then
    _ok "Working tree: limpa"
  else
    _warn "Working tree: dirty"
    "$GIT" status --short | while IFS= read -r _line; do
      printf '    %s\n' "$_line"
    done
  fi

  printf '\n'
  _info "Remotes:"
  # || true: sem remotes configurados, grep retorna exit 1; pipefail abortaria
  "$GIT" remote -v | grep "(fetch)" 2>/dev/null | while IFS= read -r _line; do
    printf '    %s\n' "$_line"
  done || true

  if ! _upstream_available; then
    _warn "upstream/dev não disponível. Execute: $0 fetch"
    return
  fi

  local _base; _base="$(_merge_base)"
  if [ -z "$_base" ]; then
    _warn "Não foi possível calcular merge-base com $UPSTREAM_BRANCH."
    return
  fi

  local _ahead; _ahead="$("$GIT" log --oneline "${_base}..${UPSTREAM_BRANCH}" 2>/dev/null | wc -l | tr -d ' ')"
  local _ours;  _ours="$("$GIT" log --oneline "${_base}..HEAD" 2>/dev/null | wc -l | tr -d ' ')"

  printf '\n'
  if [ "$_ahead" -eq 0 ]; then
    _ok "Sincronizado com $UPSTREAM_BRANCH"
  else
    _warn "Upstream à frente: $_ahead commit(s)"
    _info "Nossos commits desde o fork: $_ours"
  fi

  # Conflitos potenciais rápidos
  local _upstream_files; _upstream_files="$("$GIT" diff --name-only "${_base}..${UPSTREAM_BRANCH}" 2>/dev/null)"
  local _our_files;      _our_files="$("$GIT" diff --name-only "${_base}..HEAD" 2>/dev/null)"
  local _conflicts;      _conflicts="$(comm -12 <(printf '%s\n' "$_upstream_files" | sort) <(printf '%s\n' "$_our_files" | sort) | grep -c . || true)"

  if [ "$_conflicts" -gt 0 ]; then
    _warn "Arquivos com risco de conflito: $_conflicts"
    _info "Execute '$0 preview' para detalhes."
  else
    _ok "Sem conflitos detectados com a divergência atual"
  fi
}

# ===========================================================================
# SUBCOMANDO: fetch
# ===========================================================================
cmd_fetch() {
  _head "HubCli — Fetch"
  _sep

  if ! "$GIT" remote | grep -q "^${UPSTREAM_REMOTE}$"; then
    abort "Remote '$UPSTREAM_REMOTE' não encontrado."
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    _info "(--dry-run) Simularia: git fetch $UPSTREAM_REMOTE"
    "$GIT" fetch "$UPSTREAM_REMOTE" --dry-run 2>&1 | head -10 || true
    _info "(--dry-run) Simularia: git fetch origin"
    "$GIT" fetch origin --dry-run 2>&1 | head -5 || true
    return
  fi

  _info "Buscando upstream..."
  "$GIT" fetch "$UPSTREAM_REMOTE" 2>&1 | grep -v "^$" || true
  _ok "upstream buscado"

  _info "Buscando origin..."
  "$GIT" fetch origin 2>&1 | grep -v "^$" || true
  _ok "origin buscado"

  _info "Execute '$0 status' ou '$0 preview' para ver a divergência."
}

# ===========================================================================
# SUBCOMANDO: preview
# ===========================================================================
cmd_preview() {
  _head "HubCli — Preview de sincronização"
  _sep

  if ! _upstream_available; then
    abort "upstream/dev não disponível. Execute: $0 fetch"
  fi

  local _base; _base="$(_merge_base)"
  [ -z "$_base" ] && abort "Não foi possível calcular merge-base com $UPSTREAM_BRANCH."

  local _branch; _branch="$(_current_branch)"
  _info "Branch atual: $_branch"

  # Commits upstream não integrados
  local _upstream_log; _upstream_log="$("$GIT" log --oneline "${_base}..${UPSTREAM_BRANCH}" 2>/dev/null)"
  local _ahead; _ahead="$(printf '%s\n' "$_upstream_log" | grep -c . || true)"

  if [ "$_ahead" -eq 0 ]; then
    _ok "Nenhum commit novo no upstream. Nada a sincronizar."
    return
  fi

  _head "Commits upstream não integrados ($_ahead)"
  local _n=0
  while IFS= read -r _line && [ "$_n" -lt 20 ]; do
    printf '  %s\n' "$_line"
    _n=$((_n + 1))
  done << LOGEOF
$_upstream_log
LOGEOF
  [ "$_ahead" -gt 20 ] && printf '  ... e mais %d commits\n' "$((_ahead - 20))"

  # Diff stat
  _head "Resumo de arquivos alterados no upstream"
  "$GIT" diff --stat "${_base}..${UPSTREAM_BRANCH}" 2>/dev/null | tail -5

  # Conflitos potenciais
  local _upstream_files; _upstream_files="$("$GIT" diff --name-only "${_base}..${UPSTREAM_BRANCH}" 2>/dev/null)"
  local _our_files;      _our_files="$("$GIT" diff --name-only "${_base}..HEAD" 2>/dev/null)"
  local _conflict_list;  _conflict_list="$(comm -12 <(printf '%s\n' "$_upstream_files" | sort) <(printf '%s\n' "$_our_files" | sort))"

  _head "Arquivos com risco de conflito"
  if [ -z "$_conflict_list" ]; then
    _ok "Nenhum conflito potencial detectado"
  else
    while IFS= read -r _f; do
      [ -z "$_f" ] && continue
      _warn "$_f"
      for _hr in "${HIGH_RISK_FILES[@]}"; do
        [ "$_f" = "$_hr" ] && printf '      (alto risco — alterado por nós E pelo upstream)\n'
      done
    done << CFEOF
$_conflict_list
CFEOF
  fi

  # Arquivos HubCli exclusivos
  _head "Nossos arquivos HubCli (baixo risco)"
  for _hf in "${HUBCLI_ONLY_FILES[@]}"; do
    if [ -f "${HUBCLI_SRC}/$_hf" ]; then
      _ok "$_hf"
    else
      _info "$_hf (não encontrado — novo ou renomeado)"
    fi
  done

  # Comando sugerido
  _head "Comando sugerido para sincronizar"
  printf '\n'
  _cmd "bash $0 sync"
  printf '\n'
  _info "O subcomando sync executa: git merge --no-ff $UPSTREAM_BRANCH"
  _info "Você será solicitado a confirmar antes de qualquer alteração."
}

# ===========================================================================
# SUBCOMANDO: sync
# ===========================================================================
cmd_sync() {
  _head "HubCli — Sync (merge assistido)"
  _sep

  local _branch; _branch="$(_current_branch)"
  _info "Branch atual: $_branch"

  # Exige branch correta
  if [ "$_branch" != "$EXPECTED_BRANCH" ]; then
    abort "Branch inesperada '$_branch'. Esperado: '$EXPECTED_BRANCH'."
  fi

  # Exige working tree limpa
  if ! _is_clean; then
    _fail "Working tree dirty. Resolva antes de sincronizar:"
    "$GIT" status --short | while IFS= read -r _line; do
      printf '    %s\n' "$_line"
    done
    printf '\n'
    _info "Opções:"
    _cmd "git add -A && git commit -m 'wip'"
    _info "  ou"
    _cmd "git stash push -m 'pre-sync'"
    printf '\n'
    exit 1
  fi
  _ok "Working tree limpa"

  # Exige upstream disponível
  if ! _upstream_available; then
    abort "upstream/dev não disponível. Execute: $0 fetch"
  fi

  local _base; _base="$(_merge_base)"
  [ -z "$_base" ] && abort "Não foi possível calcular merge-base com $UPSTREAM_BRANCH."

  local _ahead; _ahead="$("$GIT" log --oneline "${_base}..${UPSTREAM_BRANCH}" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$_ahead" -eq 0 ]; then
    _ok "Já sincronizado com $UPSTREAM_BRANCH. Nada a fazer."
    exit 0
  fi

  _info "Upstream à frente: $_ahead commit(s)"

  # Verificar conflitos potenciais e avisar
  local _upstream_files; _upstream_files="$("$GIT" diff --name-only "${_base}..${UPSTREAM_BRANCH}" 2>/dev/null)"
  local _our_files;      _our_files="$("$GIT" diff --name-only "${_base}..HEAD" 2>/dev/null)"
  local _conflict_list;  _conflict_list="$(comm -12 <(printf '%s\n' "$_upstream_files" | sort) <(printf '%s\n' "$_our_files" | sort))"
  local _conflict_count; _conflict_count="$(printf '%s\n' "$_conflict_list" | grep -c . || true)"

  if [ "$_conflict_count" -gt 0 ]; then
    _warn "$_conflict_count arquivo(s) podem ter conflito de merge:"
    while IFS= read -r _f; do [ -z "$_f" ] && continue; printf '    ⚠  %s\n' "$_f"; done << CFEOF2
$_conflict_list
CFEOF2
    printf '\n'
  fi

  # Mostrar o comando que será usado
  _head "Operação planejada"
  printf '\n'
  _cmd "git merge --no-ff $UPSTREAM_BRANCH"
  printf '\n'
  _info "Esta operação:"
  _info "  • cria um commit de merge no histórico"
  _info "  • NÃO faz rebase"
  _info "  • NÃO faz push"
  _info "  • para em qualquer conflito (sem resolução automática)"
  printf '\n'

  if [ "$DRY_RUN" -eq 1 ]; then
    _info "(--dry-run) Nenhuma alteração será feita."
    _info "(--dry-run) Criaria branch de backup e executaria o merge acima."
    return
  fi

  # Confirmação explícita
  if ! confirm "Criar branch de backup e executar o merge?"; then
    _info "Sync cancelado. Nenhuma alteração foi feita."
    exit 0
  fi

  # Criar branch de backup ANTES do merge
  local _ts; _ts="$(date +%Y%m%d-%H%M%S)"
  local _backup_branch="backup/hubcli-before-upstream-${_ts}"
  "$GIT" branch "$_backup_branch"
  _ok "Branch de backup criada: $_backup_branch"
  _info "Para reverter após o merge:"
  _cmd "git reset --soft $_backup_branch"
  _info "  (soft: mantém as suas alterações na área de stage)"
  printf '\n'

  # Executar o fetch antes do merge
  _info "Executando fetch upstream..."
  "$GIT" fetch "$UPSTREAM_REMOTE" 2>&1 | grep -v "^$" || true

  # Executar o merge
  _info "Executando: git merge --no-ff $UPSTREAM_BRANCH"
  if "$GIT" merge --no-ff "$UPSTREAM_BRANCH" 2>&1; then
    _ok "Merge concluído sem conflitos"
    printf '\n'
    _info "Branch de backup disponível: $_backup_branch"
    _info "Para limpar branches de backup antigas:"
    _cmd "git branch | grep 'backup/hubcli-before-upstream' | xargs git branch -d"
    printf '\n'

    # Segunda confirmação para bun install
    _head "Dependências"
    _info "O merge pode ter atualizado package.json ou lockfiles."
    if confirm "Atualizar dependências agora? (bun install)"; then
      local _bun="${HOME}/.bun/bin/bun"
      if [ -x "$_bun" ]; then
        (cd "$HUBCLI_SRC" && "$_bun" install 2>&1 | grep -v "^$" | head -30 || true)
        _ok "Dependências atualizadas"
      else
        _warn "Bun não encontrado em $_bun. Execute manualmente: cd $HUBCLI_SRC && bun install"
      fi
    else
      _info "Lembre de executar: cd $HUBCLI_SRC && bun install"
    fi
  else
    printf '\n'
    _fail "Merge parou com conflitos."
    printf '\n'
    _warn "Resolva os conflitos manualmente:"
    _info "  1. Edite os arquivos conflitantes"
    _cmd "git status"
    _info "  2. Marque como resolvidos:"
    _cmd "git add <arquivo>"
    _info "  3. Finalize o merge:"
    _cmd "git merge --continue"
    printf '\n'
    _warn "Para ABORTAR e voltar ao estado anterior ao merge:"
    _cmd "git merge --abort"
    printf '\n'
    _warn "A branch de backup '$_backup_branch' preserva o estado pré-merge."
    exit 2
  fi
}

# ===========================================================================
# Dispatcher
# ===========================================================================
case "$SUBCOMMAND" in
  status)  cmd_status  ;;
  fetch)   cmd_fetch   ;;
  preview) cmd_preview ;;
  sync)    cmd_sync    ;;
esac
