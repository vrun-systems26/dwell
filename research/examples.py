"""Example recordings for the app and test fixtures (timings only, no letters).
neuroQWERTY MIT-CSXPD, ODC-By 1.0, Giancardo et al. 2016."""
import json, os
import numpy as np
from features import DATA, clean, features, load_nq, read_nq
import pandas as pd

H = os.path.dirname(__file__)
M = json.load(open(os.path.join(H, '..', 'model.json')))
AGES, GAPS, PCTS = M['ages'], M['gaps'], M['pcts']


def pct(hm, f, age):
    z = np.array([(np.log(max(f[c], 1e-4)) - a) / b for c, a, b in zip(M['features'], hm['model']['mean'], hm['model']['scale'])])
    s = float(z @ hm['model']['coef'] + hm['model']['intercept']); Q = np.array(hm['grid'])
    a = min(max(age, AGES[0]), AGES[-1]); lg = np.log(GAPS); g = np.log(min(max(f['gap_med'], GAPS[0]), GAPS[-1]))
    i = min(int(np.searchsorted(AGES, a, 'right')) - 1, len(AGES) - 2); j = min(int(np.searchsorted(lg, g, 'right')) - 1, len(GAPS) - 2)
    u, v = (a - AGES[i]) / (AGES[i + 1] - AGES[i]), (g - lg[j]) / (lg[j + 1] - lg[j])
    r = (1 - u) * (1 - v) * Q[i, j] + u * (1 - v) * Q[i + 1, j] + (1 - u) * v * Q[i, j + 1] + u * v * Q[i + 1, j + 1]
    return s, float(np.interp(s, r, PCTS, left=PCTS[0], right=PCTS[-1]))


d = os.path.join(DATA, 'nq', 'MIT-CS2PD'); g = pd.read_csv(os.path.join(d, 'GT_DataPD_MIT-CS2PD.csv'))
rows = []
for _, r in g.iterrows():
    p, h, s = clean(*read_nq(os.path.join(d, 'data_MIT-CS2PD', r['file_1'])))
    p, h = p[:400] - p[0], h[:400]
    f = features(p, h, np.zeros(len(h), int)); sc, pc = pct(M['heldout'], f, 60)
    rows.append(dict(id=int(r['pID']), pd=str(r['gt']) == 'True', pc=pc, score=sc, f={k: float(v) for k, v in f.items()}, press=[round(float(x), 4) for x in p], hold=[round(float(x), 4) for x in h]))
pdp = sorted([r for r in rows if r['pd']], key=lambda r: r['pc']); ctl = sorted([r for r in rows if not r['pd']], key=lambda r: r['pc'])
# fixed rule, not picked by eye: the middle person among those flagged, the middle of those missed, the middle control
fl, ms = [r for r in pdp if r['pc'] >= 95], [r for r in pdp if r['pc'] < 95]
ex = [('flagged', fl[len(fl) // 2]), ('missed', ms[len(ms) // 2]), ('without', ctl[len(ctl) // 2])]
print([(k, r['pd'], round(r['pc'], 1), len(r['hold'])) for k, r in ex], 'flagged on first 400 keys', len(fl), 'of', len(pdp))
json.dump([dict(kind=k, pd=r['pd'], press=r['press'], hold=r['hold']) for k, r in ex], open(os.path.join(H, '..', 'src', 'data', 'examples.json'), 'w'))
json.dump([dict(press=r['press'], hold=r['hold'], f=r['f'], score=r['score'], pc=r['pc'], pc60=pct(M, r['f'], 47)[1]) for r in rows[::4]], open(os.path.join(H, '..', 'tests', 'fixtures.json'), 'w'))
