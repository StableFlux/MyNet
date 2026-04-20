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
echo -e "  ${RED}•${RESET} The mynet-storage helper and its sudoers rule"
echo ""
echo -e "  ${YELLOW}This cannot be undone. Make a backup first if needed.${RESET}"
echo -e "  ${YELLOW}If your database is on a USB drive, you will be asked separately${RESET}"
echo -e "  ${YELLOW}what to do with it.${RESET}"
echo ""
read -r -p "  Type UNINSTALL to confirm: " CONFIRM
if [ "$CONFIRM" != "UNINSTALL" ]; then
    echo "Aborted."
    exit 0
fi

# ── USB Storage pre-flight ────────────────────────────────────────────────────
# See USB_STORAGE_DESIGN.md § 15.3. Ask what to do with USB-resident data
# BEFORE stopping the service, so SQLite has a chance to drain cleanly.
STORAGE_CONFIG="$INSTALL_DIR/data/storage_config.json"
USB_CHOICE="none"
if [ -f "$STORAGE_CONFIG" ] && command -v grep >/dev/null 2>&1 && \
   grep -q '"mode"[[:space:]]*:[[:space:]]*"usb"' "$STORAGE_CONFIG" 2>/dev/null && \
   mountpoint -q /mnt/mynet-storage 2>/dev/null; then
    echo ""
    echo -e "${YELLOW}Your database currently lives on a USB drive.${RESET}"
    echo ""
    echo "  a) Copy database back to the SD card before uninstall  (default, safest)"
    echo "  b) Leave database on the USB drive (keeps it portable — can seed a fresh install)"
    echo "  c) Delete the database from the USB drive"
    echo ""
    read -r -p "  Choose [a/b/c]: " USB_CHOICE_RAW
    case "${USB_CHOICE_RAW:-a}" in
        a|A) USB_CHOICE="copy_back" ;;
        b|B) USB_CHOICE="leave" ;;
        c|C) USB_CHOICE="delete" ;;
        *)   USB_CHOICE="copy_back" ;;
    esac
fi

# ── Ask about optional removals ───────────────────────────────────────────────
echo ""
read -r -p "  Remove nginx? (only say yes if nothing else uses it) [y/N] " REMOVE_NGINX
read -r -p "  Remove Node.js? [y/N] " REMOVE_NODE
read -r -p "  Remove swapfile created by setup.sh (/swapfile)? [y/N] " REMOVE_SWAP
echo ""

# ── Act on USB choice BEFORE stopping the service ────────────────────────────
# The helper requires systemctl, so "copy back" runs while the service is
# still up but paused via systemctl stop inside the helper path.
if [ "$USB_CHOICE" = "copy_back" ]; then
    step "Copying database from USB back to SD card"
    if systemctl is-active --quiet mynet 2>/dev/null; then
        systemctl stop mynet
    fi
    if [ -f /mnt/mynet-storage/mynet.db ]; then
        cp /mnt/mynet-storage/mynet.db "$INSTALL_DIR/data/mynet.db.uninstall-copy"
        success "Database copied to $INSTALL_DIR/data/mynet.db.uninstall-copy"
        info "(This file will be removed along with $INSTALL_DIR below.)"
    else
        warn "No database found at /mnt/mynet-storage/mynet.db"
    fi
elif [ "$USB_CHOICE" = "delete" ]; then
    step "Deleting database from USB"
    if systemctl is-active --quiet mynet 2>/dev/null; then
        systemctl stop mynet
    fi
    rm -f /mnt/mynet-storage/mynet.db
    success "Database deleted from USB"
elif [ "$USB_CHOICE" = "leave" ]; then
    info "Leaving database on USB — the drive can seed a fresh MyNet install"
fi

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

# ── USB Storage teardown ──────────────────────────────────────────────────────
step "Tearing down USB Storage components"

# Unmount + remove mount unit
if mountpoint -q /mnt/mynet-storage 2>/dev/null; then
    umount /mnt/mynet-storage 2>/dev/null || true
fi
# systemd-escape is only available from util-linux — fall back to the known name
MOUNT_UNIT_PATH="$(ls /etc/systemd/system/ 2>/dev/null | grep -E '^mnt-mynet.x2dstorage\.mount$' | head -n1 || true)"
if [ -n "$MOUNT_UNIT_PATH" ]; then
    systemctl disable "$MOUNT_UNIT_PATH" 2>/dev/null || true
    rm -f "/etc/systemd/system/$MOUNT_UNIT_PATH"
fi
# Drop-in dir (including storage.conf) — ignored if absent
rm -rf /etc/systemd/system/mynet.service.d
rmdir /mnt/mynet-storage 2>/dev/null || true

# Helper + sudoers
rm -f /usr/local/bin/mynet-storage
rm -f /etc/sudoers.d/mynet-storage

systemctl daemon-reload
success "Storage teardown complete"

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
    rm -f /usr/share/keyrings/nodesource.gpg
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
