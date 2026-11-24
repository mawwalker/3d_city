"""The lanes of a road, read from the map once for every step.

A way's lanes are the map's (lanes, lanes:forward, lanes:backward) where it gives them, else the usual number for its class
of road. They do not depend on how much room the neighbouring carriageways leave: where two carriageways are mapped closer
together than their lanes need, 14_spread_roads.py moves the lines apart, and what room is still short is taken from the
cycle lane beside the lanes and from their width (down to 2.8 m) before any lane is given up.
"""
import re
import numpy as np

RC = dict(motorway=0, trunk=1, primary=2, secondary=3, tertiary=4, residential=5, unclassified=5, living_street=6, service=7,
          pedestrian=8, footway=9, path=9, cycleway=9, steps=9, track=10, busway=4)
LANES_1 = {0: 3, 1: 3, 2: 3, 3: 2, 4: 2, 11: 2}       # a one-way carriageway without a lanes tag
LANES_2 = {0: 3, 1: 3, 2: 2, 3: 2, 4: 1, 11: 1}       # a two-way road without one: each direction
LW_NEED = 3.0                                         # what a lane needs for its carriageway to be left where it is mapped
LW_LEAST = 2.8                                        # below this a lane is given up


def num(s):
    if not isinstance(s, str):
        return np.nan
    m = re.match(r"\s*(-?[0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan


def road_lanes(hw, rt):
    """hw: the highway value of each way; rt: its tags (dict). Returns arrays over the ways:
      cls      class of road (RC; slip roads 11; -1 anything else)
      oneway   a single carriageway in one direction
      nf, nb   lanes along the way and against it (0, 0 where the lanes follow from the width: back streets, service roads)
      tagged   the count is the map's
      wneed    the least width of carriageway that carries those lanes (0 where nf is 0)"""
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
    nf = np.zeros(n, int); nb = np.zeros(n, int); tagged = np.zeros(n, bool)
    for c in LANES_1:
        m = cls == c
        one = m & oneway
        t1 = one & np.isfinite(ln) & (ln >= 1)
        nf[one] = LANES_1[c]
        nf[t1] = np.round(ln[t1]).astype(int); tagged |= t1
        two = m & ~oneway
        nf[two] = LANES_2[c]; nb[two] = LANES_2[c]
        t2 = two & np.isfinite(ln) & (ln >= 2)
        nf[t2] = np.ceil(ln[t2] / 2).astype(int); nb[t2] = np.floor(ln[t2] / 2).astype(int); tagged |= t2
        # (each direction's own count where the map gives it)
        tf = two & np.isfinite(lf) & (lf >= 1); tb = two & np.isfinite(lb) & (lb >= 1)
        nf[tf] = np.round(lf[tf]).astype(int); nb[tb] = np.round(lb[tb]).astype(int)
        m1 = tf & ~tb & t2; nb[m1] = np.maximum(1, np.round(ln[m1]).astype(int) - nf[m1])
        m1 = tb & ~tf & t2; nf[m1] = np.maximum(1, np.round(ln[m1]).astype(int) - nb[m1])
        tagged |= tf | tb
    drv = np.isin(cls, list(LANES_1))
    nf = np.where(drv, np.clip(nf, 1, 8), 0)
    nb = np.where(drv & ~oneway, np.clip(nb, 1, 8), 0)
    wneed = np.where(drv, (nf + nb) * LW_NEED + 0.6, 0.0)
    return dict(cls=cls, oneway=oneway, lanes=ln, nf=nf, nb=nb, tagged=tagged, wneed=wneed)
