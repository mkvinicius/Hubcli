#!/usr/bin/env bash
# =============================================================================
# setup.sh — Instala ou repara o HubCli em uma máquina local
#
# Uso:
#   bash ~/Hubcli/script/hubcli/setup.sh
#   bash ~/Hubcli/script/hubcli/setup.sh --repair         # só recria o launcher
#   bash ~/Hubcli/script/hubcli/setup.sh --check          # só verifica
#   bash ~/Hubcli/script/hubcli/setup.sh --repo PATH      # repositório alternativo
#   bash ~/Hubcli/script/hubcli/setup.sh --dry-run        # simula sem alterar
#
# Garantias de segurança:
#   ✗ Nunca apaga credentials.env
#   ✗ Nunca copia credentials.env para backup
#   ✗ Nunca sobrescreve opencode.json sem backup
#   ✗ Nunca usa eval ou source
#   ✗ Nunca inclui valores de API keys em logs
#   ✗ Nunca modifica .zshrc automaticamente
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Constantes (overridable via args ou env)
# ---------------------------------------------------------------------------
HUBCLI_SRC=""                     # resolvido abaixo após parse de args
HUBCLI_HOME="${HOME}/.hubcli"
HUBCLI_CONFIG="${HUBCLI_HOME}/opencode.json"
HUBCLI_CREDS="${HUBCLI_HOME}/credentials.env"
LAUNCHER_DIR="${HOME}/.local/bin"
LAUNCHER_PATH="${LAUNCHER_DIR}/hubcli"
FAST_BIN_PATH="${LAUNCHER_DIR}/hubcli-fast"
RUNTIME_BIN_PATH="${LAUNCHER_DIR}/hubcli-runtime"
# Resolver bun: PATH primeiro, depois fallback para ~/.bun/bin/bun
BUN="$(command -v bun 2>/dev/null || echo "${HOME}/.bun/bin/bun")"
GIT="git"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

MODE="full"   # full | repair | check
DRY_RUN=0
EXPLICIT_REPO=""

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
  printf 'Uso: %s [--repair] [--check] [--dry-run] [--repo PATH]\n' "$0"
  exit 0
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
_skip_next=0
for _arg in "${@:-}"; do
  if [ "$_skip_next" -eq 1 ]; then
    EXPLICIT_REPO="$_arg"
    _skip_next=0
    continue
  fi
  case "$_arg" in
    --repair)   MODE="repair"  ;;
    --check)    MODE="check"   ;;
    --dry-run)  DRY_RUN=1      ;;
    --repo)     _skip_next=1   ;;
    --repo=*)   EXPLICIT_REPO="${_arg#--repo=}" ;;
    --help|-h)  usage          ;;
    *) _warn "Argumento desconhecido: $_arg (ignorando)" ;;
  esac
done

# Resolver caminho do repositório
if [ -n "$EXPLICIT_REPO" ]; then
  HUBCLI_SRC="$EXPLICIT_REPO"
elif [ -d "${HOME}/Hubcli/.git" ]; then
  HUBCLI_SRC="${HOME}/Hubcli"
else
  HUBCLI_SRC="${HOME}/Hubcli"
fi

# Fonte única de versão: script/hubcli/resolve-version.sh do repositório alvo
# (tag git exata em HEAD > arquivo VERSION > "local"). Nunca hardcoded aqui.
_resolve_version_script="${HUBCLI_SRC}/script/hubcli/resolve-version.sh"
if [ -f "$_resolve_version_script" ]; then
  HUBCLI_VERSION="$(bash "$_resolve_version_script")"
else
  HUBCLI_VERSION="local"
fi

# ---------------------------------------------------------------------------
# 1. Verificar pré-requisitos
# ---------------------------------------------------------------------------
_head "HubCli Setup"
_sep

_head "1. Pré-requisitos"

# Bun
if [ ! -x "$BUN" ]; then
  abort "Bun não encontrado em $BUN. Instale via: curl -fsSL https://bun.sh/install | bash"
fi
_ok "Bun: $("$BUN" --version)"

# Git
if ! command -v "$GIT" &>/dev/null; then
  abort "Git não encontrado."
fi
_ok "Git: $("$GIT" --version)"

# OS
case "$(uname)" in
  Darwin|Linux) _ok "OS: $(uname -s) $(uname -r)" ;;
  *)            _warn "Sistema operacional não testado: $(uname)" ;;
esac

# ---------------------------------------------------------------------------
# 2. Repositório
# ---------------------------------------------------------------------------
if [ "$MODE" != "repair" ]; then
  _head "2. Repositório HubCli ($HUBCLI_SRC)"

  if [ -d "$HUBCLI_SRC/.git" ]; then
    _ok "Repositório encontrado"
    _cur_branch="$("$GIT" -C "$HUBCLI_SRC" rev-parse --abbrev-ref HEAD)"
    _info "Branch: $_cur_branch"

    if [ "$MODE" != "check" ] && [ "$DRY_RUN" -eq 0 ]; then
      _dirty="$("$GIT" -C "$HUBCLI_SRC" status --porcelain)"
      if [ -n "$_dirty" ]; then
        _warn "Repositório dirty. Nenhum bun install automático."
      else
        _info "Atualizando dependências..."
        (cd "$HUBCLI_SRC" && "$BUN" install 2>&1 | grep -v "^$" | head -20 || true)
        _ok "Dependências atualizadas"
      fi
    elif [ "$DRY_RUN" -eq 1 ]; then
      _info "(--dry-run) Executaria: bun install"
    fi
  else
    if [ "$MODE" = "check" ]; then
      _fail "Repositório NÃO encontrado: $HUBCLI_SRC"
    else
      _warn "Repositório não encontrado."
      if [ "$DRY_RUN" -eq 0 ]; then
        if ! confirm "Clonar HubCli para $HUBCLI_SRC?"; then
          abort "Instalação cancelada."
        fi
        "$GIT" clone https://github.com/mkvinicius/Hubcli.git \
          "$HUBCLI_SRC" --branch feature/hubcli-branding
        (cd "$HUBCLI_SRC" && "$BUN" install)
        _ok "Repositório clonado e dependências instaladas"
      else
        _info "(--dry-run) Clonaria: $HUBCLI_SRC"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. Diretório ~/.hubcli (chmod 700)
# ---------------------------------------------------------------------------
_head "3. Diretório de configuração"

if [ ! -d "$HUBCLI_HOME" ]; then
  if [ "$MODE" = "check" ]; then
    _fail "Diretório NÃO encontrado: $HUBCLI_HOME"
  elif [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$HUBCLI_HOME"
    chmod 700 "$HUBCLI_HOME"
    _ok "Criado: $HUBCLI_HOME (700)"
  else
    _info "(--dry-run) Criaria: $HUBCLI_HOME (700)"
  fi
else
  _ok "Diretório existente: $HUBCLI_HOME"
  # Garantir que a permissão seja 700
  _dir_perms="$(stat -f "%Lp" "$HUBCLI_HOME" 2>/dev/null || stat -c "%a" "$HUBCLI_HOME" 2>/dev/null || echo "unknown")"
  if [ "$_dir_perms" != "700" ] && [ "$MODE" != "check" ] && [ "$DRY_RUN" -eq 0 ]; then
    chmod 700 "$HUBCLI_HOME"
    _ok "Permissão ajustada para 700"
  else
    _ok "Permissão: $_dir_perms"
  fi
fi

# ---------------------------------------------------------------------------
# 4. opencode.json — nunca sobrescreve sem backup
# ---------------------------------------------------------------------------
_head "4. opencode.json"

if [ -f "$HUBCLI_CONFIG" ]; then
  _ok "Config existente (preservada)"
else
  if [ "$MODE" = "check" ]; then
    _fail "opencode.json NÃO encontrado: $HUBCLI_CONFIG"
  elif [ "$DRY_RUN" -eq 0 ]; then
    _warn "Criando template padrão..."
    # Heredoc com aspas simples: não expande variáveis internas do template
    cat > "$HUBCLI_CONFIG" << 'JSONEOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "alibaba-token-plan/qwen3.7-max",
  "provider": {
    "alibaba-token-plan": {
      "options": { "apiKey": "{env:DASHSCOPE_API_KEY}" },
      "whitelist": [
        "qwen3.7-max",
        "qwen3.6-plus",
        "qwen3.6-flash",
        "glm-5",
        "glm-5.1",
        "glm-5.2"
      ]
    },
    "deepseek": {
      "options": { "apiKey": "{env:DEEPSEEK_API_KEY}" },
      "whitelist": ["deepseek-v4-pro", "deepseek-v4-flash"]
    }
  }
}
JSONEOF
    _ok "Criado: $HUBCLI_CONFIG"
  else
    _info "(--dry-run) Criaria: $HUBCLI_CONFIG (template padrão)"
  fi
fi

# ---------------------------------------------------------------------------
# 5. credentials.env — template vazio com 600, NUNCA sobrescreve, NUNCA backup
# ---------------------------------------------------------------------------
_head "5. Credenciais"

if [ -f "$HUBCLI_CREDS" ]; then
  # Verificar apenas permissão — nunca ler nem copiar o conteúdo
  _creds_perms="$(stat -f "%Lp" "$HUBCLI_CREDS" 2>/dev/null || stat -c "%a" "$HUBCLI_CREDS" 2>/dev/null || echo "unknown")"
  _ok "credentials.env existente (preservada, conteúdo não lido)"
  if [ "$_creds_perms" = "600" ]; then
    _ok "Permissão: 600"
  else
    _warn "Permissão: $_creds_perms (deve ser 600)"
    if [ "$MODE" != "check" ] && [ "$DRY_RUN" -eq 0 ]; then
      chmod 600 "$HUBCLI_CREDS"
      _ok "Permissão corrigida para 600"
    fi
  fi
else
  if [ "$MODE" = "check" ]; then
    _warn "credentials.env NÃO encontrada: $HUBCLI_CREDS"
  elif [ "$DRY_RUN" -eq 0 ]; then
    _warn "Criando template vazio (preencha manualmente)..."
    # Heredoc com aspas simples para evitar expansão
    cat > "$HUBCLI_CREDS" << 'CREDSEOF'
# HubCli credentials — NUNCA compartilhe este arquivo
# Permissões 600 obrigatórias. Preencha com seus tokens.
#
DASHSCOPE_API_KEY=
DEEPSEEK_API_KEY=
NVIDIA_API_KEY=
CREDSEOF
    chmod 600 "$HUBCLI_CREDS"
    _ok "Criado: $HUBCLI_CREDS (600, template vazio)"
    _warn "Edite antes de usar: ${EDITOR:-nano} $HUBCLI_CREDS"
  else
    _info "(--dry-run) Criaria: $HUBCLI_CREDS (600, template vazio)"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Launcher ~/.local/bin/hubcli
# ---------------------------------------------------------------------------
_head "6. Launcher"

_needs_create=1
if [ -f "$LAUNCHER_PATH" ]; then
  # Verificar se é do HubCli (contém a assinatura esperada)
  if grep -q "HUBCLI_SRC=" "$LAUNCHER_PATH" 2>/dev/null; then
    if grep -q "NVIDIA_API_KEY" "$LAUNCHER_PATH" 2>/dev/null && grep -q "HUBCLI_CALLER_PWD" "$LAUNCHER_PATH" 2>/dev/null && grep -q "HUBCLI_RUNTIME_BIN" "$LAUNCHER_PATH" 2>/dev/null && grep -q "HUBCLI_VERSION=\"${HUBCLI_VERSION}\"" "$LAUNCHER_PATH" 2>/dev/null; then
      _ok "Launcher existente e atualizado: $LAUNCHER_PATH ($HUBCLI_VERSION)"
      _needs_create=0
    elif [ "$MODE" = "check" ]; then
      _warn "Launcher existente mas DESATUALIZADO (versão ou recursos diferentes). Rode: setup.sh --repair"
      _needs_create=0
    else
      _warn "Launcher desatualizado — criando backup e atualizando..."
      _backup="${LAUNCHER_PATH}.backup.${TIMESTAMP}"
      [ "$DRY_RUN" -eq 0 ] && cp "$LAUNCHER_PATH" "$_backup" && _ok "Backup: $_backup"
      _needs_create=1
    fi
  else
    _warn "Launcher existente parece ser de outra instalação."
    if [ "$MODE" = "check" ]; then
      _warn "Verifique manualmente: $LAUNCHER_PATH"
      _needs_create=0
    elif [ "$DRY_RUN" -eq 0 ]; then
      _backup="${LAUNCHER_PATH}.backup.${TIMESTAMP}"
      cp "$LAUNCHER_PATH" "$_backup"
      _ok "Backup criado: $_backup"
    else
      _info "(--dry-run) Criaria backup do launcher existente"
    fi
  fi
fi

if [ "$_needs_create" -eq 1 ] && [ "$MODE" != "check" ]; then
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$LAUNCHER_DIR"

    # Instalar o launcher a partir do template canônico do repositório.
    # O template é a fonte única de verdade (script/hubcli/launcher-template.sh);
    # __HUBCLI_SRC__ é substituído pelo caminho real de packages/opencode,
    # __HUBCLI_VERSION__ pela versão resolvida via resolve-version.sh.
    _template="${HUBCLI_SRC}/script/hubcli/launcher-template.sh"
    if [ ! -f "$_template" ]; then
      _fail "Template do launcher não encontrado: $_template"
      exit 1
    fi
    _tmp_launcher="${LAUNCHER_PATH}.tmp.${TIMESTAMP}"
    sed -e "s|__HUBCLI_SRC__|${HUBCLI_SRC}/packages/opencode|" \
        -e "s|__HUBCLI_VERSION__|${HUBCLI_VERSION}|" \
        "$_template" > "$_tmp_launcher"
    mv "$_tmp_launcher" "$LAUNCHER_PATH"

    chmod 755 "$LAUNCHER_PATH"
    _ok "Launcher criado: $LAUNCHER_PATH (755)"
  else
    _info "(--dry-run) Criaria/atualizaria: $LAUNCHER_PATH"
  fi
fi

if [ "$MODE" != "check" ]; then
  _head "6b. Fast path binary"
  _fast_entry="${HUBCLI_SRC}/packages/opencode/src/cli/hubcli/fast.ts"
  if [ ! -f "$_fast_entry" ]; then
    _warn "Fast path source not found: $_fast_entry"
  elif [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$LAUNCHER_DIR"
    _tmp_fast="${FAST_BIN_PATH}.tmp.${TIMESTAMP}"
    "$BUN" build --compile --minify --conditions=browser --outfile "$_tmp_fast" "$_fast_entry" >/dev/null
    chmod 755 "$_tmp_fast"
    mv "$_tmp_fast" "$FAST_BIN_PATH"
    _ok "Fast path binary criado: $FAST_BIN_PATH (755)"
  else
    _info "(--dry-run) Construiria: $FAST_BIN_PATH"
  fi
fi

if [ "$MODE" != "check" ]; then
  _head "6c. Runtime binary"
  _runtime_dir="${HUBCLI_SRC}/packages/opencode"
  _models_cache="${HOME}/.cache/opencode/models.json"
  _platform="$(uname -s)"
  _arch="$(uname -m)"
  case "$_platform" in
    Darwin) _build_os="darwin" ;;
    Linux)  _build_os="linux" ;;
    *)      _build_os="" ;;
  esac
  case "$_arch" in
    x86_64|amd64) _build_arch="x64" ;;
    arm64|aarch64) _build_arch="arm64" ;;
    *) _build_arch="" ;;
  esac

  if [ -z "$_build_os" ] || [ -z "$_build_arch" ]; then
    _warn "Plataforma não suportada para build runtime automático: $_platform/$_arch"
  elif [ "$DRY_RUN" -eq 0 ]; then
    if [ -f "$_models_cache" ]; then
      _info "Usando snapshot local models.dev: $_models_cache"
      MODELS_DEV_API_JSON="$_models_cache" HUBCLI_VERSION="$HUBCLI_VERSION" "$BUN" run --cwd "$_runtime_dir" script/build.ts --single --skip-install
    else
      _warn "Snapshot local models.dev ausente; o build oficial tentará buscar models.dev"
      HUBCLI_VERSION="$HUBCLI_VERSION" "$BUN" run --cwd "$_runtime_dir" script/build.ts --single --skip-install
    fi
    _built_runtime="${_runtime_dir}/dist/opencode-${_build_os}-${_build_arch}/bin/opencode"
    if [ ! -x "$_built_runtime" ]; then
      _fail "Runtime compilado não encontrado: $_built_runtime"
      exit 1
    fi
    mkdir -p "$LAUNCHER_DIR"
    _tmp_runtime="${RUNTIME_BIN_PATH}.tmp.${TIMESTAMP}"
    cp "$_built_runtime" "$_tmp_runtime"
    chmod 755 "$_tmp_runtime"
    mv "$_tmp_runtime" "$RUNTIME_BIN_PATH"
    _ok "Runtime binary criado: $RUNTIME_BIN_PATH (755)"
  else
    _info "(--dry-run) Construiria runtime com build oficial em: $_runtime_dir"
    _info "(--dry-run) Instalaria: $RUNTIME_BIN_PATH"
  fi
fi

# ---------------------------------------------------------------------------
# 7. PATH check
# ---------------------------------------------------------------------------
_head "7. PATH"

if echo ":${PATH}:" | grep -q ":${LAUNCHER_DIR}:"; then
  _ok "$LAUNCHER_DIR está no PATH"
else
  _warn "$LAUNCHER_DIR NÃO está no PATH"
  _warn "Adicione manualmente ao seu shell profile:"
  _cmd "export PATH=\"${LAUNCHER_DIR}:\$PATH\""
fi

# ---------------------------------------------------------------------------
# 8. Verificação final
# ---------------------------------------------------------------------------
_head "8. Verificação"

_fails=0
[ -f "$LAUNCHER_PATH" ]   && _ok "Launcher presente"   || { _fail "Launcher ausente"; _fails=$((_fails+1)); }
[ -x "$LAUNCHER_PATH" ]   && _ok "Launcher executável" || { _fail "Launcher não executável"; _fails=$((_fails+1)); }
[ -x "$FAST_BIN_PATH" ]   && _ok "Fast path presente"  || { _warn "Fast path ausente: $FAST_BIN_PATH"; }
[ -x "$RUNTIME_BIN_PATH" ] && _ok "Runtime presente"   || { _warn "Runtime ausente: $RUNTIME_BIN_PATH"; }
[ -f "$HUBCLI_CONFIG" ]   && _ok "Config presente"     || { _warn "Config ausente: $HUBCLI_CONFIG"; }
[ -f "$HUBCLI_CREDS" ]    && _ok "Credentials presente" || { _warn "Credentials ausente: $HUBCLI_CREDS"; }
[ -d "$HUBCLI_SRC/.git" ] && _ok "Repositório presente" || { _fail "Repositório ausente"; _fails=$((_fails+1)); }

printf '\n'
if [ "$_fails" -eq 0 ]; then
  _ok "Setup completo. Teste com: hubcli doctor"
else
  _fail "$_fails problema(s). Corrija e execute novamente."
  exit 1
fi
