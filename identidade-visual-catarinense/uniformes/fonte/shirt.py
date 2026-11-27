"""Men's long-sleeve dress shirt (white) as layered SVG + embroidered logo."""
from common import *


def shirt(color, emb_html, shade=.6):
    y0 = 300
    N, S, A = (424, 300), (282, 338), (244, 530)
    s = shade
    back_neck = [(m(N), (m(N)[0] - 30, y0 - 14), (N[0] + 30, y0 - 14), N)]
    side = [('C', (246, 640), (248, 780), (248, 900)), ('C', (248, 930), (250, 952), (254, 968))]
    hem = [('C', (276, 1014), (360, 1036), (430, 1040)), ('C', (460, 1042), (480, 1043), (500, 1043))]
    body = symmetric(N, [('C', (380, 312), (330, 324), S), ('C', (262, 400), (246, 470), A)] + side + hem, back_neck)
    # hanging sleeve (left); drawn above the body
    sl = (f"M{fmt(S)} C252 420 222 640 206 900 L204 906 C230 910 280 912 312 910 "
          f"C312 820 310 700 300 570 C296 470 292 400 {fmt(S)} Z")
    sr = mirror_d(sl)
    cuff = "M202 904 C232 909 282 911 314 908 L316 968 C310 974 300 976 290 976 L214 974 C206 974 201 970 200 964 Z"
    cuff_r = mirror_d(cuff)
    outline_parts = [body, sl, sr, cuff, cuff_r]

    # collar: stand band at the front + two point leaves
    bt, ib = 262, 279
    outer = "M500 262 C450 260 408 272 398 300 C392 328 404 378 430 430"
    leaf_l = outer + " L436 433 C452 408 474 378 489 352 C470 342 444 322 444 298 C446 286 470 279 500 279 Z"
    leaf_r = mirror_d(leaf_l)
    band = "M474 344 C484 350 492 352 500 352 C508 352 516 350 526 344 L527 384 C518 388 510 389 500 389 C490 389 482 388 473 384 Z"
    neck_in = "M489 352 C470 342 444 322 444 298 C446 286 470 279 500 279 C530 279 554 286 556 298 C556 322 530 342 511 352 Z"
    pk = (483, 388, 34, 655)
    btns = [366, 452, 537, 622, 707, 792, 877, 962]

    folds = f"""
 <path d="M300 560 C290 650 300 760 294 880" fill="none" stroke="#000" stroke-opacity="{.10 * s}" stroke-width="16" filter="url(#b14)"/>
 <path d="M372 560 C360 680 378 820 366 1020" fill="none" stroke="#000" stroke-opacity="{.10 * s}" stroke-width="22" filter="url(#b14)"/>
 <path d="M392 560 C384 680 398 820 390 1020" fill="none" stroke="#fff" stroke-opacity="{.35 * s}" stroke-width="10" filter="url(#b8)"/>
 <path d="M640 520 C652 650 638 800 650 1020" fill="none" stroke="#000" stroke-opacity="{.13 * s}" stroke-width="24" filter="url(#b14)"/>
 <path d="M612 540 C622 650 612 800 620 1020" fill="none" stroke="#fff" stroke-opacity="{.25 * s}" stroke-width="10" filter="url(#b8)"/>
 <path d="M440 430 C420 470 404 520 396 560" fill="none" stroke="#000" stroke-opacity="{.10 * s}" stroke-width="12" filter="url(#b8)"/>
 <path d="M560 430 C580 470 596 520 604 560" fill="none" stroke="#000" stroke-opacity="{.12 * s}" stroke-width="12" filter="url(#b8)"/>
 <path d="M262 780 C340 760 420 772 470 790" fill="none" stroke="#000" stroke-opacity="{.07 * s}" stroke-width="14" filter="url(#b8)"/>
 <path d="M738 760 C660 744 580 758 530 776" fill="none" stroke="#000" stroke-opacity="{.08 * s}" stroke-width="14" filter="url(#b8)"/>
"""
    sleeve_folds = f"""
 <path d="M262 470 C246 600 240 760 236 890" fill="none" stroke="#fff" stroke-opacity="{.45 * s}" stroke-width="10" filter="url(#b8)"/>
 <path d="M282 520 C276 640 278 760 280 890" fill="none" stroke="#000" stroke-opacity="{.12 * s}" stroke-width="10" filter="url(#b8)"/>
 <path d="M226 700 C250 690 280 694 304 706" fill="none" stroke="#000" stroke-opacity="{.10 * s}" stroke-width="7" filter="url(#b4)"/>
 <path d="M224 790 C250 780 282 784 306 796" fill="none" stroke="#000" stroke-opacity="{.10 * s}" stroke-width="7" filter="url(#b4)"/>
 <path d="M246 880 L252 904" stroke="#000" stroke-opacity="{.25 * s}" stroke-width="1.6" filter="url(#b2)"/>
 <path d="M272 880 L276 905" stroke="#000" stroke-opacity="{.25 * s}" stroke-width="1.6" filter="url(#b2)"/>
"""
    defs = DEFS + f"""
<clipPath id="cBody"><path d="{body}"/></clipPath>
<clipPath id="cSl"><path d="{sl}"/></clipPath><clipPath id="cSr"><path d="{sr}"/></clipPath>
<clipPath id="cCuffs"><path d="{cuff}"/><path d="{cuff_r}"/></clipPath><clipPath id="cCuffL"><path d="{cuff}"/></clipPath><clipPath id="cCuffR"><path d="{cuff_r}"/></clipPath>
<clipPath id="cLeaves"><path d="{leaf_l}"/><path d="{leaf_r}"/></clipPath>
<clipPath id="cAll">{''.join(f'<path d="{p}"/>' for p in outline_parts)}</clipPath>
<linearGradient id="gBodyX" gradientUnits="userSpaceOnUse" x1="244" y1="0" x2="756" y2="0">
  <stop offset="0" stop-color="#000" stop-opacity="{.30 * s}"/><stop offset=".12" stop-color="#000" stop-opacity="{.08 * s}"/>
  <stop offset=".35" stop-color="#fff" stop-opacity=".3"/><stop offset=".6" stop-color="#000" stop-opacity="0"/>
  <stop offset=".88" stop-color="#000" stop-opacity="{.12 * s}"/><stop offset="1" stop-color="#000" stop-opacity="{.34 * s}"/></linearGradient>
<linearGradient id="gSlL" gradientUnits="userSpaceOnUse" x1="206" y1="0" x2="312" y2="0">
  <stop offset="0" stop-color="#000" stop-opacity="{.28 * s}"/><stop offset=".35" stop-color="#fff" stop-opacity=".25"/>
  <stop offset=".8" stop-color="#000" stop-opacity="{.10 * s}"/><stop offset="1" stop-color="#000" stop-opacity="{.30 * s}"/></linearGradient>
<linearGradient id="gSlR" gradientUnits="userSpaceOnUse" x1="794" y1="0" x2="688" y2="0">
  <stop offset="0" stop-color="#000" stop-opacity="{.36 * s}"/><stop offset=".35" stop-color="#000" stop-opacity="{.04 * s}"/>
  <stop offset=".8" stop-color="#000" stop-opacity="{.14 * s}"/><stop offset="1" stop-color="#000" stop-opacity="{.34 * s}"/></linearGradient>
<linearGradient id="gLeaf" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity="{.16 * s}"/></linearGradient>
<radialGradient id="btn" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d5cc"/></radialGradient>
"""

    def button(x, y, r=5.4):
        return (f'<circle cx="{x}" cy="{y + 1.5}" r="{r + .5}" fill="rgba(0,0,0,.28)" filter="url(#b2)"/>'
                f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#btn)"/>'
                f'<circle cx="{x}" cy="{y}" r="{r - 1.3}" fill="none" stroke="rgba(0,0,0,.14)" stroke-width=".7"/>'
                f'<circle cx="{x - 1.2}" cy="{y - 1.2}" r=".75" fill="rgba(0,0,0,.4)"/><circle cx="{x + 1.2}" cy="{y - 1.2}" r=".75" fill="rgba(0,0,0,.4)"/>'
                f'<circle cx="{x - 1.2}" cy="{y + 1.2}" r=".75" fill="rgba(0,0,0,.4)"/><circle cx="{x + 1.2}" cy="{y + 1.2}" r=".75" fill="rgba(0,0,0,.4)"/>')

    stitch = 'stroke="#000" stroke-opacity=".22" stroke-width=".8" stroke-dasharray="2.2 1.2" fill="none"'
    tex = lambda cp: (f'<rect width="{W}" height="{H}" clip-path="url(#{cp})" fill="url(#oxford)" style="mix-blend-mode:soft-light" opacity=".5"/>'
                      f'<rect width="{W}" height="{H}" clip-path="url(#{cp})" filter="url(#grain)" style="mix-blend-mode:soft-light" opacity=".18"/>')

    base_svg = f"""<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>{defs}</defs>
 <g opacity=".26" filter="url(#b24)" transform="translate(10 22)">{''.join(f'<path d="{p}" fill="#000"/>' for p in outline_parts)}</g>
 <g opacity=".16" filter="url(#b4)" transform="translate(3 6)">{''.join(f'<path d="{p}" fill="#000"/>' for p in outline_parts)}</g>
 {hook(170, bt + 10)}
 <path d="{body}" fill="{color}"/>
 <path d="{neck_in}" fill="{color}"/><path d="{neck_in}" fill="#000" opacity=".16"/>
 <rect x="488" y="{ib + 4}" width="24" height="12" rx="1.5" fill="#fff"/><rect x="491" y="{ib + 8.5}" width="18" height="1.3" fill="#07431f" opacity=".8"/>
 {tex('cBody')}
</svg>"""

    over_svg = f"""<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}">
 <rect width="{W}" height="{H}" clip-path="url(#cBody)" fill="url(#gBodyX)"/>
 <g clip-path="url(#cBody)">{folds}</g>
 <!-- hem stitch -->
 <path d="M258 958 C280 1002 360 1024 430 1028 C460 1030 480 1031 500 1031 C520 1031 540 1030 570 1028 C640 1024 720 1002 742 958" {stitch}/>
 <!-- placket -->
 <rect x="{pk[0] + 2}" y="{pk[1]}" width="{pk[2]}" height="{pk[3]}" fill="#000" opacity=".10" filter="url(#b2)"/>
 <rect x="{pk[0]}" y="{pk[1]}" width="{pk[2]}" height="{pk[3]}" fill="{color}"/>
 <rect x="{pk[0]}" y="{pk[1]}" width="{pk[2]}" height="{pk[3]}" fill="url(#oxford)" style="mix-blend-mode:soft-light" opacity=".5"/>
 <rect x="{pk[0]}" y="{pk[1]}" width="{pk[2]}" height="{pk[3]}" fill="url(#gBodyX)"/>
 <line x1="{pk[0] + 3}" y1="{pk[1]}" x2="{pk[0] + 3}" y2="{pk[1] + pk[3]}" {stitch}/>
 <line x1="{pk[0] + pk[2] - 3}" y1="{pk[1]}" x2="{pk[0] + pk[2] - 3}" y2="{pk[1] + pk[3]}" {stitch}/>
 <line x1="{pk[0] + pk[2]}" y1="{pk[1]}" x2="{pk[0] + pk[2]}" y2="{pk[1] + pk[3]}" stroke="#000" stroke-opacity=".16" stroke-width="1"/>
 <line x1="{pk[0]}" y1="{pk[1]}" x2="{pk[0]}" y2="{pk[1] + pk[3]}" stroke="#000" stroke-opacity=".08" stroke-width="1"/>
 {''.join(button(500, y) for y in btns[1:])}
 <!-- sleeves (hang over the body) -->
 <g opacity=".22" filter="url(#b8)" transform="translate(5 6)"><path d="{sl}" fill="#000"/><path d="{sr}" fill="#000"/></g>
 <path d="{sl}" fill="{color}"/><path d="{sr}" fill="{color}"/>
 {tex('cSl')}{tex('cSr')}
 <rect width="{W}" height="{H}" clip-path="url(#cSl)" fill="url(#gSlL)"/>
 <rect width="{W}" height="{H}" clip-path="url(#cSr)" fill="url(#gSlR)"/>
 <g clip-path="url(#cSl)">{sleeve_folds}</g>
 <g clip-path="url(#cSr)" transform="translate({W} 0) scale(-1 1)">{sleeve_folds.replace('#fff', '#fff').replace('stroke-opacity="' + str(.45 * s), 'stroke-opacity="' + str(.12 * s))}</g>
 <path d="M{fmt(S)} C292 400 296 470 300 570" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="1.1"/>
 <path d="{mirror_d(f'M{fmt(S)} C292 400 296 470 300 570')}" fill="none" stroke="#000" stroke-opacity=".26" stroke-width="1.1"/>
 <!-- cuffs -->
 <path d="{cuff}" fill="{color}"/><path d="{cuff_r}" fill="{color}"/>
 {tex('cCuffs')}
 <rect width="{W}" height="{H}" clip-path="url(#cCuffL)" fill="url(#gSlL)"/>
 <rect width="{W}" height="{H}" clip-path="url(#cCuffR)" fill="url(#gSlR)"/>
 <g clip-path="url(#cCuffs)"><rect x="0" y="955" width="{W}" height="25" fill="#000" opacity=".06" filter="url(#b4)"/></g>
 <g clip-path="url(#cCuffs)"><rect x="0" y="904" width="{W}" height="10" fill="#000" opacity=".08"/></g>
 <path d="{cuff}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1"/>
 <path d="{cuff_r}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="1"/>
 <path d="M206 914 C236 918 282 920 310 917 M207 964 L310 966" {stitch}/>
 <path d="{mirror_d('M206 914 C236 918 282 920 310 917 M207 964 L310 966')}" {stitch}/>
 {button(296, 940, 4.6)}{button(W - 296, 940, 4.6)}
 <!-- collar -->
 <path d="{band}" fill="{color}"/>
 <path d="{band}" fill="url(#oxford)" style="mix-blend-mode:soft-light" opacity=".5"/>
 <path d="{band}" fill="#000" opacity=".07"/>
 <path d="M476 380 C486 384 494 385 500 385 C506 385 514 384 524 380" {stitch}/>
 {button(500, 366, 4.8)}
 <g filter="url(#b8)" opacity=".30" transform="translate(2 8)"><path d="{leaf_l}" fill="#000"/><path d="{leaf_r}" fill="#000"/></g>
 <g filter="url(#b2)" opacity=".25" transform="translate(1 2)"><path d="{leaf_l}" fill="#000"/><path d="{leaf_r}" fill="#000"/></g>
 <path d="{leaf_l}" fill="{color}"/><path d="{leaf_r}" fill="{color}"/>
 {tex('cLeaves')}
 <rect x="390" y="{bt}" width="220" height="180" clip-path="url(#cLeaves)" fill="url(#gLeaf)"/>
 <path d="{outer.replace('M500 262 ', 'M470 266 ')}" fill="none" stroke="#000" stroke-opacity=".0" stroke-width="1"/>
 <path d="M404 304 C400 330 410 374 432 420 L440 422 C455 398 474 370 486 352" {stitch}/>
 <path d="{mirror_d('M404 304 C400 330 410 374 432 420 L440 422 C455 398 474 370 486 352')}" {stitch}/>
 <path d="M489 352 C470 342 444 322 444 298" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="5" filter="url(#b4)" clip-path="url(#cLeaves)"/>
 <path d="{mirror_d('M489 352 C470 342 444 322 444 298')}" fill="none" stroke="#000" stroke-opacity=".26" stroke-width="5" filter="url(#b4)" clip-path="url(#cLeaves)"/>
 <path d="{leaf_l}" fill="none" stroke="#000" stroke-opacity=".14" stroke-width=".9"/>
 <path d="{leaf_r}" fill="none" stroke="#000" stroke-opacity=".16" stroke-width=".9"/>
</svg>"""
    return base_svg + emb_html + over_svg
