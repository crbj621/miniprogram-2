"""Add the campus API path while preserving the existing website configuration."""
from datetime import datetime
from pathlib import Path
import shutil
import subprocess

config = Path('/www/server/panel/vhost/nginx/crbuj.icu.conf')
source = config.read_text()
if 'location ^~ /campus-api/' in source:
    raise SystemExit('Campus API path already configured')
marker = '    location / {'
if source.count(marker) != 1:
    raise SystemExit('Unexpected website configuration; inspect before editing')
backup_dir = Path('/www/backup/campus-api')
backup_dir.mkdir(parents=True, exist_ok=True)
backup = backup_dir / ('nginx-before-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.conf')
shutil.copy2(config, backup)
route = '''    location ^~ /campus-api/ {
        proxy_pass http://127.0.0.1:3100/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 11m;
    }

'''
nginx = '/www/server/nginx/sbin/nginx'
try:
    config.write_text(source.replace(marker, route + marker, 1))
    subprocess.run([nginx, '-t'], check=True)
    subprocess.run([nginx, '-s', 'reload'], check=True)
except Exception:
    shutil.copy2(backup, config)
    subprocess.run([nginx, '-s', 'reload'], check=True)
    raise
print('Campus API path configured; backup=' + str(backup))
