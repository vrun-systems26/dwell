"""Final recipe, browser calibration, and the model file the app ships.  python final.py
Score: logistic regression (C=0.03) on three log "unevenness" features, weights from the clinic studies.
Meaning: percentile of that score among browser typists of the same age and typing speed."""
import hashlib, json, os
import numpy as np
import pandas as pd
from sklearn.model_selection import LeaveOneOut
from evaluate import MODELS, OUT, auc_ci, icc21, score, wilson
from features import DATA, SETS, load_nq, load_tappy, matrix

HERE = os.path.dirname(__file__)
F, M = SETS['spread3'], 'logistic C=0.03'
A = pd.read_csv(os.path.join(DATA, 'aalto_features.csv'))
half = A.id.map(lambda i: int(hashlib.sha256(str(i).encode()).hexdigest(), 16) % 2)
REF, CHK = A[half == 0].copy(), A[half == 1].copy()
D = {'CS1': load_nq('CS1'), 'CS2': load_nq('CS2')}
N = pd.concat(D.values(), ignore_index=True)
fit = lambda d: MODELS[M]().fit(matrix(d, F), d.y)
sc = lambda m, d: score(m, matrix(d, F))
AGES = [20, 30, 40, 50, 60, 70]
GAPS = [0.11, 0.14, 0.17, 0.20, 0.24, 0.28, 0.33, 0.40]  # median seconds between key presses
PCTS = [1, 2.5, 5, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 92.5, 95, 97, 98, 99, 99.5]
ra, rg = REF.AGE.to_numpy(float), np.log(REF.gap_med.to_numpy())


def grid(m):
    z = sc(m, REF); Q = np.zeros((len(AGES), len(GAPS), len(PCTS)))
    for i, a in enumerate(AGES):
        for j, g in enumerate(GAPS):
            d = ((ra - a) / 8) ** 2 + ((rg - np.log(g)) / 0.15) ** 2
            Q[i, j] = np.percentile(z[np.argpartition(d, 400)[:400]], PCTS)
    return Q


def row(Q, age, gap):
    a = min(max(age, AGES[0]), AGES[-1]); g = np.log(min(max(gap, GAPS[0]), GAPS[-1])); lg = np.log(GAPS)
    i = min(int(np.searchsorted(AGES, a, 'right')) - 1, len(AGES) - 2); j = min(int(np.searchsorted(lg, g, 'right')) - 1, len(GAPS) - 2)
    u, v = (a - AGES[i]) / (AGES[i + 1] - AGES[i]), (g - lg[j]) / (lg[j + 1] - lg[j])
    return (1 - u) * (1 - v) * Q[i, j] + u * (1 - v) * Q[i + 1, j] + (1 - u) * v * Q[i, j + 1] + u * v * Q[i + 1, j + 1]


def percentile(Q, s, age, gap):
    return np.array([float(np.interp(x, row(Q, a, g), PCTS, left=PCTS[0], right=PCTS[-1])) for x, a, g in zip(np.atleast_1d(s), np.broadcast_to(age, np.shape(np.atleast_1d(s))), np.broadcast_to(gap, np.shape(np.atleast_1d(s))))])


FLAG, AGE0 = 95.0, 60  # the clinic files give no ages; the age-60 reference is used for them
R = {'recipe': ['iqr, wsd, adj', M], 'people': {'reference': len(REF), 'check': len(CHK), 'check 40+': int((CHK.AGE >= 40).sum())}}
tot = {f: [0, 0] for f in (80, 90, 95)}
for a, b in (('CS1', 'CS2'), ('CS2', 'CS1')):
    m = fit(D[a]); Q = grid(m); p = sc(m, D[b]); y = D[b].y.to_numpy(); pc = percentile(Q, p, AGE0, D[b].gap_med)
    R[f'{a}->{b}'] = dict(auc_score=auc_ci(y, p), auc_percentile=auc_ci(y, pc))
    for f in (80, 90, 95):
        k, w = int((pc[y == 1] >= f).sum()), int((pc[y == 0] >= f).sum()); tot[f][0] += k; tot[f][1] += w
        R[f'{a}->{b}'][f'sens@{f}'] = [k, *wilson(k, int(y.sum()))]; R[f'{a}->{b}'][f'spec@{f}'] = [int((y == 0).sum()) - w, *wilson(int((y == 0).sum()) - w, int((y == 0).sum()))]
    R[f'{a}->{b}']['age sensitivity of caught@95'] = {ag: int((percentile(Q, p, ag, D[b].gap_med)[y == 1] >= 95).sum()) for ag in (50, 60, 70)}
R['both studies'] = {f'@{f}': dict(caught=wilson(tot[f][0], 42), n=[tot[f][0], 42], wrongly_flagged=[tot[f][1], 43]) for f in tot}
X, yy = matrix(N, F), N.y.to_numpy(); lo = np.zeros(len(yy))
for tr, te in LeaveOneOut().split(X): lo[te] = score(MODELS[M]().fit(X[tr], yy[tr]), X[te])
R['leave-one-out'] = auc_ci(yy, lo)

m = fit(N); Q = grid(m)
CHK['pc'] = percentile(Q, sc(m, CHK), CHK.AGE, CHK.gap_med); g = CHK[CHK.AGE >= 40]
fa = lambda d, f=FLAG: [len(d), *wilson(int((d.pc >= f).sum()), len(d))]
R['false alarms 40+'] = {f'@{f}': fa(g, f) for f in (80, 90, 95)}
R['false alarms by group @95'] = {**{f'age {a}-{b}': fa(CHK[CHK.AGE.between(a, b)]) for a, b in [(18, 29), (30, 39), (40, 49), (50, 59), (60, 69), (70, 90)]},
    **{f'{c.lower()} {v}': fa(d) for c in ('FINGERS', 'KEYBOARD_TYPE', 'GENDER') for v, d in g.groupby(c) if len(d) >= 50},
    **{f'wpm {a}-{b}': fa(g[g.AVG_WPM_15.between(a, b, inclusive='left')]) for a, b in [(0, 20), (20, 35), (35, 50), (50, 70), (70, 200)]}}
T = load_tappy(); T['pc'] = percentile(Q, sc(m, T), T.age, T.gap_med)
R['tappy (at home, self-reported)'] = dict(n=len(T), pd=int(T.y.sum()), auc=auc_ci(T.y, T.pc), flagged_pd=wilson(int((T[T.y == 1].pc >= FLAG).sum()), int(T.y.sum())), flagged_no=wilson(int((T[T.y == 0].pc >= FLAG).sum()), int((T.y == 0).sum())))
mm = fit(D['CS2']); QQ = grid(mm); V = load_nq('CS1', visits=True); V['p'] = sc(mm, V); V['pc'] = percentile(QQ, V.p, AGE0, V.gap_med); R['repeat'] = {}
for nm, v in (('all', V), ('without PD', V[V.y == 0]), ('with PD', V[V.y == 1])):
    w = v.pivot(index='id', columns='visit', values='p').dropna(); R['repeat'][nm] = [len(w), icc21(w[0], w[1])]
w = V.pivot(index='id', columns='visit', values='pc').dropna(); yv = V.groupby('id').y.first().loc[w.index].to_numpy()
R['repeat']['same answer both visits'] = [int(((w[0] >= FLAG) == (w[1] >= FLAG)).sum()), len(w)]
R['repeat']['flagged at both visits'] = dict(pd=[int(((w[0] >= FLAG) & (w[1] >= FLAG))[yv == 1].sum()), int(yv.sum())], no=[int(((w[0] >= FLAG) & (w[1] >= FLAG))[yv == 0].sum()), int((yv == 0).sum())])
R['length'] = {L: [auc_ci(te.y, sc(fit(D[a]), te), B=1)[0] for a, b in (('CS1', 'CS2'), ('CS2', 'CS1')) for te in [load_nq(b, limit=L)]] for L in (100, 150, 200, 300, 400, 500, 750, 1000)}
R['rounding ms'] = {int(q * 1000): [auc_ci(te.y, sc(fit(D[a]), te), B=1)[0] for a, b in (('CS1', 'CS2'), ('CS2', 'CS1')) for te in [load_nq(b, quant=q)]] for q in (0.001, 0.004, 0.008, 0.016)}
sens, f5 = R['both studies']['@95']['caught'][0], R['false alarms 40+']['@95'][1]
R['if flagged, chance of PD'] = {str(p): float(sens * p / (sens * p + f5 * (1 - p))) for p in (0.005, 0.01, 0.02, 0.05)}
json.dump(R, open(os.path.join(OUT, 'final.json'), 'w'), indent=1)
for k, v in R.items(): print(k, json.dumps(v)[:900])


def lin(m):
    s, c = m.named_steps['standardscaler'], m.named_steps['logisticregression']
    return dict(mean=s.mean_.tolist(), scale=s.scale_.tolist(), coef=c.coef_[0].tolist(), intercept=float(c.intercept_[0]))


h = fit(D['CS1'])
ty = REF[REF.AGE.between(45, 75)]
json.dump(dict(features=F, model=lin(m), grid=Q.round(4).tolist(), ages=AGES, gaps=GAPS, pcts=PCTS, flag=FLAG,
               heldout=dict(model=lin(h), grid=grid(h).round(4).tolist(), note='trained on CS1 only; used for the example recordings, which come from CS2'),
               typical={f: [float(x) for x in np.percentile(ty[f], [5, 25, 50, 75, 95])] for f in F + ['med', 'gap_med']}), open(os.path.join(HERE, '..', 'model.json'), 'w'))
print('weights', lin(m)['coef'])
