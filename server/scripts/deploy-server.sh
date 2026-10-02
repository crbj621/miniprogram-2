#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:-/tmp/campus-api-release.tar.gz}"
release_root="/opt/campus-api/releases"
release_id="$(date +%Y%m%d-%H%M%S)"
release_dir="${release_root}/${release_id}"
current_link="/opt/campus-api/current"
previous_release=""

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行部署脚本" >&2
  exit 1
fi

if [[ ! -f "${archive}" ]]; then
  echo "找不到部署包：${archive}" >&2
  exit 1
fi

if [[ -L "${current_link}" ]]; then
  previous_release="$(readlink -f "${current_link}")"
fi

mkdir -p "${release_dir}"
tar -xzf "${archive}" -C "${release_dir}"

if [[ ! -f "${release_dir}/server/package-lock.json" ]] ||
   [[ ! -f "${release_dir}/server/src/app.js" ]] ||
   [[ ! -d "${release_dir}/server/services" ]] ||
   [[ ! -f "${release_dir}/admin-web/index.html" ]]; then
  echo "部署包结构不正确" >&2
  exit 1
fi

cd "${release_dir}/server"
/opt/node/bin/npm ci --omit=dev --no-audit --no-fund

id campus-api >/dev/null 2>&1 ||
  useradd --system --home /opt/campus-api --shell /usr/sbin/nologin campus-api

install -d -o campus-api -g campus-api -m 0750 /www/campus-data/uploads
if [[ -f /www/campus-data/portfolio-content.json ]]; then
  chown campus-api:campus-api /www/campus-data/portfolio-content.json
fi

chgrp campus-api "${release_root}"
chmod 750 "${release_root}"
chmod -R go-w "${release_dir}"
ln -sfn "${release_dir}" "${current_link}"

install -o root -g root -m 0644 \
  "${release_dir}/server/deploy/campus-api.service" \
  /etc/systemd/system/campus-api.service
install -o root -g root -m 0755 \
  "${release_dir}/server/scripts/deploy-server.sh" \
  /usr/local/sbin/campus-api-deploy
install -o root -g root -m 0755 \
  "${release_dir}/server/scripts/backup-server.sh" \
  /usr/local/sbin/campus-api-backup
install -o root -g root -m 0755 \
  "${release_dir}/server/scripts/server-status.sh" \
  /usr/local/sbin/campus-api-status
install -o root -g root -m 0755 \
  "${release_dir}/server/scripts/configure-server.sh" \
  /usr/local/sbin/campus-api-configure
printf '%s\n' \
  '17 3 * * * root /usr/local/sbin/campus-api-backup >>/var/log/campus-api-backup.log 2>&1' \
  >/etc/cron.d/campus-api-backup
chmod 0644 /etc/cron.d/campus-api-backup

systemctl daemon-reload
systemctl enable campus-api.service >/dev/null
systemctl restart campus-api.service

for attempt in {1..15}; do
  if curl -fsS http://127.0.0.1:3100/health >/dev/null; then
    echo "部署成功：${release_id}"
    curl -fsS http://127.0.0.1:3100/health
    exit 0
  fi
  sleep 1
done

echo "新版本健康检查失败，正在回退" >&2
if [[ -n "${previous_release}" ]] && [[ -d "${previous_release}" ]]; then
  ln -sfn "${previous_release}" "${current_link}"
  systemctl restart campus-api.service
fi
exit 1
