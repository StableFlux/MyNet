#!/usr/bin/env bash
# =============================================================================
# MyNet — Uninstall Script
# Removes all MyNet data, configuration, and installed components.
# System packages (Python, nginx, Node.js) that may be used by other
# services are removed only if you explicitly confirm.
#
# Usage: sudo bash uninstall.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}━━━  $*  ━━━${RESET}"; }

INSTALL_DIR="/opt/mynet"
NGINX_CONF="/etc/nginx/sites-available/mynet"
NGINX_ENABLED="/etc/nginx/sites-enabled/mynet"
SERVICE_FILE="/etc/systemd/system/mynet.service"
SYSCTL_CONF="/etc/sysctl.d/99-mynet-swap.conf"

# ── Root check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    die "Run as root: sudo bash uninstall.sh"
fi

# ── Confirmation ──────────────────────────────────────────────────────────────
echo ""
echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${RED}${BOLD}║           MyNet — Complete Uninstall                ║${RESET}"
echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  This will permanently delete:"
echo -e "  ${RED}•${RESET} All MyNet data (database, backups, uploads)"
echo -e "  ${RED}•${RESET} The MyNet application and virtual environment"
echo -e "  ${RED}•${RESET} The mynet systemd service"
echo -e "  ${RED}•${RESET} The nginx site configuration for MyNet"
echo -e "  ${RED}•${RESET} UFW firewall rules added by MyNet"
echo ""
echo -e "  ${YELLOW}This cannot be undone. Make a backup first if needed.${RESET}"
echo ""
read -r -p "  Type UNINSTALL to confirm: " CONFIRM
if [ "$CONFIRM" != "UNINSTALL" ]; then
    echo "Aborted."
    exit 0
fi

# ── Ask about optional removals ───────────────────────────────────────────────
echo ""
read -r -p "  Remove nginx? (only say yes if nothing else uses it) [y/N] " REMOVE_NGINX
read -r -p "  Remove Node.js? [y/N] " REMOVE_NODE
read -r -p "  Remove swapfile created by setup.sh (/swapfile)? [y/N] " REMOVE_SWAP
echo ""

# ── Stop and disable the service ─────────────────────────────────────────────
step "Stopping MyNet service"

if systemctl is-active --quiet mynet 2>/dev/null; then
    systemctl stop mynet
    success "mynet service stopped"
else
    info "mynet service was not running"
fi

if systemctl is-enabled --quiet mynet 2>/dev/null; then
    systemctl disable mynet
    success "mynet service disabled"
fi

# ── Remove systemd service ────────────────────────────────────────────────────
step "Removing systemd service"

if [ -f "$SERVICE_FILE" ]; then
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    success "Removed $SERVICE_FILE"
else
    info "Service file not found — skipping"
fi

# ── Remove application data ───────────────────────────────────────────────────
step "Removing application data"

if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    success "Removed $INSTALL_DIR (data, venv, static files, .env)"
else
    info "$INSTALL_DIR not found — skipping"
fi

# ── Remove nginx configuration ────────────────────────────────────────────────
step "Removing nginx configuration"

if [ -L "$NGINX_ENABLED" ] || [ -f "$NGINX_ENABLED" ]; then
    rm -f "$NGINX_ENABLED"
    success "Removed $NGINX_ENABLED"
fi

if [ -f "$NGINX_CONF" ]; then
    rm -f "$NGINX_CONF"
    success "Removed $NGINX_CONF"
fi

if [[ "$REMOVE_NGINX" =~ ^[Yy]$ ]]; then
    apt-get remove --purge -y -qq nginx nginx-common nginx-core 2>/dev/null || true
    apt-get autoremove -y -qq 2>/dev/null || true
    rm -rf /etc/nginx
    success "nginx removed"
else
    # Restore the nginx default site so the server isn't left broken
    if [ -f /etc/nginx/sites-available/default ] && [ ! -L /etc/nginx/sites-enabled/default ]; then
        ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
        info "Restored nginx default site"
    fi
    if systemctl is-active --quiet nginx 2>/dev/null; then
        nginx -t && systemctl reload nginx
        success "nginx reloaded"
    fi
fi

# ── Remove Node.js ────────────────────────────────────────────────────────────
if [[ "$REMOVE_NODE" =~ ^[Yy]$ ]]; then
    step "Removing Node.js"
    apt-get remove --purge -y -qq nodejs 2>/dev/null || true
    rm -f /etc/apt/sources.list.d/nodesource.list
    rm -f /etc/apt/keyrings/nodesource.gpg
    apt-get autoremove -y -qq 2>/dev/null || true
    success "Node.js removed"
fi

# ── Remove UFW rules ──────────────────────────────────────────────────────────
step "Removing firewall rules"

if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    # Remove rules for common MyNet ports (80 and any custom port from old .env)
    ufw delete allow 80/tcp  2>/dev/null || true
    ufw delete allow 8000/tcp 2>/dev/null || true
    success "UFW rules removed"
else
    info "UFW not active — skipping"
fi

# ── Remove swapfile ───────────────────────────────────────────────────────────
if [[ "$REMOVE_SWAP" =~ ^[Yy]$ ]]; then
    step "Removing swapfile"
    if [ -f /swapfile ]; then
        swapoff /swapfile 2>/dev/null || true
        rm -f /swapfile
        sed -i '/\/swapfile/d' /etc/fstab
        success "Swapfile removed"
    else
        info "/swapfile not found — skipping"
    fi
    if [ -f "$SYSCTL_CONF" ]; then
        rm -f "$SYSCTL_CONF"
        success "Removed $SYSCTL_CONF"
    fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  MyNet has been fully removed.${RESET}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════${RESET}"
echo ""
