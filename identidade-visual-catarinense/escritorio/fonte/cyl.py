"""Wrap a flat artwork around a cylinder (front view, camera slightly above)
and bake in ceramic / powder-coat lighting.  numpy only (no scipy)."""
import numpy as np
from PIL import Image


def bilinear(T, ty, tx):
    h, w = T.shape[:2]
    tx = np.clip(tx, 0, w - 1.001)
    ty = np.clip(ty, 0, h - 1.001)
    x0 = np.floor(tx).astype(int); y0 = np.floor(ty).astype(int)
    fx = (tx - x0)[..., None]; fy = (ty - y0)[..., None]
    a = T[y0, x0]; b = T[y0, x0 + 1]; c = T[y0 + 1, x0]; d = T[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def wrap(tex_path, art_mm, r_mm, s, u_c, fill, ell=0.16, finish="gloss",
         light=-0.5, spec=0.55, ss=2):
    """Returns RGBA image of the cylinder body.
    art_mm: physical width of the artwork; r_mm: cylinder radius;
    s: output px per mm; u_c: art position (mm) facing the camera;
    fill: RGB used where the art does not reach; ell: ellipse b/R."""
    T = np.asarray(Image.open(tex_path).convert("RGB")).astype(float)
    Ht, Wt = T.shape[:2]
    k = Wt / art_mm                       # texture px per mm
    S = s * ss                            # supersampled output px per mm
    R = r_mm * S
    b = ell * R
    body_h = Ht / k * S
    W = int(round(2 * R)); H = int(round(body_h + b)) + 2
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    xc = (xx + 0.5 - R) / R
    inside_x = np.abs(xc) < 1
    th = np.arcsin(np.clip(xc, -0.99999, 0.99999))
    yoff = b * np.cos(th)
    u = u_c + r_mm * th                   # mm along the art
    tx = u * k
    ty = (yy - yoff) / S * k
    inside_y = (ty >= 0) & (ty <= Ht - 1)
    col = bilinear(T, ty, tx)
    outside_art = (tx < 0) | (tx > Wt - 1)
    col[outside_art] = fill
    # lighting
    diff = 0.58 + 0.42 * np.clip(np.cos(th - light), 0, 1)
    edge = 0.72 + 0.28 * np.cos(th) ** 0.6
    shade = (diff * edge)[..., None]
    col = col * shade
    if finish == "gloss":
        hl = spec * np.exp(-((th - (light - 0.08)) / 0.075) ** 2) + 0.18 * np.exp(-((th - light) / 0.35) ** 2)
        rim = 0.22 * np.exp(-((th - 1.32) / 0.08) ** 2)
    else:  # matte powder coat / satin
        hl = spec * 0.45 * np.exp(-((th - light) / 0.28) ** 2)
        rim = 0.12 * np.exp(-((th - 1.3) / 0.12) ** 2)
    col = col + (255 - col) * (hl + rim)[..., None]
    alpha = (inside_x & inside_y).astype(float)
    # soft antialiased side edges
    alpha *= np.clip((1 - np.abs(xc)) * R / 1.2, 0, 1)
    out = np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    if ss > 1:
        img = img.resize((W // ss, H // ss), Image.LANCZOS)
    return img, dict(R=R / ss, b=b / ss, body_h=body_h / ss)
