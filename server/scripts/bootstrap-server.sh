#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo '请使用 root 执行' >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils mariadb-server
systemctl enable --now mariadb

if [[ ! -x /opt/node/bin/node ]]; then
  work_dir="$(mktemp -d /tmp/campus-node.XXXXXX)"
  cd "$work_dir"
  curl -fsS --retry 2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o SHASUMS256.txt
  archive="$(awk '$2 ~ /linux-x64.tar.xz$/ { print $2 }' SHASUMS256.txt)"
  [[ "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64.tar.xz$ ]]
  curl -fsS --retry 2 "https://nodejs.org/dist/latest-v24.x/$archive" -o "$archive"
  awk -v file="$archive" '$2 == file' SHASUMS256.txt | sha256sum --check -
  install -d /opt/node
  tar -xJf "$archive" --strip-components=1 -C /opt/node
fi

for tool in node npm npx; do
  if ! command -v "$tool" >/dev/null; then
    ln -s "/opt/node/bin/$tool" "/usr/local/bin/$tool"
  fi
done
/opt/node/bin/node --version
mysql --batch --skip-column-names -e 'SELECT VERSION();'

if ! command -v codex >/dev/null; then
  /opt/node/bin/npm install --global @openai/codex --no-audit --no-fund
  ln -s /opt/node/bin/codex /usr/local/bin/codex
fi
codex --version
echo 'SERVER_RUNTIME_READY'
