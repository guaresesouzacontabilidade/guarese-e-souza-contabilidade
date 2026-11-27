"""Monochrome / gold versions of the logo for foil, embroidery and engraving."""
import numpy as np
from PIL import Image
A = 'assets/'
full = np.asarray(Image.open(A + 'logo_full.png')).astype(float) / 255
mark = np.asarray(Image.open(A + 'mark.png')).astype(float) / 255
h, w = full.shape[:2]

def save_mask(alpha, name):
    arr = np.dstack([np.ones((h, w, 3)), alpha]) * 255
    Image.fromarray(arr.astype(np.uint8), 'RGBA').save(A + name)

save_mask(full[..., 3], 'logo_mask.png')
save_mask(mark[..., 3], 'mark_mask.png')

# gold mark: map luminance of the glossy ribbons to a metallic gold ramp
L = 0.3 * mark[..., 0] + 0.59 * mark[..., 1] + 0.11 * mark[..., 2]
sel = mark[..., 3] > 0.5
lo, hi = np.percentile(L[sel], 2), np.percentile(L[sel], 99)
t = np.clip((L - lo) / (hi - lo), 0, 1) ** 0.8
yy, xx = np.mgrid[0:h, 0:w]
t = np.clip(t * 0.75 + 0.25 * (1 - ((xx / w) + (yy / h)) / 2), 0, 1)  # soft diagonal sheen
stops = [(0, (74, 50, 9)), (.3, (150, 112, 38)), (.55, (210, 174, 92)), (.78, (246, 227, 161)), (1, (255, 246, 214))]
def ramp(t, stops):
    out = np.zeros(t.shape + (3,))
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        m = (t >= a) & (t <= b)
        k = ((t - a) / (b - a))[m][:, None]
        out[m] = np.array(ca) * (1 - k) + np.array(cb) * k
    return out
gold = ramp(t, stops)
arr = np.dstack([gold, mark[..., 3:] * 255])
Image.fromarray(arr.astype(np.uint8), 'RGBA').save(A + 'mark_gold.png')
silver_stops = [(0, (60, 62, 66)), (.35, (130, 134, 140)), (.6, (190, 194, 199)), (.8, (232, 234, 237)), (1, (255, 255, 255))]
arr = np.dstack([ramp(t, silver_stops), mark[..., 3:] * 255])
Image.fromarray(arr.astype(np.uint8), 'RGBA').save(A + 'mark_silver.png')
print('ok')
