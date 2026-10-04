#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu VPS. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/ashermemon/stormhacks/main/deploy/setup-server.sh | sudo bash
# (or clone the repo and run it). Safe to re-run; it never touches the database.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ashermemon/stormhacks.git}"
APP_DIR=/opt/stormhacks
DATA_DIR=/var/lib/stormhacks
APP_USER=stormhacks

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y git curl ca-certificates gnupg debian-keyring debian-archive-keyring \
  apt-transport-https python3 python3-venv python3-pip ufw

# Node 22 (vite needs >= 20.19)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy (official repo)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# Service user, app dir, data dir (DB lives OUTSIDE the git checkout)
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR" "$DATA_DIR/backups"

if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi
sudo -u "$APP_USER" python3 -m venv "$APP_DIR/.venv"

# Migrate an existing DB if you copied one to the server (never overwrites).
if [ -f "$APP_DIR/backend/stormhacks.db" ] && [ ! -f "$DATA_DIR/stormhacks.db" ]; then
  install -o "$APP_USER" -g "$APP_USER" -m 640 "$APP_DIR/backend/stormhacks.db" "$DATA_DIR/stormhacks.db"
fi

# Let the app user restart ONLY this service, without a password.
cat > /etc/sudoers.d/stormhacks <<SUDO
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart stormhacks
SUDO
chmod 440 /etc/sudoers.d/stormhacks
visudo -cf /etc/sudoers.d/stormhacks

# First build + install configs
sudo -u "$APP_USER" bash "$APP_DIR/deploy/deploy.sh" --first-run
install -m 644 "$APP_DIR/deploy/stormhacks.service" /etc/systemd/system/stormhacks.service
install -m 644 "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
install -m 644 "$APP_DIR/deploy/stormhacks-backup.service" /etc/systemd/system/stormhacks-backup.service
install -m 644 "$APP_DIR/deploy/stormhacks-backup.timer" /etc/systemd/system/stormhacks-backup.timer
systemctl daemon-reload
systemctl enable --now stormhacks
systemctl enable --now stormhacks-backup.timer
systemctl reload caddy || systemctl restart caddy

# Firewall: SSH + HTTP/HTTPS only (8765 stays private on 127.0.0.1)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Done. Next: add the deploy SSH key (see deploy/README.md)."
