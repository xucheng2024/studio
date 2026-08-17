#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this bootstrap as root on an Ubuntu 24.04 VM." >&2
  exit 1
fi
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: sudo bash scripts/bootstrap-cloud-vm-uat.sh <repo-dir> [runner-user]" >&2
  exit 1
fi

repo_dir="$(realpath "$1")"
runner_user="${2:-uatrunner}"
if [[ ! "$runner_user" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "Runner user must be a valid Linux user name." >&2
  exit 1
fi
if [[ ! -f "$repo_dir/package-lock.json" || ! -f "$repo_dir/uat.flows.json" ]]; then
  echo "The repository path must contain package-lock.json and uat.flows.json." >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]] || ! grep -q '^ID=ubuntu$' /etc/os-release || ! grep -q '^VERSION_ID="24.04"$' /etc/os-release; then
  echo "This bootstrap supports Ubuntu 24.04 only." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-v2 git gnupg postgresql-client python3

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
fi
if [[ "$node_major" -lt 22 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

if ! id "$runner_user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$runner_user"
fi
usermod -aG docker "$runner_user"
systemctl enable --now docker

repo_owner="$(stat -c '%U' "$repo_dir")"
if [[ "$repo_owner" != "$runner_user" ]]; then
  echo "Repository must be owned by $runner_user (current owner: $repo_owner)." >&2
  exit 1
fi

browser_path="/opt/uat-browser/ms-playwright"
install -d -o "$runner_user" -g "$runner_user" -m 0755 "$browser_path"
runuser -u "$runner_user" -- env PLAYWRIGHT_BROWSERS_PATH="$browser_path" npm --prefix "$repo_dir" ci
PLAYWRIGHT_BROWSERS_PATH="$browser_path" "$repo_dir/node_modules/.bin/playwright" install-deps chromium
runuser -u "$runner_user" -- env PLAYWRIGHT_BROWSERS_PATH="$browser_path" "$repo_dir/node_modules/.bin/playwright" install chromium

echo "Cloud VM dependencies are ready. Start a new login session for $runner_user before running UAT."
