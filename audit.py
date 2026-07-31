import re

with open("index.html") as f:
    html = f.read()

with open("app.js") as f:
    js = f.read()

print("--- Onclick handlers in index.html ---")
onclicks = re.findall(r'onclick="([^"]+)"', html)
for o in set(onclicks):
    print(" ", o)

print("\n--- Checking Element IDs in app.js vs index.html ---")
get_ids = set(re.findall(r'document\.getElementById\(["\']([^"\']+)["\']\)', js))
html_ids = set(re.findall(r'id=["\']([^"\']+)["\']', html))

missing = get_ids - html_ids
print("Missing IDs count:", len(missing))
for m in sorted(missing):
    print("  Missing ID in HTML:", m)
