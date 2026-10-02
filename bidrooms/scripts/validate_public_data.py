import json, pathlib, sys, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
errors=[]
def load(p):
    try:return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:errors.append(f"{p}: {e}");return {}
m=load(ROOT/"data/manifest.json")
rooms={x.get("id"):x for x in m.get("rooms",[])}
for rid in rooms:
    p=ROOT/"data/rooms"/f"{rid}.json"; d=load(p)
    if d.get("id")!=rid:errors.append(f"{p}: id mismatch")
    for key in ["owner_id","title","status","closes_at","documents","requirements","evidence"]:
        if key not in d:errors.append(f"{p}: missing {key}")
    try: datetime.datetime.fromisoformat(d["closes_at"])
    except Exception: errors.append(f"{p}: invalid closes_at")
for o in m.get("organizations",[]):
    p=ROOT/"data/organizations"/f"{o['id']}.json"
    if p.exists(): load(p)
if errors:
    print("\n".join(errors));sys.exit(1)
print(f"BIDROOMS public data OK: {len(rooms)} room(s), {len(m.get('organizations',[]))} organization(s)")
