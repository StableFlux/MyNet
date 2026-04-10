#!/usr/bin/env bash
# =============================================================================
# MyNet — Update Script
# Pulls latest code, rebuilds frontend, restarts backend.
# Usage: sudo bash update.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}━━━  $*  ━━━${RESET}"; }

# ── Spinner ───────────────────────────────────────────────────────────────────
# Usage: spin_run "Descriptive message" command [args...]
# Runs command in background, shows animated spinner, dumps output on failure.
_SPIN_LOG=$(mktemp /tmp/mynet-XXXXXX.log)
trap 'rm -f "$_SPIN_LOG"' EXIT

spin_run() {
    local msg="$1"; shift
    local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠣⠏'
    local i=0
    "$@" >"$_SPIN_LOG" 2>&1 &
    local pid=$!
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r  ${CYAN}${frames:$((i % 10)):1}${RESET}  %s" "$msg" >&2
        sleep 0.12
        i=$(( i + 1 ))
    done
    printf "\r\033[K" >&2
    if ! wait "$pid"; then
        echo -e "${RED}[ERROR]${RESET} Failed: $*" >&2
        echo "──── Output ────────────────────────────────────────────────" >&2
        cat "$_SPIN_LOG" >&2
        echo "────────────────────────────────────────────────────────────" >&2
        exit 1
    fi
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/mynet"
VENV_DIR="$INSTALL_DIR/venv"
STATIC_DIR="$INSTALL_DIR/static"
FRONTEND_SRC="$REPO_ROOT/site/frontend"
BACKEND_SRC="$REPO_ROOT/site/backend"

if [ "$EUID" -ne 0 ]; then
    die "Run as root: sudo bash update.sh"
fi

if [ ! -f "$BACKEND_SRC/main.py" ]; then
    die "Run from the MyNet repository root"
fi

# ── Pull latest code ──────────────────────────────────────────────────────────
step "Pulling latest code"

if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
    git -C "$REPO_ROOT" pull --ff-only
    success "Repository updated"
else
    info "Not a git repository — skipping git pull (copy files manually)"
fi

# ── Rebuild frontend ──────────────────────────────────────────────────────────
step "Rebuilding frontend"

export NODE_OPTIONS="--max-old-space-size=700"
cd "$FRONTEND_SRC"
spin_run "Installing npm dependencies (this may take a while on Pi)..." npm ci --prefer-offline
spin_run "Building frontend (this may take a while on Pi)..."           npm run build
rm -rf "$STATIC_DIR"
cp -r dist "$STATIC_DIR"
unset NODE_OPTIONS
cd "$REPO_ROOT"
success "Frontend rebuilt and deployed"

# ── Update Python dependencies ────────────────────────────────────────────────
step "Updating Python dependencies"

spin_run "Upgrading pip..."                    "$VENV_DIR/bin/pip" install --quiet --upgrade pip
spin_run "Installing Python dependencies..."   "$VENV_DIR/bin/pip" install --quiet -r "$BACKEND_SRC/requirements.txt"
success "Dependencies up to date"

# ── Fix ownership and restart ─────────────────────────────────────────────────
step "Restarting services"

SERVICE_USER="${SUDO_USER:-$(whoami)}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
systemctl restart mynet
nginx -t && systemctl reload nginx
success "Services restarted"

echo ""
echo -e "${GREEN}${BOLD}MyNet updated successfully.${RESET}"
echo -e "Check logs: journalctl -u mynet -f"
echo ""
