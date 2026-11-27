"""Polo shirts (men's and women's baby look) as layered SVG + embroidered logo."""
import math
from common import *


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def polo(P, color, inner, tipping, button, emb_html, shade=1.0):
    y0 = P['y0']
    N, S, C1, C2, A = P['N'], P['S'], P['C1'], P['C2'], P['A']
    sleeve_top = ('C', P['st1'], P['st2'], C1)
    underside = ('C', P['us1'], P['us2'], A)
    armhole = ('C', P['ah1'], P['ah2'], A)
    side = P['side']        # list of segs from A to hem side
    hem = P['hem']          # seg from hem side to centre
    back_neck = [(m(N), (m(N)[0] - 30, y0 - 14), (N[0] + 30, y0 - 14), N)]

    outline = symmetric(N, [('C', P['sh1'], P['sh2'], S), sleeve_top, ('L', C2), underside] + side + [hem], back_neck)
    body = symmetric(N, [('C', P['sh1'], P['sh2'], S), armhole] + side + [hem], back_neck)
    # left sleeve: S -> C1 -> C2 -> A -> back along armhole to S
    ah_rev = (A, P['ah2'], P['ah1'], S)
    sl = chain(S, [sleeve_top, ('L', C2), underside]) + [ah_rev]
    sleeve_l = cubics_to_d(sl)
    sleeve_r = mirror_d(sleeve_l)

    # cuff band (3 cm along the sleeve axis)
    ax = ((C1[0] + C2[0]) / 2 - (S[0] + A[0]) / 2, (C1[1] + C2[1]) / 2 - (S[1] + A[1]) / 2)
    L = math.hypot(*ax)
    ux, uy = ax[0] / L, ax[1] / L
    cb = P['cuff']
    C1b = (C1[0] - ux * cb, C1[1] - uy * cb)
    C2b = (C2[0] - ux * cb * 1.05 + P.get('cuff_dx', 0), C2[1] - uy * cb * 1.05)
    cuff_l = f"M{fmt(C1)} L{fmt(C2)} L{fmt(C2b)} L{fmt(C1b)} Z"
    cuff_r = mirror_d(cuff_l)
    ang = math.degrees(math.atan2(uy, ux)) - 90

    def offline(o):
        a = (C1[0] - ux * o, C1[1] - uy * o)
        b = (C2[0] - ux * o, C2[1] - uy * o)
        return f"M{fmt(lerp(a, b, -.05))} L{fmt(lerp(a, b, 1.05))}"

    # collar
    bt, ib, sx, px, py, tx, ty, pt = (P[k] for k in ('bt', 'ib', 'sx', 'px', 'py', 'tx', 'ty', 'pt'))
    outer = (f"M500 {bt} C{500 - 50} {bt - 2} {sx + 10} {bt + 10} {sx} {y0 - 2} "
             f"C{sx - 7} {y0 + 22} {px - 30} {py - 40} {px} {py}")
    leaf_l = (outer + f" L{tx} {ty} C{tx + 12} {ty - 10} {494 - 8} {pt + 9} 494 {pt} "
              f"C476 {pt - 10} {sx + 42} {y0 + 34} {sx + 42} {y0 + 10} "
              f"C{sx + 44} {ib + 10} 470 {ib} 500 {ib} Z")
    leaf_r = mirror_d(leaf_l)
    outer_r = mirror_d(outer)
    neck_in = symmetric((494, pt), [('C', (476, pt - 10), (sx + 42, y0 + 34), (sx + 42, y0 + 10)),
                                     ('C', (sx + 44, ib + 10), (470, ib), (500, ib))])
    pk_w, pk_h = P['pk_w'], P['pk_h']
    pk_x = 500 - pk_w / 2
    btn_r = P['btn_r']
    buttons = "".join(f"""
     <circle cx="500" cy="{y + 1.8}" r="{btn_r + .6}" fill="rgba(0,0,0,.35)" filter="url(#b2)"/>
     <circle cx="500" cy="{y}" r="{btn_r}" fill="url(#btn)"/>
     <circle cx="500" cy="{y}" r="{btn_r - 1.6}" fill="none" stroke="rgba(0,0,0,.18)" stroke-width=".8"/>
     <circle cx="{500 - btn_r * .3}" cy="{y}" r="{btn_r * .16}" fill="rgba(0,0,0,.45)"/>
     <circle cx="{500 + btn_r * .3}" cy="{y}" r="{btn_r * .16}" fill="rgba(0,0,0,.45)"/>""" for y in P['btns'])

    hem_side = side[-1][-1]
    hs = P['hem_stitch']
    hem_stitch = symmetric((hem_side[0] + 1, hem_side[1] - hs),
                           [('C', (hem[1][0], hem[1][1] - hs), (hem[2][0], hem[2][1] - hs), (500, hem[3][1] - hs))]).replace(" Z", "")
    hem_stitch2 = hem_stitch.replace("M", "M ")  # placeholder (same path, shifted with transform)

    lx, rx = P['A'][0], m(P['A'])[0]
    s = shade
    defs = DEFS + f"""
<clipPath id="cOut"><path d="{outline}"/></clipPath>
<clipPath id="cBody"><path d="{body}"/></clipPath>
<clipPath id="cSl"><path d="{sleeve_l}"/></clipPath>
<clipPath id="cSr"><path d="{sleeve_r}"/></clipPath>
<clipPath id="cLeaves"><path d="{leaf_l}"/><path d="{leaf_r}"/></clipPath>
<clipPath id="cLeafL"><path d="{leaf_l}"/></clipPath><clipPath id="cLeafR"><path d="{leaf_r}"/></clipPath>
<clipPath id="cCuffs"><path d="{cuff_l}"/><path d="{cuff_r}"/></clipPath>
<pattern id="ribL" href="#rib" patternTransform="rotate({ang:.1f})"/>
<pattern id="ribR" href="#rib" patternTransform="rotate({-ang:.1f})"/>
<linearGradient id="gBodyX" gradientUnits="userSpaceOnUse" x1="{lx}" y1="0" x2="{rx}" y2="0">
  <stop offset="0" stop-color="#000" stop-opacity="{.42 * s}"/><stop offset=".1" stop-color="#000" stop-opacity="{.14 * s}"/>
  <stop offset=".32" stop-color="#fff" stop-opacity="{.07 * s}"/><stop offset=".55" stop-color="#000" stop-opacity="0"/>
  <stop offset=".86" stop-color="#000" stop-opacity="{.16 * s}"/><stop offset="1" stop-color="#000" stop-opacity="{.46 * s}"/></linearGradient>
<linearGradient id="gBodyY" gradientUnits="userSpaceOnUse" x1="0" y1="{y0}" x2="0" y2="{hem[3][1]}">
  <stop offset="0" stop-color="#fff" stop-opacity="{.07 * s}"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity="{.16 * s}"/></linearGradient>
<linearGradient id="gSl" gradientUnits="userSpaceOnUse" x1="{P['slg'][0]}" y1="{P['slg'][1]}" x2="{P['slg'][2]}" y2="{P['slg'][3]}">
  <stop offset="0" stop-color="#fff" stop-opacity="{.09 * s}"/><stop offset=".55" stop-color="#000" stop-opacity="{.06 * s}"/>
  <stop offset="1" stop-color="#000" stop-opacity="{.40 * s}"/></linearGradient>
<linearGradient id="gSr" gradientUnits="userSpaceOnUse" x1="{W - P['slg'][0]}" y1="{P['slg'][1]}" x2="{W - P['slg'][2]}" y2="{P['slg'][3]}">
  <stop offset="0" stop-color="#000" stop-opacity="{.05 * s}"/><stop offset=".55" stop-color="#000" stop-opacity="{.14 * s}"/>
  <stop offset="1" stop-color="#000" stop-opacity="{.48 * s}"/></linearGradient>
<linearGradient id="gLeaf" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff" stop-opacity="{.10 * s}"/><stop offset=".55" stop-color="#000" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity="{.20 * s}"/></linearGradient>
<radialGradient id="btn" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="{button[0]}"/><stop offset="1" stop-color="{button[1]}"/></radialGradient>
"""
    tip_outer = "".join(
        f'<path d="{o}" fill="none" stroke="{c}" stroke-width="{w}"/>'
        for o in (outer, outer_r) for (c, w) in tipping['collar'])
    tip_cuff = "".join(
        f'<path d="{offline(o)}" fill="none" stroke="{c}" stroke-width="{wd}"/>{"" if not mm else ""}'
        f'<path d="{mirror_d(offline(o))}" fill="none" stroke="{c}" stroke-width="{wd}"/>'
        for (o, c, wd, mm) in tipping['cuff'])

    folds = P['folds'](s)

    base_svg = f"""<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>{defs}</defs>
 <path d="{outline}" fill="#000" opacity=".30" filter="url(#b24)" transform="translate(10 22)"/>
 <path d="{outline}" fill="#000" opacity=".22" filter="url(#b4)" transform="translate(3 6)"/>
 {hook(P['hook_top'], bt + 10)}
 <path d="{outline}" fill="{color}"/>
 <path d="{neck_in}" fill="{inner}"/>
 <path d="{neck_in}" fill="#000" opacity=".35"/>
 <rect x="487" y="{ib + 4}" width="26" height="13" rx="1.5" fill="#efe9da" opacity=".95"/>
 <rect x="490" y="{ib + 9}" width="20" height="1.4" fill="#07431f" opacity=".8"/>
 {fabric_layers('cOut', P['texture'], P.get('tex_op', .55))}
</svg>"""

    over_svg = f"""<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>
<clipPath id="cOut2"><path d="{outline}"/></clipPath>
<clipPath id="cBody2"><path d="{body}"/></clipPath>
</defs>
 <g clip-path="url(#cBody)"><rect width="{W}" height="{H}" fill="url(#gBodyX)"/><rect width="{W}" height="{H}" fill="url(#gBodyY)"/></g>
 <g clip-path="url(#cSl)"><rect width="{W}" height="{H}" fill="url(#gSl)"/></g>
 <g clip-path="url(#cSr)"><rect width="{W}" height="{H}" fill="url(#gSr)"/></g>
 <g clip-path="url(#cOut)">{folds}</g>
 <!-- cuffs -->
 <g clip-path="url(#cCuffs)">
   <rect width="{W}" height="{H}" fill="{color}"/>
   <rect width="{W}" height="{H}" fill="url(#ribL)" style="mix-blend-mode:soft-light" opacity=".55" clip-path="url(#cSl)"/>
   <rect width="{W}" height="{H}" fill="url(#ribR)" style="mix-blend-mode:soft-light" opacity=".55" clip-path="url(#cSr)"/>
   {tip_cuff}
   <rect width="{W}" height="{H}" filter="url(#grain)" style="mix-blend-mode:soft-light" opacity=".2"/>
   <g clip-path="url(#cSl)"><rect width="{W}" height="{H}" fill="url(#gSl)"/></g>
   <g clip-path="url(#cSr)"><rect width="{W}" height="{H}" fill="url(#gSr)"/></g>
 </g>
 <path d="{cuff_l.split(' L')[0]} L{fmt(C2b)}" stroke="none"/>
 <path d="M{fmt(C1b)} L{fmt(C2b)}" stroke="#000" stroke-opacity=".35" stroke-width="1.6" fill="none" clip-path="url(#cSl)"/>
 <path d="{mirror_d(f'M{fmt(C1b)} L{fmt(C2b)}')}" stroke="#000" stroke-opacity=".35" stroke-width="1.6" fill="none" clip-path="url(#cSr)"/>
 <!-- armhole seams -->
 <path d="M{fmt(S)} C{fmt(P['ah1'])} {fmt(P['ah2'])} {fmt(A)}" fill="none" stroke="#000" stroke-opacity=".40" stroke-width="1.5"/>
 <path d="M{fmt(S)} C{fmt(P['ah1'])} {fmt(P['ah2'])} {fmt(A)}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1" transform="translate(2.2 0)"/>
 <path d="{mirror_d(f'M{fmt(S)} C{fmt(P["ah1"])} {fmt(P["ah2"])} {fmt(A)}')}" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1.5"/>
 <path d="M{fmt(S)} C{fmt(P['ah1'])} {fmt(P['ah2'])} {fmt(A)}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="10" filter="url(#b4)" transform="translate(-6 0)" clip-path="url(#cSl)"/>
 <path d="{mirror_d(f'M{fmt(S)} C{fmt(P["ah1"])} {fmt(P["ah2"])} {fmt(A)}')}" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="10" filter="url(#b4)" transform="translate(6 0)" clip-path="url(#cSr)"/>
 <!-- hem -->
 <path d="{hem_stitch}" fill="none" stroke="{P['stitch']}" stroke-opacity="{P['stitch_op']}" stroke-width=".9" stroke-dasharray="2.4 1.3"/>
 <path d="{hem_stitch}" fill="none" stroke="{P['stitch']}" stroke-opacity="{P['stitch_op']}" stroke-width=".9" stroke-dasharray="2.4 1.3" transform="translate(0 5)"/>
 <path d="{hem_stitch}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="3" filter="url(#b2)" transform="translate(0 -2)"/>
 <!-- shoulder top highlight -->
 <path d="M{fmt(N)} C{fmt(P['sh1'])} {fmt(P['sh2'])} {fmt(S)}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="5" filter="url(#b2)" transform="translate(0 4)"/>
 <!-- placket -->
 <rect x="{pk_x + 2}" y="{pt}" width="{pk_w}" height="{pk_h}" rx="3" fill="#000" opacity=".22" filter="url(#b2)"/>
 <rect x="{pk_x}" y="{pt}" width="{pk_w}" height="{pk_h}" rx="3" fill="{color}"/>
 <rect x="{pk_x}" y="{pt}" width="{pk_w}" height="{pk_h}" rx="3" fill="url(#{P['texture']})" style="mix-blend-mode:soft-light" opacity="{P.get('tex_op', .55)}"/>
 <rect x="{pk_x}" y="{pt}" width="{pk_w}" height="{pk_h}" rx="3" fill="url(#gBodyX)" opacity=".6"/>
 <rect x="{pk_x + 3.5}" y="{pt}" width="{pk_w - 7}" height="{pk_h - 3.5}" rx="2" fill="none" stroke="{P['stitch']}" stroke-opacity="{P['stitch_op']}" stroke-width=".8" stroke-dasharray="2.2 1.3"/>
 <rect x="{pk_x + 4}" y="{pt + pk_h - 14}" width="{pk_w - 8}" height="8" fill="none" stroke="{P['stitch']}" stroke-opacity="{P['stitch_op']}" stroke-width=".8" stroke-dasharray="2 1.2"/>
 <line x1="{pk_x + pk_w}" y1="{pt}" x2="{pk_x + pk_w}" y2="{pt + pk_h}" stroke="#000" stroke-opacity=".35" stroke-width="1.2"/>
 <line x1="500" y1="{pt}" x2="500" y2="{pt + pk_h - 16}" stroke="#000" stroke-opacity=".12" stroke-width=".8"/>
 {buttons}
 <!-- collar shadow + collar -->
 <g filter="url(#b8)" opacity=".55" transform="translate(2 8)"><path d="{leaf_l}" fill="#000"/><path d="{leaf_r}" fill="#000"/></g>
 <g filter="url(#b2)" opacity=".45" transform="translate(1 2.5)"><path d="{leaf_l}" fill="#000"/><path d="{leaf_r}" fill="#000"/></g>
 <g clip-path="url(#cLeaves)">
   <rect width="{W}" height="{H}" fill="{color}"/>
   {tip_outer}
   <rect width="{W}" height="{H}" fill="url(#{P['texture']})" style="mix-blend-mode:soft-light" opacity="{P.get('tex_op', .55) * .8}"/>
   <rect width="{W}" height="{H}" filter="url(#grain)" style="mix-blend-mode:soft-light" opacity=".2"/>
 </g>
 <g clip-path="url(#cLeafL)"><rect x="{sx - 10}" y="{bt}" width="120" height="{py - bt + 6}" fill="url(#gLeaf)"/>
   <path d="M494 {pt} C476 {pt - 10} {sx + 42} {y0 + 34} {sx + 42} {y0 + 10}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="7" filter="url(#b4)"/>
   <rect x="{sx - 10}" y="{bt}" width="120" height="{py - bt + 6}" fill="url(#gBodyX)" opacity=".5"/></g>
 <g clip-path="url(#cLeafR)"><rect x="{W - sx - 110}" y="{bt}" width="120" height="{py - bt + 6}" fill="url(#gLeaf)"/>
   <path d="{mirror_d(f'M494 {pt} C476 {pt - 10} {sx + 42} {y0 + 34} {sx + 42} {y0 + 10}')}" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="7" filter="url(#b4)"/>
   <rect x="{W - sx - 110}" y="{bt}" width="120" height="{py - bt + 6}" fill="url(#gBodyX)" opacity=".6"/></g>
 <path d="{outer}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.2"/>
 <path d="{outer_r}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.2"/>
 <!-- back collar band: inner fold line -->
 <path d="M{sx + 44} {ib + 8} C{sx + 46} {ib + 2} 470 {ib - 1} 500 {ib - 1} C530 {ib - 1} {W - sx - 46} {ib + 2} {W - sx - 44} {ib + 8}" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="1.2"/>
</svg>"""
    return base_svg + emb_html + over_svg


# ------------------------------------------------------------------ men's polo
def folds_m(s):
    return f"""
 <path d="M262 568 C300 598 352 618 404 628" fill="none" stroke="#000" stroke-opacity="{.34 * s}" stroke-width="14" filter="url(#b8)"/>
 <path d="M268 598 C312 622 356 640 408 650" fill="none" stroke="#fff" stroke-opacity="{.09 * s}" stroke-width="10" filter="url(#b8)"/>
 <path d="M738 566 C700 596 650 616 598 626" fill="none" stroke="#000" stroke-opacity="{.40 * s}" stroke-width="14" filter="url(#b8)"/>
 <path d="M732 596 C690 620 646 638 594 648" fill="none" stroke="#fff" stroke-opacity="{.05 * s}" stroke-width="10" filter="url(#b8)"/>
 <path d="M372 760 C364 840 374 930 366 1010" fill="none" stroke="#000" stroke-opacity="{.20 * s}" stroke-width="20" filter="url(#b14)"/>
 <path d="M398 750 C392 840 400 930 394 1010" fill="none" stroke="#fff" stroke-opacity="{.07 * s}" stroke-width="12" filter="url(#b14)"/>
 <path d="M636 720 C648 820 638 920 644 1010" fill="none" stroke="#000" stroke-opacity="{.22 * s}" stroke-width="22" filter="url(#b14)"/>
 <path d="M520 800 C516 870 526 940 520 1012" fill="none" stroke="#000" stroke-opacity="{.10 * s}" stroke-width="16" filter="url(#b14)"/>
 <path d="M270 800 C380 778 600 806 730 786" fill="none" stroke="#fff" stroke-opacity="{.05 * s}" stroke-width="18" filter="url(#b14)"/>
 <ellipse cx="420" cy="540" rx="80" ry="60" fill="#fff" opacity="{.06 * s}" filter="url(#b24)"/>
 <path d="M175 470 C200 500 225 540 240 600" fill="none" stroke="#fff" stroke-opacity="{.07 * s}" stroke-width="12" filter="url(#b8)"/>
 <path d="M825 470 C800 500 775 540 760 600" fill="none" stroke="#000" stroke-opacity="{.12 * s}" stroke-width="14" filter="url(#b8)"/>
"""


POLO_M = dict(
    y0=320, N=(419, 320), S=(282, 362), sh1=(380, 333), sh2=(330, 346),
    C1=(126, 512), C2=(240, 630), A=(253, 548),
    st1=(240, 396), st2=(172, 460), us1=(244, 604), us2=(249, 576),
    ah1=(287, 420), ah2=(276, 502),
    side=[('C', (256, 640), (258, 720), (257, 800)), ('C', (256, 880), (253, 960), (252, 1004))],
    hem=('C', (330, 1011), (420, 1015), (500, 1015)),
    cuff=28, slg=(196, 436, 268, 506),
    bt=282, ib=302, sx=400, px=440, py=420, tx=463, ty=422, pt=392,
    pk_w=32, pk_h=136, btn_r=7.2, btns=[430, 488],
    hem_stitch=22, stitch='#fff', stitch_op=.16, texture='pique', hook_top=170, folds=folds_m,
)


def folds_f(s):
    return f"""
 <path d="M290 560 C320 584 360 600 400 606" fill="none" stroke="#000" stroke-opacity="{.30 * s}" stroke-width="12" filter="url(#b8)"/>
 <path d="M710 560 C680 584 640 600 600 606" fill="none" stroke="#000" stroke-opacity="{.36 * s}" stroke-width="12" filter="url(#b8)"/>
 <path d="M308 690 C350 700 400 700 440 690" fill="none" stroke="#000" stroke-opacity="{.16 * s}" stroke-width="14" filter="url(#b8)"/>
 <path d="M692 690 C650 700 600 700 560 690" fill="none" stroke="#000" stroke-opacity="{.18 * s}" stroke-width="14" filter="url(#b8)"/>
 <path d="M380 760 C374 820 382 880 376 930" fill="none" stroke="#000" stroke-opacity="{.16 * s}" stroke-width="18" filter="url(#b14)"/>
 <path d="M628 740 C636 820 630 880 634 930" fill="none" stroke="#000" stroke-opacity="{.18 * s}" stroke-width="18" filter="url(#b14)"/>
 <ellipse cx="410" cy="520" rx="70" ry="50" fill="#fff" opacity="{.10 * s}" filter="url(#b24)"/>
 <ellipse cx="590" cy="520" rx="70" ry="50" fill="#000" opacity="{.04 * s}" filter="url(#b24)"/>
"""


POLO_F = dict(
    y0=340, N=(429, 340), S=(320, 370), sh1=(392, 349), sh2=(352, 360),
    C1=(228, 452), C2=(306, 540), A=(286, 526),
    st1=(292, 396), st2=(254, 428), us1=(300, 536), us2=(292, 530),
    ah1=(316, 420), ah2=(300, 494),
    side=[('C', (285, 590), (306, 640), (306, 700)), ('C', (306, 770), (282, 852), (277, 928))],
    hem=('C', (340, 940), (420, 944), (500, 944)),
    cuff=20, cuff_dx=-2, slg=(258, 432, 300, 476),
    bt=308, ib=325, sx=414, px=448, py=416, tx=467, ty=418, pt=398,
    pk_w=26, pk_h=104, btn_r=6, btns=[426, 456, 486],
    hem_stitch=18, stitch='#000', stitch_op=.22, texture='pique', hook_top=196, folds=folds_f,
)


# ------------------------------------------------------------ crew-neck tee
def tee(P, color, emb_html, shade=1.0):
    """Basic crew-neck T-shirt: polo body without collar/placket, rib neckline, hemmed sleeves."""
    html = polo(P, color, color, tipping={'collar': [], 'cuff': []}, button=('#000', '#000'),
                emb_html=emb_html, shade=shade)
    base, emb_and_over = html.split('</svg>', 1)
    y0 = P['y0']
    nl, nr = P['N'], m(P['N'])
    fd = P['front_drop']
    band = P['band']
    front_outer = f"M{fmt(nl)} C{nl[0] + 12} {y0 + fd * .7} {470} {y0 + fd} 500 {y0 + fd} C530 {y0 + fd} {nr[0] - 12} {y0 + fd * .7} {fmt(nr)}"
    il, ir = (nl[0] + band, y0 + 1), (nr[0] - band, y0 + 1)
    fi = fd - band
    front_inner_pts = f"C{il[0] + 10} {y0 + fi * .75} 476 {y0 + fi} 500 {y0 + fi} C524 {y0 + fi} {ir[0] - 10} {y0 + fi * .75} {fmt(ir)}"
    back_top = f"C{nr[0] - 22} {y0 - 13} {nl[0] + 22} {y0 - 13} {fmt(nl)}"
    back_in = f"C{il[0] + 18} {y0 - 6} {ir[0] - 18} {y0 - 6} {fmt(ir)}"
    interior = f"M{fmt(il)} {back_in} C{ir[0] - 10} {y0 + fi * .75} 524 {y0 + fi} 500 {y0 + fi} C476 {y0 + fi} {il[0] + 10} {y0 + fi * .75} {fmt(il)} Z"
    rib_front = (front_outer + f" L{fmt(ir)} C{ir[0] - 10} {y0 + fi * .75} 524 {y0 + fi} 500 {y0 + fi} "
                 f"C476 {y0 + fi} {il[0] + 10} {y0 + fi * .75} {fmt(il)} Z")
    rib_back = f"M{fmt(nl)} L{fmt(il)} {back_in} L{fmt(nr)} {back_top.replace(fmt(nl), fmt(nl))} Z"
    # base: replace the polo neck interior + label with crew interior
    import re
    base = re.sub(r'<path d="M494[^"]*" fill="[^"]*"/>\s*<path d="M494[^"]*" fill="#000" opacity="\.35"/>\s*<rect x="487"[^>]*/>\s*<rect x="490"[^>]*/>',
                  f'<path d="{interior}" fill="{color}"/><path d="{interior}" fill="#000" opacity=".42"/>'
                  f'<rect x="489" y="{y0 + 1}" width="22" height="11" rx="1.5" fill="#efe9da" opacity=".95"/>'
                  f'<rect x="492" y="{y0 + 5}" width="16" height="1.3" fill="#07431f" opacity=".8"/>', base)
    emb, over = emb_and_over.split('<svg', 1)
    over = '<svg' + over
    a = over.index('<!-- cuffs -->'); b = over.index('<!-- armhole seams -->')
    C1, C2 = P['C1'], P['C2']
    st = P['stitch']
    sleeve_hem = "".join(
        f'<path d="{d}" fill="none" stroke="{st}" stroke-opacity="{P["stitch_op"]}" stroke-width=".9" stroke-dasharray="2.4 1.3"/>'
        for d in [P['sleeve_stitch'], mirror_d(P['sleeve_stitch'])])
    over = over[:a] + sleeve_hem + over[b:]
    a = over.index('<!-- placket -->')
    crew = f"""
 <path d="{front_outer}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="5" filter="url(#b4)" transform="translate(1 4)"/>
 <path d="{rib_front}" fill="{color}"/>
 <path d="{rib_front}" fill="url(#ribN)" style="mix-blend-mode:soft-light" opacity=".55"/>
 <path d="{rib_front}" fill="url(#gBodyX)" opacity=".7"/>
 <path d="{rib_back}" fill="{color}"/><path d="{rib_back}" fill="#000" opacity=".22"/>
 <path d="M{fmt(il)} {front_inner_pts}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.2"/>
 <path d="{front_outer}" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="1.1"/>
 <path d="{front_outer}" fill="none" stroke="{st}" stroke-opacity="{P['stitch_op']}" stroke-width=".8" stroke-dasharray="2.2 1.3" transform="translate(0 4)"/>
 <path d="{front_outer}" fill="none" stroke="{st}" stroke-opacity="{P['stitch_op']}" stroke-width=".8" stroke-dasharray="2.2 1.3" transform="translate(0 8)"/>
</svg>"""
    over = over[:a] + crew
    base = base.replace('</defs>', '<pattern id="ribN" href="#rib" patternTransform="rotate(90)"/></defs>', 1)
    return base + '</svg>' + emb + over


TEE = dict(POLO_M)
TEE.update(front_drop=62, band=17, cuff=0, stitch='#fff', stitch_op=.2,
           sleeve_stitch="M136.0 497.0 L248.5 614.0")


def polo_lineart(P, stroke="#26302a", sw=2.2):
    """Technical flat (line drawing) of the polo, same geometry as the mockup."""
    y0 = P['y0']
    N, S, C1, C2, A = P['N'], P['S'], P['C1'], P['C2'], P['A']
    back_neck = [(m(N), (m(N)[0] - 30, y0 - 14), (N[0] + 30, y0 - 14), N)]
    outline = symmetric(N, [('C', P['sh1'], P['sh2'], S), ('C', P['st1'], P['st2'], C1), ('L', C2),
                            ('C', P['us1'], P['us2'], A)] + P['side'] + [P['hem']], back_neck)
    arm = f"M{fmt(S)} C{fmt(P['ah1'])} {fmt(P['ah2'])} {fmt(A)}"
    bt, ib, sx, px, py, tx, ty, pt = (P[k] for k in ('bt', 'ib', 'sx', 'px', 'py', 'tx', 'ty', 'pt'))
    leaf = (f"M500 {bt} C450 {bt - 2} {sx + 10} {bt + 10} {sx} {y0 - 2} C{sx - 7} {y0 + 22} {px - 30} {py - 40} {px} {py}"
            f" L{tx} {ty} C{tx + 12} {ty - 10} 486 {pt + 9} 494 {pt} C476 {pt - 10} {sx + 42} {y0 + 34} {sx + 42} {y0 + 10}"
            f" C{sx + 44} {ib + 10} 470 {ib} 500 {ib} Z")
    pk_x = 500 - P['pk_w'] / 2
    ax = ((C1[0] + C2[0]) / 2 - (S[0] + A[0]) / 2, (C1[1] + C2[1]) / 2 - (S[1] + A[1]) / 2)
    import math
    L = math.hypot(*ax); ux, uy = ax[0] / L, ax[1] / L; cb = P['cuff']
    cuffline = f"M{C1[0] - ux * cb:.1f} {C1[1] - uy * cb:.1f} L{C2[0] - ux * cb * 1.05:.1f} {C2[1] - uy * cb * 1.05:.1f}"
    hs = side_end = P['side'][-1][-1]
    hem = P['hem']; k = P['hem_stitch']
    hemst = (f"M{side_end[0] + 1} {side_end[1] - k} C{hem[1][0]} {hem[1][1] - k} {hem[2][0]} {hem[2][1] - k} 500 {hem[3][1] - k}")
    g = f'fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round"'
    gs = f'fill="none" stroke="{stroke}" stroke-width="{sw * .55}" stroke-dasharray="5 4"'
    return f"""
 <path d="{outline}" fill="#fff" {g}/>
 <path d="{arm}" {g}/><path d="{mirror_d(arm)}" {g}/>
 <path d="{cuffline}" {g}/><path d="{mirror_d(cuffline)}" {g}/>
 <path d="{hemst}" {gs}/><path d="{mirror_d(hemst)}" {gs}/>
 <rect x="{pk_x}" y="{pt}" width="{P['pk_w']}" height="{P['pk_h']}" rx="3" fill="#fff" {g}/>
 {''.join(f'<circle cx="500" cy="{y}" r="{P["btn_r"]}" fill="#fff" {g}/>' for y in P['btns'])}
 <path d="{leaf}" fill="#fff" {g}/><path d="{mirror_d(leaf)}" fill="#fff" {g}/>
"""
