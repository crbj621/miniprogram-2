#!/usr/bin/env bash
set -Eeuo pipefail

backup_root="/www/backup/campus-api"
stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="${backup_root}/${stamp}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行备份脚本" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source /etc/campus-api/app.env
set +a

mkdir -p "${backup_dir}"
chmod 700 "${backup_root}" "${backup_dir}"

dump_command="$(command -v mariadb-dump || command -v mysqldump)"
MYSQL_PWD="${DB_PASSWORD}" "${dump_command}" \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --single-transaction \
  --quick \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  "${DB_NAME}" >"${backup_dir}/database.sql"

tar -czf "${backup_dir}/uploads.tar.gz" -C /www/campus-data uploads
install -m 0600 /etc/campus-api/app.env "${backup_dir}/app.env"
if [[ -f "${PORTFOLIO_CONTENT_FILE:-/www/campus-data/portfolio-content.json}" ]]; then
  install -m 0600 "${PORTFOLIO_CONTENT_FILE:-/www/campus-data/portfolio-content.json}" "${backup_dir}/portfolio-content.json"
fi
(cd "${backup_dir}" && sha256sum database.sql uploads.tar.gz app.env >SHA256SUMS
  if [[ -f portfolio-content.json ]]; then sha256sum portfolio-content.json >>SHA256SUMS; fi)

echo "备份完成：${backup_dir}"
