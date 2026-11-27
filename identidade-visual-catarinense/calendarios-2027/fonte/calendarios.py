"""Calendários 2027 no estilo do caderno minimalista (só verde, vermelho e branco).
Gera HTML de: calendário de mesa (capa + 12 meses), parede A3 e bolso (frente/verso)."""
import calendar
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cal")
os.makedirs(OUT, exist_ok=True)
Y = 2027
G, R = "#07431f", "#8e0f16"
MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO",
         "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"]
SEM = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"]
SEM1 = ["D", "S", "T", "Q", "Q", "S", "S"]

# feriados 2027: nac = nacional, to = estadual Tocantins, fac = ponto facultativo
FERIADOS = {
    (1, 1): ("Confraternização Universal", "nac"),
    (2, 8): ("Carnaval", "fac"),
    (2, 9): ("Carnaval", "fac"),
    (3, 18): ("Autonomia do Tocantins", "to"),
    (3, 26): ("Paixão de Cristo", "nac"),
    (4, 21): ("Tiradentes", "nac"),
    (5, 1): ("Dia do Trabalho", "nac"),
    (5, 27): ("Corpus Christi", "fac"),
    (9, 7): ("Independência do Brasil", "nac"),
    (9, 8): ("N. Sra. da Natividade", "to"),
    (10, 5): ("Criação do Tocantins", "to"),
    (10, 12): ("N. Sra. Aparecida", "nac"),
    (11, 2): ("Finados", "nac"),
    (11, 15): ("Proclamação da República", "nac"),
    (11, 20): ("Consciência Negra", "nac"),
    (12, 25): ("Natal", "nac"),
}
SUFIXO = {"nac": "", "to": " (TO)", "fac": " (facultativo)"}

CAL = calendar.Calendar(firstweekday=6)  # domingo primeiro


def weeks(m):
    return CAL.monthdayscalendar(Y, m)


def icon_whats(s, c=G):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 32 32"><path d="M16 3.2C8.9 3.2 3.2 8.8 3.2 15.8c0 2.4.7 4.7 1.9 6.7L3.3 28.8l6.5-1.7c1.9 1 4 1.6 6.2 1.6 7.1 0 12.8-5.7 12.8-12.8S23.1 3.2 16 3.2z" fill="none" stroke="{c}" stroke-width="2.4" stroke-linejoin="round"/>'
            f'<path d="M11.7 9.3c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.4-1.4 3.4s1.5 3.9 1.7 4.2c.2.3 2.8 4.5 6.9 6.1 3.4 1.3 4.1 1.1 4.9 1 .7-.1 2.4-1 2.7-1.9.3-.9.3-1.7.2-1.9-.1-.2-.4-.3-.8-.5s-2.4-1.2-2.7-1.3c-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.3 1.5-.2.3-.5.3-.9.1-.4-.2-1.7-.6-3.2-2-1.2-1-2-2.3-2.2-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7-.1-.2-.9-2.2-1.2-2.9z" fill="{c}"/></svg>')


def icon_mail(s, c=G):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.8" stroke-linejoin="round">'
            f'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 6.5l9 6.5 9-6.5"/></svg>')


def icon_web(s, c=G):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.7">'
            f'<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4M12 2.8c2.6 2.6 3.9 5.6 3.9 9.2s-1.3 6.6-3.9 9.2c-2.6-2.6-3.9-5.6-3.9-9.2s1.3-6.6 3.9-9.2z"/></svg>')


def icon_pin(s, c=G):
    return (f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.8">'
            f'<path d="M12 21.5s-7-6.3-7-11.8a7 7 0 0 1 14 0c0 5.5-7 11.8-7 11.8z"/><circle cx="12" cy="9.7" r="2.6"/></svg>')


BASE_CSS = f"""
@font-face{{font-family:Montserrat;font-weight:500;src:url(../fonts/fontsource-montserrat-5.0.19/package/files/montserrat-latin-500-normal.woff2)}}
@font-face{{font-family:Montserrat;font-weight:600;src:url(../fonts/fontsource-montserrat-5.0.19/package/files/montserrat-latin-600-normal.woff2)}}
@font-face{{font-family:Montserrat;font-weight:700;src:url(../fonts/fontsource-montserrat-5.0.19/package/files/montserrat-latin-700-normal.woff2)}}
@font-face{{font-family:Cinzel;font-weight:600;src:url(../fonts/fontsource-cinzel-5.0.13/package/files/cinzel-latin-600-normal.woff2)}}
@font-face{{font-family:Cinzel;font-weight:700;src:url(../fonts/fontsource-cinzel-5.0.13/package/files/cinzel-latin-700-normal.woff2)}}
html,body{{margin:0;padding:0;background:#fff}}
.cover{{position:relative;overflow:hidden;font-family:Montserrat,sans-serif;color:{G}}}
.abs{{position:absolute}} .full{{position:absolute;inset:0}}
.bg{{position:absolute;inset:0;background:radial-gradient(ellipse 90% 75% at 50% 40%,#fbfaf6 0%,#f2efe7 70%,#e8e3d7 100%)}}
.grain{{position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply;opacity:.75;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 0.09 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}}
.logo{{position:absolute;aspect-ratio:1440/854}} .logo img{{position:absolute;inset:0;width:100%;height:100%}}
.row{{display:flex;align-items:center;gap:8px}} .row svg{{display:block;flex:none}}
.day{{display:flex;align-items:center;justify-content:center;font-weight:600}}
.sun{{color:{R}}} .bold{{font-weight:800;text-decoration:underline;text-underline-offset:1.5px}}
.hol{{background:{R};color:#fff!important;border-radius:50%}}
.fac{{box-shadow:inset 0 0 0 1.6px {R};color:{R}!important;border-radius:50%}}
"""


def stripe(top, height_total, w):
    """tri-color base stripe (green / white / red) from `top` to the bottom edge"""
    g = round(height_total * 0.33)
    wt = max(3, round(height_total * 0.1))
    return (f'<div class="abs" style="left:0;width:{w}px;top:{top}px;height:{g}px;background:linear-gradient(90deg,#03401b,#0a6b31)"></div>'
            f'<div class="abs" style="left:0;width:{w}px;top:{top + g}px;height:{wt}px;background:#fff"></div>'
            f'<div class="abs" style="left:0;width:{w}px;top:{top + g + wt}px;bottom:0;background:linear-gradient(90deg,#6a040a,#b8101a)"></div>')


def page(w, h, body, css=""):
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}{css}</style></head>'
            f'<body><div class="cover" style="width:{w}px;height:{h}px"><div class="bg"></div><div class="grain"></div>{body}</div></body></html>')


def day_cls(m, d, col):
    f = FERIADOS.get((m, d))
    if f:
        return "hol" if f[1] in ("nac", "to") else "fac"
    return "sun" if col == 0 else ""


def holiday_list(m):
    return [(d, n + SUFIXO[t], t) for (mm, d), (n, t) in sorted(FERIADOS.items()) if mm == m]


# ------------------------------------------------------------------ MESA
# 200 x 150 mm (+3 mm sangria) -> 1030 x 780 px a 5 px/mm. Wire-o no topo: 15 mm livres.
MW, MH = 1030, 780


def contacts_small(top, left, size=15, gap=10):
    return (f'<div class="abs" style="left:{left}px;top:{top}px;display:flex;flex-direction:column;gap:{gap}px;font-size:{size}px;font-weight:500">'
            f'<div class="row">{icon_whats(size + 5)}<span>(63) 99296-9763 · (63) 99243-5636</span></div>'
            f'<div class="row">{icon_web(size + 3)}<span>catarinensegestao.com.br</span></div>'
            f'<div class="row">{icon_mail(size + 3)}<span>Catarinensegestao@gmail.com</span></div></div>')


def desk_month(m):
    wk = weeks(m)
    x0, y0, cw = 395, 150, 87          # grid origin and cell width
    ch = 92 if len(wk) <= 5 else 77
    cells = []
    for i, s in enumerate(SEM):
        cells.append(f'<div class="abs" style="left:{x0 + i * cw}px;top:{y0 - 46}px;width:{cw}px;text-align:center;font-size:14px;font-weight:700;letter-spacing:2px;color:{R if i == 0 else G}">{s}</div>')
    cells.append(f'<div class="abs" style="left:{x0}px;top:{y0 - 16}px;width:{7 * cw}px;height:2px;background:{G}"></div>')
    for r, week in enumerate(wk):
        for c, d in enumerate(week):
            if not d:
                continue
            cls = day_cls(m, d, c)
            cells.append(f'<div class="abs" style="left:{x0 + c * cw}px;top:{y0 + r * ch}px;width:{cw}px;height:{ch}px;display:flex;justify-content:center;align-items:center">'
                         f'<div class="day {cls}" style="width:56px;height:56px;font-size:28px">{d}</div></div>')
        if r < len(wk) - 1:
            cells.append(f'<div class="abs" style="left:{x0}px;top:{y0 + (r + 1) * ch}px;width:{7 * cw}px;height:1px;background:rgba(7,67,31,.13)"></div>')
    hl = holiday_list(m)
    hol_html = "".join(
        f'<div class="row" style="font-size:14px;font-weight:500;line-height:1.25"><span style="flex:none;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;'
        + (f'background:{R};color:#fff' if t != "fac" else f'box-shadow:inset 0 0 0 1.6px {R};color:{R}')
        + f'">{d}</span><span>{n}</span></div>' for d, n, t in hl)
    body = f"""
<div class="logo" style="left:58px;top:92px;width:250px"><img src="../assets/logo_full.png"></div>
<div class="abs" style="left:60px;top:268px;font-family:Cinzel;font-weight:700;font-size:{44 if len(MESES[m-1]) <= 7 else 37}px;letter-spacing:2px;color:{G}">{MESES[m - 1]}</div>
<div class="abs" style="left:62px;top:322px;font-family:Montserrat;font-weight:600;font-size:22px;letter-spacing:9px;color:{R}">{Y}</div>
<div class="abs" style="left:62px;top:362px;width:46px;height:2px;background:{G}"></div>
<div class="abs" style="left:62px;top:384px;width:300px;display:flex;flex-direction:column;gap:9px">{hol_html}</div>
{contacts_small(612, 60, 14, 8)}
<div class="abs" style="left:362px;top:95px;width:1.5px;height:600px;background:rgba(7,67,31,.18)"></div>
{''.join(cells)}
{stripe(728, 52, MW)}
"""
    return page(MW, MH, body)


def desk_cover():
    body = f"""
<div class="logo" style="left:{MW // 2 - 230}px;top:150px;width:460px"><img src="../assets/logo_full.png"></div>
<div class="abs" style="left:0;right:0;top:445px;text-align:center;font-family:Montserrat;font-weight:600;font-size:17px;letter-spacing:12px;padding-left:12px;color:{R}">CALENDÁRIO</div>
<div class="abs" style="left:0;right:0;top:470px;text-align:center;font-family:Cinzel;font-weight:700;font-size:92px;letter-spacing:6px;color:{G}">{Y}</div>
<div class="abs" style="left:{MW // 2 - 29}px;top:590px;width:58px;height:2px;background:{G}"></div>
<div class="abs" style="left:0;right:0;top:620px;display:flex;justify-content:center;gap:34px;font-size:15px;font-weight:500">
 <div class="row">{icon_whats(20)}<span>(63) 99296-9763 · (63) 99243-5636</span></div>
 <div class="row">{icon_web(18)}<span>catarinensegestao.com.br</span></div></div>
{stripe(728, 52, MW)}
"""
    return page(MW, MH, body)


# ------------------------------------------------------------------ PAREDE A3
# 297 x 420 mm (+3 mm) -> 909 x 1278 px a 3 px/mm
PW, PH = 909, 1278


def mini_month(m, x, y, w, numsize=15, title=19, rowh=25, show_title=True, tgap=12, wgap=6, marks=True):
    cw = w / 7
    out = []
    if show_title:
        out.append(f'<div class="abs" style="left:{x}px;top:{y}px;width:{w}px;text-align:center;font-family:Cinzel;font-weight:700;font-size:{title}px;letter-spacing:1.5px;color:{G}">{MESES[m - 1]}</div>')
        y += title + tgap
    for i, s in enumerate(SEM1):
        out.append(f'<div class="abs" style="left:{x + i * cw:.1f}px;top:{y}px;width:{cw:.1f}px;text-align:center;font-size:{numsize - 3}px;font-weight:700;color:{R if i == 0 else G}">{s}</div>')
    y += numsize + wgap
    out.append(f'<div class="abs" style="left:{x}px;top:{y - 3}px;width:{w}px;height:1px;background:rgba(7,67,31,.35)"></div>')
    for r, week in enumerate(weeks(m)):
        for c, d in enumerate(week):
            if not d:
                continue
            cls = day_cls(m, d, c)
            if not marks and cls:
                cls = 'sun' + (' bold' if cls != 'sun' else '')
            dsz = rowh - 3
            out.append(f'<div class="abs" style="left:{x + c * cw:.1f}px;top:{y + r * rowh}px;width:{cw:.1f}px;height:{rowh}px;display:flex;justify-content:center;align-items:center">'
                       f'<div class="day {cls}" style="width:{dsz}px;height:{dsz}px;font-size:{numsize}px">{d}</div></div>')
    return "".join(out)


def wall():
    body = [f'<div class="logo" style="left:{PW // 2 - 135}px;top:38px;width:270px"><img src="../assets/logo_full.png"></div>',
            f'<div class="abs" style="left:0;right:0;top:196px;text-align:center;font-family:Cinzel;font-weight:700;font-size:50px;letter-spacing:5px;color:{G}">{Y}</div>',
            f'<div class="abs" style="left:{PW // 2 - 26}px;top:262px;width:52px;height:2px;background:{G}"></div>']
    cols, mw, gx = 4, 178, 30
    x0 = (PW - (cols * mw + (cols - 1) * gx)) // 2
    for i in range(12):
        r, c = divmod(i, cols)
        body.append(mini_month(i + 1, x0 + c * (mw + gx), 290 + r * 205, mw, numsize=14.5, title=18, rowh=23.5, tgap=10, wgap=5))
    # feriados em 3 colunas
    items = sorted(FERIADOS.items())
    chunks = [items[0:6], items[6:11], items[11:16]]
    body.append(f'<div class="abs" style="left:{x0}px;top:912px;width:{PW - 2 * x0}px;height:1px;background:rgba(7,67,31,.25)"></div>')
    body.append(f'<div class="abs" style="left:{x0}px;top:928px;font-weight:700;font-size:13px;letter-spacing:4px;color:{R}">FERIADOS {Y}</div>')
    body.append(f'<div class="abs" style="left:{PW - x0 - 330}px;top:927px;width:330px;display:flex;justify-content:flex-end;gap:16px;font-size:11.5px;font-weight:500;align-items:center">'
                f'<span class="row" style="gap:5px"><span style="width:13px;height:13px;border-radius:50%;background:{R}"></span>Feriado</span>'
                f'<span class="row" style="gap:5px"><span style="width:13px;height:13px;border-radius:50%;box-shadow:inset 0 0 0 1.6px {R}"></span>Ponto facultativo</span></div>')
    colw = (PW - 2 * x0) // 3
    for k, part in enumerate(chunks):
        rows = "".join(
            f'<div class="row" style="font-size:12.5px;font-weight:500;gap:6px;white-space:nowrap"><span style="flex:none;width:46px;font-weight:700;color:{R}">{d:02d}/{m:02d}</span><span>{n}{SUFIXO[t]}</span></div>'
            for (m, d), (n, t) in part)
        body.append(f'<div class="abs" style="left:{x0 + k * colw}px;top:956px;width:{colw}px;display:flex;flex-direction:column;gap:5px">{rows}</div>')
    # contatos + QR
    body.append(f'<div class="abs" style="left:{x0}px;top:1100px;width:{PW - 2 * x0}px;height:1px;background:rgba(7,67,31,.25)"></div>')
    qs = 96
    qx = PW - x0 - qs
    body.append(f'<div class="abs" style="left:{qx}px;top:1112px;width:{qs}px;height:{qs}px;background:#fff;border-radius:9px;box-shadow:0 0 0 1px rgba(7,67,31,.12)"></div>'
                f'<img class="abs" src="../assets/qr_site.png" style="left:{qx + 8}px;top:1120px;width:{qs - 16}px;height:{qs - 16}px;image-rendering:pixelated">')
    body.append(f'<div class="abs" style="left:{qx - 150}px;top:1150px;width:138px;text-align:right;font-size:12px;font-style:italic;font-weight:500;line-height:1.3">Acesse<br>nosso site →</div>')
    body.append(f'<div class="abs" style="left:{x0}px;top:1122px;display:grid;grid-template-columns:auto auto;column-gap:34px;row-gap:12px;font-size:13px;font-weight:500">'
                f'<div class="row">{icon_whats(18)}<span>(63) 99296-9763 · (63) 99243-5636</span></div>'
                f'<div class="row">{icon_mail(16)}<span>Catarinensegestao@gmail.com</span></div>'
                f'<div class="row">{icon_web(16)}<span>catarinensegestao.com.br</span></div>'
                f'<div class="row">{icon_pin(16)}<span>Porto Nacional - TO</span></div></div>')
    body.append(stripe(1228, 50, PW))
    return page(PW, PH, "".join(body))


# ------------------------------------------------------------------ BOLSO
# 90 x 50 mm (+2 mm) -> 940 x 540 px a 10 px/mm
BW, BH = 940, 540


def pocket_front():
    body = f"""
<div class="logo" style="left:{BW // 2 - 220}px;top:60px;width:440px"><img src="../assets/logo_full.png"></div>
<div class="abs" style="left:0;right:0;top:330px;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:21px;font-weight:600">
 <div class="row" style="gap:10px">{icon_whats(27)}<span>(63) 99296-9763 · (63) 99243-5636</span></div>
 <div class="row" style="gap:10px;font-weight:500;font-size:19px">{icon_web(23)}<span>catarinensegestao.com.br</span></div></div>
{stripe(468, 72, BW)}
"""
    return page(BW, BH, body)


def pocket_back():
    parts = [f'<div class="abs" style="left:0;right:0;top:34px;text-align:center;font-family:Cinzel;font-weight:700;font-size:24px;letter-spacing:6px;color:{G}">CALENDÁRIO {Y}</div>']
    cols, mw, gx, gy = 4, 196, 22, 10
    x0 = (BW - (cols * mw + (cols - 1) * gx)) // 2
    for i in range(12):
        r, c = divmod(i, cols)
        parts.append(mini_month(i + 1, x0 + c * (mw + gx), 78 + r * 141, mw, numsize=12.5, title=13.5, rowh=15.5, tgap=8, wgap=4, marks=False))
    parts.append(f'<div class="abs" style="left:0;width:{BW}px;top:508px;height:32px;background:linear-gradient(90deg,#03401b,#0a6b31)"></div>'
                 f'<div class="abs" style="left:0;width:{BW}px;top:516px;height:3px;background:#fff"></div>'
                 f'<div class="abs" style="left:0;width:{BW}px;top:519px;bottom:0;background:linear-gradient(90deg,#6a040a,#b8101a)"></div>')
    return page(BW, BH, "".join(parts))


files = {"mesa_00-capa.html": desk_cover()}
for m in range(1, 13):
    files[f"mesa_{m:02d}-{MESES[m - 1].lower().replace('ç', 'c')}.html"] = desk_month(m)
files["parede_a3.html"] = wall()
files["bolso_frente.html"] = pocket_front()
files["bolso_verso.html"] = pocket_back()
for n, h in files.items():
    with open(os.path.join(OUT, n), "w") as f:
        f.write(h)
print(len(files), "páginas")
