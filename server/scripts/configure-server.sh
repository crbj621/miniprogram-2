#!/usr/bin/env bash
set -Eeuo pipefail

env_file="/etc/campus-api/app.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 运行配置脚本" >&2
  exit 1
fi

read -r -p "请输入 API 的 HTTPS 地址（例如 https://www.crbuj.icu/campus-api）：" public_url
if [[ ! "${public_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9_-]+)*$ ]]; then
  echo "地址格式不正确，必须是 HTTPS 域名，可带 API 路径" >&2
  exit 1
fi

read -r -s -p "请输入微信小程序 AppSecret（输入时不会显示）：" app_secret
echo
if [[ ! "${app_secret}" =~ ^[A-Za-z0-9_-]{20,64}$ ]]; then
  echo "AppSecret 格式不正确" >&2
  exit 1
fi

cp -a "${env_file}" "${env_file}.before-configure-$(date +%Y%m%d-%H%M%S)"
sed -i \
  -e "s|^PUBLIC_BASE_URL=.*$|PUBLIC_BASE_URL=${public_url}|" \
  -e "s|^WECHAT_APP_SECRET=.*$|WECHAT_APP_SECRET=${app_secret}|" \
  "${env_file}"
chmod 600 "${env_file}"

unset app_secret
systemctl restart campus-api.service

for attempt in {1..15}; do
  if curl -fsS http://127.0.0.1:3100/health >/dev/null; then
    echo "服务器配置已保存，API 服务正常"
    exit 0
  fi
  sleep 1
done

echo "API 服务启动失败，请运行 campus-api-status 检查" >&2
exit 1
