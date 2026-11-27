"""Back cover (verso) for the chosen Minimalista notebook.
Seen from the back, the spiral is on the RIGHT, so the right ~18 mm stay clear."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
G = "#07431f"   # brand green
R = "#8e0f16"   # brand wine

ICON_WHATS = (f'<svg width="22" height="22" viewBox="0 0 32 32"><path d="M16 3.2C8.9 3.2 3.2 8.8 3.2 15.8c0 2.4.7 4.7 1.9 6.7L3.3 28.8l6.5-1.7c1.9 1 4 1.6 6.2 1.6 7.1 0 12.8-5.7 12.8-12.8S23.1 3.2 16 3.2z" fill="none" stroke="{G}" stroke-width="2.4" stroke-linejoin="round"/>'
              f'<path d="M11.7 9.3c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.4-1.4 3.4s1.5 3.9 1.7 4.2c.2.3 2.8 4.5 6.9 6.1 3.4 1.3 4.1 1.1 4.9 1 .7-.1 2.4-1 2.7-1.9.3-.9.3-1.7.2-1.9-.1-.2-.4-.3-.8-.5s-2.4-1.2-2.7-1.3c-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.3 1.5-.2.3-.5.3-.9.1-.4-.2-1.7-.6-3.2-2-1.2-1-2-2.3-2.2-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7-.1-.2-.9-2.2-1.2-2.9z" fill="{G}"/></svg>')
ICON_MAIL = (f'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="{G}" stroke-width="1.8" stroke-linejoin="round">'
             f'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 6.5l9 6.5 9-6.5"/></svg>')
ICON_PIN = (f'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{G}" stroke-width="1.8">'
            f'<path d="M12 21.5s-7-6.3-7-11.8a7 7 0 0 1 14 0c0 5.5-7 11.8-7 11.8z"/><circle cx="12" cy="9.7" r="2.6"/></svg>')

html = f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="covers.css"><style>
.line{{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:11px;
  font-family:Montserrat;font-weight:500;font-size:18px;color:{G};letter-spacing:.3px}}
.line svg{{display:block;flex:none}}
</style></head><body><div class="cover">
<div class="full" style="background:radial-gradient(ellipse 90% 70% at 55% 40%,#fbfaf6 0%,#f2efe7 70%,#e8e3d7 100%)"></div>
<div class="abs" style="left:-130px;bottom:-40px;width:680px;aspect-ratio:540/544;background:#e6dfcf;transform:scaleX(-1);
  -webkit-mask:url(assets/mark_tight.png) center/contain no-repeat;mask:url(assets/mark_tight.png) center/contain no-repeat;
  filter:drop-shadow(1.5px -1.5px 0 rgba(255,255,255,.9)) drop-shadow(-1.5px 1.5px 1px rgba(120,100,60,.18))"></div>
<div class="grain" style="opacity:.8"></div>

<div class="logo" style="left:{385 - 140}px;top:150px;width:280px"><img src="assets/logo_full.png"></div>

<div class="abs" style="left:{385 - 92}px;top:405px;width:184px;height:184px;background:#fff;border-radius:16px;
  box-shadow:0 0 0 1px rgba(7,67,31,.10),0 6px 18px rgba(60,50,30,.10)"></div>
<img class="abs" src="assets/qr_site.png" style="left:{385 - 76}px;top:421px;width:152px;height:152px;image-rendering:pixelated">
<div class="abs" style="left:0;right:0;top:604px;text-align:center;font-family:Montserrat;font-weight:500;font-style:italic;font-size:17px;color:{G}">Acesse nosso site</div>
<div class="abs" style="left:0;right:0;top:630px;text-align:center;font-family:Montserrat;font-weight:600;font-size:13px;letter-spacing:3px;color:{R}">CATARINENSEGESTAO.COM.BR</div>

<div class="abs" style="left:356px;top:700px;width:58px;height:2px;background:{G}"></div>

<div class="line" style="top:742px">{ICON_MAIL}<span>Catarinensegestao@gmail.com</span></div>
<div class="line" style="top:786px">{ICON_WHATS}<span>(63) 99296-9763 &nbsp;ou&nbsp; (63) 99243-5636</span></div>
<div class="line" style="top:830px">{ICON_PIN}<span>Porto Nacional - TO</span></div>

<div class="abs" style="left:0;right:0;top:1012px;height:22px;background:linear-gradient(270deg,#03401b,#0a6b31)"></div>
<div class="abs" style="left:0;right:0;top:1034px;height:7px;background:#fff"></div>
<div class="abs" style="left:0;right:0;top:1041px;height:39px;background:linear-gradient(270deg,#6a040a,#b8101a)"></div>
</div></body></html>"""

with open(os.path.join(OUT, "cover_04-minimalista-verso.html"), "w") as f:
    f.write(html)
print("ok")
