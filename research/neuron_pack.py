# Packs the sculpted mesh for the web: points renumbered in the order triangles use them, stored
# as differences, byte planes split, gzipped. src/scene.ts reverses it.
# python neuron_pack.py in.bin out.dat
import gzip
import sys

import numpy as np

b = open(sys.argv[1], 'rb').read()
nv, nf = (int(x) for x in np.frombuffer(b, np.uint32, 2))
o = 16


def take(t, k):
    global o
    a = np.frombuffer(b, t, k, o)
    o += (a.nbytes + 3) & ~3
    return a


P = take(np.int16, nv * 3).reshape(-1, 3)
N = take(np.int8, nv * 3).reshape(-1, 3)
D, A, R = take(np.uint16, nv), take(np.uint8, nv), take(np.uint8, nv)
F = np.frombuffer(b, np.uint32, nf * 3, o)
order = F[np.sort(np.unique(F, return_index=True)[1])]
new = np.empty(nv, np.int64)
new[order] = np.arange(nv)
F = new[F]
P, N, D, A, R = P[order], N[order], D[order], A[order], R[order]
out = []
zig16 = lambda x: (((lambda v: (v << 1) ^ (v >> 31))(x.astype(np.int16).astype(np.int32))) & 0xFFFF).astype(np.uint16)
split = lambda u, n: [out.append(((u >> (8 * k)) & 255).astype(np.uint8).tobytes()) for k in range(n)]
for c in range(3):
    split(zig16(np.diff(P[:, c].astype(np.int32), prepend=0)), 2)
for c in range(3):
    out.append(np.ascontiguousarray(N[:, c]).tobytes())
split(zig16(np.diff(D.astype(np.int32), prepend=0)), 2)
out += [A.tobytes(), R.tobytes()]
f = np.diff(F, prepend=0)
f = ((f << 1) ^ (f >> 63)).astype(np.uint32)
assert f.max() < 2 ** 24
split(f, 3)
open(sys.argv[2], 'wb').write(gzip.compress(b[:16] + b''.join(out), 9, mtime=0))
