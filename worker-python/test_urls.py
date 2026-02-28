"""Test is_detail_page_url with real URLs."""
from app.crawler import is_detail_page_url

base_ant = "www.antonellaimoveis.com.br"
base_att = "www.attualeimoveis.com.br"

tests = [
    # Antonella detail (should be TRUE)
    ("https://www.antonellaimoveis.com.br/imoveis/venda/caxias-do-sul/interlagos/-/casa/7762/imovel/2439717", base_ant, True),
    ("https://www.antonellaimoveis.com.br/imoveis/venda/caxias-do-sul/exposicao/-/apartamento/5733/imovel/945807", base_ant, True),
    # Antonella filter/listing (should be FALSE)
    ("https://www.antonellaimoveis.com.br/imoveis/venda/-/-/-/-", base_ant, False),
    ("https://www.antonellaimoveis.com.br/imoveis/venda/-/-/-/apartamento", base_ant, False),
    ("https://www.antonellaimoveis.com.br/imoveis/venda/caxias-do-sul/-/-/-", base_ant, False),
    ("https://www.antonellaimoveis.com.br/imoveis/venda/-/-/-/-?promocao=1", base_ant, False),
    # Attuale detail (should be TRUE)
    ("https://www.attualeimoveis.com.br/imovel/1294279/edificio-da-vinci", base_att, True),
    ("https://www.attualeimoveis.com.br/imovel/1296599/residenziale-portovenere", base_att, True),
    # Attuale listing (should be FALSE)
    ("https://www.attualeimoveis.com.br/imoveis?operacao=venda&page=2", base_att, False),
    ("https://www.attualeimoveis.com.br/imoveis", base_att, False),
]

all_pass = True
for url, base, expected in tests:
    result = is_detail_page_url(url, base)
    status = "OK" if result == expected else "FAIL"
    if result != expected:
        all_pass = False
    short = url.split(".br")[1][:65]
    label = "DETAIL" if result else "SKIP"
    print(f"  {status}  {label:6s}  {short}")

print()
print("ALL TESTS PASSED" if all_pass else "SOME TESTS FAILED!")
