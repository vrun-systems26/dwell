"""Timing features. Mirrored exactly by src/core/features.ts (tests/parity)."""
import csv, glob, os
import numpy as np
import pandas as pd

DATA = os.environ.get('DWELL_DATA', os.path.join(os.path.dirname(__file__), '..', '..', 'dwell-data'))
LEFT = set('qwertasdfgzxcvb12345QWERTASDFGZXCVB!@#$%')
RIGHT = set("yuiophjklnm67890YUIOPHJKLNM^&*()[]{};:'\",.<>/?-_=+ñÑ")
MIN_HOLD, MAX_HOLD = 0.010, 1.000  # seconds; outside this a key was bounced or rested on
WINDOW = 50  # keystrokes


def clean(press, hold, side):
    """Keep usable keystrokes in press order. press and hold in seconds."""
    press, hold, side = np.asarray(press, float), np.asarray(hold, float), np.asarray(side, int)
    ok = np.isfinite(press) & np.isfinite(hold) & (hold >= MIN_HOLD) & (hold < MAX_HOLD)
    o = np.argsort(press[ok], kind='stable')
    return press[ok][o], hold[ok][o], side[ok][o]


def pct(x, q):
    """Linear-interpolated percentile, as in numpy's default."""
    return float(np.percentile(x, q))


def features(press, hold, side):
    press, hold, side = clean(press, hold, side)
    n = len(hold)
    q10, q25, q50, q75, q90 = (pct(hold, q) for q in (10, 25, 50, 75, 90))
    wins = [hold[i:i + WINDOW] for i in range(0, n - WINDOW + 1, WINDOW)] or [hold]
    wsd = float(np.median([np.std(w) for w in wins]))
    wmed = np.array([np.median(w) for w in wins])
    adj = float(np.median(np.abs(np.diff(hold)))) if n > 1 else 0.0
    gap = np.diff(press)
    gap = gap[(gap > 0.03) & (gap < 1.0)]
    L, R = hold[side == -1], hold[side == 1]
    enough = len(L) >= 20 and len(R) >= 20
    iqr = lambda v: pct(v, 75) - pct(v, 25)
    return {
        'n': n,
        'med': q50, 'sd': float(np.std(hold)), 'iqr': q75 - q25, 'spread': q90 - q10, 'wsd': wsd, 'adj': adj,
        'drift': float(np.std(wmed)),
        # scale-free versions: how uneven, whatever the keyboard
        'cv': float(np.std(hold)) / q50, 'riqr': (q75 - q25) / q50, 'rspread': (q90 - q10) / q50, 'rwsd': wsd / q50, 'radj': adj / q50,
        'tail': (q90 - q50) / max(q50 - q10, 1e-3),
        'hand_med': abs(np.log(np.median(L) / np.median(R))) if enough else 0.0,
        'hand_iqr': abs(np.log(max(iqr(L), 1e-3) / max(iqr(R), 1e-3))) if enough else 0.0,
        'gap_med': float(np.median(gap)) if len(gap) else 0.0, 'gap_cv': float(np.std(gap) / np.mean(gap)) if len(gap) else 0.0,
    }


SETS = {
    'spread3': ['iqr', 'wsd', 'adj'],
    'spread5': ['sd', 'iqr', 'spread', 'wsd', 'adj'],
    'hold8': ['med', 'sd', 'iqr', 'spread', 'wsd', 'adj', 'drift', 'tail'],
    'relative6': ['cv', 'riqr', 'rspread', 'rwsd', 'radj', 'tail'],
    'spread+hands': ['sd', 'iqr', 'spread', 'wsd', 'adj', 'hand_med', 'hand_iqr'],
    'spread+gaps': ['sd', 'iqr', 'spread', 'wsd', 'adj', 'gap_med', 'gap_cv'],
    'all': ['med', 'sd', 'iqr', 'spread', 'wsd', 'adj', 'drift', 'tail', 'hand_med', 'hand_iqr', 'gap_med', 'gap_cv'],
}
LOGGED = {'med', 'sd', 'iqr', 'spread', 'wsd', 'adj', 'drift', 'cv', 'riqr', 'rspread', 'rwsd', 'radj', 'tail', 'gap_med', 'gap_cv'}


def matrix(df, cols):
    return np.column_stack([np.log(np.maximum(df[c].to_numpy(float), 1e-4)) if c in LOGGED else df[c].to_numpy(float) for c in cols])


def side_of(ch):
    return -1 if ch in LEFT else 1 if ch in RIGHT else 0


def read_nq(path):
    p, h, s = [], [], []
    for x in csv.reader(open(path, encoding='utf8', errors='replace')):
        if len(x) != 4 or len(x[0]) != 1:  # named keys (space, shift, backspace...) are skipped
            continue
        try:
            hold, rel = float(x[1]), float(x[2])
        except ValueError:
            continue
        p.append(rel - hold); h.append(hold); s.append(side_of(x[0]))
    return p, h, s


def load_nq(study, visits=False, limit=None, quant=None):
    """One row per person (mean over visits) or per visit."""
    d = os.path.join(DATA, 'nq', f'MIT-{study}PD')
    g = pd.read_csv(os.path.join(d, f'GT_DataPD_MIT-{study}PD.csv'))
    rows = []
    for _, r in g.iterrows():
        fs = []
        for v, c in enumerate(c for c in g.columns if c.startswith('file_')):
            if not isinstance(r[c], str):
                continue
            p, h, s = clean(*read_nq(os.path.join(d, f'data_MIT-{study}PD', r[c])))
            if limit:
                p, h, s = p[:limit], h[:limit], s[:limit]
            if quant:
                rel = np.round((p + h) / quant) * quant
                p = np.round(p / quant) * quant
                h = rel - p
            if len(h) < 60:
                continue
            fs.append({**features(p, h, s), 'visit': v})
        meta = dict(id=r['pID'], study=study, y=int(str(r['gt']) == 'True'), speed=r['typingSpeed'], nq=r['nqScore'], sTap=r['sTap'], afTap=r['afTap'], updrs=r['updrs108'])
        if visits:
            rows += [{**f, **meta} for f in fs]
        elif fs:
            rows.append({**pd.DataFrame(fs).mean().to_dict(), **meta})
    return pd.DataFrame(rows)


def load_tappy():
    """At-home typists. Tappy stores no letters, only the half of the keyboard."""
    users = {}
    for p in glob.glob(os.path.join(DATA, 'tappy', '**', 'User_*.txt'), recursive=True):
        users[os.path.basename(p)[5:-4]] = dict((l.split(':', 1)[0].strip(), l.split(':', 1)[1].strip()) for l in open(p).read().splitlines() if ':' in l)
    raw = {}
    for p in glob.glob(os.path.join(DATA, 'tappy', 'Tappy Data', '*.txt')):
        for l in open(p, encoding='utf8', errors='replace'):
            x = l.rstrip('\n').split('\t')
            if len(x) < 5 or x[3] not in 'LRS':
                continue
            try:
                hh, mm, ss = x[2].split(':')
                day = int(x[1]) % 100 + 31 * (int(x[1]) // 100 % 100) + 372 * (int(x[1]) // 10000)
                t = day * 86400 + int(hh) * 3600 + int(mm) * 60 + float(ss)
                h = float(x[4]) / 1000
            except ValueError:
                continue
            if x[3] != 'S':
                raw.setdefault(x[0], []).append((t - h, h, -1 if x[3] == 'L' else 1))
    rows = []
    for k, v in raw.items():
        u = users.get(k)
        if not u:
            continue
        p, h, s = clean(*zip(*v))
        if len(h) < 2000:
            continue
        try:
            age = 2016.5 - int(u.get('BirthYear', ''))
        except ValueError:
            continue
        if age < 40:
            continue
        rows.append({**features(p, h, s), 'id': k, 'y': int(u.get('Parkinsons') == 'True'), 'age': age, 'sex': u.get('Gender'), 'lev': u.get('Levadopa') == 'True', 'impact': u.get('Impact')})
    return pd.DataFrame(rows)
