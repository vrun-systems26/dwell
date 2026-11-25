"""False alarms among browser typists (PROTOCOL rule 8).  python browser.py"""
import hashlib, json, os
import numpy as np
import pandas as pd
from evaluate import MODELS, OUT, oof, score, select, wilson, auc_ci
from features import DATA, SETS, load_nq, load_tappy, matrix

A = pd.read_csv(os.path.join(DATA, 'aalto_features.csv'))
half = A.id.map(lambda i: int(hashlib.sha256(str(i).encode()).hexdigest(), 16) % 2)
REF, CHK = A[half == 0], A[half == 1]
D = {'CS1': load_nq('CS1'), 'CS2': load_nq('CS2')}
N = pd.concat(D.values())
R = {'aalto': dict(people=len(A), reference=len(REF), check=len(CHK))}
(cv, s, m), grid = select(N)
R['pooled'] = dict(chosen=[s, m], innerAUC=cv); print('pooled choice', cv, s, m)
model = MODELS[m]().fit(matrix(N, SETS[s]), N.y)
thr = float(np.quantile(oof(N, s, m)[N.y == 0], 0.9))
bands = [(18, 29), (30, 39), (40, 49), (50, 59), (60, 69), (70, 90)]


def table(flag_of, name):
    out = {}
    for lo, hi in bands:
        c = CHK[CHK.AGE.between(lo, hi)]
        k = int(flag_of(c).sum()); out[f'{lo}-{hi}'] = [len(c), *wilson(k, len(c))]
    c = CHK[CHK.AGE >= 40]; out['40+'] = [len(c), *wilson(int(flag_of(c).sum()), len(c))]
    print(name, {k: (v[0], round(v[1], 3)) for k, v in out.items()}); return out


R['raw'] = table(lambda c: score(model, matrix(c, SETS[s])) > thr, 'raw threshold')
print('medians (log scale not used), clinic controls vs Aalto 50-69')
for f in ['med', 'sd', 'iqr', 'spread', 'wsd', 'adj', 'gap_med']:
    a = REF[REF.AGE.between(50, 69)]
    print(f'  {f:8s} ctl {N[N.y == 0][f].median():.4f}  PD {N[N.y == 1][f].median():.4f}  aalto {a[f].median():.4f}  tappy ctl {load_tappy().query("y==0")[f].median() if f == "med" else float("nan"):.4f}')
json.dump(R, open(os.path.join(OUT, 'browser.json'), 'w'), indent=1)
