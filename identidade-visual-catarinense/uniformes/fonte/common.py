"""Shared helpers for the uniform mockups (SVG garments + embroidered logo)."""
import re

W = 1000          # scene width (CSS px)
H = 1200          # scene height
CM = 9.5          # px per cm (garment scale)


def m(p):
    return (W - p[0], p[1])


def chain(start, segs):
    """segs: ('L', p) | ('C', c1, c2, p) -> list of cubic tuples (p0, c1, c2, p1)."""
    out, cur = [], start
    for s in segs:
        if s[0] == 'L':
            p = s[1]
            out.append((cur, cur, p, p))
        else:
            out.append((cur, s[1], s[2], s[3]))
            p = s[3]
        cur = p
    return out


def fmt(p):
    return f"{p[0]:.1f} {p[1]:.1f}"


def cubics_to_d(cubics, close=True, move=True):
    d = f"M{fmt(cubics[0][0])} " if move else ""
    d += " ".join(f"C{fmt(c1)} {fmt(c2)} {fmt(p1)}" for (_, c1, c2, p1) in cubics)
    return d + (" Z" if close else "")


def symmetric(start, segs, close_segs=None):
    """Left half from `start` down to the centre line; mirrored to build a closed outline.
    close_segs: list of cubics from the right start point back to `start` (e.g. back neck)."""
    left = chain(start, segs)
    right = [(m(p1), m(c2), m(c1), m(p0)) for (p0, c1, c2, p1) in reversed(left)]
    allc = left + right
    if close_segs:
        allc += close_segs
    return cubics_to_d(allc)


def mirror_d(d):
    """Mirror an absolute path (M/L/C/Q/Z only) around x = W/2."""
    toks = re.findall(r"[MLCQZ]|-?\d+(?:\.\d+)?", d)
    out, nums = [], []
    for t in toks:
        if t in "MLCQZ":
            out.append(t)
        else:
            nums.append(float(t))
            if len(nums) == 2:
                out.append(f"{W - nums[0]:.1f} {nums[1]:.1f}")
                nums = []
    return " ".join(out)


DEFS = """
<filter id="b2" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="1400"><feGaussianBlur stdDeviation="2"/></filter>
<filter id="b4" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="1400"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="b8" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="1400"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="b14" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="1400"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="b24" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1200" height="1400"><feGaussianBlur stdDeviation="24"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed="4" result="t"/><feColorMatrix type="saturate" values="0"/></filter>
<filter id="mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="3" seed="9"/><feColorMatrix type="saturate" values="0"/></filter>
<pattern id="pique" width="3.2" height="3.2" patternUnits="userSpaceOnUse">
  <rect width="3.2" height="3.2" fill="#808080"/><circle cx=".8" cy=".8" r=".75" fill="#4d4d4d"/><circle cx="2.4" cy="2.4" r=".75" fill="#4d4d4d"/>
  <circle cx="2.4" cy=".8" r=".45" fill="#a8a8a8"/><circle cx=".8" cy="2.4" r=".45" fill="#a8a8a8"/></pattern>
<pattern id="oxford" width="2.4" height="2.4" patternUnits="userSpaceOnUse">
  <rect width="2.4" height="2.4" fill="#808080"/><rect width="1.2" height="1.2" fill="#6e6e6e"/><rect x="1.2" y="1.2" width="1.2" height="1.2" fill="#929292"/></pattern>
<pattern id="twill" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
  <rect width="4" height="4" fill="#808080"/><rect width="4" height="1.6" fill="#666"/><rect y="2" width="4" height=".6" fill="#9a9a9a"/></pattern>
<pattern id="rib" width="2.2" height="10" patternUnits="userSpaceOnUse">
  <rect width="2.2" height="10" fill="#808080"/><rect width="1" height="10" fill="#5e5e5e"/></pattern>
<linearGradient id="chrome" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#6d7075"/><stop offset=".35" stop-color="#f4f5f7"/><stop offset=".6" stop-color="#9da1a7"/><stop offset="1" stop-color="#55585d"/></linearGradient>
"""

BG = "radial-gradient(ellipse 70% 62% at 50% 45%,#f7f6f3 0%,#e9e8e3 58%,#d8d6d0 100%)"


def page(body, title="mockup", extra_css=""):
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<link rel="stylesheet" href="../covers.css">
<style>
html,body{{margin:0;padding:0;background:#fff}}
#scene{{position:relative;width:{W}px;height:{H}px;overflow:hidden;background:{BG}}}
#scene>svg{{position:absolute;left:0;top:0}}
.emb{{position:absolute;aspect-ratio:1440/854}}
.emb>*{{position:absolute;inset:0;width:100%;height:100%}}
.emb .word{{-webkit-mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat;mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat}}
.emb .tag{{-webkit-mask:url(../assets/tagline_mask.png) center/100% 100% no-repeat;mask:url(../assets/tagline_mask.png) center/100% 100% no-repeat}}
.emb .thr-mark{{-webkit-mask:url(../assets/mark_mask.png) center/100% 100% no-repeat;mask:url(../assets/mark_mask.png) center/100% 100% no-repeat;mix-blend-mode:overlay}}
.emb .thr-text{{-webkit-mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat,url(../assets/tagline_mask.png) center/100% 100% no-repeat;
  mask:url(../assets/wordmark_mask.png) center/100% 100% no-repeat,url(../assets/tagline_mask.png) center/100% 100% no-repeat;mix-blend-mode:overlay}}
{extra_css}
</style></head><body><div id="scene">{body}</div></body></html>"""


WHITE_TXT = "#fbf8f0"


def thread(period, angle_mark=38, angle_text=96, strength=0.45):
    """Satin-stitch texture layers (diagonal on the symbol, near-vertical on letters)."""
    a, b = period * 0.5, period
    s = strength
    g = lambda ang: (f"repeating-linear-gradient({ang}deg,rgba(255,255,255,{s}) 0 {a * .45:.2f}px,"
                     f"rgba(255,255,255,0) {a:.2f}px,rgba(0,0,0,{s}) {a * 1.55:.2f}px,rgba(0,0,0,0) {b:.2f}px)")
    return (f'<div class="thr-mark" style="background:{g(angle_mark)}"></div>'
            f'<div class="thr-text" style="background:{g(angle_text)}"></div>')


def emb_dark(left, top, width, period=1.3, text=WHITE_TXT, outline=.45, symbol_only=False):
    """Embroidery for green/red fabric: symbol with white stripe + white letters.
    A thin white contour keeps the green/red parts of the symbol readable on coloured fabric."""
    sh = ("drop-shadow(0 .7px .45px rgba(0,0,0,.6)) drop-shadow(0 -.45px 0 rgba(255,255,255,.18)) "
          "drop-shadow(0 1.6px 1.4px rgba(0,0,0,.35))")
    o = outline
    ol = f"filter:drop-shadow(0 0 {o}px #f4f1ea) drop-shadow(0 0 {o}px #f4f1ea) drop-shadow(0 0 {o * .6:.2f}px #f4f1ea)" if o else ""
    inner = f'<img src="../assets/mark_filled.png" style="{ol}">'
    if not symbol_only:
        inner += f'<div class="word" style="background:{text}"></div><div class="tag" style="background:{text}"></div>'
    inner += thread(period, strength=.4)
    return f'<div class="emb" style="left:{left}px;top:{top}px;width:{width}px;filter:{sh}">{inner}</div>'


def emb_color(left, top, width, period=1.3, filled=False):
    """Full-colour embroidery of the original logo."""
    sh = ("drop-shadow(0 .6px .4px rgba(0,0,0,.45)) drop-shadow(0 -.4px 0 rgba(255,255,255,.5)) "
          "drop-shadow(0 1.4px 1.2px rgba(0,0,0,.18))")
    src = "logo_full_filled.png" if filled else "logo_full.png"
    return (f'<div class="emb" style="left:{left}px;top:{top}px;width:{width}px;filter:{sh} saturate(.92)">'
            f'<img src="../assets/{src}">{thread(period, strength=0.35)}</div>')


def hook(top_y, base_y):
    """Chrome hanger hook coming out from behind the collar."""
    return f"""
<g>
 <path d="M500 {base_y} L500 {top_y + 52} C500 {top_y + 20} 522 {top_y} 544 {top_y + 6} C566 {top_y + 12} 572 {top_y + 38} 556 {top_y + 52}"
   fill="none" stroke="rgba(0,0,0,.25)" stroke-width="7" stroke-linecap="round" transform="translate(4 6)" filter="url(#b2)"/>
 <path d="M500 {base_y} L500 {top_y + 52} C500 {top_y + 20} 522 {top_y} 544 {top_y + 6} C566 {top_y + 12} 572 {top_y + 38} 556 {top_y + 52}"
   fill="none" stroke="#5c5f63" stroke-width="7" stroke-linecap="round"/>
 <path d="M500 {base_y} L500 {top_y + 52} C500 {top_y + 20} 522 {top_y} 544 {top_y + 6} C566 {top_y + 12} 572 {top_y + 38} 556 {top_y + 52}"
   fill="none" stroke="#d9dbde" stroke-width="4.2" stroke-linecap="round"/>
 <path d="M498.6 {base_y} L498.6 {top_y + 52} C498.6 {top_y + 22} 520 {top_y + 2} 543 {top_y + 7.5}"
   fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".9"/>
</g>"""


def fabric_layers(clip_id, texture="pique", tex_op=.55, grain_op=.22, mottle_op=.25):
    """Texture rects; the clip sits on each rect so the blend reaches the fabric below
    (a clipped parent <g> would isolate the blend)."""
    cp = f'clip-path="url(#{clip_id})"'
    return f"""
 <rect width="{W}" height="{H}" {cp} fill="url(#{texture})" style="mix-blend-mode:soft-light" opacity="{tex_op}"/>
 <rect width="{W}" height="{H}" {cp} filter="url(#grain)" style="mix-blend-mode:soft-light" opacity="{grain_op}"/>
 <rect width="{W}" height="{H}" {cp} filter="url(#mottle)" style="mix-blend-mode:soft-light" opacity="{mottle_op}"/>"""
