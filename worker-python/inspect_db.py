import psycopg2, os

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='fontes' ORDER BY ordinal_position")
print("FONTES COLS:", [(r[0], r[1]) for r in cur.fetchall()])

cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='imoveis' ORDER BY ordinal_position")
print("IMOVEIS COLS:", [(r[0], r[1]) for r in cur.fetchall()])

# Sample a few fontes to see crawl timing fields
cur.execute("SELECT id, nome, status, last_crawl, crawl_progress FROM fontes ORDER BY nome")
rows = cur.fetchall()
for r in rows:
    print(f"  {r[1][:30]:30s} status={r[2]:10s} last_crawl={r[3]} progress={r[4]}")

conn.close()
