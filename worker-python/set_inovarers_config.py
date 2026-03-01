"""Add config column and set Inovarers listing URL."""
import sys, json
sys.path.insert(0, '.')
from app.db import cursor as db_cursor

INOVARERS_ID = 'bcf596fd-2aa7-42fc-b0b0-d38358e205c5'

with db_cursor() as cur:
    # Add config column if not exists
    cur.execute("ALTER TABLE fontes ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'")
    print('Column added (or already existed)')

    # Set Inovarers listing URL
    cfg = {'listing_urls': ['https://www.imobiliariainovarers.com.br/equipe/imobiliaria-inovare-imoveis-']}
    cur.execute('UPDATE fontes SET config = %s WHERE id = %s', (json.dumps(cfg), INOVARERS_ID))
    print('Updated Inovarers config')

    # Verify
    cur.execute('SELECT nome, config FROM fontes WHERE id = %s', (INOVARERS_ID,))
    row = cur.fetchone()
    print('Nome:', row['nome'])
    print('Config:', row['config'])
