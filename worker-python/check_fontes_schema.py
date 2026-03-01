import sys
sys.path.insert(0, '.')
from app.db import cursor as db_cursor

with db_cursor() as cur:
    cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='fontes' ORDER BY ordinal_position")
    for r in cur.fetchall():
        print(r['column_name'], '-', r['data_type'])
