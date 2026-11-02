"""Apply a migration file via Management API (recorded in migration history). Usage: apply_migration.py <file.sql> <name>"""
import json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sbq
path, name = sys.argv[1], sys.argv[2]
body = json.dumps({'query': open(path, encoding='utf-8').read(), 'name': name}).encode()
req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{sbq.REF}/database/migrations', data=body, method='POST',
    headers={'Authorization': 'Bearer ' + sbq.token(), 'Content-Type': 'application/json', 'User-Agent': 'tcurl-setup/1.0'})
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        print('HTTP', r.status, r.read()[:300].decode(errors='replace'))
except urllib.error.HTTPError as e:
    print('FAILED HTTP', e.code, e.read()[:1500].decode(errors='replace')); sys.exit(1)
