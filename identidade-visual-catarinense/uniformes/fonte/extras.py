"""Close-up of the embroidery, technical sheet and presentation sheet for the uniforms."""
from common import *
from polo import POLO_M, polo_lineart

FONT_CSS = '<link rel="stylesheet" href="../covers.css">'
NOISE = ("url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>"
         "<filter id='f'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/>"
         "<feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23f)'/></svg>\")")


def closeup():
    # macro of the green polo embroidery
    thr = lambda ang, p, s: (f"repeating-linear-gradient({ang}deg,rgba(255,255,255,{s}) 0 {p * .22:.1f}px,rgba(255,255,255,0) {p * .5:.1f}px,"
                             f"rgba(0,0,0,{s}) {p * .78:.1f}px,rgba(0,0,0,0) {p:.1f}px)")
    mk = lambda f: f"-webkit-mask:url(../assets/{f}) center/100% 100% no-repeat;mask:url(../assets/{f}) center/100% 100% no-repeat;"
    txt = ("-webkit-mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat,url(../assets/tagline_mask.png) center/100% 100% no-repeat;"
           "mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat,url(../assets/tagline_mask.png) center/100% 100% no-repeat;")
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONT_CSS}<style>
html,body{{margin:0}}
#scene{{position:relative;width:1600px;height:1000px;overflow:hidden;background:#053a1c}}
.fab{{position:absolute;inset:-20px;
 background:
  radial-gradient(circle at 50% 50%,rgba(0,0,0,.42) 0 2.6px,rgba(0,0,0,.12) 4px,rgba(255,255,255,.07) 5.6px,rgba(255,255,255,0) 7px) 0 0/15px 15px,
  radial-gradient(circle at 50% 50%,rgba(0,0,0,.42) 0 2.6px,rgba(0,0,0,.12) 4px,rgba(255,255,255,.07) 5.6px,rgba(255,255,255,0) 7px) 7.5px 7.5px/15px 15px,
  #0a4524;}}
.noise{{position:absolute;inset:0;background-image:{NOISE};mix-blend-mode:overlay;opacity:.35}}
.light{{position:absolute;inset:0;background:radial-gradient(ellipse 70% 70% at 42% 40%,rgba(255,255,255,.10),rgba(0,0,0,0) 55%,rgba(0,0,0,.45) 100%)}}
.emb{{position:absolute;left:250px;top:150px;width:1100px;aspect-ratio:1440/854;
 filter:drop-shadow(0 4px 3px rgba(0,0,0,.55)) drop-shadow(0 -2px 0 rgba(255,255,255,.12)) drop-shadow(0 10px 12px rgba(0,0,0,.35))}}
.emb>*{{position:absolute;inset:0;width:100%;height:100%}}
.emb img{{filter:drop-shadow(0 0 3px #f2efe8) drop-shadow(0 0 2px #f2efe8) drop-shadow(0 0 1px #f2efe8)}}
.w{{{txt}background:#f6f3ec}}
.t1{{{mk('mark_mask.png')}background:{thr(38, 9, .42)};mix-blend-mode:overlay}}
.t2{{{txt}background:{thr(96, 7, .5)};mix-blend-mode:overlay}}
.t3{{{mk('logo_mask.png')}background-image:{NOISE};mix-blend-mode:overlay;opacity:.5}}
.cap{{position:absolute;left:0;right:0;bottom:0;height:86px;background:rgba(251,248,240,.96);display:flex;align-items:center;justify-content:center;gap:26px;
 font-family:Montserrat;font-weight:600;font-size:21px;color:#07431f;letter-spacing:.4px}}
.cap b{{color:#8e0f16;font-weight:700}}
.bar{{position:absolute;left:0;right:0;bottom:86px;height:8px;background:linear-gradient(180deg,#07431f 0 3px,#fff 3px 5px,#8e0f16 5px)}}
</style></head><body><div id="scene">
<div class="fab"></div><div class="noise"></div>
<div class="emb"><img src="../assets/mark_filled.png"><div class="w"></div><div class="t1"></div><div class="t2"></div><div class="t3"></div></div>
<div class="light"></div>
<div class="bar"></div>
<div class="cap"><span><b>Close do bordado</b> · polo verde</span><span>símbolo nas cores da marca com contorno branco</span><span>letras em linha branca</span></div>
</div></body></html>"""


def ficha():
    S = 0.78  # scale of the technical drawing
    OX, OY = -88, 170 - 282 * 0.78
    P = POLO_M
    # logo box on the polo (same as mockup: left 552, top 488, width 86)
    lx, ly, lw = 552, 488, 86
    lh = lw * 813 / 1400
    hps_y = P['y0']
    def tr(x, y): return (OX + x * S, OY + y * S)
    bx, by = tr(lx, ly); bw, bh = lw * S, lh * S
    hx, hy = tr(P['N'][0], hps_y)     # wearer's right HPS (viewer left)
    hx2, hy2 = tr(W - P['N'][0], hps_y)  # wearer's left HPS (viewer right)
    cx = tr(500, 0)[0]
    dimx = tr(880, 0)[0] + 10
    lc = bx + bw / 2
    swatch = lambda c, name, hexv, border="": (f'<div class="sw"><i style="background:{c};{border}"></i><div><b>{name}</b><span>{hexv}</span></div></div>')
    versions = [
        ("#f6f3ec", "Tecido branco / marfim", "Logo nas cores originais: símbolo verde e vermelho, CATARINENSE em verde, frase em vermelho.",
         emb_color(26, 22, 188, period=1.6)),
        ("#08401f", "Tecido verde", "Símbolo com a faixa branca e contorno branco fino; CATARINENSE e frase em branco.",
         emb_dark(26, 22, 188, period=1.6, outline=.7)),
        ("#8a0a12", "Tecido vermelho", "Igual ao tecido verde: símbolo com faixa e contorno brancos, letras em branco.",
         emb_dark(26, 22, 188, period=1.6, outline=.7)),
    ]
    vers_html = "".join(f"""<div class="ver"><div class="fabric" style="background:{c}">{e}</div>
      <div class="vt"><b>{t}</b><span>{d}</span></div></div>""" for c, t, d, e in versions)
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONT_CSS}<style>
html,body{{margin:0}}
.emb{{position:absolute;aspect-ratio:1440/854}}
.emb>*{{position:absolute;inset:0;width:100%;height:100%}}
.emb .word{{-webkit-mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat;mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat}}
.emb .tag{{-webkit-mask:url(../assets/tagline_mask.png) center/100% 100% no-repeat;mask:url(../assets/tagline_mask.png) center/100% 100% no-repeat}}
.emb .thr-mark{{-webkit-mask:url(../assets/mark_mask.png) center/100% 100% no-repeat;mask:url(../assets/mark_mask.png) center/100% 100% no-repeat;mix-blend-mode:overlay}}
.emb .thr-text{{-webkit-mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat,url(../assets/tagline_mask.png) center/100% 100% no-repeat;mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat,url(../assets/tagline_mask.png) center/100% 100% no-repeat;mix-blend-mode:overlay}}
#scene{{position:relative;width:1600px;height:1132px;background:#fbfaf6;font-family:Montserrat;color:#1f2a23;overflow:hidden}}
.hd{{position:absolute;left:60px;top:46px;right:60px}}
.hd h1{{margin:0;font-family:Cinzel;font-weight:700;font-size:40px;color:#07431f;letter-spacing:1px}}
.hd p{{margin:6px 0 0;font-size:15px;letter-spacing:5px;font-weight:600;color:#8e0f16}}
.tri{{position:absolute;left:60px;top:132px;width:160px;height:7px;background:linear-gradient(90deg,#07431f 0 33.3%,#e9e6de 33.3% 66.6%,#8e0f16 66.6%)}}
.draw{{position:absolute;left:30px;top:160px;width:730px;height:930px}}
.col{{position:absolute;left:760px;top:170px;right:60px}}
h2{{margin:0 0 12px;font-size:15px;letter-spacing:3px;font-weight:700;color:#07431f;text-transform:uppercase}}
.sws{{display:flex;gap:26px;margin-bottom:26px}}
.sw{{display:flex;align-items:center;gap:10px}}
.sw i{{display:block;width:40px;height:40px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}}
.sw b{{display:block;font-size:15px}} .sw span{{font-size:13px;color:#5c625e}}
.vers{{display:flex;gap:16px;margin-bottom:24px}}
.ver{{flex:1;background:#fff;border:1px solid #e6e2d8;border-radius:10px;overflow:hidden}}
.fabric{{position:relative;height:156px}}
.vt{{padding:10px 12px 12px}} .vt b{{display:block;font-size:14px;color:#07431f;margin-bottom:4px}} .vt span{{font-size:12.5px;line-height:1.4;color:#4b524d}}
table{{border-collapse:collapse;width:100%;font-size:14px;margin-bottom:22px}}
td,th{{text-align:left;padding:7px 10px;border-bottom:1px solid #e6e2d8}} th{{font-size:12px;letter-spacing:1.5px;color:#8e0f16;text-transform:uppercase}}
ul{{margin:0;padding-left:18px;font-size:13.5px;line-height:1.5;color:#36403a}} li{{margin-bottom:5px}}
li b{{color:#8e0f16}}
.ft{{position:absolute;left:60px;right:60px;bottom:22px;font-size:12px;color:#7a807c;display:flex;justify-content:space-between}}
</style></head><body><div id="scene">
<div class="hd"><h1>Ficha técnica · Uniformes Catarinense</h1><p>POSIÇÃO DO BORDADO, CORES DE LINHA E VERSÕES DO LOGO</p></div>
<div class="tri"></div>
<svg class="draw" viewBox="0 0 730 930">
 <defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 Z" fill="#8e0f16"/></marker></defs>
 <g transform="translate({OX} {OY}) scale({S})">{polo_lineart(P)}</g>
 <image href="../assets/logo_full.png" x="{bx}" y="{by}" width="{bw}" height="{bh}" preserveAspectRatio="none"/>
 <rect x="{bx - 3}" y="{by - 3}" width="{bw + 6}" height="{bh + 6}" fill="none" stroke="#8e0f16" stroke-width="1.6" stroke-dasharray="5 3"/>
 <!-- width -->
 <line x1="{bx}" y1="{by + bh + 26}" x2="{bx + bw}" y2="{by + bh + 26}" stroke="#8e0f16" stroke-width="1.6" marker-start="url(#ar)" marker-end="url(#ar)"/>
 <line x1="{bx}" y1="{by + bh + 6}" x2="{bx}" y2="{by + bh + 34}" stroke="#8e0f16" stroke-width="1"/><line x1="{bx + bw}" y1="{by + bh + 6}" x2="{bx + bw}" y2="{by + bh + 34}" stroke="#8e0f16" stroke-width="1"/>
 <text x="{lc}" y="{by + bh + 52}" font-family="Montserrat" font-weight="700" font-size="17" fill="#8e0f16" text-anchor="middle">9 cm</text>
 <!-- height from HPS -->
 <line x1="{hx2}" y1="{hy2}" x2="{dimx + 10}" y2="{hy2}" stroke="#8e0f16" stroke-width="1" stroke-dasharray="3 3"/>
 <line x1="{bx + bw + 30}" y1="{by}" x2="{dimx + 10}" y2="{by}" stroke="#8e0f16" stroke-width="1" stroke-dasharray="3 3"/>
 <line x1="{dimx}" y1="{hy2}" x2="{dimx}" y2="{by}" stroke="#8e0f16" stroke-width="1.6" marker-start="url(#ar)" marker-end="url(#ar)"/>
 <text x="{dimx + 10}" y="{(hy2 + by) / 2 - 4}" font-family="Montserrat" font-weight="700" font-size="17" fill="#8e0f16">18 cm</text>
 <text x="{dimx + 10}" y="{(hy2 + by) / 2 + 16}" font-family="Montserrat" font-size="12.5" fill="#5c625e">do ombro até</text>
 <text x="{dimx + 10}" y="{(hy2 + by) / 2 + 31}" font-family="Montserrat" font-size="12.5" fill="#5c625e">o topo do logo</text>
 <circle cx="{hx2}" cy="{hy2}" r="4" fill="#8e0f16"/>
 <!-- distance from centre front -->
 <line x1="{cx}" y1="{by - 50}" x2="{cx}" y2="{by + bh + 90}" stroke="#07431f" stroke-width="1" stroke-dasharray="6 4"/>
 <line x1="{cx}" y1="{by + bh + 80}" x2="{lc}" y2="{by + bh + 80}" stroke="#07431f" stroke-width="1.6" marker-start="url(#ar)" marker-end="url(#ar)" style="--c:#07431f"/>
 <text x="{(cx + lc) / 2}" y="{by + bh + 102}" font-family="Montserrat" font-weight="700" font-size="17" fill="#07431f" text-anchor="middle">10 cm</text>
 <text x="{(cx + lc) / 2}" y="{by + bh + 120}" font-family="Montserrat" font-size="12.5" fill="#5c625e" text-anchor="middle">do centro da frente ao centro do logo</text>
 <text x="350" y="905" font-family="Montserrat" font-weight="600" font-size="14" fill="#36403a" text-anchor="middle">Peito esquerdo de quem veste (lado direito na imagem) · medidas para tamanho M</text>
</svg>
<div class="col">
 <h2>Cores de linha</h2>
 <div class="sws">{swatch('#07431f', 'Verde', '#07431F')}{swatch('#8e0f16', 'Vermelho', '#8E0F16')}{swatch('#ffffff', 'Branco', '#FFFFFF')}</div>
 <h2>Versão do logo por cor de tecido</h2>
 <div class="vers">{vers_html}</div>
 <h2>Tamanho do bordado por peça</h2>
 <table><tr><th>Peça</th><th>Tecido</th><th>Largura do logo</th><th>Versão</th></tr>
  <tr><td>Polo masculina</td><td>Verde (piquet)</td><td>9 cm</td><td>Contorno branco + letras brancas</td></tr>
  <tr><td>Polo feminina (baby look)</td><td>Branca (piquet)</td><td>8 cm</td><td>Cores originais</td></tr>
  <tr><td>Camisa social manga longa</td><td>Branca (tricoline)</td><td>7 cm</td><td>Cores originais</td></tr>
  <tr><td>Camiseta básica</td><td>Vermelha (malha)</td><td>9 cm</td><td>Contorno branco + letras brancas</td></tr></table>
 <h2>Observações</h2>
 <ul>
  <li>Com 9 cm de largura o logo tem ~5,2 cm de altura; “CATARINENSE” fica com ~9 mm e a frase “CONTABILIDADE E GESTÃO” com só <b>~2,7 mm</b> (na camisa, 7 cm: ~2,1 mm). Isso está abaixo do mínimo usual para letra bordada (~4 mm). Peça uma <b>prova bordada</b>: se a frase não ficar legível, bordar só o símbolo + CATARINENSE ou aumentar o logo.</li>
  <li>Frisos da gola e dos punhos: polo verde com friso branco e vermelho; polo feminina com friso verde e vermelho.</li>
  <li>Linha de bordado de poliéster nº 40 nas três cores acima. Para a matriz (DST/PES), usar o arquivo <b>logo-transparente.png</b>.</li>
 </ul>
</div>
<div class="ft"><span>Catarinense Contabilidade e Gestão</span><span>Medidas de referência; ajustar proporcionalmente para os outros tamanhos.</span></div>
</div></body></html>"""


def sheet():
    items = [("polo_masculina", "Polo masculina · verde", "Bordado com contorno branco, friso branco e vermelho"),
             ("polo_feminina", "Polo feminina · branca", "Baby look, logo nas cores originais"),
             ("camisa_social", "Camisa social · branca", "Manga longa, logo pequeno no peito"),
             ("camiseta_vermelha", "Camiseta básica · vermelha", "Malha, logo com letras brancas")]
    cards = "".join(f'<div class="card"><img src="crops/{n}.png"><div class="cap">{t}<span>{d}</span></div></div>' for n, t, d in items)
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONT_CSS}<style>
html,body{{margin:0}}
#scene{{width:2000px;padding:70px 64px 56px;box-sizing:border-box;background:linear-gradient(180deg,#eceded,#dcdee1);font-family:Montserrat}}
h1{{margin:0;text-align:center;font-family:Cinzel;font-weight:700;font-size:56px;color:#07431f;letter-spacing:2px}}
.sub{{text-align:center;margin:10px 0 14px;font-size:17px;letter-spacing:7px;color:#8e0f16;font-weight:600}}
.tri{{width:150px;height:6px;margin:0 auto 44px;background:linear-gradient(90deg,#07431f 0 33.3%,#fff 33.3% 66.6%,#8e0f16 66.6%)}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:28px}}
.card img{{width:100%;display:block;border-radius:12px}}
.cap{{text-align:center;margin-top:12px;font-weight:700;font-size:21px;color:#1d2a22}}
.cap span{{display:block;font-weight:500;font-size:14.5px;color:#5b605c;margin-top:5px}}
</style></head><body><div id="scene">
<h1>Uniformes Catarinense</h1><div class="sub">4 PEÇAS COM O LOGO BORDADO</div><div class="tri"></div>
<div class="grid">{cards}</div></div></body></html>"""


if __name__ == "__main__":
    open("closeup_bordado.html", "w").write(closeup())
    open("ficha_tecnica.html", "w").write(ficha())
    open("apresentacao.html", "w").write(sheet())
    print("ok")
