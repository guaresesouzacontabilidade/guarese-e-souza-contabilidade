"""Extract the Catarinense logo from its light gradient background into
transparent layers that can be recombined / recolored on any cover."""
import sys
import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1]
OUT = sys.argv[2]

im = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float64)
H, W, _ = im.shape

# ---- 1. model the background gradient (poly fit on pixels outside the logo)
CROP = (360, 1416, 1800, 2270)  # x0, y0, x1, y1 (logo bbox + padding)
yy, xx = np.mgrid[0:H:8, 0:W:8]
outside = ~((xx > 340) & (xx < 1820) & (yy > 1390) & (yy < 2290))
xs, ys = xx[outside] / W, yy[outside] / H


def basis(x, y):
    return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y,
                     x ** 3, x * x * y, x * y * y, y ** 3], axis=-1)


A = basis(xs, ys)
coef = [np.linalg.lstsq(A, im[::8, ::8, c][outside], rcond=None)[0] for c in range(3)]

x0, y0, x1, y1 = CROP
cy, cx = np.mgrid[y0:y1, x0:x1]
Bm = basis(cx / W, cy / H)
B = np.stack([Bm @ coef[c] for c in range(3)], axis=-1)
O = im[y0:y1, x0:x1]

# ---- 2. alpha from darkness relative to background, then un-premultiply
diff = np.max(B - O, axis=-1)
alpha = np.clip((diff - 7.0) / (105.0 - 7.0), 0, 1)
a3 = alpha[..., None]
F = np.where(a3 > 0.004, (O - (1 - a3) * B) / np.maximum(a3, 1e-3), O)
F = np.clip(F, 0, 255)

h, w = alpha.shape
SPLIT_MARK = 1985 - y0      # rows above = swoosh
SPLIT_TAG = 2185 - y0       # rows below = tagline

region = np.zeros((h, w), np.uint8)
region[:SPLIT_MARK] = 1
region[SPLIT_MARK:SPLIT_TAG] = 2
region[SPLIT_TAG:] = 3

# ---- 3. white stripe of the swoosh (it is negative space in the original)
R, G = F[..., 0], F[..., 1]
solid = alpha > 0.5
green = solid & (G > R) & (region == 1)
red = solid & (R > G + 20) & (region == 1)
stripe = np.zeros((h, w), bool)
for x in range(w):
    gcol = np.where(green[:, x])[0]
    if gcol.size == 0:
        continue
    yg = gcol.max()
    rcol = np.where(red[yg:, x])[0]
    if rcol.size == 0:
        continue
    yr = yg + rcol.min()
    if yr - yg > 1:
        stripe[yg - 3:yr + 3, x] = True
# soften the column-wise mask a touch
stripe_img = Image.fromarray((stripe * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
stripe_a = np.asarray(stripe_img).astype(np.float64) / 255.0
# gentle shading on the stripe so it matches the glossy ribbons
shade = np.linspace(0, 1, h)[:, None] * np.ones((1, w))
stripe_rgb = np.stack([np.full((h, w), 255.0), np.full((h, w), 255.0), np.full((h, w), 252.0)], -1)
stripe_rgb -= (np.clip(shade - 0.2, 0, 1) * 10)[..., None]


def save_rgba(rgb, a, name):
    arr = np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8)
    Image.fromarray(arr, "RGBA").save(f"{OUT}/{name}")


def over(rgb_top, a_top, rgb_bot, a_bot):
    a = a_top + a_bot * (1 - a_top)
    rgb = (rgb_top * a_top[..., None] + rgb_bot * (a_bot * (1 - a_top))[..., None]) / np.maximum(a, 1e-6)[..., None]
    return rgb, a


mark_a = alpha * (region == 1)
word_a = alpha * (region == 2)
tag_a = alpha * (region == 3)

save_rgba(F, alpha, "logo_full.png")
filled_rgb, filled_a = over(F, mark_a, stripe_rgb, stripe_a * (region == 1))
save_rgba(filled_rgb, filled_a, "mark_filled.png")
save_rgba(F, mark_a, "mark.png")
full_f_rgb, full_f_a = over(F, alpha, stripe_rgb, stripe_a * (region == 1))
save_rgba(full_f_rgb, full_f_a, "logo_full_filled.png")
white = np.full((h, w, 3), 255.0)
save_rgba(white, word_a, "wordmark_mask.png")
save_rgba(white, tag_a, "tagline_mask.png")

# tight crop of just the swoosh (for patterns / small marks)
ys_, xs_ = np.where(filled_a > 0.02)
box = (xs_.min() - 4, ys_.min() - 4, xs_.max() + 5, ys_.max() + 5)
Image.open(f"{OUT}/mark_filled.png").crop(box).save(f"{OUT}/mark_tight_filled.png")
Image.open(f"{OUT}/mark.png").crop(box).save(f"{OUT}/mark_tight.png")
print("canvas", w, h, "mark box", box)
