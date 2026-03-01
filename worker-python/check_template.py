"""Ver progresso do crawl coimca"""
import json
import sys
sys.path.insert(0, '.')

from app.db import get_conn

FONTE_ID = '28c615c0-02b9-477a-8f8e-62b520b8d0c5'

conn = get_conn()
cur = conn.cursor()
cur.execute("SELECT status, crawl_progress FROM fontes WHERE id = %s", (FONTE_ID,))
row = cur.fetchone()
status, prog = row
print("Status:", status)
if prog:
    print(f"Progresso: {prog.get('done')}/{prog.get('total')} - {prog.get('pct')}%")
    print("Fase:", prog.get('fase'))
    print("Elapsed:", prog.get('elapsed'))
    print("Ultimos logs:")
    for l in prog.get('logs', [])[-5:]:
        print(" ", l)
cur.close()
