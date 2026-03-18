"""
Testa a análise LLM de um site imobiliário — roda localmente com doppler.
Uso: doppler run -- python scripts/test_llm_site_analysis.py https://www.imobiliariaconnect.com.br/
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "worker-python"))

from app.crawler import _llm_analyze_site, fetch_page, safe_html

def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.imobiliariaconnect.com.br/"
    print(f"Testando: {url}")
    
    print("1. Buscando homepage com Playwright...")
    page = fetch_page(url, stealth=True)
    if not page:
        print("ERRO: Não consegui buscar a homepage")
        return
    
    html = safe_html(page)
    print(f"   HTML: {len(html)} chars")
    
    print("2. Chamando LLM para analisar...")
    result = _llm_analyze_site(html, url, on_progress=lambda msg: print(f"   {msg}"))
    
    print(f"\n3. Resultado:")
    if result:
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("   LLM retornou None — sem resultado")

if __name__ == "__main__":
    main()
