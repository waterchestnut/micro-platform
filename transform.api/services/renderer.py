# -*- coding: utf-8 -*-
"""
参数化原理演示渲染引擎（matplotlib FuncAnimation -> mp4 + poster png）
供 gRPC Renderer 服务调用：render_demo(kind, params) -> {video, poster, meta}
说明：画面内文字仅使用英文与 mathtext 公式（镜像无中文字体依赖），中文讲解内容由课件的文本元素承载。
"""
import io
import json
import math

import numpy as np
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import rcParams  # noqa: E402
import matplotlib.animation as animation  # noqa: E402
from matplotlib.patches import Rectangle, Polygon, FancyArrowPatch  # noqa: E402
from matplotlib.transforms import Affine2D  # noqa: E402

try:
    import imageio_ffmpeg
    rcParams['animation.ffmpeg_path'] = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # 退化为 PATH 中的 ffmpeg
    pass

rcParams['font.family'] = 'DejaVu Sans'
rcParams['axes.unicode_minus'] = False

INK = '#1F2937'
GRID = '#E5E7EB'
RED = '#EF4444'

TEMPLATES = {}


class RenderError(Exception):
    pass


def template(fn):
    TEMPLATES[fn.__name__] = fn
    return fn


def _new_fig(w_px, h_px, bg):
    dpi = 100
    fig = plt.figure(figsize=(w_px / dpi, h_px / dpi), dpi=dpi)
    fig.patch.set_facecolor(bg)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor(bg)
    ax.axis('off')
    return fig, ax


def _run_template(kind, params, seconds, fps):
    p = params or {}
    color = p.get('color', '#2563EB')
    fig, ax = _new_fig(int(p.get('width', 640)), int(p.get('height', 360)), p.get('bg', '#FFFFFF'))
    anim = TEMPLATES[kind](ax, p, color, seconds, fps)
    return fig, anim


# ---------------- 1. 抛体运动 projectile ----------------
@template
def projectile(ax, p, color, dur, fps):
    v0 = float(p.get('v0', 20.0))
    angle = math.radians(float(p.get('angleDeg', 35.0)))
    g = 9.8
    t_total = 2 * v0 * math.sin(angle) / g
    ax.set_xlim(-1, v0 * math.cos(angle) * t_total + 2)
    ax.set_ylim(-0.5, (v0 * math.sin(angle)) ** 2 / (2 * g) + 2)
    gx = np.linspace(0, t_total, 300)
    X = v0 * np.cos(angle) * gx
    Y = v0 * np.sin(angle) * gx - 0.5 * g * gx ** 2
    ax.plot([0, ax.get_xlim()[1]], [0, 0], color=INK, lw=1.5)
    curve, = ax.plot([], [], color=color, lw=2, alpha=0.85)
    ball, = ax.plot([], [], 'o', color=color, ms=9)
    arrow = FancyArrowPatch((0, 0), (0, 0), arrowstyle='-|>', mutation_scale=16, color=RED, lw=2)
    ax.add_patch(arrow)
    ax.text(0.3, ax.get_ylim()[1] * 0.98, r'$y=v_0\sin\theta\, t-\frac{1}{2}gt^2$', color=INK, fontsize=11, va='top')
    frames = int(dur * fps)

    def update(i):
        f = i / max(1, frames - 1)
        n = max(2, int(f * len(gx)))
        curve.set_data(X[:n], Y[:n])
        x, y = X[n - 1], max(Y[n - 1], 0)
        ball.set_data([x], [y])
        vx = v0 * math.cos(angle)
        vy = v0 * math.sin(angle) - g * gx[n - 1]
        s = 0.12
        arrow.set_positions((x, y), (x + vx * s, y + vy * s))
        return [curve, ball, arrow]

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


# ---------------- 2. 受力分析 force_analysis ----------------
@template
def force_analysis(ax, p, color, dur, fps):
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6)
    ax.plot([0.5, 9.5], [1.5, 1.5], color=INK, lw=2)
    ax.add_patch(Rectangle((4.2, 1.5), 1.8, 1.2, facecolor=color, alpha=0.85, edgecolor=INK))
    cx, cy = 5.1, 2.1
    defs = [(r'$mg$', (cx, cy), (cx, cy - 1.1), RED),
            (r'$N$', (cx, cy), (cx, cy + 1.1), '#10B981'),
            (r'$F$', (cx, cy), (cx + 1.6, cy), color),
            (r'$f$', (cx, cy), (cx - 1.2, cy), '#F59E0B')]
    artists = []
    for lab, a, b, c in defs:
        ar = FancyArrowPatch(a, b, arrowstyle='-|>', mutation_scale=18, color=c, lw=2.5)
        ax.add_patch(ar)
        t = ax.text(b[0] + (0.18 if b[0] >= a[0] else -0.18), b[1], lab, color=c, fontsize=13,
                    ha='left' if b[0] >= a[0] else 'right', va='center')
        artists.append((ar, t))
    for ar, t in artists:
        ar.set_alpha(0)
        t.set_alpha(0)
    frames = int(dur * fps)
    per = max(1, frames // len(artists))

    def update(i):
        shown = min(len(artists), i // per)
        for j, (ar, t) in enumerate(artists):
            a = 1 if j < shown else 0
            ar.set_alpha(a)
            t.set_alpha(a)
        return [x for pair in artists for x in pair]

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


# ---------------- 3. 杠杆平衡 lever ----------------
@template
def lever(ax, p, color, dur, fps):
    ax.set_xlim(-6, 6)
    ax.set_ylim(-2.5, 4.5)
    ax.add_patch(Polygon([(-0.7, -0.2), (0.7, -0.2), (0, 1.2)], facecolor=INK, alpha=0.8))
    beam = Rectangle((-5, 1.15), 10, 0.22, facecolor=color)
    ax.add_patch(beam)
    wl = Rectangle((-4.4, 1.4), 0.8, 0.8, facecolor=RED)
    wr = Rectangle((3.6, 1.4), 0.8, 0.8, facecolor='#10B981')
    ax.add_patch(wl)
    ax.add_patch(wr)
    eq = ax.text(0, 4.1, r'$F_1 d_1 = F_2 d_2$', color=INK, fontsize=14, ha='center', alpha=0)
    pivot = (0, 1.26)
    frames = int(dur * fps)

    def update(i):
        f = i / max(1, frames - 1)
        theta = 10 * math.sin(2.2 * math.pi * f * 1.2) * math.exp(-2.6 * f)
        tr = Affine2D().rotate_deg_around(pivot[0], pivot[1], theta) + ax.transData
        for art in (beam, wl, wr):
            art.set_transform(tr)
        eq.set_alpha(min(1.0, max(0.0, (f - 0.7) / 0.2)))
        return [beam, wl, wr, eq]

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


# ---------------- 4. 公式推导 derivation ----------------
@template
def derivation(ax, p, color, dur, fps):
    steps = p.get('steps') or [r'$ax^2+bx+c=0$', r'$x^2+\frac{b}{a}x=-\frac{c}{a}$',
                               r'$\left(x+\frac{b}{2a}\right)^2=\frac{b^2-4ac}{4a^2}$',
                               r'$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$']
    steps = steps[:6]
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 2.2 * len(steps) + 1)
    texts, boxes = [], []
    for i, s in enumerate(steps):
        y = (len(steps) - 1 - i) * 2.2 + 1.0
        texts.append(ax.text(1.0, y, s, fontsize=16, color=INK, va='center', alpha=0))
        b = Rectangle((0.6, y - 0.75), 8.8, 1.5, facecolor='none', edgecolor=color, lw=2.5, alpha=0)
        ax.add_patch(b)
        boxes.append(b)
    frames = int(dur * fps)
    per = frames / len(steps)

    def update(i):
        cur = min(len(steps) - 1, int(i // per))
        for j in range(len(steps)):
            texts[j].set_alpha(1 if j <= cur else 0)
            boxes[j].set_alpha(0.9 if j == cur else 0)
        return texts + boxes

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


# ---------------- 5. 极限逼近 limit ----------------
@template
def limit(ax, p, color, dur, fps):
    ax.set_xlim(-0.6, 3.2)
    ax.set_ylim(-0.9, 1.8)
    L = 1.0
    ax.plot([0, 3], [0, 0], color=INK, lw=1.5)
    ax.plot([L, L], [-0.4, 0.2], color=RED, lw=2)
    ax.text(L, 0.35, r'$L$', color=RED, fontsize=13, ha='center')
    band = Rectangle((L, -0.5), 0, 1.0, facecolor=color, alpha=0)
    ax.add_patch(band)
    eps_seq = [0.6, 0.42, 0.3, 0.21, 0.15, 0.11, 0.08, 0.056]
    dots, = ax.plot([], [], 'o', color=color, ms=6)
    xs = [L + e * 2.0 for e in eps_seq]
    ys = [1.3 - i * 0.06 for i in range(len(eps_seq))]
    rule = ax.text(0.3, -0.8, r'$|a_n-L|<\varepsilon$', color=INK, fontsize=12, alpha=0)
    frames = int(dur * fps)
    per = max(1, frames // len(eps_seq))

    def update(i):
        k = min(len(eps_seq) - 1, i // per)
        eps = eps_seq[k]
        band.set_x(L - eps)
        band.set_width(2 * eps)
        band.set_alpha(0.18)
        dots.set_data(xs[:k + 1], ys[:k + 1])
        rule.set_alpha(1 if k >= 2 else 0)
        return [band, dots, rule]

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


# ---------------- 6. 行波 wave ----------------
@template
def wave(ax, p, color, dur, fps):
    A = 1.0
    k = 2 * math.pi / float(p.get('wavelength', 2.5))
    v = float(p.get('speed', 1.2))
    ax.set_xlim(0, 8)
    ax.set_ylim(-2, 2)
    ax.plot([0, 8], [0, 0], color=INK, lw=1)
    xs = np.linspace(0, 8, 400)
    line, = ax.plot(xs, np.zeros_like(xs), color=color, lw=2.5)
    m1, = ax.plot([], [], 'o', color=RED, ms=7)
    m2, = ax.plot([], [], 'o', color=RED, ms=7)
    ax.text(0.3, 1.7, r'$y=A\sin(kx-\omega t)$', color=INK, fontsize=13)
    frames = int(dur * fps)

    def update(i):
        t = i / fps
        ys = A * np.sin(k * xs - v * k * t)
        line.set_data(xs, ys)
        lam = 2 * math.pi / k
        crest = (math.pi / 2 + v * k * t) / k
        crest = crest % (8 - lam)
        c2 = crest + lam
        y1 = A * math.sin(k * crest - v * k * t)
        y2 = A * math.sin(k * c2 - v * k * t)
        m1.set_data([crest], [y1])
        m2.set_data([c2], [y2])
        return [line, m1, m2]

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


# ---------------- 7. 几何变换 transform ----------------
@template
def transform(ax, p, color, dur, fps):
    mode = p.get('mode', 'rotate')  # rotate | reflect | translate
    if mode not in ('rotate', 'reflect', 'translate'):
        mode = 'rotate'
    ax.set_xlim(-4.2, 4.2)
    ax.set_ylim(-4.2, 4.2)
    ax.axhline(0, color=GRID, lw=1)
    ax.axvline(0, color=GRID, lw=1)
    base = np.array([[-2.5, -1], [-0.5, -1], [-2.5, 1.5]])
    ax.add_patch(Polygon(base, facecolor=INK, alpha=0.15, edgecolor=INK))
    cur = Polygon(base, facecolor=color, alpha=0.75, edgecolor=color)
    ax.add_patch(cur)
    diag = ax.plot([-3.5, 3.5], [-3.5, 3.5], '--', color=RED, lw=1.5, alpha=0)[0]
    lab = ax.text(-3.8, 3.6, {'rotate': r'$90^\circ$', 'reflect': r'$y=x$', 'translate': r'$(+3,+2)$'}[mode],
                  color=INK, fontsize=13, alpha=0)
    frames = int(dur * fps)

    def update(i):
        f = min(1.0, i / max(1, frames - 1))
        if mode == 'rotate':
            th = math.radians(90 * f)
            M = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
            cur.set_xy(base @ M.T)
        elif mode == 'reflect':
            diag.set_alpha(0.9)
            tgt = base @ np.array([[0, 1], [1, 0]]).T
            cur.set_xy(base * (1 - f) + tgt * f)
        else:
            cur.set_xy(base + np.array([3 * f, 2 * f]))
        lab.set_alpha(1 if f > 0.6 else 0)
        return [cur, diag, lab]

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


# ---------------- 8. 化学平衡移动 reaction ----------------
@template
def reaction(ax, p, color, dur, fps):
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6)
    ax.add_patch(Rectangle((0.4, 0.4), 9.2, 5.2, facecolor='none', edgecolor=INK, lw=1.5))
    ax.plot([5, 5], [0.4, 5.6], '--', color=GRID)
    ax.text(2.5, 5.8, r'$A$', ha='center', fontsize=12, color=INK)
    ax.text(7.5, 5.8, r'$AB$', ha='center', fontsize=12, color=INK)
    mark = ax.text(5.2, 4.8, r'add $A$', fontsize=11, color=RED, alpha=0)
    rng = np.random.default_rng(7)
    posA = rng.random((24, 2)) * np.array([3.8, 4.0]) + np.array([0.9, 0.9])
    posB = rng.random((24, 2)) * np.array([3.8, 4.0]) + np.array([5.7, 0.9])
    ph = rng.random((24, 2)) * 6.28
    lA, = ax.plot([], [], 'o', color=RED, ms=8)
    lB, = ax.plot([], [], 's', color=color, ms=7)
    frames = int(dur * fps)

    def update(i):
        f = i / max(1, frames - 1)
        t = i / fps
        shift = max(0.0, (f - 0.45) / 0.55)
        na = int(8 + 16 * shift)
        nb = int(6 + 12 * shift)
        pa = posA[:na] + np.stack([np.sin(t * 1.5 + ph[:na, 0]) * 0.25, np.cos(t * 1.2 + ph[:na, 1]) * 0.25], -1)
        pb = posB[:nb] + np.stack([np.cos(t * 1.4 + ph[:nb, 0]) * 0.25, np.sin(t * 1.1 + ph[:nb, 1]) * 0.25], -1)
        lA.set_data(pa[:, 0], pa[:, 1])
        lB.set_data(pb[:, 0], pb[:, 1])
        mark.set_alpha(1 if f > 0.4 else 0)
        return [lA, lB, mark]

    return animation.FuncAnimation(fig_ref(ax), update, frames=frames, interval=1000 // fps, blit=False)


def fig_ref(ax):
    return ax.figure


# ---------------- 对外接口 ----------------
DEFAULTS = {'width': 640, 'height': 360, 'fps': 20, 'seconds': 6.0}
LIMITS = {'max_seconds': 15.0, 'min_seconds': 2.0, 'min_fps': 10, 'max_fps': 30, 'max_px': 1280 * 720}


def render_demo(kind, params=None, width=None, height=None, fps=None, seconds=None):
    """渲染一个原理演示动画，返回 {video: mp4 bytes, poster: png bytes, meta: json str}"""
    if kind not in TEMPLATES:
        raise RenderError('unknown demo kind: %s, allowed: %s' % (kind, ','.join(sorted(TEMPLATES))))
    w = int(width or DEFAULTS['width'])
    h = int(height or DEFAULTS['height'])
    fp = int(fps or DEFAULTS['fps'])
    sec = float(seconds or DEFAULTS['seconds'])
    if w * h > LIMITS['max_px']:
        raise RenderError('resolution too large: %dx%d' % (w, h))
    fp = max(LIMITS['min_fps'], min(fp, LIMITS['max_fps']))
    sec = max(LIMITS['min_seconds'], min(sec, LIMITS['max_seconds']))
    p = dict(params or {})
    p.setdefault('width', w)
    p.setdefault('height', h)
    fig, anim = _run_template(kind, p, sec, fp)
    import os
    import tempfile
    try:
        fd, tmp_path = tempfile.mkstemp(suffix='.mp4')
        os.close(fd)
        try:
            anim.save(tmp_path, writer='ffmpeg', fps=fp, extra_args=['-pix_fmt', 'yuv420p', '-b:v', '1200k'])
            with open(tmp_path, 'rb') as f:
                video = f.read()
        finally:
            os.unlink(tmp_path)
        pbuf = io.BytesIO()
        fig.savefig(pbuf, format='png', dpi=100, facecolor=fig.get_facecolor())
        poster = pbuf.getvalue()
        pbuf.close()
    finally:
        plt.close(fig)
    if not video:
        raise RenderError('empty video produced')
    meta = {'kind': kind, 'width': w, 'height': h, 'fps': fp, 'seconds': sec, 'videoBytes': len(video)}
    return {'video': video, 'poster': poster, 'meta': json.dumps(meta)}


def list_kinds():
    return sorted(TEMPLATES)
