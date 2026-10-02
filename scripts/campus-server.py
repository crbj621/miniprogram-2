"""Execute a command through the saved campus-server SSH connection."""
import argparse
import json
from pathlib import Path
import sys
import paramiko

parser = argparse.ArgumentParser()
parser.add_argument('command')
parser.add_argument('--timeout', type=int, default=60)
args = parser.parse_args()
ssh_dir = Path.home() / '.ssh'
maintenance_dir = Path(__file__).resolve().parent.parent / 'maintenance' / '账号与连接'
local_config = maintenance_dir / 'ssh.json'
if local_config.exists():
    saved = json.loads(local_config.read_text(encoding='utf-8'))
    config = {
        'hostname': saved['hostname'], 'user': saved['user'], 'port': saved['port'],
        'identityfile': [str(maintenance_dir / saved['identityFile'])],
    }
    known_hosts = maintenance_dir / saved['knownHosts']
else:
    config = paramiko.SSHConfig.from_path(str(ssh_dir / 'config')).lookup('campus-server')
    known_hosts = ssh_dir / 'known_hosts'
client = paramiko.SSHClient()
client.load_host_keys(str(known_hosts))
try:
    client.connect(
        config['hostname'], port=int(config.get('port', 22)),
        username=config['user'], key_filename=config['identityfile'][0],
        timeout=15, banner_timeout=30, auth_timeout=30,
        look_for_keys=False, allow_agent=False,
    )
    _, output, errors = client.exec_command(args.command, timeout=args.timeout)
    print(output.read().decode('utf-8', errors='replace'), end='')
    print(errors.read().decode('utf-8', errors='replace'), end='', file=sys.stderr)
    sys.exit(output.channel.recv_exit_status())
finally:
    client.close()
