import os
key = os.environ.get("OPENAI_API_KEY", "")
if key:
    print(f"OPENAI_API_KEY exists: {key[:8]}...{key[-4:]}")
else:
    print("OPENAI_API_KEY not set")
