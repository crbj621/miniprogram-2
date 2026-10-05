"""Integrate published gift domains into the existing wildcard Nginx host."""
import datetime
import re
import shutil
import subprocess
from pathlib import Path

vhost = Path('/www/server/panel/vhost/nginx/wildcard.crbuj.icu.conf')
env = Path('/etc/campus-api/app.env')
nginx = '/www/server/nginx/sbin/nginx'
configuration = subprocess.run([nginx, '-T'], capture_output=True, text=True, check=True)
if str(vhost) not in configuration.stdout:
    raise RuntimeError('The active Nginx does not load this wildcard host')
original_host, original_env = vhost.read_text(), env.read_text()
backup = Path('/www/backup/campus-api') / ('gift-routing-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir()
shutil.copy2(vhost, backup / vhost.name)
shutil.copy2(env, backup / 'app.env')
host = original_host
if '# Campus gift domain routing' not in host:
    anchor = '    location / { try_files $uri $uri/ /index.html =404; }'
    if anchor not in host:
        raise RuntimeError('Wildcard host changed; review its root location before integration')
    routes = '''    # Campus gift domain routing; existing site directories retain priority.
    location = / { try_files /index.html @campus_gift; }
    location @campus_gift {
        rewrite ^ /gift-domain break;
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store" always;
    }
    location ^~ /gift-assets/ {
        proxy_pass http://127.0.0.1:3100/gift-assets/;
        proxy_set_header Host $host;
    }
    location ^~ /api/gifts/ {
        proxy_pass http://127.0.0.1:3100/api/gifts/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store" always;
    }
'''
    host = host.replace(anchor, routes + anchor)
configured_env = original_env
for key, value in {'GIFT_DOMAIN': 'crbuj.icu', 'GIFT_EXISTING_SITES_ROOT': '/www/wwwroot/sites'}.items():
    line = key + '=' + value
    if re.search(r'^' + key + r'=.*$', configured_env, re.MULTILINE):
        configured_env = re.sub(r'^' + key + r'=.*$', line, configured_env, flags=re.MULTILINE)
    else:
        configured_env = configured_env.rstrip() + '\n' + line + '\n'
try:
    vhost.write_text(host)
    env.write_text(configured_env)
    subprocess.run([nginx, '-t'], check=True)
    subprocess.run([nginx, '-s', 'reload'], check=True)
except Exception:
    vhost.write_text(original_host)
    env.write_text(original_env)
    raise
print('Gift routing configured; backup=' + str(backup))
