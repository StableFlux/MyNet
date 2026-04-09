#!/usr/bin/env bash
# =============================================================================
# MyNet — Production Setup Script
# Supports: Ubuntu 22.04+, Raspberry Pi OS Bookworm/Bullseye (headless)
# Architectures: x86_64, aarch64 (Pi 4/5, 64-bit Pi 3), armv7l (32-bit Pi 3)
#
# Usage (run from the repository root):
#   sudo bash setup.sh
# =============================================================================
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}━━━  $*  ━━━${RESET}"; }

# ── Paths ─────────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/mynet"
DATA_DIR="$INSTALL_DIR/data"
VENV_DIR="$INSTALL_DIR/venv"
STATIC_DIR="$INSTALL_DIR/static"
ENV_FILE="$INSTALL_DIR/.env"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_SRC="$REPO_ROOT/site/backend"
FRONTEND_SRC="$REPO_ROOT/site/frontend"

# ── Root check ────────────────────────────────────────────────────────────────
step "Preflight checks"

if [ "$EUID" -ne 0 ]; then
    die "This script must be run as root. Try: sudo bash setup.sh"
fi

# ── Repo root check ───────────────────────────────────────────────────────────
if [ ! -f "$BACKEND_SRC/main.py" ] || [ ! -f "$FRONTEND_SRC/package.json" ]; then
    die "Run this script from the MyNet repository root (the folder containing setup.sh)"
fi
success "Repository root confirmed: $REPO_ROOT"

# ── OS detection ──────────────────────────────────────────────────────────────
if [ -f /etc/os-release ]; then
    source /etc/os-release
    OS_NAME="${NAME:-unknown}"
    OS_ID="${ID:-unknown}"
    OS_VER="${VERSION_ID:-unknown}"
else
    die "Cannot detect OS — /etc/os-release not found"
fi

ARCH="$(uname -m)"
info "OS: $OS_NAME $OS_VER  |  Arch: $ARCH"

case "$OS_ID" in
    ubuntu|debian|raspbian) ;;
    *) warn "Untested OS '$OS_ID'. Continuing but results may vary." ;;
esac

case "$ARCH" in
    x86_64|aarch64|armv7l) ;;
    *) warn "Untested architecture '$ARCH'. Continuing." ;;
esac

if [ "$ARCH" = "armv7l" ]; then
    warn "32-bit ARM detected (Pi 3 in 32-bit mode). Consider using a 64-bit OS"
    warn "for better Node.js and Python performance."
fi

# ── RAM and swap ──────────────────────────────────────────────────────────────
step "Memory check"

TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
info "Total RAM: ${TOTAL_RAM_MB}MB"

SWAP_TOTAL_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
SWAP_TOTAL_MB=$((SWAP_TOTAL_KB / 1024))

if [ "$TOTAL_RAM_MB" -lt 1800 ] && [ "$SWAP_TOTAL_MB" -lt 1024 ]; then
    warn "Low RAM (${TOTAL_RAM_MB}MB) with insufficient swap (${SWAP_TOTAL_MB}MB)."
    warn "The frontend build requires ~800MB. Creating a 2GB swapfile..."
    if [ ! -f /swapfile ]; then
        fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        # Persist across reboots
        if ! grep -q '/swapfile' /etc/fstab; then
            echo '/swapfile none swap sw 0 0' >> /etc/fstab
        fi
        success "2GB swapfile created and activated"
    else
        swapon /swapfile 2>/dev/null || true
        success "Existing swapfile activated"
    fi
    # Reduce swappiness — we only want swap for build-time peaks, not normal operation
    sysctl -w vm.swappiness=10 > /dev/null
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-mynet-swap.conf
elif [ "$SWAP_TOTAL_MB" -ge 1024 ]; then
    success "Swap OK (${SWAP_TOTAL_MB}MB)"
else
    success "RAM OK (${TOTAL_RAM_MB}MB)"
fi

# ── System packages ───────────────────────────────────────────────────────────
step "Installing system packages"

apt-get update -qq

# Python: use already-installed python3 if it's 3.10+, then try versioned
# packages, then fall back to the distro default python3.
# Note: deadsnakes PPA is Ubuntu-only and is not used here.
PYTHON_BIN=""

# Check if python3 is already present and meets the minimum version
if command -v python3 &>/dev/null; then
    _maj=$(python3 -c 'import sys; print(sys.version_info.major)' 2>/dev/null || echo 0)
    _min=$(python3 -c 'import sys; print(sys.version_info.minor)' 2>/dev/null || echo 0)
    if [ "$_maj" -ge 3 ] && [ "$_min" -ge 10 ]; then
        PYTHON_BIN="python3"
        info "Using already-installed $(python3 --version)"
    fi
fi

# Try versioned packages from the distro repos
if [ -z "$PYTHON_BIN" ]; then
    for ver in 3.12 3.11 3.10; do
        if apt-cache show "python$ver" &>/dev/null 2>&1; then
            PYTHON_BIN="python$ver"
            break
        fi
    done
fi

# Last resort: install distro python3 (Debian 12+ ships 3.11+, Debian 13 ships 3.12)
if [ -z "$PYTHON_BIN" ]; then
    info "No versioned Python 3.10+ package found — installing distro python3..."
    apt-get install -y -qq python3 python3-venv python3-dev
    PYTHON_BIN="python3"
fi

info "Using $PYTHON_BIN"

# Build package list — python3 uses generic names; versioned bins use suffixed names
if [ "$PYTHON_BIN" = "python3" ]; then
    PKGS=(
        "python3"
        "python3-venv"
        "python3-dev"
        "libffi-dev"           # required by cryptography package
        "fonts-dejavu-core"    # required by Pillow for QR label generation
        "nginx"
        "curl"
        "git"
        "ca-certificates"
    )
else
    PKGS=(
        "$PYTHON_BIN"
        "${PYTHON_BIN}-venv"
        "${PYTHON_BIN}-dev"
        "libffi-dev"
        "fonts-dejavu-core"
        "nginx"
        "curl"
        "git"
        "ca-certificates"
    )
fi

apt-get install -y -qq "${PKGS[@]}"
success "System packages installed"

# ── Node.js 20 ────────────────────────────────────────────────────────────────
step "Installing Node.js 20"

if command -v node &>/dev/null && node --version | grep -q '^v2[0-9]'; then
    success "Node.js $(node --version) already installed"
else
    info "Adding NodeSource repository..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null
    apt-get install -y -qq nodejs
    success "Node.js $(node --version) installed"
fi

# ── Directory structure ───────────────────────────────────────────────────────
step "Creating directory structure"

# Run the service as the user who invoked sudo (the repo owner)
SERVICE_USER="${SUDO_USER:-$(whoami)}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
info "Service will run as $SERVICE_USER"

mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$STATIC_DIR"
success "Directories created under $INSTALL_DIR"

# ── Frontend build ────────────────────────────────────────────────────────────
step "Building frontend"

info "Installing npm dependencies..."
cd "$FRONTEND_SRC"

# Limit Node.js heap — important on Pi 3B+ (1GB RAM)
export NODE_OPTIONS="--max-old-space-size=700"

npm ci --prefer-offline --silent
info "Running Vite build..."
npm run build
success "Frontend built successfully"

# Copy built assets to install location
rm -rf "$STATIC_DIR"
cp -r "$FRONTEND_SRC/dist" "$STATIC_DIR"
success "Static files copied to $STATIC_DIR"
unset NODE_OPTIONS
cd "$REPO_ROOT"

# ── Python virtual environment ────────────────────────────────────────────────
step "Setting up Python environment"

if [ ! -d "$VENV_DIR" ]; then
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    success "Virtual environment created at $VENV_DIR"
else
    success "Virtual environment already exists — updating"
fi

"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$BACKEND_SRC/requirements.txt"
success "Python dependencies installed"

# ── Environment configuration ─────────────────────────────────────────────────
step "Configuring environment"

if [ -f "$ENV_FILE" ]; then
    warn ".env already exists at $ENV_FILE — skipping generation"
    warn "Edit it manually if you need to change settings, then restart: systemctl restart mynet"
else
    JWT_SECRET=$(openssl rand -hex 32)

    cat > "$ENV_FILE" << EOF
# MyNet production environment
# Generated by setup.sh on $(date)

# REQUIRED — do not share this key
JWT_SECRET_KEY=$JWT_SECRET

# SQLite database location
DB_PATH=$DATA_DIR/mynet.db

# Port nginx listens on (default 80)
APP_PORT=80
EOF

    chmod 600 "$ENV_FILE"
    success ".env written to $ENV_FILE"
fi

# Read port from .env for nginx config
APP_PORT=$(grep '^APP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
APP_PORT="${APP_PORT:-80}"
APP_URL="http://$(hostname -I | awk '{print $1}' | tr -d '[:space:]'):${APP_PORT}"

# ── nginx configuration ───────────────────────────────────────────────────────
step "Configuring nginx"

NGINX_CONF="/etc/nginx/sites-available/mynet"
cat > "$NGINX_CONF" << NGINX
upstream mynet_backend {
    server 127.0.0.1:8000;
    keepalive 8;
}

server {
    listen ${APP_PORT};
    server_name _;

    root $STATIC_DIR;
    index index.html;

    # Limit request body size — backup files are JSON, 50MB is generous
    client_max_body_size 50M;

    # Security headers
    add_header X-Content-Type-Options  "nosniff"                         always;
    add_header X-Frame-Options         "SAMEORIGIN"                      always;
    add_header X-XSS-Protection        "1; mode=block"                   always;
    add_header Referrer-Policy         "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'self';" always;

    # Gzip compression
    gzip            on;
    gzip_vary       on;
    gzip_min_length 1024;
    gzip_types      text/plain text/css text/javascript application/javascript
                    application/json application/xml image/svg+xml;

    # API proxy → FastAPI backend
    location /api/ {
        proxy_pass         http://mynet_backend;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }

    # WebSocket proxy → monitoring real-time updates
    location /ws {
        proxy_pass         http://mynet_backend;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       \$host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Long-lived cache for hashed asset bundles
    location ~* \.(js|css|woff2?|ttf|eot)$ {
        expires    1y;
        add_header Cache-Control "public, immutable";
    }

    # Short cache for images
    location ~* \.(png|jpg|jpeg|gif|ico|svg|webp)$ {
        expires    30d;
        add_header Cache-Control "public";
    }

    # SPA fallback — all unmatched routes serve index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

# Enable the site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/mynet
# Remove default nginx site from both possible locations
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/conf.d/default.conf

nginx -t
systemctl enable nginx
systemctl restart nginx
success "nginx configured on port $APP_PORT"

# ── systemd service ───────────────────────────────────────────────────────────
step "Creating systemd service"

# Source .env to pass variables to the service
DB_PATH=$(grep '^DB_PATH=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
DB_PATH="${DB_PATH:-$DATA_DIR/mynet.db}"

cat > /etc/systemd/system/mynet.service << SERVICE
[Unit]
Description=MyNet — home network manager (FastAPI/uvicorn)
Documentation=file://$REPO_ROOT
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$BACKEND_SRC
EnvironmentFile=$ENV_FILE

ExecStart=$VENV_DIR/bin/uvicorn main:app \\
    --host 127.0.0.1 \\
    --port 8000 \\
    --workers 1 \\
    --log-level info

Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mynet

# Grant ICMP capability for device monitoring (ping) — no root required
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW

# Harden the service
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full

[Install]
WantedBy=multi-user.target
SERVICE

# Ownership
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
chmod 750 "$DATA_DIR"

systemctl daemon-reload
systemctl enable mynet
systemctl restart mynet
success "mynet service enabled and started"

# ── Firewall ──────────────────────────────────────────────────────────────────
step "Firewall (UFW)"

if command -v ufw &>/dev/null; then
    ufw allow ssh    > /dev/null
    ufw allow "$APP_PORT"/tcp > /dev/null
    # Close direct backend port — only nginx should be reachable
    ufw deny 8000/tcp > /dev/null 2>&1 || true
    if ! ufw status | grep -q "Status: active"; then
        ufw --force enable > /dev/null
    fi
    success "UFW: SSH + port $APP_PORT allowed, port 8000 blocked"
else
    warn "UFW not installed — skipping firewall setup"
fi

# ── Health check ──────────────────────────────────────────────────────────────
step "Verifying installation"

info "Waiting for backend to start..."
for i in $(seq 1 20); do
    if curl -sf http://127.0.0.1:8000/api/auth/setup-required > /dev/null 2>&1; then
        success "Backend responding on port 8000"
        break
    fi
    if [ "$i" -eq 20 ]; then
        warn "Backend did not respond after 20 seconds."
        warn "Check logs with: journalctl -u mynet -n 50"
    fi
    sleep 1
done

if curl -sf "http://127.0.0.1:${APP_PORT}/" > /dev/null 2>&1; then
    success "nginx responding on port $APP_PORT"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  MyNet is installed and running!${RESET}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}App:${RESET}      ${APP_URL}"
echo ""
echo -e "  ${BOLD}Logs:${RESET}     journalctl -u mynet -f"
echo -e "  ${BOLD}Restart:${RESET}  systemctl restart mynet"
echo -e "  ${BOLD}Config:${RESET}   $ENV_FILE"
echo ""
echo -e "  Open ${BOLD}${APP_URL}${RESET} in your browser to complete setup."
echo ""
