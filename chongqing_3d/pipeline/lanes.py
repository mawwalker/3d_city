"""The lanes of a road, read from the map once for every step."""
import re
import numpy as np

RC = dict(
    motorway=0, trunk=1, primary=2, secondary=3, tertiary=4,
    residential=5, unclassified=5, living_street=6, service=7,
    pedestrian=8, footway=9, path=9, cycleway=9, steps=9, track=10, busway=4,
)
LANES_1 = {0: 3, 1: 3, 2: 3, 3: 2, 4: 2, 11: 2}
LANES_2 = {0: 3, 1: 3, 2: 2, 3: 2, 4: 1, 11: 1}
LW_NEED = 3.0
LW_LEAST = 2.8


def num(s):
    if not isinstance(s, str):
        return np.nan
    m = re.match(r"\s*(-?[0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan


def road_lanes(hw, rt):
    n = len(hw)
    hw = np.asarray(hw, dtype=object)
    cls = np.full(n, -1)
    for k, v in RC.items():
        cls[hw == k] = v
    link = np.array([isinstance(h, str) and h.endswith("_link") for h in hw])
    cls[link] = 11
    oneway = np.array([t.get("oneway") in ("yes", "1", "true", "-1") or t.get("junction") == "roundabout" for t in rt]) | np.isin(hw, ["motorway"]) | link
    ln = np.array([num(t.get("lanes")) for t in rt])
    lf = np.array([num(t.get("lanes:forward")) for t in rt])
    lb = np.array([num(t.get("lanes:backward")) for t in rt])
    nf = np.zeros(n, int)
    nb = np.zeros(n, int)
    tagged = np.zeros(n, bool)
    for c in LANES_1:
        m = cls == c
        one = m & oneway
        t1 = one & np.isfinite(ln) & (ln >= 1)
        nf[one] = LANES_1[c]
        nf[t1] = np.round(ln[t1]).astype(int)
        tagged |= t1
        two = m & ~oneway
        nf[two] = LANES_2[c]
        nb[two] = LANES_2[c]
        t2 = two & np.isfinite(ln) & (ln >= 2)
        nf[t2] = np.ceil(ln[t2] / 2).astype(int)
        nb[t2] = np.floor(ln[t2] / 2).astype(int)
        tagged |= t2
        tf = two & np.isfinite(lf) & (lf >= 1)
        tb = two & np.isfinite(lb) & (lb >= 1)
        nf[tf] = np.round(lf[tf]).astype(int)
        nb[tb] = np.round(lb[tb]).astype(int)
        m1 = tf & ~tb & t2
        nb[m1] = np.maximum(1, np.round(ln[m1]).astype(int) - nf[m1])
        m1 = tb & ~tf & t2
        nf[m1] = np.maximum(1, np.round(ln[m1]).astype(int) - nb[m1])
        tagged |= tf | tb
    drv = np.isin(cls, list(LANES_1))
    nf = np.where(drv, np.clip(nf, 1, 8), 0)
    nb = np.where(drv & ~oneway, np.clip(nb, 1, 8), 0)
    wneed = np.where(drv, (nf + nb) * LW_NEED + 0.6, 0.0)
    return dict(cls=cls, oneway=oneway, lanes=ln, nf=nf, nb=nb, tagged=tagged, wneed=wneed)
