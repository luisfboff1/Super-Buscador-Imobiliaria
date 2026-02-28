"""
Reset coimca e qualquer fonte em status 'crawling' de volta para 'idle'.
"""
import psycopg2, os

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("UPDATE fontes SET status = 'idle' WHERE status = 'crawling'")
print(f"Resetadas {cur.rowcount} fonte(s) de crawling → idle")
conn.commit()
conn.close()
