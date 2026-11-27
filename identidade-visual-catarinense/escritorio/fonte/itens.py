"""Flat print pieces for the office kit, laid out at real size.
Each file has one .art element; render.js turns it into a 300 dpi PNG.
Main line follows the chosen MINIMALIST notebook: ivory, full-colour logo,
thin green rule, blind-embossed mark and the green/white/red base stripe.
Brand colours only: green #07431F, wine #8E0F16, white/ivory. No gold."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
PHONE = "(63) 99296-9763"
PHONE2 = "(63) 99243-5636"
NAME, ROLE = "Nome Sobrenome", "Cargo"
EMAIL, CITY = "Catarinensegestao@gmail.com", "Porto Nacional - TO"
SITE = "catarinensegestao.com.br"

IVORY_BG = "radial-gradient(ellipse 90% 70% at 45% 40%,#fdfcf8 0%,#f5f2ea 70%,#ece7dc 100%)"
GREEN = "#07431f"
WINE = "#8e0f16"


def ic_whats(c, s=18):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 32 32"><path d="M16 3.2C8.9 3.2 3.2 8.8 3.2 15.8c0 2.4.7 4.7 1.9 6.7L3.3 28.8l6.5-1.7c1.9 1 4 1.6 6.2 1.6 7.1 0 12.8-5.7 12.8-12.8S23.1 3.2 16 3.2z" fill="none" stroke="{c}" stroke-width="2.4" stroke-linejoin="round"/>'
            f'<path d="M11.7 9.3c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.4-1.4 3.4s1.5 3.9 1.7 4.2c.2.3 2.8 4.5 6.9 6.1 3.4 1.3 4.1 1.1 4.9 1 .7-.1 2.4-1 2.7-1.9.3-.9.3-1.7.2-1.9-.1-.2-.4-.3-.8-.5s-2.4-1.2-2.7-1.3c-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.3 1.5-.2.3-.5.3-.9.1-.4-.2-1.7-.6-3.2-2-1.2-1-2-2.3-2.2-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7-.1-.2-.9-2.2-1.2-2.9z" fill="{c}"/></svg>')


def ic_mail(c, s=18):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.8" stroke-linejoin="round">'
            f'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 6.5l9 6.5 9-6.5"/></svg>')


def ic_pin(c, s=18):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.8" stroke-linejoin="round">'
            f'<path d="M12 21.5s7-6.6 7-12a7 7 0 1 0-14 0c0 5.4 7 12 7 12z"/><circle cx="12" cy="9.5" r="2.6"/></svg>')


def ic_globe(c, s=18):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.8">'
            f'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9c-2.6-2.8-3.9-5.8-3.9-9S9.4 5.8 12 3z"/></svg>')


def qr(left, top, size, pad=None, radius=None, shadow=True):
    pad = pad if pad is not None else round(size * .07)
    radius = radius if radius is not None else round(size * .08)
    sh = "box-shadow:0 2px 8px rgba(60,50,30,.16),0 0 0 1px rgba(0,0,0,.04);" if shadow else ""
    return (f'<div class="abs" style="left:{left}px;top:{top}px;width:{size}px;height:{size}px;box-sizing:border-box;padding:{pad}px;'
            f'background:#fff;border-radius:{radius}px;{sh}"><img src="../assets/qr_site.png" style="width:100%;height:100%;display:block"></div>')


def page(w, h, body, css="", bg="transparent"):
    return f"""<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="esc.css">
<style>{css}</style></head><body><div class="art" style="width:{w}px;height:{h}px;background:{bg}">{body}</div></body></html>"""


def logo_color(left, top, width):
    return f'<div class="logo" style="left:{left}px;top:{top}px;width:{width}px"><img src="../assets/logo_full.png"></div>'


def emboss(left, top, width, color="#e6dfcf"):
    """blind-embossed mark, same treatment as the minimalist notebook"""
    return (f'<div class="abs mmark" style="left:{left}px;top:{top}px;width:{width}px;background:{color};'
            f'filter:drop-shadow(-1px -1px 0 rgba(255,255,255,.9)) drop-shadow(1px 1px .6px rgba(120,100,60,.2))"></div>')


def tricolor(top, h_green, h_white, h_red_total, w="100%"):
    return (f'<div class="abs" style="left:0;width:{w};top:{top}px;height:{h_green}px;background:linear-gradient(90deg,#03401b,#0a6b31)"></div>'
            f'<div class="abs" style="left:0;width:{w};top:{top + h_green}px;height:{h_white}px;background:#fff"></div>'
            f'<div class="abs" style="left:0;width:{w};top:{top + h_green + h_white}px;height:{h_red_total}px;background:linear-gradient(90deg,#6a040a,#b8101a)"></div>')


def green_rule(cx, top, width=58, h=2):
    return f'<div class="abs" style="left:{cx - width / 2}px;top:{top}px;width:{width}px;height:{h}px;background:{GREEN}"></div>'


def contact(icon, text, color=GREEN, s=15, gap=8):
    return f'<div style="display:flex;align-items:center;gap:{gap}px">{icon(color, s)}<span>{text}</span></div>'


pieces = {}
CORM = "font-family:Cormorant;font-style:italic;font-weight:500"
SITE_CAPS = f"font-weight:600;letter-spacing:3px;color:{WINE};text-transform:uppercase"

# ------------------------------------------------ CARTÃO DE VISITA (94x54 mm @10px/mm, 2 mm bleed; trim 20..920 / 20..520)
pieces["cartao-frente"] = page(940, 540, f"""
<div class="full" style="background:{IVORY_BG}"></div>
{emboss(640, 150, 420)}
<div class="grain" style="opacity:.7"></div>
{logo_color(230, 104, 480)}
{tricolor(488, 15, 4, 33)}
""")

rows = "".join(
    f'<div style="display:flex;align-items:center;gap:13px;height:40px">{ic(GREEN, 21)}<span>{t}</span></div>'
    for ic, t in [(ic_whats, PHONE), (ic_whats, PHONE2), (ic_mail, EMAIL), (ic_pin, CITY)])
pieces["cartao-verso"] = page(940, 540, f"""
<div class="full" style="background:{IVORY_BG}"></div><div class="grain" style="opacity:.7"></div>
<div class="abs" style="left:78px;top:96px;font-family:Cinzel;font-weight:700;font-size:38px;color:{GREEN};letter-spacing:.5px">{NAME}</div>
<div class="abs" style="left:80px;top:150px;font-weight:600;font-size:14.5px;letter-spacing:6px;color:{WINE};text-transform:uppercase">{ROLE}</div>
<div class="abs" style="left:80px;top:186px;width:58px;height:2px;background:{GREEN}"></div>
<div class="abs" style="left:78px;top:210px;font-weight:500;font-size:18px;color:#26302a;line-height:1">{rows}</div>
{qr(676, 112, 176)}
<div class="abs" style="left:614px;top:302px;width:300px;text-align:center;{CORM};font-size:21px;color:{GREEN}">Acesse nosso site</div>
<div class="abs" style="left:594px;top:332px;width:340px;text-align:center;{SITE_CAPS};font-size:12.5px;letter-spacing:2.4px">{SITE}</div>
{tricolor(488, 15, 4, 33)}
""")

# ------------------------------------------------ PAPEL TIMBRADO (A4 + 3 mm bleed @4px/mm; trim 12..852 / 12..1200)
FOOT = f"""
<div class="abs" style="left:72px;top:1080px;width:720px;height:1px;background:#cdd3cd"></div>
<div class="abs" style="left:72px;top:1098px;font-size:10.5px;font-weight:500;color:#2f3a33;line-height:2">
  <div style="display:flex;gap:22px">{contact(ic_whats, PHONE + ' ou ' + PHONE2, s=13, gap=6)}{contact(ic_mail, EMAIL, s=13, gap=6)}</div>
  <div style="display:flex;gap:22px">{contact(ic_pin, CITY, s=13, gap=6)}{contact(ic_globe, SITE, s=13, gap=6)}</div>
</div>
{qr(724, 1090, 68, pad=5, radius=5, shadow=False)}
"""


def timbrado(body=""):
    return page(864, 1212, f"""
<div class="full" style="background:#fff"></div>
{emboss(560, 720, 420, "#f2eee6")}
{logo_color(332, 44, 200)}
{green_rule(432, 178, 58, 2)}
{body}
{FOOT}
{tricolor(1168, 14, 3, 30)}
""")


pieces["timbrado"] = timbrado()
letter = """<div class="abs" style="left:96px;top:236px;width:672px;font-family:Montserrat;font-size:11.5px;line-height:1.75;color:#3a403c">
<div style="text-align:right;margin-bottom:26px">Porto Nacional - TO, ___ de __________ de 20__.</div>
<div style="margin-bottom:16px;font-weight:600;color:#07431f">Prezado(a) Cliente,</div>
""" + "".join(f'<div style="height:9px;margin:10px 0;border-radius:4px;background:#e2e5e2;width:{w}%"></div>' for w in
              [100, 97, 99, 92, 60, 0, 100, 98, 95, 99, 88, 0, 100, 96, 99, 72]) + """
<div style="margin-top:26px">Atenciosamente,</div>
<div style="margin-top:44px;width:230px;border-top:1px solid #9aa39c;padding-top:6px;font-weight:600;color:#07431f">Nome Sobrenome</div>
<div style="font-size:10px;letter-spacing:2px;color:#8e0f16;font-weight:600">CARGO</div></div>"""
pieces["timbrado-exemplo"] = timbrado(letter)

# ------------------------------------------------ ENVELOPE (229x114 + 3 mm bleed @5px/mm; trim 15..1160 / 15..585)
pieces["envelope"] = page(1175, 600, f"""
<div class="full" style="background:#fffefb"></div>
{emboss(880, 250, 340, "#f2eee6")}
{logo_color(62, 46, 290)}
<div class="abs" style="left:88px;top:226px;width:44px;height:2px;background:{GREEN}"></div>
<div class="abs" style="left:88px;top:244px;font-size:13px;font-weight:500;color:#2f3a33;line-height:1.9">
  {contact(ic_whats, PHONE + ' ou ' + PHONE2)}{contact(ic_mail, EMAIL)}{contact(ic_pin, CITY)}{contact(ic_globe, SITE)}
</div>
{tricolor(530, 18, 4, 52)}
""")

# ------------------------------------------------ CRACHÁ (54x86 + 2 mm bleed @10px/mm; trim 20..560 / 20..880)
pieces["cracha"] = page(580, 900, f"""
<div class="full" style="background:{IVORY_BG}"></div>
{emboss(330, 560, 330)}
<div class="grain" style="opacity:.6"></div>
{logo_color(140, 96, 300)}
<div class="abs" style="left:195px;top:290px;width:190px;height:190px;border-radius:50%;background:{GREEN}"></div>
<div class="abs" style="left:200px;top:295px;width:180px;height:180px;border-radius:50%;background:#fff"></div>
<div class="abs" style="left:206px;top:301px;width:168px;height:168px;border-radius:50%;background:#e9e6df;overflow:hidden">
  <svg viewBox="0 0 100 100" width="168" height="168"><circle cx="50" cy="40" r="17" fill="#cbc7bd"/><path d="M14 100 C16 72 32 62 50 62 C68 62 84 72 86 100 Z" fill="#cbc7bd"/></svg></div>
<div class="abs" style="left:0;right:0;top:500px;text-align:center;font-family:Cinzel;font-weight:700;font-size:37px;color:{GREEN}">{NAME}</div>
<div class="abs" style="left:0;right:0;top:552px;text-align:center;font-weight:600;font-size:16px;letter-spacing:6px;padding-left:6px;color:{WINE}">{ROLE.upper()}</div>
{green_rule(290, 590, 58, 2)}
{qr(232, 616, 116, pad=8, radius=8)}
<div class="abs" style="left:0;right:0;top:744px;text-align:center;{SITE_CAPS};font-size:11.5px;letter-spacing:2px">{SITE}</div>
<div class="abs" style="left:0;right:0;top:768px;display:flex;justify-content:center;font-size:14px;font-weight:600;color:{GREEN}">{contact(ic_whats, PHONE, s=16, gap=6)}</div>
{tricolor(818, 16, 4, 62)}
""")

# ------------------------------------------------ CANECA (200x95 mm @5px/mm, sublimação, branca)
pieces["caneca"] = page(1000, 475, f"""
<div class="full" style="background:#fff"></div>
{logo_color(115, 108, 270)}{logo_color(615, 108, 270)}
<div class="abs" style="left:0;right:0;top:350px;display:flex;justify-content:space-around;font-size:12px;font-weight:600;letter-spacing:1.5px;color:{GREEN}">
  <span style="width:270px;text-align:center">{SITE.upper()}</span><span style="width:270px;text-align:center">{SITE.upper()}</span></div>
{tricolor(412, 14, 4, 14)}
""")

# ------------------------------------------------ PASTA (frente 230x320 mm @4px/mm, 3 mm bleed)
pieces["pasta-frente"] = page(944, 1304, f"""
<div class="full" style="background:{IVORY_BG}"></div>
{emboss(500, 760, 640)}
<div class="grain" style="opacity:.7"></div>
{logo_color(282, 330, 380)}
<div class="abs" style="left:0;right:0;top:580px;text-align:center;font-weight:500;font-size:15px;letter-spacing:9px;padding-left:9px;color:{WINE}">DOCUMENTOS</div>
{green_rule(472, 616, 58, 2)}
<div class="abs" style="left:0;right:0;top:1130px;display:flex;justify-content:center;gap:28px;font-size:14px;font-weight:600;color:{GREEN};letter-spacing:.5px">
  {contact(ic_whats, PHONE + ' ou ' + PHONE2, s=17)}</div>
<div class="abs" style="left:0;right:0;top:1162px;display:flex;justify-content:center;gap:26px;font-size:13px;font-weight:500;color:#2f3a33">
  {contact(ic_mail, EMAIL, s=16)}{contact(ic_pin, CITY, s=16)}{contact(ic_globe, SITE, s=16)}</div>
{tricolor(1228, 22, 6, 54)}
""")

# ------------------------------------------------ BLOCO DE NOTAS (A6 105x148 @5px/mm)
lines = "".join(f'<div class="abs" style="left:40px;right:40px;top:{238 + i * 30}px;height:1px;background:#ddd6c7"></div>' for i in range(15))
pieces["bloco"] = page(525, 740, f"""
<div class="full" style="background:#fffdf7"></div><div class="grain" style="opacity:.45"></div>
{logo_color(162, 28, 200)}
{green_rule(262, 160, 40, 2)}
<div class="abs" style="left:40px;top:200px;font-weight:600;font-size:11px;letter-spacing:4px;color:{WINE}">ANOTAÇÕES</div>
<div class="abs" style="right:40px;top:200px;font-weight:500;font-size:11px;color:#8b8f8a">____ / ____ / ______</div>
{lines}
<div class="abs" style="left:0;right:0;top:696px;display:flex;justify-content:center;gap:16px;font-size:10px;font-weight:600;color:{GREEN}">
  {contact(ic_whats, PHONE + ' ou ' + PHONE2, s=12, gap=5)}{contact(ic_globe, SITE, s=12, gap=5)}</div>
{tricolor(718, 8, 2, 14)}
""")

if __name__ == "__main__":
    for name, html in pieces.items():
        with open(os.path.join(OUT, f"p_{name}.html"), "w") as f:
            f.write(html)
    print(" ".join(pieces))
