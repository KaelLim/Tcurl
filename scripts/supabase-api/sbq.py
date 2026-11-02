"""Run SQL on Supabase Cloud via Management API. Usage: python3 -I sbq.py 'SQL' | python3 -I sbq.py -f file.sql"""
import json, os, sys, urllib.request
REF = os.environ.get('SB_REF', 'fsneeigsjdryxutmdrmg')
def token():
    for l in open(os.path.expanduser('~/.config/tcurl/supabase.env')):
        if l.startswith('SUPABASE_ACCESS_TOKEN='): return l.split('=', 1)[1].strip()
def query(sql, read_only=False):
    body = {'query': sql}
    if read_only: body['read_only'] = True
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps(body).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json', 'User-Agent': 'tcurl-setup/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read()[:8000].decode(errors="replace")}')
if __name__ == '__main__':
    sql = open(sys.argv[2]).read() if sys.argv[1] == '-f' else sys.argv[1]
    print(json.dumps(query(sql), ensure_ascii=False, indent=1, default=str))
