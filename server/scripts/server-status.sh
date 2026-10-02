#!/usr/bin/env bash
set -u

echo "校园小程序服务器状态"
echo
systemctl is-active campus-api.service |
  sed 's/^active$/API 服务：正常/; s/^inactive$/API 服务：已停止/; s/^failed$/API 服务：故障/'

if curl -fsS http://127.0.0.1:3100/health; then
  echo
else
  echo "API 健康检查失败"
fi

echo
echo "磁盘使用："
df -h / /www/campus-data | awk 'NR == 1 || !seen[$6]++'

echo
echo "最近一次备份："
find /www/backup/campus-api -mindepth 1 -maxdepth 1 -type d 2>/dev/null |
  sort |
  tail -n 1
