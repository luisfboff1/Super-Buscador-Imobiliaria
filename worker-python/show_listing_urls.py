"""
Script to find listing URLs for all fontes.
Fetches each site to discover /imoveis-venda, /imoveis-locacao URL patterns.
"""
import asyncio, json, time, sys
sys.path.insert(0, '.')

async def main():
    from app.db import get_db
    db = get_db()
    fontes = db.table('fontes').select('id,nome,url,config').execute()
    
    print("=" * 80)
    print("FONTES CONFIG - LISTING URLS")
    print("=" * 80)
    
    for f in fontes.data:
        cfg = f.get('config') or {}
        listing_urls = cfg.get('listing_urls', cfg.get('listingUrls', []))
        print(f"\nNome: {f['nome']}")
        print(f"Base: {f['url']}")
        print(f"Listing URLs: {json.dumps(listing_urls, indent=2, ensure_ascii=False)}")

asyncio.run(main())
