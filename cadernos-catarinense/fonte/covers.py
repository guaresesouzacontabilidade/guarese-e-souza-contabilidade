"""Generate the HTML for each notebook cover (A5 + 3 mm bleed = 154 x 216 mm,
laid out at 5 px/mm -> 770 x 1080 CSS px; rendered later at 300 dpi)."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
PHONE = "63 99296-9763"

WHATS = ('<svg width="{s}" height="{s}" viewBox="0 0 32 32"><path d="M16 3.2C8.9 3.2 3.2 8.8 3.2 15.8c0 2.4.7 4.7 1.9 6.7L3.3 28.8l6.5-1.7c1.9 1 4 1.6 6.2 1.6 7.1 0 12.8-5.7 12.8-12.8S23.1 3.2 16 3.2z" fill="none" stroke="{c}" stroke-width="2.3" stroke-linejoin="round"/>'
         '<path d="M11.7 9.3c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.4-1.4 3.4s1.5 3.9 1.7 4.2c.2.3 2.8 4.5 6.9 6.1 3.4 1.3 4.1 1.1 4.9 1 .7-.1 2.4-1 2.7-1.9.3-.9.3-1.7.2-1.9-.1-.2-.4-.3-.8-.5s-2.4-1.2-2.7-1.3c-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.3 1.5-.2.3-.5.3-.9.1-.4-.2-1.7-.6-3.2-2-1.2-1-2-2.3-2.2-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7-.1-.2-.9-2.2-1.2-2.9z" fill="{c}"/></svg>')

GOLD_DEFS = """
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#7d5a1e"/><stop offset=".18" stop-color="#d2ad5c"/>
  <stop offset=".34" stop-color="#f6e3a1"/><stop offset=".5" stop-color="#b8893a"/>
  <stop offset=".68" stop-color="#ecd38b"/><stop offset=".85" stop-color="#94702b"/>
  <stop offset="1" stop-color="#dcbb6a"/></linearGradient>
<linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#9a7330"/><stop offset=".3" stop-color="#f3dc9a"/>
  <stop offset=".55" stop-color="#b8893a"/><stop offset=".8" stop-color="#ecd38b"/>
  <stop offset="1" stop-color="#8f6a28"/></linearGradient>
<linearGradient id="gGreen" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#033a18"/><stop offset=".55" stop-color="#05501f"/>
  <stop offset="1" stop-color="#0b7a36"/></linearGradient>
<linearGradient id="gRed" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#5e0207"/><stop offset=".6" stop-color="#8e0710"/>
  <stop offset="1" stop-color="#d0141d"/></linearGradient>
<linearGradient id="gRed2" x1="1" y1="0" x2="0" y2="0">
  <stop offset="0" stop-color="#5e0207"/><stop offset=".6" stop-color="#8e0710"/>
  <stop offset="1" stop-color="#c8121b"/></linearGradient>
<linearGradient id="gGreen2" x1="1" y1="1" x2="0" y2="0">
  <stop offset="0" stop-color="#033a18"/><stop offset=".55" stop-color="#05501f"/>
  <stop offset="1" stop-color="#0b7a36"/></linearGradient>
"""

WATERMARK = """
<svg viewBox="0 0 420 300" width="{w}" style="position:absolute;left:50%;top:{top}px;transform:translateX(-50%);opacity:{op}">
 <g fill="none" stroke="{c}" stroke-linecap="round" stroke-linejoin="round">
  <path d="M60 230 A150 150 0 1 1 362 214" stroke-width="5"/>
  <rect x="95" y="128" width="112" height="140" rx="14" stroke-width="7"/>
  <rect x="112" y="146" width="78" height="26" rx="5" stroke-width="5"/>
 </g>
 <g fill="{c}">
  <rect x="112" y="186" width="20" height="16" rx="3"/><rect x="141" y="186" width="20" height="16" rx="3"/><rect x="170" y="186" width="20" height="16" rx="3"/>
  <rect x="112" y="210" width="20" height="16" rx="3"/><rect x="141" y="210" width="20" height="16" rx="3"/><rect x="170" y="210" width="20" height="16" rx="3"/>
  <rect x="112" y="234" width="20" height="16" rx="3"/><rect x="141" y="234" width="20" height="16" rx="3"/><rect x="170" y="234" width="20" height="16" rx="3"/>
  <rect x="226" y="210" width="26" height="58" rx="3"/><rect x="264" y="178" width="26" height="90" rx="3"/><rect x="302" y="136" width="26" height="132" rx="3"/>
 </g>
 <path d="M110 112 C170 120 240 96 300 52" fill="none" stroke="{c}" stroke-width="8" stroke-linecap="round"/>
 <path d="M282 38 L322 34 L310 72 Z" fill="{c}"/>
</svg>"""


def page(body, extra_css=""):
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="covers.css"><style>{extra_css}</style></head>
<body><div class="cover">{body}</div></body></html>"""


def logo_original(left, top, width, filled=False):
    src = "assets/logo_full_filled.png" if filled else "assets/logo_full.png"
    return f'<div class="logo" style="left:{left}px;top:{top}px;width:{width}px"><img src="{src}"></div>'


def logo_recolor(left, top, width, word_bg, tag_bg, shadow="none"):
    return (f'<div class="logo" style="left:{left}px;top:{top}px;width:{width}px;filter:{shadow}">'
            f'<img src="assets/mark_filled.png">'
            f'<div class="word" style="background:{word_bg}"></div>'
            f'<div class="tag" style="background:{tag_bg}"></div></div>')


def phone(top, color, icon_color=None, size=26, sep_bg=None, extra=""):
    icon_color = icon_color or color
    sep_bg = sep_bg or color
    return (f'<div class="phone" style="top:{top}px;color:{color};font-size:{size}px;{extra}">'
            f'{WHATS.format(s=int(size * 1.25), c=icon_color)}<span class="sep" style="background:{sep_bg}"></span>'
            f'<span>{PHONE}</span></div>')


def divider_svg(top, width, gold_id="goldH", fade=True, color=None):
    stroke = f"url(#{gold_id})" if not color else color
    mask = ('<linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>'
            '<stop offset=".25" stop-color="#fff"/><stop offset=".75" stop-color="#fff"/>'
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
            f'<mask id="fm{top}"><rect width="{width}" height="14" fill="url(#fadeL)"/></mask>') if fade else ""
    m = f'mask="url(#fm{top})"' if fade else ""
    c = width / 2
    return (f'<svg width="{width}" height="14" style="position:absolute;left:50%;top:{top}px;transform:translateX(-50%)">'
            f'<defs>{GOLD_DEFS}{mask}</defs>'
            f'<g {m}><rect x="0" y="6.2" width="{c - 12}" height="1.6" fill="{stroke}"/>'
            f'<rect x="{c + 12}" y="6.2" width="{c - 12}" height="1.6" fill="{stroke}"/></g>'
            f'<rect x="{c - 4.6}" y="2.4" width="9.2" height="9.2" transform="rotate(45 {c} 7)" fill="{stroke}"/></svg>')


covers = {}

# ---------------------------------------------------------------- 1 CLÁSSICO
covers["01-classico"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 80% 65% at 50% 45%,#fffdf8 0%,#f7f2e7 60%,#ece4d2 100%)"></div>
<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}
 <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
 <!-- top-left -->
 <path d="M0 0 H560 C420 46 220 140 0 360 Z" fill="url(#gGreen2)"/>
 <path d="M0 360 C220 140 420 46 560 0 H640 C470 64 250 170 0 418 Z" fill="url(#gRed2)"/>
 <path d="M0 360 C220 140 420 46 560 0" fill="none" stroke="url(#gold)" stroke-width="5"/>
 <path d="M0 418 C250 170 470 64 640 0" fill="none" stroke="url(#gold)" stroke-width="3"/>
 <path d="M0 300 C200 120 380 40 500 0" fill="none" stroke="url(#shine)" stroke-width="22" opacity=".6"/>
 <!-- bottom-right -->
 <path d="M770 1080 H330 C500 1050 680 980 770 790 Z" fill="url(#gGreen)"/>
 <path d="M770 790 C680 980 500 1050 330 1080 H240 C450 1035 650 950 770 715 Z" fill="url(#gRed)"/>
 <path d="M770 790 C680 980 500 1050 330 1080" fill="none" stroke="url(#gold)" stroke-width="5"/>
 <path d="M770 715 C650 950 450 1035 240 1080" fill="none" stroke="url(#gold)" stroke-width="3"/>
 <path d="M770 860 C690 1000 540 1060 420 1080" fill="none" stroke="url(#shine)" stroke-width="22" opacity=".5"/>
</svg>
<div class="grain"></div>
{logo_original(110, 270, 550)}
{WATERMARK.format(w=340, top=596, op=0.5, c="#dccdaf")}
{phone(842, "#07431f", size=27, extra="font-weight:700")}
{divider_svg(900, 330)}
""")

# ------------------------------------------------------------ 2 VERDE PREMIUM
frame = f"""
<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}</defs>
 <rect x="112" y="70" width="546" height="940" rx="4" fill="none" stroke="url(#gold)" stroke-width="3"/>
 <rect x="123" y="81" width="524" height="918" rx="2" fill="none" stroke="url(#gold)" stroke-width="1.2"/>
 <g fill="url(#gold)">
  <rect x="105" y="63" width="14" height="14" transform="rotate(45 112 70)"/>
  <rect x="651" y="63" width="14" height="14" transform="rotate(45 658 70)"/>
  <rect x="105" y="1003" width="14" height="14" transform="rotate(45 112 1010)"/>
  <rect x="651" y="1003" width="14" height="14" transform="rotate(45 658 1010)"/>
 </g>
 <g fill="none" stroke="url(#gold)" stroke-width="1.6" stroke-linecap="round">
  <path d="M137 135 C137 105 147 95 177 95"/><path d="M633 135 C633 105 623 95 593 95"/>
  <path d="M137 945 C137 975 147 985 177 985"/><path d="M633 945 C633 975 623 985 593 985"/>
 </g>
</svg>"""
covers["02-verde-premium"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 75% 60% at 50% 40%,#0f5f33 0%,#08431f 50%,#032912 100%)"></div>
<div class="leather"></div><div class="fine"></div>
<div class="full" style="background:radial-gradient(ellipse 90% 80% at 50% 45%,transparent 55%,rgba(0,0,0,.35) 100%)"></div>
{frame}
{logo_recolor(160, 290, 450, "var(--gold)", "linear-gradient(90deg,#e9dcc0,#f8f1df,#e9dcc0)", "drop-shadow(0 2px 2px rgba(0,0,0,.45))")}
{divider_svg(615, 280)}
<div class="abs" style="left:0;right:0;top:652px;text-align:center;font-family:Cinzel;font-weight:600;font-size:28px;letter-spacing:13px;padding-left:13px;
 background:var(--gold);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))">ANOTAÇÕES</div>
{phone(900, "#e9d9a8", icon_color="#d9bd73", size=23, sep_bg="#c3a057")}
""")

# ------------------------------------------------------------- 3 ONDAS / FAIXAS
covers["03-ondas-bandeira"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 85% 60% at 50% 30%,#ffffff 0%,#f8f5ee 65%,#eee8db 100%)"></div>
<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}
 <linearGradient id="gG3" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#02401b"/><stop offset=".6" stop-color="#055a24"/><stop offset="1" stop-color="#0c8a3c"/></linearGradient>
 <linearGradient id="gR3" x1="0" y1="0" x2="1" y2="-.4"><stop offset="0" stop-color="#5a0206"/><stop offset=".55" stop-color="#8c0710"/><stop offset="1" stop-color="#d4161f"/></linearGradient>
 <linearGradient id="gW3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ece9e2"/></linearGradient>
 <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="-4" stdDeviation="6" flood-opacity=".18"/></filter></defs>
 <g filter="url(#soft)">
  <path d="M0 800 C230 880 430 770 770 560 V1080 H0 Z" fill="url(#gG3)"/>
 </g>
 <path d="M0 860 C240 940 450 830 770 628 V1080 H0 Z" fill="url(#gW3)"/>
 <path d="M0 902 C250 980 470 872 770 676 V1080 H0 Z" fill="url(#gR3)"/>
 <path d="M0 800 C230 880 430 770 770 560" fill="none" stroke="url(#gold)" stroke-width="4"/>
 <path d="M0 902 C250 980 470 872 770 676" fill="none" stroke="url(#gold)" stroke-width="2"/>
 <path d="M0 840 C240 915 440 805 770 600" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="14"/>
</svg>
<div class="grain"></div>
{logo_original(115, 215, 540)}
{phone(985, "#f6ead0", icon_color="#f6ead0", size=24, sep_bg="#d9bd73")}
""")

# ---------------------------------------------------------------- 4 MINIMALISTA
covers["04-minimalista"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 90% 70% at 45% 40%,#fbfaf6 0%,#f2efe7 70%,#e8e3d7 100%)"></div>
<div class="abs" style="right:-130px;bottom:-40px;width:680px;aspect-ratio:540/544;background:#e6dfcf;
  -webkit-mask:url(assets/mark_tight.png) center/contain no-repeat;mask:url(assets/mark_tight.png) center/contain no-repeat;
  filter:drop-shadow(-1.5px -1.5px 0 rgba(255,255,255,.9)) drop-shadow(1.5px 1.5px 1px rgba(120,100,60,.18))"></div>
<div class="grain" style="opacity:.8"></div>
{logo_original(195, 300, 380)}
<div class="abs" style="left:0;right:0;top:560px;text-align:center;font-family:Montserrat;font-weight:500;font-size:15px;letter-spacing:9px;padding-left:9px;color:#8e0f16">ANOTAÇÕES</div>
<div class="abs" style="left:356px;top:600px;width:58px;height:2px;background:#07431f"></div>
{phone(946, "#07431f", size=18, extra="font-weight:600;letter-spacing:2px")}
<div class="abs" style="left:0;right:0;top:1012px;height:22px;background:linear-gradient(90deg,#03401b,#0a6b31)"></div>
<div class="abs" style="left:0;right:0;top:1034px;height:7px;background:#fff"></div>
<div class="abs" style="left:0;right:0;top:1041px;height:39px;background:linear-gradient(90deg,#6a040a,#b8101a)"></div>
""")

# ----------------------------------------------------------------- 5 VINHO
plate_w, plate_h = 520, 400
covers["05-vinho-elegante"] = page(f"""
<div class="full" style="background:radial-gradient(ellipse 75% 60% at 50% 42%,#9a1626 0%,#6f0c18 50%,#40050d 100%)"></div>
<div class="leather" style="opacity:.45"></div><div class="fine"></div>
<div class="full" style="background:repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 2px,transparent 2px 14px)"></div>
<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}</defs>
 <g fill="none" stroke="url(#gold)" stroke-linecap="round">
  <path d="M110 160 V95 H175" stroke-width="3"/><path d="M122 150 V107 H165" stroke-width="1.3"/>
  <path d="M660 160 V95 H595" stroke-width="3"/><path d="M648 150 V107 H605" stroke-width="1.3"/>
  <path d="M110 920 V985 H175" stroke-width="3"/><path d="M122 930 V973 H165" stroke-width="1.3"/>
  <path d="M660 920 V985 H595" stroke-width="3"/><path d="M648 930 V973 H605" stroke-width="1.3"/>
 </g>
 <g fill="url(#gold)"><circle cx="110" cy="95" r="4"/><circle cx="660" cy="95" r="4"/><circle cx="110" cy="985" r="4"/><circle cx="660" cy="985" r="4"/></g>
</svg>
<div class="abs" style="left:{385 - plate_w // 2}px;top:250px;width:{plate_w}px;height:{plate_h}px;border-radius:22px;
  background:radial-gradient(ellipse at 50% 35%,#fffdf7,#f3ecdc);box-shadow:0 18px 40px rgba(0,0,0,.45),0 2px 0 rgba(255,255,255,.15) inset;"></div>
<svg class="abs" style="left:{385 - plate_w // 2}px;top:250px" width="{plate_w}" height="{plate_h}"><defs>{GOLD_DEFS}</defs>
 <rect x="3" y="3" width="{plate_w - 6}" height="{plate_h - 6}" rx="20" fill="none" stroke="url(#gold)" stroke-width="5"/>
 <rect x="14" y="14" width="{plate_w - 28}" height="{plate_h - 28}" rx="13" fill="none" stroke="url(#gold)" stroke-width="1.3"/>
</svg>
{logo_original(385 - 230, 250 + 62, 460)}
{divider_svg(740, 320)}
{phone(800, "#f1dfae", icon_color="#e1c27a", size=24, sep_bg="#c3a057")}
""")

# ----------------------------------------------------------------- 6 EXECUTIVO
covers["06-executivo"] = page(f"""
<div class="full" style="background:linear-gradient(180deg,#fbf8f1 0%,#f3eee2 100%)"></div>
<svg class="full" viewBox="0 0 770 1080" width="770" height="1080"><defs>{GOLD_DEFS}
 <radialGradient id="gTop" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#0f6236"/><stop offset=".55" stop-color="#07431f"/><stop offset="1" stop-color="#032713"/></radialGradient>
 <clipPath id="topclip"><path d="M0 0 H770 V600 C600 690 430 640 270 690 C160 724 80 760 0 800 Z"/></clipPath></defs>
 <path d="M0 0 H770 V600 C600 690 430 640 270 690 C160 724 80 760 0 800 Z" fill="url(#gTop)"/>
 <g clip-path="url(#topclip)" fill="none" stroke="#ffffff" stroke-opacity=".045" stroke-width="1.4">
  {''.join(f'<path d="M-20 {120 + k * 34} C200 {60 + k * 34} 420 {190 + k * 34} 790 {40 + k * 34}"/>' for k in range(22))}
 </g>
 <path d="M0 800 C80 760 160 724 270 690 C430 640 600 690 770 600 V650 C600 740 430 690 270 740 C160 774 80 810 0 850 Z" fill="#fff"/>
 <path d="M0 850 C80 810 160 774 270 740 C430 690 600 740 770 650 V700 C600 790 430 740 270 790 C160 824 80 860 0 900 Z" fill="url(#gRed)"/>
 <path d="M0 800 C80 760 160 724 270 690 C430 640 600 690 770 600" fill="none" stroke="url(#gold)" stroke-width="4"/>
 <path d="M0 900 C80 860 160 824 270 790 C430 740 600 790 770 700" fill="none" stroke="url(#gold)" stroke-width="3"/>
</svg>
<div class="grain" style="opacity:.6"></div>
<div class="leather" style="opacity:.25;clip-path:path('M0 0 H770 V600 C600 690 430 640 270 690 C160 724 80 760 0 800 Z')"></div>
{logo_recolor(155, 175, 460, "linear-gradient(180deg,#fffaf0,#efe4cc)", "var(--gold)", "drop-shadow(0 2px 3px rgba(0,0,0,.4))")}
{divider_svg(560, 260)}
{phone(950, "#07431f", size=24, extra="font-weight:700")}
""")

for name, html in covers.items():
    with open(os.path.join(OUT, f"cover_{name}.html"), "w") as f:
        f.write(html)
print("\n".join(covers))
