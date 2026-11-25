"""Timing features for adult browser typists (Aalto 136M).  python aalto.py
Only timing features leave this script; no typed text is kept."""
import os, zipfile
from multiprocessing import Pool
import numpy as np
import pandas as pd
from features import DATA, clean, features, side_of

Z = os.path.join(DATA, 'Keystrokes.zip')
OUT = os.path.join(DATA, 'aalto_features.csv')
_z = None


def one(pid):
    global _z
    if _z is None:
        _z = zipfile.ZipFile(Z)
    try:
        t = _z.read(f'Keystrokes/files/{pid}_keystrokes.txt').decode('utf8', 'replace')
    except KeyError:
        return None
    p, h, s = [], [], []
    for l in t.split('\n')[1:]:
        x = l.split('\t')
        if len(x) < 9 or len(x[7]) != 1 or x[7] == ' ':
            continue
        try:
            a, b = float(x[5]), float(x[6])
        except ValueError:
            continue
        p.append(a / 1000); h.append((b - a) / 1000); s.append(side_of(x[7]))
    if len(h) < 300:
        return None
    p, h, s = clean(p, h, s)
    return {'id': pid, **features(p, h, s)} if len(h) >= 300 else None


if __name__ == '__main__':
    z = zipfile.ZipFile(Z)
    m = pd.read_csv(z.open('Keystrokes/files/metadata_participants.txt'), sep='\t', quoting=3, encoding='latin1', on_bad_lines='skip')
    m['AGE'] = pd.to_numeric(m.AGE, errors='coerce')
    m = m[m.AGE.between(18, 90) & m.KEYBOARD_TYPE.isin(['laptop', 'full'])]
    old, young = m[m.AGE >= 40], m[m.AGE < 40].sample(6000, random_state=0)
    m = pd.concat([old, young]); print('people', len(m), 'aged 40+', len(old))
    with Pool(8) as pool:
        rows = [r for r in pool.imap_unordered(one, m.PARTICIPANT_ID.tolist(), chunksize=50) if r]
    f = pd.DataFrame(rows).merge(m[['PARTICIPANT_ID', 'AGE', 'GENDER', 'KEYBOARD_TYPE', 'FINGERS', 'AVG_WPM_15', 'COUNTRY']], left_on='id', right_on='PARTICIPANT_ID').drop(columns='PARTICIPANT_ID')
    f.to_csv(OUT, index=False); print('kept', len(f), f.AGE.describe().round(1).to_dict(), 'median keys', f.n.median())
