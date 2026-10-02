"""Initialize a new campus database and secret configuration without printing secrets."""
from pathlib import Path
import os
import secrets
import subprocess

env_file = Path('/etc/campus-api/app.env')
if env_file.exists():
    raise SystemExit('Existing configuration preserved; initialization skipped')

existing = subprocess.check_output([
    'mysql', '--batch', '--skip-column-names', '-e',
    "SELECT COUNT(*) FROM mysql.user WHERE User='campus_app';"
], text=True).strip()
if existing != '0':
    raise SystemExit('Existing campus_app database user found; do not overwrite')

password = secrets.token_hex(32)
sql = (
    'CREATE DATABASE IF NOT EXISTS campus_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
    f"CREATE USER 'campus_app'@'127.0.0.1' IDENTIFIED BY '{password}';"
    "GRANT ALL PRIVILEGES ON campus_app.* TO 'campus_app'@'127.0.0.1';"
)
subprocess.run(['mysql'], input=sql, text=True, check=True, stdout=subprocess.DEVNULL)
env_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
config = {
    'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': '3100',
    'DB_HOST': '127.0.0.1', 'DB_PORT': '3306', 'DB_NAME': 'campus_app',
    'DB_USER': 'campus_app', 'DB_PASSWORD': password,
    'JWT_SECRET': secrets.token_hex(48),
    'WECHAT_APP_ID': 'wxc7ccced9847cc3ae', 'WECHAT_APP_SECRET': '',
    'PUBLIC_BASE_URL': 'https://www.crbuj.icu/campus-api',
    'UPLOAD_DIR': '/www/campus-data/uploads', 'MAX_UPLOAD_MB': '10',
    'SERVICES_DIR': '/opt/campus-api/current/server/services',
    'PORTFOLIO_CONTENT_FILE': '/www/campus-data/portfolio-content.json',
}
fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write(''.join(f'{key}={value}\n' for key, value in config.items()))
Path(config['UPLOAD_DIR']).mkdir(parents=True, exist_ok=True)
portfolio = Path(config['PORTFOLIO_CONTENT_FILE'])
if not portfolio.exists():
    portfolio.write_text('{}\n')
print('Database and secret configuration initialized; AppSecret still required')
