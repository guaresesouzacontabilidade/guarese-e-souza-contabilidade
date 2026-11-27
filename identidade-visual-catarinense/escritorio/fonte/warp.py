import os, json
from cyl import wrap
os.makedirs("bodies", exist_ok=True)
G = {}
def go(name, *a, **k):
    img, g = wrap(*a, **k); img.save(f"bodies/{name}.png"); G[name] = {**g, "w": img.width, "h": img.height}
# mug: art 200x95 mm, r = 41 mm, logo at 150 mm faces the camera
go("caneca", "print/caneca.png", 200, 41, 7.4, 150, (255, 255, 255), ell=0.17, finish="gloss", spec=0.4)
go("caneca-p", "print/caneca.png", 200, 41, 5.2, 150, (255, 255, 255), ell=0.17, finish="gloss", spec=0.4)
for n, fill in [("garrafa-verde", (7, 67, 31)), ("garrafa-branca", (247, 246, 242))]:
    go(n, f"tex/{n}.png", 120, 36, 4.4, 60, fill, ell=0.15, finish="matte", spec=0.5)
json.dump(G, open("bodies/geom.json", "w"), indent=1)
print(json.dumps(G))
