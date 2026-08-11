#!/usr/bin/env bash
# =============================================================================
# HubCli — desinstalação segura
#
# Por padrão remove APENAS o launcher (~/.local/bin/hubcli), preservando:
#   - ~/.hubcli/credentials.env  (suas chaves)
#   - ~/.hubcli/opencode.json    (sua configuração)
#   - ~/.hubcli/profiles.json    (seus perfis)
#   - o repositório ~/Hubcli
#
# Dados só são apagados com --purge-data + confirmação digitada.
# Registros MCP em Codex/Claude Code são mostrados como instruções — este
# script nunca edita configs de outras ferramentas.
#
# Uso:
#   bash uninstall.sh            # remove launcher, preserva dados
#   bash uninstall.sh --dry-run  # mostra o que faria
#   bash uninstall.sh --purge-data  # TAMBÉM apaga ~/.hubcli (pede confirmação)
# =============================================================================
set -euo pipefail

LAUNCHER="${HOME}/.local/bin/hubcli"
HUBCLI_HOME="${HOME}/.hubcli"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DRY_RUN=0
PURGE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --purge-data) PURGE=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 1 ;;
  esac
done

echo "== HubCli uninstall =="

# 1. Launcher
if [ -f "$LAUNCHER" ]; then
  if grep -q "HUBCLI_SRC=" "$LAUNCHER" 2>/dev/null; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "(dry-run) Removeria: $LAUNCHER (com backup)"
    else
      cp "$LAUNCHER" "${LAUNCHER}.removed.${TIMESTAMP}"
      rm "$LAUNCHER"
      echo "Removido: $LAUNCHER (backup em ${LAUNCHER}.removed.${TIMESTAMP})"
    fi
  else
    echo "AVISO: $LAUNCHER não parece ser do HubCli — não vou tocar nele."
  fi
else
  echo "Launcher já ausente: $LAUNCHER"
fi

# 2. Dados — preservados por padrão
if [ "$PURGE" -eq 0 ]; then
  echo "Preservado: $HUBCLI_HOME (config, credenciais, perfis)"
  echo "Preservado: repositório ~/Hubcli"
else
  echo ""
  echo "ATENÇÃO: --purge-data apagará $HUBCLI_HOME, incluindo credentials.env."
  echo "Suas chaves de API serão PERDIDAS se não tiver backup."
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "(dry-run) Pediria confirmação e apagaria $HUBCLI_HOME"
  else
    printf 'Digite exatamente APAGAR para confirmar: '
    read -r _confirm
    if [ "$_confirm" = "APAGAR" ]; then
      rm -rf "$HUBCLI_HOME"
      echo "Apagado: $HUBCLI_HOME"
    else
      echo "Confirmação incorreta — dados preservados."
    fi
  fi
fi

# 3. Registros MCP — instruções apenas (nunca editamos configs de terceiros)
echo ""
echo "Se registrou o servidor MCP, remova manualmente:"
echo "  Codex CLI:    codex mcp remove hubcli"
echo "  Claude Code:  claude mcp remove --scope user hubcli"
echo ""
echo "O repositório ~/Hubcli não é removido por este script."
echo "Concluído."
