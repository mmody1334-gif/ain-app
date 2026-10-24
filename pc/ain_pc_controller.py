#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
عين — برنامج الحاسوب
=====================
يستعمل كاميرا الحاسوب ليتعرّف على إيماءات يدك ويضغط أزرار لوحة المفاتيح:
تنقّل بين شرائح PowerPoint، تحكّم بالفيديو والصوت، وغير ذلك.

الاستعمال:
    py -m pip install opencv-python mediapipe numpy
    py ain_pc_controller.py                (يقرأ control_config.json من نفس المجلد)
    py ain_pc_controller.py --dry-run      (يعرض ما سيفعله دون ضغط أي زر)

الأمان:
  * لا يضغط أي زر إلا بعد «إيماءة التسليح» (تثبّتها ثانية) وبعدها لمدة محدودة.
  * يضغط أزراراً من قائمة بيضاء ثابتة فقط (أسهم، PageUp/Down، مسافة، F5…).
  * مفتاح Q في نافذة المعاينة يُنهي البرنامج، و D يبدّل التجربة، و R يقفل التحكم فوراً.

المنطق (التتبّع، الخصائص، المصنِّف، DTW، القواعد) منقول حرفياً من تطبيق عين (JavaScript)،
وتختبره المقارنة الآلية tests/parity في مشروع التطبيق.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

# ------------------------------------------------------------------ الخصائص
N_LM = 21
POSE_LEN = 63
FEATURE_LEN = 99
FINGERS = [(1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20)]
TIPS = [4, 8, 12, 16, 20]
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16), (13, 17), (17, 18), (18, 19), (19, 20), (0, 17),
]


def _unit(x, y, z):
    l = math.sqrt(x * x + y * y + z * z) or 1e-9
    return [x / l, y / l, z / l]


def _dist(p, a, b):
    return math.sqrt((p[a * 3] - p[b * 3]) ** 2 + (p[a * 3 + 1] - p[b * 3 + 1]) ** 2 + (p[a * 3 + 2] - p[b * 3 + 2]) ** 2)


def landmarks_to_pose(lm, aspect):
    """lm: مصفوفة (21,3) من x,y,z كما يعيدها MediaPipe. يعيد (p, w, size) أو None."""
    if lm is None or len(lm) < N_LM:
        return None
    ar = aspect if aspect > 0 else 4 / 3
    X = [float(lm[i][0]) for i in range(N_LM)]
    Y = [float(lm[i][1]) / ar for i in range(N_LM)]
    Z = [float(lm[i][2]) for i in range(N_LM)]

    def d(i):
        return math.sqrt((X[i] - X[0]) ** 2 + (Y[i] - Y[0]) ** 2 + (Z[i] - Z[0]) ** 2)

    size = (d(5) + d(9) + d(13) + d(17)) / 4
    if not size > 1e-4:
        return None
    p = []
    for i in range(N_LM):
        p += [(X[i] - X[0]) / size, (Y[i] - Y[0]) / size, (Z[i] - Z[0]) / size]
    return p, (float(lm[0][0]), float(lm[0][1])), size


def orientation(p):
    o = [0.0] * 15
    o[0:3] = _unit(p[27], p[28], p[29])
    o[3:6] = _unit(p[15] - p[51], p[16] - p[52], p[17] - p[53])
    ax, ay, az = o[0], o[1], o[2]
    lux, luy, luz = o[3], o[4], o[5]
    o[6:9] = _unit(luy * az - luz * ay, luz * ax - lux * az, lux * ay - luy * ax)
    o[9:12] = _unit(p[24] - p[15], p[25] - p[16], p[26] - p[17])
    o[12:15] = _unit(p[12] - p[6], p[13] - p[7], p[14] - p[8])
    return o


def finger_extension(p):
    out = []
    for a, b, c, d in FINGERS:
        chain = _dist(p, a, b) + _dist(p, b, c) + _dist(p, c, d)
        out.append(min(1.0, _dist(p, a, d) / (chain or 1)))
    return out


def pose_to_features(p):
    f = list(p[3:POSE_LEN])
    f += orientation(p)
    f += finger_extension(p)
    for k in range(5):
        f.append(_dist(p, TIPS[k], 0))
    for a in range(5):
        for b in range(a + 1, 5):
            f.append(_dist(p, TIPS[a], TIPS[b]))

    def direction(i, j):
        x, y, z = p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]
        l = math.sqrt(x * x + y * y + z * z) or 1
        return [x / l, y / l, z / l]

    dI, dM, dR, dP, dT = direction(5, 8), direction(9, 12), direction(13, 16), direction(17, 20), direction(2, 4)
    dot = lambda u, v: u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
    f += [dot(dI, dM), dot(dM, dR), dot(dR, dP), dot(dT, dI)]
    return f


# ------------------------------------------------------------------ المصنِّف
class Classifier:
    def __init__(self, j):
        self.classes = j['classes']
        self.H, self.D = j['H'], j['D']
        self.mean = np.array(j['mean'], dtype=np.float64)
        self.std = np.array(j['std'], dtype=np.float64)
        self.W1 = np.array(j['W1'], dtype=np.float64).reshape(self.H, self.D) if j.get('W1') else None
        self.b1 = np.array(j['b1'], dtype=np.float64) if j.get('b1') else None
        self.W2 = np.array(j['W2'], dtype=np.float64).reshape(len(self.classes), self.H) if j.get('W2') else None
        self.b2 = np.array(j['b2'], dtype=np.float64) if j.get('b2') else None
        self.ref = np.array(j['ref'], dtype=np.float64) if j.get('ref') else None
        self.ref_label = j.get('refLabel') or []
        self.nn_thr, self.p_min, self.margin = j['nnThr'], j['pMin'], j['margin']

    def predict(self, p):
        C = len(self.classes)
        if not C or self.ref is None or not len(self.ref):
            return {'label': None, 'prob': 0, 'accepted': False}
        x = (np.array(pose_to_features(p)) - self.mean) / self.std
        diff = self.ref - x
        d2 = (diff * diff).sum(axis=1)
        bi = int(d2.argmin())
        nn_dist = math.sqrt(d2[bi] / self.D)
        if C == 1:
            probs = np.array([1.0])
        else:
            h = np.maximum(0.0, self.W1 @ x + self.b1)
            z = self.W2 @ h + self.b2
            z = np.exp(z - z.max())
            probs = z / z.sum()
        order = np.argsort(-probs)
        b = float(probs[order[0]])
        s = float(probs[order[1]]) if C > 1 else 0.0
        label = self.classes[int(order[0])]
        accepted = b >= self.p_min and (b - max(0.0, s)) >= self.margin and nn_dist <= self.nn_thr and label != 'none'
        return {'label': label, 'prob': b, 'accepted': accepted, 'dist': nn_dist}


# ------------------------------------------------------------------ التتبّع والحركة
class HandTracker:
    def __init__(self, alpha=0.75):
        self.alpha = alpha
        self.prev = None
        self.last_seen = -1.0
        self.speed = 0.0

    def reset(self):
        self.prev = None
        self.speed = 0.0

    def update(self, t, lm, aspect):
        base = landmarks_to_pose(lm, aspect)
        if base is None:
            if self.prev is not None and t - self.last_seen > 0.4:
                self.reset()
            return None
        bp, w, bsize = base
        ar = aspect if aspect > 0 else 4 / 3
        wi = (float(lm[0][0]), float(lm[0][1]) / ar)
        p, wiS, size = bp, wi, bsize
        if self.prev is not None:
            a = self.alpha
            p = [a * bp[i] + (1 - a) * self.prev['p'][i] for i in range(POSE_LEN)]
            wiS = (0.7 * wi[0] + 0.3 * self.prev['wi'][0], 0.7 * wi[1] + 0.3 * self.prev['wi'][1])
            size = 0.5 * bsize + 0.5 * self.prev['size']
            dt = max(0.008, t - self.prev['t'])
            v = math.hypot(wiS[0] - self.prev['wi'][0], wiS[1] - self.prev['wi'][1]) / size / dt
            self.speed = 0.7 * v + 0.3 * self.speed
        frame = {'t': t, 'p': p, 'wi': wiS, 'w': w, 'size': size, 'ext': finger_extension(p), 'speed': self.speed}
        self.prev = frame
        self.last_seen = t
        return frame


class MotionSegmenter:
    def __init__(self, v_on=1.4, v_off=0.6, min_dur=0.25, max_dur=2.5, still=0.15, pre=0.15):
        self.v_on, self.v_off, self.min_dur, self.max_dur, self.still, self.pre = v_on, v_off, min_dur, max_dur, still, pre
        self.reset()

    def reset(self):
        self.buf, self.active, self.frames, self.still_since, self.fast_count = [], False, [], None, 0

    def push(self, frame, t):
        if frame is None:
            if self.active:
                return self._finish(t)
            self.buf = []
            return None
        slim = {'t': frame['t'], 'p': frame['p'], 'wi': frame['wi'], 'size': frame['size'], 'ext': frame['ext'], 'speed': frame['speed']}
        if not self.active:
            self.buf.append(slim)
            while self.buf and frame['t'] - self.buf[0]['t'] > self.pre:
                self.buf.pop(0)
            self.fast_count = self.fast_count + 1 if frame['speed'] > self.v_on else 0
            if self.fast_count >= 2:
                self.active, self.frames, self.still_since = True, list(self.buf), None
            return None
        self.frames.append(slim)
        if frame['speed'] < self.v_off:
            if self.still_since is None:
                self.still_since = frame['t']
        else:
            self.still_since = None
        dur = frame['t'] - self.frames[0]['t']
        if (self.still_since is not None and frame['t'] - self.still_since >= self.still) or dur > self.max_dur:
            return self._finish(frame['t'])
        return None

    def _finish(self, t):
        frames = self.frames
        if self.still_since is not None:
            frames = [f for f in frames if f['t'] <= self.still_since + 0.06]
        self.active, self.fast_count, self.still_since, self.frames, self.buf = False, 0, None, [], []
        if len(frames) < 5:
            return None
        dur = frames[-1]['t'] - frames[0]['t']
        if dur < self.min_dur:
            return None
        return {'frames': frames, 'dur': dur}


T_LEN = 24
PTS = [4, 8, 12, 16, 20, 5, 9, 17]
SEQ_F = len(PTS) * 3 + 2 + 3


def _frame_vec(f, start):
    out = []
    for i in PTS:
        out += [f['p'][i * 3], f['p'][i * 3 + 1], f['p'][i * 3 + 2]]
    out.append((f['wi'][0] - start['wi'][0]) / start['size'])
    out.append((f['wi'][1] - start['wi'][1]) / start['size'])
    n = orientation(f['p'])
    out += [n[6], n[7], n[8]]
    return out


def segment_to_seq(frames):
    n = len(frames)
    start, t0, t1 = frames[0], frames[0]['t'], frames[-1]['t']
    out = np.zeros((T_LEN, SEQ_F))
    j = 0
    for i in range(T_LEN):
        tt = t0 + (t1 - t0) * i / (T_LEN - 1)
        while j < n - 2 and frames[j + 1]['t'] < tt:
            j += 1
        a = frames[j]
        b = frames[min(n - 1, j + 1)]
        span = (b['t'] - a['t']) or 1
        u = min(1.0, max(0.0, (tt - a['t']) / span))
        va, vb = np.array(_frame_vec(a, start)), np.array(_frame_vec(b, start))
        out[i] = va + (vb - va) * u
    return out


def dtw(a, b, band=7):
    a = np.asarray(a, dtype=np.float64).reshape(T_LEN, SEQ_F)
    b = np.asarray(b, dtype=np.float64).reshape(T_LEN, SEQ_F)
    INF = 1e9
    prev = [INF] * T_LEN
    cur = [INF] * T_LEN
    pose_dims = list(range(0, 24)) + list(range(26, SEQ_F))
    for i in range(T_LEN):
        cur = [INF] * T_LEN
        for j in range(max(0, i - band), min(T_LEN - 1, i + band) + 1):
            dif = a[i] - b[j]
            sp = float((dif[pose_dims] ** 2).sum())
            st = float((dif[24:26] ** 2).sum())
            c = math.sqrt(sp / 27) + 3.5 * math.sqrt(st / 2)
            if i == 0 and j == 0:
                best = 0.0
            else:
                best = min(prev[j] if i > 0 else INF, cur[j - 1] if j > 0 else INF, prev[j - 1] if (i > 0 and j > 0) else INF)
            cur[j] = best + c
        prev = cur
    return prev[T_LEN - 1] / (2 * T_LEN)


class MotionBank:
    def __init__(self, j):
        self.signs = {k: {'thr': v['thr'], 'seqs': [np.array(q) for q in v['seqs']]} for k, v in (j or {}).items()}

    def classify(self, seq):
        scores = []
        for sid, s in self.signs.items():
            best = min(dtw(seq, q) for q in s['seqs'])
            scores.append((best, sid, s['thr']))
        scores.sort()
        if not scores:
            return {'label': None, 'accepted': False}
        a = scores[0]
        ratio = scores[1][0] / max(1e-6, a[0]) if len(scores) > 1 else math.inf
        return {'label': a[1], 'dist': a[0], 'thr': a[2], 'ratio': ratio, 'accepted': a[0] <= a[2] and ratio >= 1.15}


# ------------------------------------------------------------------ قواعد جاهزة
def _open_fingers(frames):
    c = 0
    for f in frames:
        c += sum(1 for i in range(1, 5) if f['ext'][i] > 0.8)
    return c / len(frames)


def detect_builtin_motion(seg):
    fr = seg['frames']
    n = len(fr)
    if n < 6:
        return None
    sz = sum(f['size'] for f in fr) / n
    pts = [(f['wi'][0] / sz, f['wi'][1] / sz) for f in fr]
    dx, dy = pts[-1][0] - pts[0][0], pts[-1][1] - pts[0][1]
    L = sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, n))
    net = math.hypot(dx, dy)
    if _open_fingers(fr) < 2.8:
        return None
    rev, direction, ext = 0, 0, pts[0][0]
    for i in range(1, n):
        d = (pts[i][0] - pts[i - 1][0])
        d = (d > 0) - (d < 0)
        if not d:
            continue
        if direction and d != direction:
            if abs(pts[i - 1][0] - ext) > 0.8:
                rev += 1
            ext = pts[i - 1][0]
        direction = d
    if rev >= 3 and net < 0.5 * L and seg['dur'] >= 0.8:
        return 'wave'
    straight = net / max(1e-6, L)
    if straight < 0.65 or seg['dur'] > 1.3:
        return None
    if abs(dx) >= 1.8 * abs(dy) and abs(dx) >= 2.0:
        return 'swipe_right' if dx < 0 else 'swipe_left'
    if abs(dy) >= 1.8 * abs(dx) and abs(dy) >= 1.5:
        return 'swipe_up' if dy < 0 else 'swipe_down'
    return None


BUILTIN_SHAPES = [
    ('shape_open', 'EEEEE'), ('shape_fist', 'CCCCC'), ('shape_point', '?ECCC'), ('shape_victory', '?EECC'),
    ('shape_thumb', 'ECCCC'), ('shape_three', '?EEEC'), ('shape_four', '?EEEE'), ('shape_call', 'ECCCE'),
    ('shape_love', 'EECCE'), ('shape_pinky', '?CCCE'),
]


def finger_states(p):
    ext = finger_extension(p)
    tdist = math.sqrt((p[12] - p[15]) ** 2 + (p[13] - p[16]) ** 2 + (p[14] - p[17]) ** 2)
    st = ['E' if tdist > 0.72 else 'C' if tdist < 0.62 else 'H']
    for i in range(1, 5):
        st.append('E' if ext[i] > 0.86 else 'C' if ext[i] < 0.72 else 'H')
    return st


def detect_builtin_shape(p):
    st = finger_states(p)
    pinch = math.sqrt((p[12] - p[24]) ** 2 + (p[13] - p[25]) ** 2 + (p[14] - p[26]) ** 2)
    if pinch < 0.32 and st[2] == 'E' and st[3] == 'E' and st[4] == 'E':
        return 'shape_ok'
    if 'H' in st[1:]:
        return None
    for sid, pattern in BUILTIN_SHAPES:
        ok = True
        for i in range(5):
            w = pattern[i]
            if w == '?':
                continue
            if i == 0:
                if st[0] == 'H' or st[0] != w:
                    ok = False
                    break
            elif st[i] != w:
                ok = False
                break
        if ok:
            return sid
    return None


# ------------------------------------------------------------------ المحرّك
class Engine:
    def __init__(self, cfg):
        self.hold_sec = cfg.get('holdSec', 0.6)
        self.grace = 0.2
        self.static_speed_max = 1.0
        self.relock = 0.5
        self.tracker = HandTracker()
        self.segmenter = MotionSegmenter()
        self.clf = Classifier(cfg['classifier']) if cfg.get('classifier') else None
        self.bank = MotionBank(cfg.get('motion'))
        self.sig = cfg.get('sig') or {}
        self.signs = {s['id']: s for s in cfg.get('signs', [])}
        self.by_rule = {s['rule']: s for s in cfg.get('signs', []) if s['kind'] == 'builtin' and s.get('rule')}
        self.last_seen = -1.0
        self.reset()

    def reset(self):
        self.tracker.reset()
        self.segmenter.reset()
        self._reset_hold()
        self.lock = None

    def _reset_hold(self):
        self.hold = {'key': None, 'since': 0.0, 'last_good': 0.0, 'id': None, 'kind': None, 'conf': 0.0}

    def _finger_gate(self, label, p):
        sig = self.sig.get(label)
        if not sig:
            return True
        st = finger_states(p)
        for i in range(5):
            if sig[i] and st[i] != 'H' and st[i] != sig[i]:
                return False
        return True

    def process(self, t, lm, aspect):
        out = {'hand': False, 'frame': None, 'events': [], 'moving': False, 'hold': None}
        frame = self.tracker.update(t, lm, aspect) if lm is not None else self.tracker.update(t, None, aspect)
        if frame is None:
            if self.hold['key']:
                self._reset_hold()
            if t - self.last_seen > self.relock:
                self.lock = None
            seg = self.segmenter.push(None, t)
            if seg:
                self._on_segment(seg, t, out)
            return out
        self.last_seen = t
        out['hand'], out['frame'] = True, frame
        seg = self.segmenter.push(frame, t)
        out['moving'] = self.segmenter.active
        if seg:
            self._on_segment(seg, t, out)
        if not out['moving'] and frame['speed'] < self.static_speed_max:
            self._static(t, frame, out)
        elif self.hold['key']:
            self._reset_hold()
        if self.hold['key']:
            out['hold'] = {'key': self.hold['key'], 'progress': min(1.0, (t - self.hold['since']) / self.hold_sec)}
        return out

    def _static(self, t, frame, out):
        cand = None
        if self.clf:
            pr = self.clf.predict(frame['p'])
            if pr['accepted'] and pr['label'] and pr['label'] != 'none' and self._finger_gate(pr['label'], frame['p']):
                if pr['label'] in self.signs:
                    cand = {'key': 'sign:' + pr['label'], 'kind': 'static', 'id': pr['label'], 'conf': pr['prob']}
        if cand is None:
            sh = detect_builtin_shape(frame['p'])
            if sh:
                cand = {'key': 'builtin:' + sh, 'kind': 'shape', 'id': sh, 'conf': 1.0}
        h = self.hold
        if cand:
            if h['key'] == cand['key']:
                h['last_good'] = t
                h['conf'] = 0.8 * h['conf'] + 0.2 * cand['conf']
            else:
                self.hold = {'key': cand['key'], 'since': t, 'last_good': t, 'id': cand['id'], 'kind': cand['kind'], 'conf': cand['conf']}
        elif h['key'] and t - h['last_good'] > self.grace:
            self._reset_hold()
        hh = self.hold
        if hh['key'] and t - hh['since'] >= self.hold_sec and self.lock != hh['key']:
            self.lock = hh['key']
            out['events'].append({'type': 'shape' if hh['kind'] == 'shape' else 'static', 'key': hh['key'], 't': t})
        if cand and self.lock and cand['key'] != self.lock:
            self.lock = None
        if not cand and self.lock and t - hh['last_good'] > 0.35:
            self.lock = None

    def _on_segment(self, seg, t, out):
        if self.bank.signs:
            r = self.bank.classify(segment_to_seq(seg['frames']))
            if r['accepted']:
                out['events'].append({'type': 'motion', 'key': 'sign:' + r['label'], 't': t})
                self._reset_hold()
                self.lock = None
                return
        b = detect_builtin_motion(seg)
        if b:
            out['events'].append({'type': 'swipe', 'key': 'builtin:' + b, 't': t})
            self._reset_hold()
            self.lock = None


class ArmState:
    def __init__(self, cfg):
        self.arm_key = cfg['arm']['key']
        self.arm_seconds = cfg['arm']['seconds']
        self.always = bool(cfg['arm'].get('alwaysArmed'))
        self.cooldown = cfg.get('cooldown', 1.2)
        self.bindings = {b['key']: b['action'] for b in cfg.get('bindings', [])}
        self.armed_until = 0.0
        self.last_fire = -99.0

    def armed(self, t):
        return self.always or t < self.armed_until

    def remaining(self, t):
        return max(0.0, self.armed_until - t)

    def feed(self, key, t):
        if key == self.arm_key:
            self.armed_until = t + self.arm_seconds
            return ('armed', None)
        if not self.armed(t) or t - self.last_fire < self.cooldown:
            return None
        action = self.bindings.get(key)
        if not action:
            return None
        self.last_fire = t
        if action == 'disarm':
            self.armed_until = 0.0
            return ('disarmed', None)
        self.armed_until = t + self.arm_seconds
        return ('action', action)


# ------------------------------------------------------------------ ضغط الأزرار (قائمة بيضاء)
VK = {
    'right': 0x27, 'left': 0x25, 'up': 0x26, 'down': 0x28, 'pagedown': 0x22, 'pageup': 0x21, 'space': 0x20,
    'enter': 0x0D, 'esc': 0x1B, 'f5': 0x74, 'home': 0x24, 'end': 0x23, 'b': 0x42, 'w': 0x57,
    'volume_up': 0xAF, 'volume_down': 0xAE, 'mute': 0xAD, 'play_pause': 0xB3, 'next_track': 0xB0, 'prev_track': 0xB1,
}
EXTENDED = {'right', 'left', 'up', 'down', 'pagedown', 'pageup', 'home', 'end'}
ALLOWED = set(VK) | {'shift_f5'}


class KeyPresser:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.user32 = None
        if os.name == 'nt':
            import ctypes
            self.user32 = ctypes.windll.user32
        elif not dry_run:
            print('هذا النظام ليس Windows: سيعمل البرنامج في وضع التجربة فقط.')
            self.dry_run = True

    def _tap(self, name):
        vk = VK[name]
        flags = 1 if name in EXTENDED else 0
        self.user32.keybd_event(vk, 0, flags, 0)
        self.user32.keybd_event(vk, 0, flags | 2, 0)

    def press(self, action):
        if action not in ALLOWED:
            return False
        if self.dry_run:
            return True
        if action == 'shift_f5':
            self.user32.keybd_event(0x10, 0, 0, 0)
            self._tap('f5')
            self.user32.keybd_event(0x10, 0, 2, 0)
        else:
            self._tap(action)
        return True


# ------------------------------------------------------------------ التشغيل
def load_config(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description='عين — التحكم بالحاسوب بإيماءات اليد')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--config', default=os.path.join(here, 'control_config.json'))
    ap.add_argument('--model', default=os.path.join(here, 'hand_landmarker.task'))
    ap.add_argument('--camera', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true', help='لا تضغط أي زر، اعرض فقط')
    args = ap.parse_args()

    if not os.path.exists(args.config):
        sys.exit('لم أجد control_config.json — صدّره من تطبيق عين (أوامر ← التحكم بالحاسوب) وضعه بجوار هذا الملف.')
    if not os.path.exists(args.model):
        sys.exit('لم أجد hand_landmarker.task — ضعه بجوار هذا الملف (هو نفسه من مشروعك الأول).')
    try:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
    except ImportError:
        sys.exit('ثبّت المكتبات أولاً:  py -m pip install opencv-python mediapipe numpy')

    cfg = load_config(args.config)
    eng = Engine(cfg)
    arm = ArmState(cfg)
    keys = KeyPresser(args.dry_run)
    names = {s['id']: s['word'] for s in cfg.get('signs', [])}

    def label(key):
        if key.startswith('sign:'):
            return names.get(key[5:], key)
        return key.replace('builtin:', '')

    opts = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=args.model), running_mode=vision.RunningMode.VIDEO,
        num_hands=1, min_hand_detection_confidence=0.5, min_hand_presence_confidence=0.5, min_tracking_confidence=0.5)
    landmarker = vision.HandLandmarker.create_from_options(opts)
    cap = cv2.VideoCapture(args.camera)
    # تسريع: دقة 640×480 بدل دقة الكاميرا الكاملة (MediaPipe أسرع بكثير)،
    # ومخزن إطار واحد فقط حتى لا تتراكم إطارات قديمة في الطابور وتتأخر الاستجابة ثوانٍ.
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    if not cap.isOpened():
        sys.exit('تعذّر فتح الكاميرا. أغلق أي برنامج آخر يستعملها أو جرّب --camera 1')
    print('يعمل. اعرض إيماءة التسليح لتفعيل التحكم. Q للخروج، R لقفل التحكم، D لتبديل وضع التجربة.')
    t0 = time.time()
    last_ts = 0
    last_msg, last_msg_t = '', 0.0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        t = time.time() - t0
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        ts = max(last_ts + 1, int(t * 1000))
        last_ts = ts
        res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)
        lm = None
        if res.hand_landmarks:
            lm = [(p.x, p.y, p.z) for p in res.hand_landmarks[0]]
        out = eng.process(t, lm, w / h)
        for ev in out['events']:
            r = arm.feed(ev['key'], t)
            if r is None:
                continue
            kind, action = r
            if kind == 'armed':
                last_msg = 'ARMED'
            elif kind == 'disarmed':
                last_msg = 'LOCKED'
            elif kind == 'action':
                keys.press(action)
                last_msg = ('[dry] ' if keys.dry_run else '') + action
                print(time.strftime('%H:%M:%S'), label(ev['key']), '->', action)
            last_msg_t = t
        # معاينة
        view = cv2.flip(bgr, 1)
        if lm:
            pts = [(int((1 - x) * w), int(y * h)) for x, y, _ in lm]
            for a, b in HAND_CONNECTIONS:
                cv2.line(view, pts[a], pts[b], (60, 200, 140), 2)
        st = 'ARMED (always)' if arm.always else ('ARMED %ds' % math.ceil(arm.remaining(t)) if arm.armed(t) else 'LOCKED (show arm gesture: %s)' % label(arm.arm_key))
        cv2.putText(view, st, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 120) if arm.armed(t) else (0, 160, 255), 2)
        if t - last_msg_t < 1.5:
            cv2.putText(view, last_msg, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        if keys.dry_run:
            cv2.putText(view, 'DRY RUN', (w - 130, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (80, 80, 255), 2)
        cv2.imshow('Hudhaifa', view)
        k = cv2.waitKey(1) & 0xFF
        if k in (ord('q'), 27):
            break
        if k == ord('d'):
            keys.dry_run = not keys.dry_run
        if k == ord('r'):
            arm.armed_until = 0.0
    cap.release()
    cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
