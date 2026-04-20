#!/usr/bin/env bash
# =============================================================================
# MyNet — Update Script
# Pulls latest code, rebuilds frontend, restarts backend.
# Usage: sudo bash update.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
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

# ── Fix ownership ─────────────────────────────────────────────────────────────
step "Restoring ownership"

SERVICE_USER="${SUDO_USER:-$(whoami)}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
success "Ownership restored"

# ── USB Storage feature upgrade (idempotent) ──────────────────────────────────
# See USB_STORAGE_DESIGN.md § 15.2. Every step is a no-op when already applied,
# so re-running update.sh is safe. Preserves any active USB-mode runtime state:
# /mnt/mynet-storage, storage.conf drop-in, storage_config.json, snapshots.
step "Updating USB Storage support"

SERVICE_FILE="/etc/systemd/system/mynet.service"
UNIT_CHANGED=0

if [ -f "$SERVICE_FILE" ] && grep -q '^NoNewPrivileges=yes' "$SERVICE_FILE"; then
    sed -i '/^NoNewPrivileges=yes/d' "$SERVICE_FILE"
    UNIT_CHANGED=1
    success "Removed NoNewPrivileges=yes from systemd unit (required by USB Storage helper)"
fi

# CapabilityBoundingSet=CAP_NET_RAW caps the service (and sudo children) to that
# single capability, which breaks sudo's setuid-root escalation ("unable to
# change to root gid"). AmbientCapabilities=CAP_NET_RAW stays — that's what
# grants ICMP. Same helper-access rationale as NoNewPrivileges above.
if [ -f "$SERVICE_FILE" ] && grep -q '^CapabilityBoundingSet=' "$SERVICE_FILE"; then
    sed -i '/^CapabilityBoundingSet=/d' "$SERVICE_FILE"
    UNIT_CHANGED=1
    success "Removed CapabilityBoundingSet from systemd unit (required by USB Storage helper)"
fi

# Ensure jq + helper dependencies are installed (no-op when already present)
if ! command -v jq >/dev/null 2>&1; then
    spin_run "Installing jq (required by USB Storage helper)..." apt-get install -y -qq jq
fi

if [ -f "$REPO_ROOT/scripts/mynet-storage" ]; then
    install -m 755 -o root -g root "$REPO_ROOT/scripts/mynet-storage" /usr/local/bin/mynet-storage
    success "Installed/updated /usr/local/bin/mynet-storage"
fi

# Idempotent sudoers drop-in. Re-written every run so the $SERVICE_USER stays
# correct even if the install's SUDO_USER changes between runs.
SUDOERS_TMP="$(mktemp)"
cat > "$SUDOERS_TMP" <<SUDOERS
# Installed by MyNet update.sh for the USB Storage feature.
$SERVICE_USER ALL=(root) NOPASSWD: /usr/local/bin/mynet-storage
SUDOERS
chmod 0440 "$SUDOERS_TMP"
if visudo -c -f "$SUDOERS_TMP" >/dev/null 2>&1; then
    install -m 0440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/mynet-storage
    success "Ensured /etc/sudoers.d/mynet-storage"
else
    info "Sudoers validation failed — skipping drop-in install"
fi
rm -f "$SUDOERS_TMP"

# Snapshots dir (SD side)
if [ ! -d "$INSTALL_DIR/data/snapshots" ]; then
    mkdir -p "$INSTALL_DIR/data/snapshots"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/data/snapshots"
    chmod 750 "$INSTALL_DIR/data/snapshots"
    success "Created $INSTALL_DIR/data/snapshots"
fi

if [ "$UNIT_CHANGED" -eq 1 ]; then
    systemctl daemon-reload
fi

# Nginx — inject a dedicated /api/storage/ location with a 600s timeout so
# long-running operations (mkfs, migrate) don't hit the default 30s /api/
# timeout and return 504. Idempotent: only runs if the block isn't present.
NGINX_CONF="/etc/nginx/sites-available/mynet"
if [ -f "$NGINX_CONF" ] && ! grep -q "location /api/storage/" "$NGINX_CONF"; then
    cp "$NGINX_CONF" "$NGINX_CONF.before-storage"
    awk '
        /^    location \/api\/ \{/ && !done {
            print "    # USB Storage endpoints — mkfs, migration, and snapshot restore can"
            print "    # legitimately take minutes on a Pi. Keep them separate from the"
            print "    # general API timeout."
            print "    location /api/storage/ {"
            print "        proxy_pass         http://mynet_backend;"
            print "        proxy_set_header   Host              $host;"
            print "        proxy_set_header   X-Real-IP         $remote_addr;"
            print "        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;"
            print "        proxy_set_header   X-Forwarded-Proto $scheme;"
            print "        proxy_read_timeout 600s;"
            print "        proxy_send_timeout 600s;"
            print "    }"
            print ""
            done=1
        }
        { print }
    ' "$NGINX_CONF.before-storage" > "$NGINX_CONF"
    if nginx -t >/dev/null 2>&1; then
        rm -f "$NGINX_CONF.before-storage"
        success "Added /api/storage/ nginx location with 600s timeout"
    else
        warn "nginx config test failed after adding storage location — reverting"
        mv "$NGINX_CONF.before-storage" "$NGINX_CONF"
    fi
fi

# ── Restart ──────────────────────────────────────────────────────────────────
step "Restarting services"
systemctl restart mynet
nginx -t && systemctl reload nginx
success "Services restarted"

echo ""
echo -e "${GREEN}${BOLD}MyNet updated successfully.${RESET}"
echo -e "Check logs: journalctl -u mynet -f"
echo ""
