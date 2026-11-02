"""Import the COPY-format extract files into Supabase Cloud through the Management API
(/v1/projects/{ref}/database/query) — no psql / DB password needed.

Usage:
  python3 -I import_via_api.py --dry-run          # parse + count check only, no network
  python3 -I import_via_api.py --run              # precheck (targets empty) -> import -> post steps
Prints only counts / table names, never row values.
"""
import os, re, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sbq

EXTRACT = os.path.expanduser('~/Desktop/projects/urlpj/supabase-2026-11-02/extract')
BATCH_BYTES = 900_000
CHECK_NAME = 'urls_original_url_http_check'
CHECK_EXPR = "original_url ~* '^https?://'"
COPY_RE = re.compile(r'^COPY ([\w.]+) \((.*)\) FROM stdin;$')
ESC = {'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v', '\\': '\\'}


def unescape(field):
    """PostgreSQL COPY text-format field -> python str (or None for \\N)."""
    if field == '\\N':
        return None
    if '\\' not in field:
        return field
    out, i, n = [], 0, len(field)
    while i < n:
        c = field[i]
        if c != '\\' or i + 1 >= n:
            out.append(c); i += 1; continue
        d = field[i + 1]
        if d in ESC:
            out.append(ESC[d]); i += 2
        elif d in '01234567':
            j = i + 1
            while j < n and j < i + 4 and field[j] in '01234567':
                j += 1
            out.append(chr(int(field[i + 1:j], 8))); i = j
        elif d == 'x' and i + 2 < n and field[i + 2] in '0123456789abcdefABCDEF':
            j = i + 2
            while j < n and j < i + 4 and field[j] in '0123456789abcdefABCDEF':
                j += 1
            out.append(chr(int(field[i + 2:j], 16))); i = j
        else:
            out.append(d); i += 2
    return ''.join(out)


def literal(v):
    if v is None:
        return 'NULL'
    if '\x00' in v:
        raise ValueError('NUL byte in field')
    return "'" + v.replace("'", "''") + "'"


def parse(path):
    table, cols, rows = None, None, []
    with open(path, encoding='utf-8', newline='\n') as f:
        for line in f:
            line = line.rstrip('\n')
            if table is None:
                m = COPY_RE.match(line)
                if m:
                    table, cols = m.group(1), m.group(2)
                continue
            if line == '\\.':
                break
            fields = line.split('\t')
            if len(fields) != len(cols.split(',')):
                raise ValueError(f'{path}: column count mismatch at row {len(rows) + 1}')
            rows.append('(' + ','.join(literal(unescape(x)) for x in fields) + ')')
    if table is None:
        raise ValueError(f'{path}: no COPY header')
    return table, cols, rows


def manifest():
    lines = open(os.path.join(EXTRACT, 'MANIFEST.tsv'), encoding='utf-8').read().splitlines()[1:]
    return [dict(zip(['order', 'file', 'table', 'rows', 'columns'], l.split('\t'))) for l in lines if l.strip()]


def batches(table, cols, rows):
    head = f'SET session_replication_role = replica;\nINSERT INTO {table} ({cols}) VALUES\n'
    cur, size = [], 0
    for r in rows:
        if cur and size + len(r) > BATCH_BYTES:
            yield head + ',\n'.join(cur) + ';', len(cur)
            cur, size = [], 0
        cur.append(r); size += len(r) + 2
    if cur:
        yield head + ',\n'.join(cur) + ';', len(cur)


def count(table):
    return sbq.query(f'select count(*)::bigint n from {table}')[0]['n']


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--dry-run'
    items = manifest()
    parsed = []
    for it in items:
        table, cols, rows = parse(os.path.join(EXTRACT, it['file']))
        assert table == it['table'], (table, it['table'])
        assert len(rows) == int(it['rows']), (table, len(rows), it['rows'])
        nb = sum(1 for _ in batches(table, cols, rows))
        print(f'parsed {table}: {len(rows)} rows, {nb} batch(es)')
        parsed.append((table, cols, rows))
    if mode == '--dry-run':
        print('dry-run OK'); return

    # precheck: every target exists and is empty
    for table, _, _ in parsed:
        n = count(table)
        if n != 0:
            sys.exit(f'ABORT: {table} already has {n} rows (import expects empty targets)')
    print('precheck OK: all targets empty')

    # [FIX-1] CHECK is NOT VALID but still checked on INSERT; one legacy non-http(s) row must be kept.
    sbq.query(f'ALTER TABLE public.urls DROP CONSTRAINT {CHECK_NAME}')
    print('temporarily dropped', CHECK_NAME)

    for table, cols, rows in parsed:
        done = 0
        for sql, k in batches(table, cols, rows):
            try:
                sbq.query(sql)
            except Exception as e:
                sys.exit(f'FAILED on {table} after {done} rows: {e}\n'
                         f'NOTE: {CHECK_NAME} is currently dropped; re-add after cleanup.')
            done += k
        print(f'imported {table}: {done}')

    sbq.query(f"ALTER TABLE public.urls ADD CONSTRAINT {CHECK_NAME} CHECK ({CHECK_EXPR}) NOT VALID")
    print('re-added', CHECK_NAME, 'NOT VALID')

    # post: reset sequences owned by imported tables' columns
    sbq.query("""
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT ns.nspname sch, s.relname seq, t.relname tbl, a.attname col
    FROM pg_class s
    JOIN pg_namespace ns ON ns.oid = s.relnamespace
    JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid
                     AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a','i')
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S' AND ns.nspname = 'public'
  LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I.%I), 0) + 1, false)',
                   r.sch || '.' || r.seq, r.col, r.sch, r.tbl);
  END LOOP;
END $$;""")
    print('sequences reset')
    mvs = sbq.query("select schemaname||'.'||matviewname mv from pg_matviews where schemaname='public'")
    for m in mvs:
        sbq.query(f"REFRESH MATERIALIZED VIEW {m['mv']}")
        print('refreshed', m['mv'])
    ok = True
    for (table, _, rows) in parsed:
        n = count(table)
        flag = 'OK' if n == len(rows) else 'MISMATCH'
        ok &= n == len(rows)
        print(f'verify {table}: expected {len(rows)} actual {n} {flag}')
    sbq.query('ANALYZE')
    print('ALL OK' if ok else 'COUNT MISMATCH — investigate before cutover')


if __name__ == '__main__':
    main()
