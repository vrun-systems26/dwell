"""Two design questions raised by final.py: can the score be equal-weight, and
should people be compared with others of the same typing speed?  python fairness.py"""
import hashlib, json, os
import numpy as np
import pandas as pd
from evaluate import MODELS, OUT, auc_ci, score, wilson
from features import DATA, SETS, load_nq, matrix

A = pd.read_csv(os.path.join(DATA, 'aalto_features.csv'))
half = A.id.map(lambda i: int(hashlib.sha256(str(i).encode()).hexdigest(), 16) % 2)
REF, CHK = A[half == 0].copy(), A[(half == 1) & (A.AGE >= 40)].copy()
D = {'CS1': load_nq('CS1'), 'CS2': load_nq('CS2')}
F = SETS['spread3']
fits = {
    'logistic C=1': lambda tr: (lambda m: (lambda d: score(m, matrix(d, F))))(MODELS['logistic C=1']().fit(matrix(tr, F), tr.y)),
    'logistic C=0.03': lambda tr: (lambda m: (lambda d: score(m, matrix(d, F))))(MODELS['logistic C=0.03']().fit(matrix(tr, F), tr.y)),
    # equal weight: mean of the three log features, each scaled by browser typists (no Parkinson's labels used at all)
    'equal weight': lambda tr: (lambda mu, sd: (lambda d: ((matrix(d, F) - mu) / sd).mean(1)))(matrix(REF, F).mean(0), matrix(REF, F).std(0)),
}
R = {}


def ref_pct(f, people, by_speed, age=None):
    """percentile among the 400 nearest reference typists in age (and log gap)"""
    z = f(REF); ra, rg = REF.AGE.to_numpy(float), np.log(REF.gap_med.to_numpy())
    sp = f(people); a = np.full(len(people), age, float) if age else people.AGE.to_numpy(float); g = np.log(people.gap_med.to_numpy()); out = []
    for s, x, y in zip(sp, a, g):
        d = ((ra - x) / 8) ** 2 + (((rg - y) / 0.15) ** 2 if by_speed else 0)
        near = np.argpartition(d, 400)[:400]; out.append(100 * np.mean(z[near] < s))
    return np.array(out)


for name, mk in fits.items():
    for by in (False, True):
        r = {}; tot = [0, 0, 0, 0]
        for a, b in (('CS1', 'CS2'), ('CS2', 'CS1')):
            f = mk(D[a]); d = D[b]; pc = ref_pct(f, d, by, 60); y = d.y.to_numpy()
            r[f'{a}->{b}'] = dict(auc=auc_ci(y, f(d)), auc_percentile=auc_ci(y, pc), sens=int((pc[y == 1] >= 95).sum()), pd=int(y.sum()), wrong=int((pc[y == 0] >= 95).sum()), ctl=int((y == 0).sum()))
            tot[0] += r[f'{a}->{b}']['sens']; tot[1] += r[f'{a}->{b}']['pd']; tot[2] += r[f'{a}->{b}']['wrong']; tot[3] += r[f'{a}->{b}']['ctl']
        f = mk(pd.concat(D.values())); c = CHK.sample(2500, random_state=0); pc = ref_pct(f, c, by)
        r['false alarms 40+'] = wilson(int((pc >= 95).sum()), len(c))
        r['by speed'] = {f'{lo}-{hi}': wilson(int((pc[(c.AVG_WPM_15 >= lo) & (c.AVG_WPM_15 < hi)] >= 95).sum()), int(((c.AVG_WPM_15 >= lo) & (c.AVG_WPM_15 < hi)).sum())) for lo, hi in [(0, 35), (35, 50), (50, 70), (70, 200)]}
        r['sens'] = wilson(tot[0], tot[1]); r['wrong'] = wilson(tot[2], tot[3]); R[f'{name} | speed-matched={by}'] = r
        print(f'{name:16s} speed={by!s:5s} auc', [round(r[k]['auc'][0], 3) for k in ('CS1->CS2', 'CS2->CS1')], 'auc of percentile', [round(r[k]['auc_percentile'][0], 3) for k in ('CS1->CS2', 'CS2->CS1')], f'caught {tot[0]}/{tot[1]} wrong {tot[2]}/{tot[3]}', 'FA', round(r['false alarms 40+'][0], 3), 'by speed', [round(v[0], 3) for v in r['by speed'].values()])
print('gap medians: clinic ctl', D['CS2'][D['CS2'].y == 0].gap_med.median(), 'PD', D['CS2'][D['CS2'].y == 1].gap_med.median(), 'browser 50+', REF[REF.AGE >= 50].gap_med.describe()[['25%', '50%', '75%', 'max']].round(3).tolist())
json.dump(R, open(os.path.join(OUT, 'fairness.json'), 'w'), indent=1)
