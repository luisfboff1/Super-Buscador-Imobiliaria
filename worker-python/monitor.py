"""Quick crawl monitor — polls /health and /status every 15s."""
import requests, time, json, sys

H = {"Authorization": "Bearer meu-segredo-super-secreto-2026"}
BASE = "http://localhost:3001"

for i in range(60):  # up to 15 min
    time.sleep(15)
    try:
        health = requests.get(f"{BASE}/health", headers=H, timeout=5).json()
        active = health.get("active_crawls", 0)
        if active == 0:
            status = requests.get(f"{BASE}/status", headers=H, timeout=5).json()
            hist = status.get("history", [])
            if hist:
                last = hist[-1]
                print(f"\n=== CRAWL CONCLUÍDO ===")
                print(json.dumps(last, indent=2, ensure_ascii=False))
            else:
                print("Done — no history entry")
            sys.exit(0)
        else:
            status = requests.get(f"{BASE}/status", headers=H, timeout=5).json()
            for fid, info in status.get("active", {}).items():
                msg = info.get("last_message", "?")
                elapsed = i * 15
                print(f"  [{elapsed}s] {msg[:120]}", flush=True)
    except Exception as e:
        print(f"  [{i*15}s] WORKER DOWN: {e}")
        sys.exit(1)

print("TIMEOUT after 15 min")
