#!/usr/bin/env bash
# birds.quest server installer for Ubuntu 26.04. Run as root, from a copy of this repo:
#
#   sudo APP_DOMAIN=birds.example.com TRACCAR_DOMAIN=gps.example.com \
#        LETSENCRYPT_EMAIL=you@example.com ./deploy/install.sh
#
# Safe to re-run: packages, users, grants, units and config are converged; secrets and
# /etc/birdsquest/birdsquest.env are created once and never overwritten.
#
# Optional variables: DEPLOY_SSH_PUBKEY (public key allowed to git push; defaults to root's
# authorized_keys), TRACCAR_VERSION, SSH_PORT.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_USER=birdsquest
BASE_DIR=/srv/birdsquest
APP_DIR=$BASE_DIR/app
REPO_DIR=$BASE_DIR/repo.git
CONF_DIR=/etc/birdsquest
SECRETS_FILE=$CONF_DIR/secrets.env
APP_ENV_FILE=$CONF_DIR/birdsquest.env
CADDY_ENV_FILE=$CONF_DIR/caddy.env
TRACCAR_DIR=/opt/traccar
TRACCAR_VERSION="${TRACCAR_VERSION:-6.16.0}"
SSH_PORT="${SSH_PORT:-22}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "this script targets Ubuntu (found ${ID:-unknown})"
[ "${VERSION_ID:-}" = "26.04" ] || echo "warning: tested for Ubuntu 26.04, found ${VERSION_ID:-unknown}" >&2

install -d -m 0750 -o root -g root "$CONF_DIR"

# Domains: from the environment, or from a previous run.
if [ -f "$CADDY_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CADDY_ENV_FILE"
fi
: "${APP_DOMAIN:?set APP_DOMAIN (public blog domain)}"
: "${TRACCAR_DOMAIN:?set TRACCAR_DOMAIN (Traccar domain)}"
[ "$APP_DOMAIN" != "$TRACCAR_DOMAIN" ] || die "APP_DOMAIN and TRACCAR_DOMAIN must differ"
case "$APP_DOMAIN$TRACCAR_DOMAIN" in
  *[!A-Za-z0-9.-]*) die "domains may only contain letters, digits, dots and hyphens" ;;
esac

export DEBIAN_FRONTEND=noninteractive

log "Installing base packages"
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg unzip openssl git sudo ufw debian-keyring debian-archive-keyring \
  apt-transport-https mariadb-server

log "Installing Caddy (official apt repository)"
if [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

log "Installing Node.js (>= 22.9) and pnpm"
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=9)?0:1)'
}
if ! node_ok; then
  apt-get install -y nodejs npm || true
fi
if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node_ok || die "could not install Node.js >= 22.9"
[ -x /usr/bin/node ] || ln -s "$(command -v node)" /usr/bin/node
PNPM_VERSION="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$DEPLOY_DIR/../package.json")"
PNPM_VERSION="${PNPM_VERSION:-12.6.0}"
if [ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  command -v npm >/dev/null 2>&1 || apt-get install -y npm
  npm install -g "pnpm@$PNPM_VERSION"
fi

log "Creating the $APP_USER user and directories"
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home "/home/$APP_USER" --shell /bin/bash "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$BASE_DIR" "$APP_DIR" "$APP_DIR/.next" "$APP_DIR/.next/cache"

log "Generating secrets (kept across re-runs)"
if [ ! -f "$SECRETS_FILE" ]; then
  umask 077
  {
    echo "TRACCAR_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_RO_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n=+/')"
  } > "$SECRETS_FILE"
  umask 022
fi
chmod 600 "$SECRETS_FILE"
# shellcheck disable=SC1090
. "$SECRETS_FILE"

log "Configuring MariaDB (databases and users)"
systemctl enable --now mariadb
mariadb <<SQL
CREATE DATABASE IF NOT EXISTS traccar CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS birdsquest CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'traccar'@'127.0.0.1' IDENTIFIED BY '${TRACCAR_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'birdsquest'@'127.0.0.1' IDENTIFIED BY '${APP_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'birdsquest_ro'@'127.0.0.1' IDENTIFIED BY '${APP_RO_DB_PASSWORD}';
ALTER USER 'traccar'@'127.0.0.1' IDENTIFIED BY '${TRACCAR_DB_PASSWORD}';
ALTER USER 'birdsquest'@'127.0.0.1' IDENTIFIED BY '${APP_DB_PASSWORD}';
ALTER USER 'birdsquest_ro'@'127.0.0.1' IDENTIFIED BY '${APP_RO_DB_PASSWORD}';
GRANT ALL ON traccar.* TO 'traccar'@'127.0.0.1';
GRANT ALL ON birdsquest.* TO 'birdsquest'@'127.0.0.1';
GRANT SELECT ON traccar.* TO 'birdsquest_ro'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

log "Installing Traccar $TRACCAR_VERSION (native)"
if [ ! -x "$TRACCAR_DIR/bin/traccar" ] && [ ! -d "$TRACCAR_DIR/conf" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/traccar.zip" \
    "https://github.com/traccar/traccar/releases/download/v${TRACCAR_VERSION}/traccar-linux-64-${TRACCAR_VERSION}.zip"
  unzip -q "$tmp/traccar.zip" -d "$tmp"
  (cd "$tmp" && chmod +x traccar.run && ./traccar.run)
  rm -rf "$tmp"
fi

log "Configuring Traccar (MariaDB, localhost only)"
[ -f "$TRACCAR_DIR/conf/traccar.xml.orig" ] || cp "$TRACCAR_DIR/conf/traccar.xml" "$TRACCAR_DIR/conf/traccar.xml.orig"
cat > "$TRACCAR_DIR/conf/traccar.xml" <<XML
<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE properties SYSTEM 'http://java.sun.com/dtd/properties.dtd'>
<properties>
  <entry key='config.default'>./conf/default.xml</entry>

  <!-- Only Caddy (HTTPS) is reachable from outside. -->
  <entry key='web.address'>127.0.0.1</entry>
  <entry key='web.port'>8082</entry>
  <entry key='osmand.address'>127.0.0.1</entry>
  <entry key='osmand.port'>5055</entry>

  <entry key='database.driver'>org.mariadb.jdbc.Driver</entry>
  <entry key='database.url'>jdbc:mariadb://127.0.0.1/traccar?zeroDateTimeBehavior=round&amp;allowPublicKeyRetrieval=true&amp;useSsl=false&amp;allowMultiQueries=true&amp;autoReconnect=true&amp;sessionVariables=sql_mode=''</entry>
  <entry key='database.user'>traccar</entry>
  <entry key='database.password'>${TRACCAR_DB_PASSWORD}</entry>
</properties>
XML
chmod 600 "$TRACCAR_DIR/conf/traccar.xml"
systemctl enable traccar
systemctl restart traccar

log "Writing the app environment file (only if missing)"
if [ ! -f "$APP_ENV_FILE" ]; then
  umask 077
  cat > "$APP_ENV_FILE" <<ENV
# Loaded by systemd and by the git deploy hook. Plain KEY=value, no quotes except the hash.
DATABASE_URL=mysql://birdsquest:${APP_DB_PASSWORD}@127.0.0.1:3306/birdsquest
TRACCAR_DATABASE_URL=mysql://birdsquest_ro:${APP_RO_DB_PASSWORD}@127.0.0.1:3306/traccar
SITE_URL=https://${APP_DOMAIN}
SESSION_SECRET=${SESSION_SECRET}
# Set with: sudo -u ${APP_USER} pnpm admin:hash (in ${APP_DIR}), keep the \\\$ escapes.
ADMIN_PASSWORD_HASH='\\\$argon2id\\\$v=19\\\$m=65536,t=3,p=4\\\$REPLACE_ME\\\$REPLACE_ME'
LLM_PROVIDER=digitalocean
LLM_API_KEY=
WIKIPEDIA_USER_AGENT=birds.quest/0.1 (you@example.com)
ENV
  umask 022
fi
chown root:"$APP_USER" "$APP_ENV_FILE"
chmod 640 "$APP_ENV_FILE"

log "Configuring Caddy"
cat > "$CADDY_ENV_FILE" <<ENV
APP_DOMAIN=${APP_DOMAIN}
TRACCAR_DOMAIN=${TRACCAR_DOMAIN}
ENV
chmod 644 "$CADDY_ENV_FILE"
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/birdsquest.conf <<CONF
[Service]
EnvironmentFile=$CADDY_ENV_FILE
CONF
install -m 0644 "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile
if [ -n "${LETSENCRYPT_EMAIL:-}" ] && ! grep -q '^{$' /etc/caddy/Caddyfile; then
  printf '{\n\temail %s\n}\n\n%s\n' "$LETSENCRYPT_EMAIL" "$(cat /etc/caddy/Caddyfile)" > /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || die "Caddyfile is invalid"

log "Installing systemd units"
install -m 0644 "$DEPLOY_DIR/birdsquest-web.service" /etc/systemd/system/
install -m 0644 "$DEPLOY_DIR/birdsquest-worker.service" /etc/systemd/system/
install -m 0644 "$DEPLOY_DIR/birdsquest-worker.timer" /etc/systemd/system/
cat > /etc/sudoers.d/birdsquest <<SUDO
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart birdsquest-web.service
SUDO
chmod 440 /etc/sudoers.d/birdsquest
visudo -cf /etc/sudoers.d/birdsquest >/dev/null || die "invalid sudoers file"
systemctl daemon-reload
systemctl enable birdsquest-web.service birdsquest-worker.timer
systemctl enable caddy
systemctl restart caddy

log "Setting up the git deploy repository"
if [ ! -d "$REPO_DIR" ]; then
  sudo -u "$APP_USER" git init --bare --initial-branch=main "$REPO_DIR"
fi
install -m 0755 -o "$APP_USER" -g "$APP_USER" "$DEPLOY_DIR/post-receive" "$REPO_DIR/hooks/post-receive"
SSH_DIR=/home/$APP_USER/.ssh
install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$SSH_DIR"
touch "$SSH_DIR/authorized_keys"
if [ -n "${DEPLOY_SSH_PUBKEY:-}" ]; then
  grep -qxF "$DEPLOY_SSH_PUBKEY" "$SSH_DIR/authorized_keys" || echo "$DEPLOY_SSH_PUBKEY" >> "$SSH_DIR/authorized_keys"
elif [ ! -s "$SSH_DIR/authorized_keys" ] && [ -s /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys "$SSH_DIR/authorized_keys"
fi
chown "$APP_USER:$APP_USER" "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"
[ -s "$SSH_DIR/authorized_keys" ] || echo "warning: no SSH key authorised for $APP_USER; set DEPLOY_SSH_PUBKEY and re-run" >&2

log "Configuring the firewall (UFW: $SSH_PORT, 80, 443)"
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Traccar registration"
# Traccar makes the first registered user the administrator, so registration stays open until
# that account exists, then it is switched off (re-run this script after registering).
users="$(mariadb -N -e 'SELECT COUNT(*) FROM traccar.tc_users' 2>/dev/null || echo 0)"
if [ "${users:-0}" -gt 0 ]; then
  mariadb -e 'UPDATE traccar.tc_servers SET registration = 0'
  systemctl restart traccar
  echo "Open registration is disabled."
else
  echo "No Traccar user yet: register the admin account at https://${TRACCAR_DOMAIN}, then re-run this script."
fi

if [ -f "$APP_DIR/package.json" ]; then
  log "Downloading models"
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pnpm models:download"
fi

cat <<DONE

Done. Next steps:
  1. DNS: point ${APP_DOMAIN} and ${TRACCAR_DOMAIN} at this server (needed for TLS certificates).
  2. Register the Traccar admin account at https://${TRACCAR_DOMAIN}, then re-run this script.
  3. Edit ${APP_ENV_FILE} (LLM_API_KEY, WIKIPEDIA_USER_AGENT, ADMIN_PASSWORD_HASH).
  4. From your machine: git remote add production ${APP_USER}@<server>:${REPO_DIR} && git push production main
  5. Start the worker timer: systemctl start birdsquest-worker.timer
DONE
