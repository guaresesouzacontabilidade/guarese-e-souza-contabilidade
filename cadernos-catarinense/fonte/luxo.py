"""Luxury notebook covers (same 770x1080 canvas = A5 + 3 mm bleed)."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))

GOLD_DEFS = """
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#7d5a1e"/><stop offset=".18" stop-color="#d2ad5c"/>
  <stop offset=".34" stop-color="#f6e3a1"/><stop offset=".5" stop-color="#b8893a"/>
  <stop offset=".68" stop-color="#ecd38b"/><stop offset=".85" stop-color="#94702b"/>
  <stop offset="1" stop-color="#dcbb6a"/></linearGradient>
<filter id="stitchShadow" x="-5%" y="-5%" width="110%" height="110%">
  <feDropShadow dx="0" dy="1.2" stdDeviation=".6" flood-color="#000" flood-opacity=".7"/></filter>
"""

CSS = """
.pebble{position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='0.13' numOctaves='3' seed='3' stitchTiles='stitch'/><feDiffuseLighting surfaceScale='1.9' lighting-color='%23969696'><feDistantLight azimuth='235' elevation='58'/></feDiffuseLighting></filter><rect width='100%' height='100%' filter='url(%23p)'/></svg>")}
.softtouch{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;opacity:.06;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='s'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='1' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23s)'/></svg>")}
.leather2{position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='l'><feTurbulence type='fractalNoise' baseFrequency='0.045 0.06' numOctaves='4' seed='7' stitchTiles='stitch'/><feDiffuseLighting surfaceScale='2.2' lighting-color='%23999999'><feDistantLight azimuth='225' elevation='52'/></feDiffuseLighting></filter><rect width='100%' height='100%' filter='url(%23l)'/></svg>")}
.linen{position:absolute;inset:0;pointer-events:none;
  background:
   repeating-linear-gradient(0deg,rgba(90,70,40,.055) 0 1px,transparent 1px 3px),
   repeating-linear-gradient(90deg,rgba(90,70,40,.05) 0 1px,transparent 1px 2.6px)}
.foil{filter:drop-shadow(0 -1px .4px rgba(0,0,0,.55)) drop-shadow(0 1px 0 rgba(255,255,255,.10))}
"""


def page(body):
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="covers.css"><style>{CSS}</style></head>
<body><div class="cover">{body}</div></body></html>"""


def logo_gold(left, top, width, cls="foil", tag_bg="var(--gold)"):
    return (f'<div class="logo {cls}" style="left:{left}px;top:{top}px;width:{width}px">'
            f'<img src="assets/mark_gold.png">'
            f'<div class="word" style="background:var(--gold)"></div>'
            f'<div class="tag" style="background:{tag_bg}"></div></div>')


def stitches(x0, y0, x1, y1, color, groove=True, r=10):
    g = ""
    if groove:  # pressed channel next to the seam
        g = (f'<rect x="{x0 - 7}" y="{y0 - 7}" width="{x1 - x0 + 14}" height="{y1 - y0 + 14}" rx="{r + 6}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>'
             f'<rect x="{x0 - 5.6}" y="{y0 - 5.6}" width="{x1 - x0 + 11.2}" height="{y1 - y0 + 11.2}" rx="{r + 5}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1"/>')
    return (f'<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}</defs>{g}'
            f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{r}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="3.4" stroke-dasharray="9 5"/>'
            f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{r}" fill="none" stroke="{color}" stroke-width="2.2" stroke-dasharray="9 5" stroke-linecap="round" filter="url(#stitchShadow)"/>'
            f'</svg>')


covers = {}

# -------------------------------------------- LX1 IMPERIAL (couro verde + hot stamping)
covers["lx1-imperial"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 70% 55% at 50% 40%,#083a1f 0%,#052a16 50%,#021509 100%)"></div>
<div class="pebble" style="opacity:.9"></div><div class="leather2" style="opacity:.5"></div>
<div class="full" style="background:radial-gradient(ellipse 85% 75% at 50% 42%,transparent 50%,rgba(0,0,0,.45) 100%)"></div>
{stitches(100, 52, 670, 1028, "#c9a24e")}
{logo_gold(385 - 215, 372, 430)}
<div class="abs foil" style="left:355px;top:668px;width:60px;height:2px;background:var(--gold)"></div>
""")

# -------------------------------------------- LX2 NOIR (preto soft-touch + dourado)
covers["lx2-noir"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 70% 55% at 50% 40%,#232323 0%,#151515 55%,#0a0a0a 100%)"></div>
<div class="pebble" style="opacity:.6"></div><div class="softtouch"></div>
<div class="full" style="background:radial-gradient(ellipse 85% 75% at 50% 42%,transparent 55%,rgba(0,0,0,.5) 100%)"></div>
<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}</defs>
 <rect x="112" y="62" width="546" height="956" fill="none" stroke="url(#gold)" stroke-width="1.1" opacity=".85"/>
</svg>
{logo_gold(385 - 220, 360, 440)}
<div class="abs foil" style="left:355px;top:672px;width:60px;height:2px;background:var(--gold)"></div>
""")

# -------------------------------------------- LX3 BORDEAUX (couro vinho + placa de metal)
pw, ph, px, py = 440, 286, 385 - 220, 380
covers["lx3-bordeaux"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 70% 55% at 50% 42%,#6a0d1a 0%,#4c0812 50%,#270308 100%)"></div>
<div class="pebble" style="opacity:.9"></div><div class="leather2" style="opacity:.5"></div>
<div class="full" style="background:radial-gradient(ellipse 85% 75% at 50% 42%,transparent 50%,rgba(0,0,0,.45) 100%)"></div>
{stitches(100, 52, 670, 1028, "#d3b169")}
<div class="abs" style="left:{px}px;top:{py}px;width:{pw}px;height:{ph}px;border-radius:14px;
  background:
    repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 1px,rgba(0,0,0,.05) 1px 2px,transparent 2px 3px),
    linear-gradient(120deg,#8a6526 0%,#d9b866 22%,#f7e7b4 38%,#c49a48 55%,#e9cf8c 72%,#9c7630 100%);
  box-shadow:0 14px 26px rgba(0,0,0,.55),0 3px 6px rgba(0,0,0,.45),inset 0 2px 1px rgba(255,255,255,.55),inset 0 -2px 2px rgba(80,55,10,.6),inset 0 0 0 1px rgba(90,60,15,.5)"></div>
<div class="abs" style="left:{px + 12}px;top:{py + 12}px;width:{pw - 24}px;height:{ph - 24}px;border-radius:9px;
  box-shadow:inset 0 1px 1px rgba(90,60,15,.6),0 1px 0 rgba(255,255,255,.45)"></div>
<div class="logo" style="left:{px + 40}px;top:{py + 28}px;width:{pw - 80}px;
  filter:drop-shadow(0 1px 0 rgba(255,250,225,.75)) drop-shadow(0 -1px 0 rgba(60,40,5,.55))">
  <div style="background:linear-gradient(180deg,#4f3608,#7a5718);-webkit-mask:url(assets/logo_mask.png) center/100% 100% no-repeat;mask:url(assets/logo_mask.png) center/100% 100% no-repeat"></div>
</div>
""")

# -------------------------------------------- LX4 COUTURE (meia-encadernação: lombada de couro + linho)
spine = 290
CX = 492  # optical centre of the linen panel, clear of the elastic
covers["lx4-couture"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 80% 70% at 60% 40%,#f8f3e7 0%,#efe7d6 65%,#e2d7c1 100%)"></div>
<div class="linen"></div><div class="grain" style="opacity:.7"></div>
<div class="abs" style="left:0;top:0;bottom:0;width:{spine}px;background:linear-gradient(90deg,#021a0c 0%,#083a1f 55%,#06321b 85%,#042413 100%);
  box-shadow:4px 0 8px rgba(0,0,0,.35)"></div>
<div class="pebble" style="opacity:.9;width:{spine}px;right:auto"></div>
<div class="leather2" style="opacity:.5;width:{spine}px;right:auto"></div>
<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}</defs>
 <line x1="{spine - 16}" y1="0" x2="{spine - 16}" y2="1080" stroke="rgba(0,0,0,.6)" stroke-width="3.4" stroke-dasharray="9 5"/>
 <line x1="{spine - 16}" y1="0" x2="{spine - 16}" y2="1080" stroke="#c9a24e" stroke-width="2.1" stroke-dasharray="9 5" stroke-linecap="round" filter="url(#stitchShadow)"/>
 <rect x="{spine}" y="0" width="5" height="1080" fill="url(#gold)"/>
 <rect x="{spine + 5}" y="0" width="1" height="1080" fill="rgba(0,0,0,.25)"/>
</svg>
<div class="abs foil" style="left:{(spine + 90) // 2 - 45}px;top:880px;width:90px;aspect-ratio:540/544;background:var(--gold);
  -webkit-mask:url(assets/mark_tight.png) center/contain no-repeat;mask:url(assets/mark_tight.png) center/contain no-repeat"></div>
<div class="logo" style="left:{CX - 170}px;top:370px;width:340px"><img src="assets/logo_full.png"></div>
<div class="abs" style="left:{CX - 200}px;width:400px;top:610px;text-align:center;font-family:Cinzel;font-weight:600;font-size:16px;letter-spacing:9px;padding-left:9px;color:#07431f">ANOTAÇÕES</div>
<div class="abs" style="left:{CX - 30}px;top:648px;width:60px;height:2px;background:var(--gold)"></div>
""")

for name, html in covers.items():
    with open(os.path.join(OUT, f"cover_{name}.html"), "w") as f:
        f.write(html)
print("\n".join(covers))
