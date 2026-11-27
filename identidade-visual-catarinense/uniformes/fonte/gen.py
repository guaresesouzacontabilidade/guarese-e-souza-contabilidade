import sys
from common import *
from shirt import shirt
from polo import polo, tee, POLO_M, POLO_F, TEE

GREEN = '#053a1c'   # renders close to brand green #07431F after fabric texture
RED = '#8a0a12'     # renders close to brand red #8E0F16
OFFW = '#f3efe6'
IVORY = '#f6f3ec'

pages = {}
pages['polo_masculina'] = page(polo(
    POLO_M, GREEN, GREEN,
    tipping={'collar': [(OFFW, 22), (GREEN, 19), (RED, 14.5), (GREEN, 11)],
             'cuff': [(7, OFFW, 1.6, None), (11.5, RED, 1.8, None)]},
    button=('#2a6a44', '#05250f'),
    emb_html=emb_dark(552, 488, 86)), "polo_m")

pages['polo_feminina'] = page(polo(
    POLO_F, IVORY, IVORY,
    tipping={'collar': [('#07431f', 20), (IVORY, 17), ('#8e0f16', 13.5), (IVORY, 10.5)],
             'cuff': [(6, '#07431f', 1.5, None), (10, '#8e0f16', 1.5, None)]},
    button=('#ffffff', '#d6d0c2'),
    emb_html=emb_color(543, 466, 76), shade=.55), "polo_f")

pages['camiseta_vermelha'] = page(tee(TEE, RED, emb_dark(552, 470, 86), shade=1.0), "tee")

pages['camisa_social'] = page(shirt('#fbfbf9', emb_color(557, 468, 66)), "shirt")

only = sys.argv[1] if len(sys.argv) > 1 else None
for k, v in pages.items():
    if only and only not in k: continue
    open(f'{k}.html', 'w').write(v)
    print(k)
