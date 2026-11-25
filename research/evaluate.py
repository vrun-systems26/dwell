"""Clinic-study evaluation, following PROTOCOL.md.  python evaluate.py"""
import json, os, warnings
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from features import SETS, load_nq, load_tappy, matrix

warnings.filterwarnings('ignore')
OUT = os.path.join(os.path.dirname(__file__), 'results')
os.makedirs(OUT, exist_ok=True)
lr = lambda C: (lambda: make_pipeline(StandardScaler(), LogisticRegression(C=C, class_weight='balanced', max_iter=5000)))
MODELS = {  # simplest first: ties go to the earlier one
    'logistic C=0.03': lr(0.03), 'logistic C=0.1': lr(0.1), 'logistic C=1': lr(1.0),
    'SVM': lambda: make_pipeline(StandardScaler(), SVC(C=1, gamma='scale', probability=False, class_weight='balanced')),
    'random forest': lambda: RandomForestClassifier(300, min_samples_leaf=4, class_weight='balanced', random_state=0, n_jobs=-1),
    'boosting': lambda: GradientBoostingClassifier(n_estimators=60, max_depth=2, subsample=0.8, random_state=0),
}


def score(m, X):
    return m.decision_function(X) if hasattr(m, 'decision_function') else m.predict_proba(X)[:, 1]


def auc_ci(y, p, B=2000, seed=0):
    rng = np.random.default_rng(seed); y, p = np.asarray(y), np.asarray(p); a = []
    while len(a) < B:
        i = rng.integers(0, len(y), len(y))
        if 0 < y[i].sum() < len(i):
            a.append(roc_auc_score(y[i], p[i]))
    return [float(roc_auc_score(y, p)), float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]


def wilson(k, n):
    if n == 0: return [0, 0, 0]
    z, p = 1.96, k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [float(p), float(max(0, c - h)), float(min(1, c + h))]


def inner(train, sname, mname):
    """Mean cross-validated AUC inside the training study."""
    X, y = matrix(train, SETS[sname]), train.y.to_numpy()
    reps = 10 if 'forest' not in mname and 'boost' not in mname else 3
    rk = RepeatedStratifiedKFold(n_splits=5, n_repeats=reps, random_state=1); a = []
    for tr, te in rk.split(X, y):
        a.append(roc_auc_score(y[te], score(MODELS[mname]().fit(X[tr], y[tr]), X[te])))
    return float(np.mean(a))


def select(train):
    grid = [(inner(train, s, m), s, m) for m in MODELS for s in SETS]
    best = max(g[0] for g in grid)
    # simplest model, then smallest set, within 0.005 of the best
    ok = [g for g in grid if g[0] >= best - 0.005]
    order = sorted(ok, key=lambda g: (list(MODELS).index(g[2]), len(SETS[g[1]])))
    return order[0], sorted(grid, reverse=True)


def oof(train, s, m):
    """Out-of-fold scores on the training study, for the threshold."""
    X, y = matrix(train, SETS[s]), train.y.to_numpy(); P = np.zeros((len(y), 0))
    rk = RepeatedStratifiedKFold(n_splits=5, n_repeats=10, random_state=2); sm = np.zeros(len(y)); c = np.zeros(len(y))
    for tr, te in rk.split(X, y):
        sm[te] += score(MODELS[m]().fit(X[tr], y[tr]), X[te]); c[te] += 1
    return sm / c


def icc21(a, b):
    """ICC(2,1), absolute agreement."""
    x = np.column_stack([a, b]); n, k = x.shape; g = x.mean(); r = x.mean(1); c = x.mean(0)
    msr = k * ((r - g) ** 2).sum() / (n - 1); msc = n * ((c - g) ** 2).sum() / (k - 1)
    mse = ((x - r[:, None] - c[None, :] + g) ** 2).sum() / ((n - 1) * (k - 1))
    return float((msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n))


if __name__ == '__main__':
    D = {'CS1': load_nq('CS1'), 'CS2': load_nq('CS2')}
    T = load_tappy()
    R = {'people': {k: [len(v), int(v.y.sum())] for k, v in D.items()}, 'cross': {}}
    for a, b in (('CS1', 'CS2'), ('CS2', 'CS1')):
        (cv, s, m), grid = select(D[a])
        model = MODELS[m]().fit(matrix(D[a], SETS[s]), D[a].y)
        p = score(model, matrix(D[b], SETS[s])); y = D[b].y.to_numpy()
        o = oof(D[a], s, m); thr = float(np.quantile(o[D[a].y == 0], 0.9))
        R['cross'][f'{a}->{b}'] = dict(chosen=[s, m], innerAUC=cv, auc=auc_ci(y, p), threshold=thr, sens=wilson(int((p[y == 1] > thr).sum()), int(y.sum())), spec=wilson(int((p[y == 0] <= thr).sum()), int((y == 0).sum())), top5=[[round(g[0], 3), g[1], g[2]] for g in grid[:5]],
                                      perModel={mn: max(round(g[0], 3) for g in grid if g[2] == mn) for mn in MODELS})
        print(f'{a}->{b}', json.dumps(R['cross'][f'{a}->{b}'], indent=0).replace('\n', ' '))
        # at-home test: never used for any choice
        tp = score(model, matrix(T, SETS[s]))
        R['cross'][f'{a}->Tappy'] = dict(n=len(T), pd=int(T.y.sum()), auc=auc_ci(T.y, tp)); print('   -> Tappy', R['cross'][f'{a}->Tappy'])
    N = pd.concat(D.values())
    R['comparisons'] = {
        'typing speed': auc_ci(N.y, -N.speed), 'published neuroQWERTY index': auc_ci(N.y, N.nq),
        **{k: auc_ci(N.dropna(subset=[c]).y, -N.dropna(subset=[c])[c]) for k, c in (('single-key tapping test (clinic)', 'sTap'), ('alternating tapping test (clinic)', 'afTap'))}}
    print(json.dumps(R['comparisons'], indent=0))
    # repeatability: CS1 visits scored by the CS2 model
    s, m = R['cross']['CS2->CS1']['chosen']
    model = MODELS[m]().fit(matrix(D['CS2'], SETS[s]), D['CS2'].y); V = load_nq('CS1', visits=True); V['p'] = score(model, matrix(V, SETS[s]))
    w = V.pivot(index='id', columns='visit', values='p').dropna(); R['icc'] = dict(n=len(w), icc=icc21(w[0], w[1]), r=float(np.corrcoef(w[0], w[1])[0, 1])); print('repeat', R['icc'])
    R['length'] = {}; R['rounding'] = {}
    for L in (100, 200, 300, 500, 750, 1000):
        x = {k: load_nq(k, limit=L) for k in D}; R['length'][L] = [float(roc_auc_score(x[b].y, score(MODELS[R['cross'][f'{a}->{b}']['chosen'][1]]().fit(matrix(x[a], SETS[R['cross'][f'{a}->{b}']['chosen'][0]]), x[a].y), matrix(x[b], SETS[R['cross'][f'{a}->{b}']['chosen'][0]])))) for a, b in (('CS1', 'CS2'), ('CS2', 'CS1'))]
    for q in (0.001, 0.004, 0.008, 0.016):
        R['rounding'][q] = []
        for a, b in (('CS1', 'CS2'), ('CS2', 'CS1')):
            s, m = R['cross'][f'{a}->{b}']['chosen']; te = load_nq(b, quant=q)
            R['rounding'][q].append(float(roc_auc_score(te.y, score(MODELS[m]().fit(matrix(D[a], SETS[s]), D[a].y), matrix(te, SETS[s])))))
    print('length', R['length']); print('rounding', R['rounding'])
    json.dump(R, open(os.path.join(OUT, 'clinic.json'), 'w'), indent=1)
