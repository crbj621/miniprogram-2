"""Wire the installed Mihomo subscription to native HTTP updates and 0.1x URLTest groups.

Run on the server as root. Original routing/DNS remain unchanged; no scheduler is added.
"""
import copy
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.parse import quote, urlsplit
import urllib.request
import yaml

HOME = Path('/etc/mihomo')
CONFIG = HOME / 'config.yaml'
PROVIDER = 'campus-subscription'
PAYLOAD = HOME / 'proxy_providers' / (PROVIDER + '.yaml')
PROBE = 'https://www.gstatic.com/generate_204'
LOW_RATE = r'0[.]1\s*倍'
REGIONS = {'🇯🇵日本节点': r'日本|🇯🇵|Japan', '🇸🇬狮城节点': r'新加坡|狮城|🇸🇬|Singapore', '🇺🇸美国节点': r'美国|🇺🇸|USA'}


def wire_config(original, url, nodes):
    config = copy.deepcopy(original)
    if config.get('mode') != 'rule' or config.get('tun', {}).get('enable'):
        raise ValueError('Expected the existing rule mode with TUN disabled')
    if set(config.get('proxy-providers', {})) - {PROVIDER}:
        raise ValueError('Unexpected providers; inspect before replacing them')
    config['proxy-providers'] = {PROVIDER: {
        'type': 'http', 'url': url, 'path': './proxy_providers/' + PROVIDER + '.yaml',
        'interval': 21600, 'proxy': 'DIRECT', 'size-limit': 8388608,
        'header': {'User-Agent': ['mihomo/1.19.32']},
        'exclude-filter': '剩余流量|距离下次|套餐到期',
        'health-check': {'enable': True, 'url': PROBE, 'interval': 300, 'timeout': 5000, 'lazy': True, 'expected-status': 204}
    }}
    names = {node['name'] for node in nodes}
    for group in config['proxy-groups']:
        references = group.get('proxies', [])
        if not any(name in names for name in references) and PROVIDER not in group.get('use', []):
            continue
        group['proxies'] = [name for name in references if name not in names]
        group['use'] = [PROVIDER]
        if group['type'] == 'url-test':
            region = REGIONS.get(group['name'])
            pattern = '(?i)(' + region + ').*' + LOW_RATE + '|' + LOW_RATE + '.*(' + region + ')' if region else LOW_RATE
            if not any(re.search(pattern, name) for name in names):
                raise ValueError('No 0.1x node matches ' + group['name'])
            group.update({'filter': pattern, 'url': PROBE, 'interval': 300, 'timeout': 5000})
    config['proxies'] = []
    config.setdefault('profile', {})['store-selected'] = True
    return config


def main():
    original = yaml.safe_load(CONFIG.read_text())
    url = (HOME / 'subscription-url.txt').read_text().strip()
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname:
        raise ValueError('Subscription URL must be HTTPS')
    nodes = original.get('proxies') or yaml.safe_load(PAYLOAD.read_text())['proxies']
    config = wire_config(original, url, nodes)
    backup = HOME / ('backup-subscription-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir()
    for file in [CONFIG, HOME / 'cache.db', PAYLOAD]:
        if file.exists():
            shutil.copy2(file, backup / file.name)
    PAYLOAD.parent.mkdir(exist_ok=True)
    candidate = HOME / 'config-subscription-candidate.yaml'
    candidate.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False))
    try:
        subprocess.run(['/usr/local/bin/mihomo', '-t', '-d', str(HOME), '-f', str(candidate)], check=True, capture_output=True)
        if not PAYLOAD.exists():
            PAYLOAD.write_text(yaml.safe_dump({'proxies': nodes}, allow_unicode=True, sort_keys=False))
        os.replace(candidate, CONFIG)
        subprocess.run(['systemctl', 'restart', 'mihomo'], check=True)
        def controller(path, method='GET', data=None):
            request = urllib.request.Request('http://127.0.0.1:9090' + path, method=method,
                data=json.dumps(data).encode() if data is not None else None,
                headers={'Authorization': 'Bearer ' + config.get('secret', ''), 'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=35) as response:
                body = response.read()
                return json.loads(body) if body else None
        for attempt in range(20):
            try:
                live = controller('/proxies')['proxies']
                break
            except OSError:
                if attempt == 19:
                    raise
                time.sleep(.5)
        for name, selection in {'🚀节点选择': '🇺🇸美国节点', '🎬媒体解锁': '🚀节点选择'}.items():
            if selection not in live[name]['all']:
                raise ValueError('Automatic selector is missing')
            controller('/proxies/' + quote(name, safe=''), 'PUT', {'name': selection})
        controller('/providers/proxies/' + PROVIDER, 'PUT')
        provider = controller('/providers/proxies/' + PROVIDER)
        if provider.get('vehicleType') != 'HTTP' or not provider.get('proxies'):
            raise ValueError('Native HTTP provider was not refreshed')
        active = yaml.safe_load(CONFIG.read_text())
        unchanged = all(active.get(key) == original.get(key) for key in ['rules', 'dns', 'mode', 'tun', 'mixed-port', 'external-controller', 'bind-address', 'allow-lan'])
        if not unchanged:
            raise ValueError('Routing, DNS or binding changed unexpectedly')
        print(json.dumps({'backup': str(backup), 'provider': PROVIDER, 'vehicleType': provider['vehicleType'], 'updatedAt': provider.get('updatedAt'), 'nodeCount': len(provider['proxies']), 'subscriptionIntervalSeconds': 21600, 'routingAndDnsUnchanged': unchanged, 'ruleCount': len(active['rules'])}, ensure_ascii=False))
    except Exception as error:
        shutil.copy2(backup / 'config.yaml', CONFIG)
        for file in [HOME / 'cache.db', PAYLOAD]:
            if (backup / file.name).exists():
                shutil.copy2(backup / file.name, file)
        subprocess.run(['systemctl', 'restart', 'mihomo'], check=False)
        reason = (error.stderr or error.stdout).decode(errors='replace') if isinstance(error, subprocess.CalledProcessError) else str(error)
        raise RuntimeError('Subscription integration failed; original configuration restored: ' + reason.replace(url, '<subscription URL>')) from None


if __name__ == '__main__':
    main()
