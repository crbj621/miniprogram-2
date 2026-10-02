"""Read AppSecret from standard input and update the protected server environment."""
from datetime import datetime
from pathlib import Path
import re
import shutil
import sys

secret = sys.stdin.read().strip()
if not re.fullmatch(r'[A-Za-z0-9_-]{20,64}', secret):
    raise SystemExit('Invalid AppSecret format')
env_file = Path('/etc/campus-api/app.env')
source = env_file.read_text()
if not re.search(r'^WECHAT_APP_SECRET=', source, flags=re.M):
    raise SystemExit('AppSecret configuration entry missing')
shutil.copy2(env_file, str(env_file) + '.before-secret-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
env_file.write_text(re.sub(r'^WECHAT_APP_SECRET=.*$', 'WECHAT_APP_SECRET=' + secret, source, flags=re.M))
env_file.chmod(0o600)
print('WECHAT_SECRET_CONFIGURED')
