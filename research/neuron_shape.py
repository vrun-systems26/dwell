# Sculpts a solid mesh from a real traced neuron.
# python neuron_shape.py in.swc out.bin 0.34 150 1.9   (needs numpy, scipy, scikit-image)
# The shipped file used MYUX58R; the blurred cells behind it use MYUX100 with voxel 0.85, thickness 2.2.
# Trace: NeuroMorpho.Org, Henny archive, MYUX58R (dopamine cell, mouse substantia nigra pars compacta).
# Meza R. C. et al., J. Neurosci. 38, 733-744 (2018). Get the .swc from neuromorpho.org; it is not copied here.
# Branch paths and relative thickness come from the trace. Thickness is scaled up to be visible, and
# small membrane detail (swellings, spines, lumps) is added by hand.
import sys
import numpy as np
from scipy.spatial import cKDTree
from skimage.measure import marching_cubes

src, out, h, crop, thick = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
plain = '--plain' in sys.argv
rng = np.random.default_rng(7)
rows = [list(map(float, l.split())) for l in open(src) if l.strip() and l[0] != '#']
P = {int(r[0]): np.array(r[2:5]) for r in rows}; RAD = {int(r[0]): r[5] for r in rows}; TY = {int(r[0]): int(r[1]) for r in rows}; PAR = {int(r[0]): int(r[6]) for r in rows}
kids = {}
for i, p in PAR.items(): kids.setdefault(p, []).append(i)
soma = [i for i in P if TY[i] == 1]; som = np.array([P[i] for i in soma]); sr = np.array([RAD[i] for i in soma])
C = np.average(som, axis=0, weights=sr)
for i in P: P[i] = P[i] - C
som = som - C
print('soma points', len(soma), 'extent', np.ptp(som, axis=0).round(1), 'r', sr.round(1)[:8])

# ---- noise ----
PERM = rng.permutation(256).astype(np.int64); GR = rng.normal(size=(256, 3)); GR /= np.linalg.norm(GR, axis=1)[:, None]
def noise(p):
    i = np.floor(p).astype(np.int64); f = p - i; u = f * f * (3 - 2 * f); r = np.zeros(len(p))
    for c in range(8):
        o = np.array([c & 1, c >> 1 & 1, c >> 2 & 1]); q = i + o
        g = GR[PERM[(PERM[(PERM[q[:, 0] & 255] + q[:, 1]) & 255] + q[:, 2]) & 255]]
        r += (g * (f - o)).sum(1) * np.prod(np.where(o, u, 1 - u), axis=1)
    return r

# ---- branches: every path between forks, resampled ----
branches = []
def trace(start, parent_pt, parent_r, d0, depth):
    pts, rr = [parent_pt], [parent_r]; i = start
    while True:
        pts.append(P[i]); rr.append(RAD[i]); k = [c for c in kids.get(i, []) if TY[c] != 1]
        if len(k) != 1: break
        i = k[0]
    pts = np.array(pts); rr = np.array(rr); seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    L = seg[-1]
    if L < 0.4:
        for c in k: trace(c, pts[-1], rr[-1], d0 + L, depth + 1)
        return
    n = max(3, int(L / 0.55)); s = np.linspace(0, L, n); X = np.stack([np.interp(s, seg, pts[:, a]) for a in range(3)], 1); r = np.interp(s, seg, rr)
    # tracing steps are coarse in z: smooth lightly, keep the kinks
    w = 7; pad = lambda a: np.concatenate([np.repeat(a[:1], w, 0), a, np.repeat(a[-1:], w, 0)]); ker = np.hanning(2 * w + 1); ker /= ker.sum()
    S = np.stack([np.convolve(pad(X[:, a]), ker, 'valid') for a in range(3)], 1); S[0], S[-1] = X[0], X[-1]; e = np.minimum(1, np.minimum(np.arange(n), np.arange(n)[::-1]) / w)[:, None]; S = X * (1 - e) + S * e
    S[:, 2] = np.convolve(pad(S[:, 2]), np.ones(15) / 15, 'valid') * e[:, 0] + S[:, 2] * (1 - e[:, 0])
    r = np.convolve(pad(r), np.ones(15) / 15, 'valid')
    branches.append(dict(X=S, r=r, s=s + d0, ty=TY[start], tip=len(k) == 0))
    for c in k: trace(c, S[-1], r[-1], d0 + L, depth + 1)
for i in P:
    if TY[i] != 1 and (PAR[i] == -1 or TY[PAR[i]] == 1):
        trace(i, P[i], RAD[i], 0.0, 0)
branches = [b for b in branches if (np.linalg.norm(b['X'], axis=1) < crop).any()]
branches = [b for b in branches if b['s'][-1] > 22 or np.linalg.norm(b['X'], axis=1).max() > 24]
print('branches', len(branches), 'length', round(sum(b['s'][-1] - b['s'][0] for b in branches)))

# ---- capsule chain list ----
A, B, RA, RB, SD, BR, RN = [], [], [], [], [], [], []
def add(a, b, ra, rb, d, br): A.append(a); B.append(b); RA.append(ra); RB.append(rb); SD.append(d); BR.append(br); RN.append(0)
SOMA_R = 8.6
for bi, b in enumerate(branches):
    X, s, n = b['X'], b['s'], len(b['X']); ax = b['ty'] == 2
    r = np.maximum(b['r'], 0.17) ** 0.62 * thick * 0.72 + (0.10 if ax else 0.16)
    if not plain:
        # swellings: irregular, not a string of even beads
        sw = np.zeros(n); t = s[0] + rng.uniform(2, 10)
        while t < s[-1]:
            amp = rng.gamma(1.6, 0.16) * (1.5 if ax else 1.0); wid = rng.uniform(0.6, 2.4); sw += amp * np.exp(-((s - t) / wid) ** 2); t += rng.gamma(2.0, 5.0)
        slow = noise(np.stack([s / 9 + bi * 17, s * 0 + bi, s * 0], 1)) * 0.5 + noise(np.stack([s / 3.1 + bi * 5, s * 0 + 9, s * 0], 1)) * 0.28
        r = r * np.clip(1 + slow * 0.6, 0.6, 1.4) + np.minimum(sw, 0.6) * (0.36 + r * 0.22)
        # meander finer than the tracing can see
        jit = np.stack([noise(np.stack([s / 4.2 + bi * 3, s * 0 + a * 11, s * 0 + 3], 1)) for a in range(3)], 1) * 0.75; e = np.minimum(1, np.minimum(np.arange(n), np.arange(n)[::-1]) / 8)[:, None]; X = X + jit * e
        if b['tip']: r = r * np.clip((s[-1] - s) / 5, 0.25, 1) ** 0.5
    # roots flare where they leave the body
    dc = np.linalg.norm(X, axis=1); r = r + (1.5 if ax else 2.5) * np.exp(-np.maximum(0, dc - SOMA_R) / 4.6) * np.exp(-np.maximum(0, s - 0) / 18)
    if b['s'][0] < 1:  # a root starting off-centre must not poke out as a knob
        q = np.maximum(1, np.linalg.norm(X, axis=1)); inside = q < 9; r = np.where(inside, np.minimum(r, np.maximum(0.8, 9.6 - q)), r)
    b['X'], b['R'] = X, r
    for k in range(n - 1):
        if np.linalg.norm(X[k]) < crop + 4: add(X[k], X[k + 1], r[k], r[k + 1], max(0.0, s[k]), bi)
    if s[0] < 1:  # join roots to the middle of the body
        add(X[0] * 0.35, X[0], r[0] * 0.8, r[0], 0.0, bi)
nb = len(branches)
if not plain:
    spine = 0
    for bi, b in enumerate(branches):
        X, r, s = b['X'], b['R'], b['s']; t = s[0] + 6
        while t < s[-1] - 1:
            k = int(np.searchsorted(s, t)); k = min(k, len(X) - 2); tan = X[k + 1] - X[k]; tan /= np.linalg.norm(tan) + 1e-9
            v = rng.normal(size=3); v -= tan * v.dot(tan); v /= np.linalg.norm(v); v = v + tan * rng.normal() * 0.5; v /= np.linalg.norm(v)
            if np.linalg.norm(X[k]) < crop and r[k] < 2.6:
                L = rng.uniform(0.5, 1.7); a = X[k] + v * r[k] * 0.7; m = X[k] + v * (r[k] + L * 0.6) + rng.normal(size=3) * 0.12; e = X[k] + v * (r[k] + L) + rng.normal(size=3) * 0.16; hd = rng.uniform(0.24, 0.52)
                add(a, m, 0.30, 0.2, s[k], nb + spine); add(m, e, 0.2, hd, s[k], nb + spine); spine += 1
            t += rng.gamma(1.4, 5.2 if b['ty'] != 2 else 12)
    # endings of other cells pressed onto the body
    for _ in range(16):
        v = rng.normal(size=3); v /= np.linalg.norm(v); e = v * rng.uniform(7.6, 9.8); add(e, e + rng.normal(size=3) * 0.5, rng.uniform(0.35, 0.8), rng.uniform(0.3, 0.6), 0.0, nb + spine); spine += 1
    print('spines', spine)
A, B, RA, RB, SD, BR = map(np.array, (A, B, RA, RB, SD, BR)); AB = B - A; LL = (AB ** 2).sum(1) + 1e-9
MID = (A + B) / 2; SEGR = np.maximum(RA, RB) + np.sqrt(LL) / 2

# body: the traced outline averages to a lopsided bean; a few offset lobes keep it from being a ball
pc = np.linalg.svd(som - som.mean(0), full_matrices=False)[2][0]
lobes = [(np.zeros(3), 8.2), (pc * 4.6 + np.array([0.6, 0.8, 0]), 5.9), (-pc * 4.0 + np.array([-0.9, 0.5, 1.2]), 5.4), (np.array([1.8, -2.8, 1.6]), 5.2), (np.array([-2.4, 2.2, -2.2]), 5.0)]
def smin(a, b, k): q = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1); return b * (1 - q) + a * q - k * q * (1 - q)
def body(p):
    d = None
    for c, r in lobes:
        e = np.linalg.norm(p - c, axis=1) - r; d = e if d is None else smin(d, e, 2.6)
    if not plain: d = d + noise(p / 5.2 + 3) * 1.0 + noise(p / 2.8 + 9) * 0.14
    return d
tree = cKDTree(MID); RMAX = SEGR.max()
def field(p, near=3.2, want=False):
    """signed distance; optionally path distance and local radius"""
    n = len(p); d = np.full(n, 99.0); sd = np.zeros(n); rl = np.ones(n)
    lo, hi = p.min(0) - near, p.max(0) + near
    cand = np.where(((np.minimum(A, B) - np.maximum(RA, RB)[:, None] < hi) & (np.maximum(A, B) + np.maximum(RA, RB)[:, None] > lo)).all(1))[0]
    best = np.full(n, 99.0)
    if len(cand):
        for br in np.unique(BR[cand]):
            m = cand[BR[cand] == br]; db = np.full(n, 99.0); sb = np.zeros(n); rb = np.ones(n)
            for j in m:
                q = p - A[j]; t = np.clip(q @ AB[j] / LL[j], 0, 1); rr = RA[j] + (RB[j] - RA[j]) * t; e = np.sqrt(((q - t[:, None] * AB[j]) ** 2).sum(1)) - rr
                c = e < db; db[c] = e[c]; sb[c] = SD[j] + t[c] * np.sqrt(LL[j]); rb[c] = rr[c]
            c = db < best; best[c] = db[c]; sd[c] = sb[c]; rl[c] = rb[c]
            k = np.clip(rb * 0.75, 0.28, 2.6); d = smin(d, db, k)
    r2 = (p ** 2).sum(1)
    if r2.min() < 22 ** 2:
        s = body(p); c = s < best; sd[c] = 0; rl[c] = 8; d = smin(d, s, 2.8)
    if not plain:
        am = np.clip(rl, 0.3, 3)
        near_s = d < 2.0
        if near_s.any():
            q = p[near_s]; d[near_s] += noise(q / 2.4 + 21) * 0.06 * am[near_s] + noise(q / 0.9 + 5) * 0.012 * np.sqrt(am[near_s])
    return (d, sd, rl) if want else d

# ---- sparse marching cubes ----
N = 26; bs = N * h; keys = set()
for a, b, r in zip(A, B, np.maximum(RA, RB)):
    lo = np.floor((np.minimum(a, b) - r - 0.9) / bs).astype(int); hi = np.floor((np.maximum(a, b) + r + 0.9) / bs).astype(int)
    for x in range(lo[0], hi[0] + 1):
        for y in range(lo[1], hi[1] + 1):
            for z in range(lo[2], hi[2] + 1): keys.add((x, y, z))
w = int(np.ceil(17 / bs))
for x in range(-w, w):
    for y in range(-w, w):
        for z in range(-w, w): keys.add((x, y, z))
keys = sorted(keys); print('blocks', len(keys)); V, F, nv = [], [], 0
ii = np.stack(np.meshgrid(*[np.arange(N + 1)] * 3, indexing='ij'), -1).reshape(-1, 3)
for n, k in enumerate(keys):
    o = np.array(k) * N; p = (ii + o) * h; f = field(p).reshape(N + 1, N + 1, N + 1)
    if f.min() < 0 < f.max():
        v, t, _, _ = marching_cubes(f, 0.0); V.append((v + o) * h); F.append(t + nv); nv += len(v)
    if n % 400 == 0: print(n, nv, flush=True)
V, F = np.concatenate(V), np.concatenate(F)
_, first, inv = np.unique(np.round(V / h * 512).astype(np.int64), axis=0, return_index=True, return_inverse=True); V = V[first]; F = inv.reshape(-1)[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
# keep the piece that contains the body
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
g = coo_matrix((np.ones(len(F) * 2), (np.r_[F[:, 0], F[:, 1]], np.r_[F[:, 1], F[:, 2]])), shape=(len(V), len(V))); _, lab = connected_components(g, directed=False); cnt = np.bincount(lab); keep = cnt[lab] > (60 if plain else 120)
V, F = V, F[keep[F].all(1)]; u, inv = np.unique(F, return_inverse=True); V = V[u]; F = inv.reshape(-1, 3)
print('mesh', len(V), 'verts', len(F), 'tris')

# ---- normals, path distance, light blocking ----
from scipy.sparse import diags
G = coo_matrix((np.ones(len(F) * 3), (np.r_[F[:, 0], F[:, 1], F[:, 2]], np.r_[F[:, 1], F[:, 2], F[:, 0]])), shape=(len(V), len(V))).tocsr(); G = G + G.T; G = diags(1 / np.maximum(1, np.asarray(G.sum(1)).ravel())) @ G
for _ in range(6): V = V + 0.5 * (G @ V - V); V = V - 0.52 * (G @ V - V)  # a touch of smoothing that does not shrink thin branches
nn = np.zeros_like(V); fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
for c in range(3): np.add.at(nn, F[:, c], fn)
nn /= np.linalg.norm(nn, axis=1)[:, None] + 1e-12
def chunked(Q, want=False):
    key = np.floor(Q / 9).astype(int); order = np.lexsort(key.T); R = [np.zeros(len(Q)) for _ in range(3)]; ks = key[order]; cut = np.r_[0, np.where((np.diff(ks, axis=0) != 0).any(1))[0] + 1, len(Q)]
    for a, b in zip(cut[:-1], cut[1:]):
        ix = order[a:b]; r = field(Q[ix], want=True)
        for c in range(3): R[c][ix] = r[c]
    return R
d0, sd, rl = chunked(V)
if (chunked(V[:2000] + nn[:2000] * 0.3)[0] - d0[:2000]).mean() < 0: nn = -nn; F = F[:, ::-1]
# blend labels across joins so no seam shows
from scipy.sparse import diags
G = coo_matrix((np.ones(len(F) * 3), (np.r_[F[:, 0], F[:, 1], F[:, 2]], np.r_[F[:, 1], F[:, 2], F[:, 0]])), shape=(len(V), len(V))).tocsr(); G = G + G.T; G = diags(1 / np.maximum(1, np.asarray(G.sum(1)).ravel())) @ G
for _ in range(60): sd = 0.35 * sd + 0.65 * (G @ sd); rl = 0.35 * rl + 0.65 * (G @ rl)
ao = np.ones(len(V))
if not plain:
    for st, wt in ((0.5, 0.55), (1.3, 0.35), (2.8, 0.24)):
        dd = chunked(V + nn * st)[0]; ao -= wt * np.clip((st - dd) / st, 0, 1)
for _ in range(3): ao = 0.5 * ao + 0.5 * (G @ ao)
ao = np.clip(ao, 0, 1); nn[np.linalg.norm(nn, axis=1) < 0.5] = (0, 1, 0)
ext = np.abs(V).max(); print('ext', ext, 'path', sd.max(), 'ao', np.percentile(ao, [1, 25, 50, 99]).round(2))
with open(out, 'wb') as f:
    f.write(np.array([len(V), len(F)], np.uint32).tobytes()); f.write(np.array([ext, sd.max()], np.float32).tobytes())
    f.write((V / ext * 32767).round().astype(np.int16).tobytes());
    if len(V) % 2: f.write(b'\0\0')
    f.write((nn * 127).round().astype(np.int8).tobytes()); f.write(b'\0' * (-len(V) * 3 % 4))
    f.write((sd / sd.max() * 65535).astype(np.uint16).tobytes())
    if len(V) % 2: f.write(b'\0\0')
    f.write((ao * 255).astype(np.uint8).tobytes()); f.write(b'\0' * (-len(V) % 4))
    f.write((np.clip(rl / 8, 0, 1) * 255).astype(np.uint8).tobytes()); f.write(b'\0' * (-len(V) % 4))
    f.write(F.astype(np.uint32).tobytes())
