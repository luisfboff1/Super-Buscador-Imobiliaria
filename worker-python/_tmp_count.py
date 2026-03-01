import os, psycopg2
c = psycopg2.connect(os.environ['DATABASE_URL'])
cur = c.cursor()
cur.execute("SELECT COUNT(*) FROM imoveis WHERE fonte_id = 'd3c4659b-ac75-4bb5-9a0d-c095402d79ad'")
print('Perini imoveis:', cur.fetchone()[0])
