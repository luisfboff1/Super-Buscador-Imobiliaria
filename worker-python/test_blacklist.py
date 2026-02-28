import unicodedata

vals = ['Início', 'inicio', 'Bairro', 'bairro']
bl = {'início', 'inicio', 'bairro', 'cidade'}

for v in vals:
    lo = v.lower()
    nfc = unicodedata.normalize('NFC', lo)
    print(f"{repr(v):30} lower={repr(lo):20} in_bl={lo in bl}")
    print(f"  bytes: {lo.encode('utf-8')}")

print()
for w in sorted(bl):
    print(f"  frozenset key: {repr(w)} bytes={w.encode('utf-8')}")
