"""HyperTask's fixed Nod access reader. Reads one private self-host .env; prints a version 1 JSON report."""
import json
import os
import re
import stat
import sys

ENV = '/home/agent/HyperTask-Nod/deployment/self-host/.env'
# The private deployment HyperTask's SSH relay expects, with Nod's own usage sharing and feedback off.
EXPECTED = {'PORT': '4311', 'NOD_BIND_ADDRESS': '127.0.0.1', 'NOD_PUBLIC_URL': 'http://127.0.0.1:4311', 'NOD_ANALYTICS_ENABLED': 'false', 'NOD_FEEDBACK_ENABLED': 'false'}
TOKEN = re.compile(r'[A-Za-z0-9_-]{43,512}')


def report(problem, detail=None, token=None):
    value = {'version': 1, 'problem': problem}
    if detail:
        value['detail'] = detail
    if token:
        value['token'] = token
    print(json.dumps(value))
    sys.exit(0)


def main():
    try:
        info = os.lstat(ENV)
    except FileNotFoundError:
        report('setup_required', 'The Nod self-host .env is missing.')
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        report('unsafe_deployment', 'The Nod .env must be a regular file owned by this account with mode 600.')
    values = {}
    with open(ENV, encoding='utf-8') as handle:
        for line in handle:
            key, sep, value = line.rstrip('\r\n').partition('=')
            if sep and not key.startswith('#'):
                values[key.strip()] = value.strip()
    for key, expected in EXPECTED.items():
        if values.get(key) != expected:
            report('unsafe_deployment', f'{key} must be {expected} in the Nod .env.')
    token = values.get('NOD_AUTH_TOKEN', '')
    if not TOKEN.fullmatch(token):
        report('setup_required', 'NOD_AUTH_TOKEN is missing from the Nod .env. Run its setup.sh.')
    report('none', token=token)


if len(sys.argv) != 2 or sys.argv[1] != 'access':
    report('operation_failed', 'Unsupported Nod access action.')
main()
