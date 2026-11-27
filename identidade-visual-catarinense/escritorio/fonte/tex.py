"""Textures for the thermal bottles (front 120 mm of the circumference x 230 mm @5px/mm)."""
import os, json
from itens import page, logo_color, tricolor, SITE
OUT = os.path.dirname(os.path.abspath(__file__))


def logo_white(left, top, width):
    return (f'<div class="logo" style="left:{left}px;top:{top}px;width:{width}px">'
            f'<img src="../assets/mark_filled.png"><div class="word" style="background:#fff"></div>'
            f'<div class="tag" style="background:#fff"></div></div>')


T = {}
T["garrafa-verde"] = page(600, 1150, f"""
<div class="full" style="background:#07431f"></div><div class="felt" style="opacity:.3"></div>
{logo_white(160, 400, 280)}
<div class="abs" style="left:0;right:0;top:590px;text-align:center;font-size:11px;font-weight:600;letter-spacing:2px;color:#fff">{SITE.upper()}</div>
<div class="abs" style="left:0;right:0;top:1040px;height:8px;background:#fff"></div>
<div class="abs" style="left:0;right:0;top:1048px;height:12px;background:#8e0f16"></div>
""")
T["garrafa-branca"] = page(600, 1150, f"""
<div class="full" style="background:#f7f6f2"></div><div class="felt" style="opacity:.2"></div>
{logo_color(160, 400, 280)}
<div class="abs" style="left:0;right:0;top:590px;text-align:center;font-size:11px;font-weight:600;letter-spacing:2px;color:#07431f">{SITE.upper()}</div>
{tricolor(1034, 14, 4, 14)}
""")
for n, h in T.items():
    open(os.path.join(OUT, f"t_{n}.html"), "w").write(h)
json.dump([{"html": f"t_{n}.html", "out": f"tex/{n}.png", "dsf": 2, "w": 600, "h": 1150} for n in T], open("jobs_tex.json", "w"))
print(list(T))
