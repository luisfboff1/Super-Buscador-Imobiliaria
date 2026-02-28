"""List all fontes with their URLs and status."""
import os
import psycopg2

conn = psycopg2.connect(os.environ["DATABASE_URL"], sslmode="require")
cur = conn.cursor()

cur.execute("SELECT id, nome, url, status FROM fontes ORDER BY nome")
rows = cur.fetchall()

print(f"\n{'='*80}")
print(f"{'FONTES':^80}")
print(f"{'='*80}")
for r in rows:
    fid, nome, url, status = r
    print(f"\n  {nome}")
    print(f"  ID:     {fid}")
    print(f"  URL:    {url}")
    print(f"  Status: {status}")
print(f"\n{'='*80}")
print(f"Total: {len(rows)} fontes")

conn.close()
