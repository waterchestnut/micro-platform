# -*- coding: utf-8 -*-
"""
参数化原理演示渲染引擎（matplotlib FuncAnimation -> mp4 + poster png）
供 gRPC Renderer 服务调用：render_demo(kind, params) -> {video, poster, meta}
说明：画面内文字仅使用英文与 mathtext 公式（镜像无中文字体依赖），中文讲解内容由课件的文本元素承载。
"""
import io
import json
import logging
import math
import re
import threading

import numpy as np
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import rcParams  # noqa: E402
import matplotlib.animation as animation  # noqa: E402
from matplotlib.patches import Rectangle, Polygon, FancyArrowPatch, FancyBboxPatch, Arc  # noqa: E402
from matplotlib.transforms import Affine2D  # noqa: E402

try:
    import imageio_ffmpeg
    rcParams['animation.ffmpeg_path'] = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # 退化为 PATH 中的 ffmpeg
    pass

rcParams['font.family'] = ['DejaVu Sans', 'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei', 'SimHei', 'PingFang SC']
rcParams['axes.unicode_minus'] = False
logging.getLogger('matplotlib.font_manager').setLevel(logging.ERROR)

INK = '#1F2937'
GRID = '#E5E7EB'
RED = '#EF4444'

TEMPLATES = {}


class RenderError(Exception):
    pass


# ---------------- 公式字符串归一化：模型按KaTeX子集输出 → matplotlib mathtext可靠渲染 ----------------

_math_logger = logging.getLogger('renderer.math')

_CJK_RE = re.compile(r'[\u4e00-\u9fff\u3000-\u303f\uff01-\uff5e]')

_MATH_REWRITES = [
    (re.compile(r'\\text\s*\{'), r'\\mathrm{'),
    (re.compile(r'\\iff\b'), r'\\Longleftrightarrow'),
    (re.compile(r'\\to\b'), r'\\rightarrow'),
    (re.compile(r'\\left|\\right'), ''),
    (re.compile(r'\\mathbb\s*\{([^{}]*)\}'), r'\1'),
    (re.compile(r'\\mathcal\s*\{([^{}]*)\}'), r'\1'),
    (re.compile(r'\\widehat\s*\{([^{}]*)\}'), r'\\hat{\1}'),
    (re.compile(r'\\widetilde\s*\{([^{}]*)\}'), r'\\tilde{\1}'),
    (re.compile(r'\\mathrm\s*\{\s*\}'), ''),
    (re.compile(r'\\displaystyle'), ''),
    (re.compile(r'\\,|\\;|\\:|\\!'), ' '),
]


def _mathtext_parse_ok(math_str):
    try:
        from matplotlib.mathtext import MathTextParser
        if not hasattr(_mathtext_parse_ok, '_parser'):
            _mathtext_parse_ok._parser = MathTextParser('path')
        _mathtext_parse_ok._parser.parse(math_str, 72)
        return True
    except Exception:
        return False


_MATHTEXT_KNOWN = set("""frac dfrac sqrt sum prod int oint lim limsup liminf infty partial nabla cdot times div pm mp
leq geq neq approx equiv in notin subset subseteq supset cup cap emptyset forall exists neg land lor
rightarrow leftarrow Rightarrow Leftarrow Leftrightarrow longrightarrow longleftarrow leftrightarrow to mapsto
langle rangle hat tilde bar vec overline underline dots ldots cdots prime angle bot top quad qquad
alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varrho sigma tau
upsilon phi varphi chi psi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega""".split())


def _drop_unknown_macros(core):
    def rep(m):
        name = m.group(1)
        body = m.group(2) or ''
        if name in _MATHTEXT_KNOWN:
            return m.group(0)
        return body.strip('{}') if body else ' '
    return re.sub(r'\\([a-zA-Z]+)\s*(\{[^{}]*\})?', rep, core)


def normalize_math_step(s):
    """把单条公式串归一化为可渲染的 mathtext（带$包裹）；无法渲染时降级为无反斜杠的纯文本"""
    core = str(s).strip()
    had_dollar = core.startswith('$')
    core = core.strip('$').strip()
    core = re.sub(r'\\begin\s*\{[^{}]*\}(?:\[[^\]]*\])?', ' ', core)
    core = re.sub(r'\\end\s*\{[^{}]*\}', ' ', core)
    core = core.replace('&', ' ')
    core = re.sub(r'\\text\s*\{', r'\\mathrm{', core)
    core = _CJK_RE.sub('', core)
    core = re.sub(r'\\mathrm\s*\{\s*\}', '', core)
    core = re.sub(r'\s+', ' ', core).strip()
    if not core:
        return ''
    cand = '$' + core + '$'
    if _mathtext_parse_ok(cand):
        return cand
    t = core
    for pat, rep in _MATH_REWRITES:
        t = pat.sub(rep, t)
    cand = '$' + t + '$'
    if _mathtext_parse_ok(cand):
        return cand
    t2 = _drop_unknown_macros(t)
    cand = '$' + t2 + '$'
    if _mathtext_parse_ok(cand):
        return cand
    plain = re.sub(r'\\[a-zA-Z]+|[{}$\\]', ' ', t2)
    plain = re.sub(r'\s+', ' ', plain).strip()
    _math_logger.warning('mathtext无法渲染，降级纯文本: %s', str(s)[:80])
    return plain


def normalize_math_steps(steps):
    """steps数组归一化：按 \\\\ 换行拆分为多个渲染步骤"""
    out = []
    for s in steps:
        for row in re.split(r'\\\\', str(s)):
            if not row.strip():
                continue
            n = normalize_math_step(row)
            if n:
                out.append(n)
    return out


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
    default_steps = [r'$ax^2+bx+c=0$', r'$x^2+\frac{b}{a}x=-\frac{c}{a}$',
                     r'$\left(x+\frac{b}{2a}\right)^2=\frac{b^2-4ac}{4a^2}$',
                     r'$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$']
    raw = p.get('steps') or default_steps
    steps = normalize_math_steps(raw)[:6] or default_steps
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


# ---------------- 通用帧序列 custom ----------------

CUSTOM_MAX_FRAMES = 6
CUSTOM_MAX_ELS = 14
_PATH_D_RE = re.compile(r'^[MLQCZmlqcz\s\d.\-,]+$')


def _set_artist_alpha(artist, alpha):
    try:
        artist.set_alpha(alpha)
    except Exception:
        pass
    patch = getattr(artist, 'arrow_patch', None)
    if patch is not None:
        try:
            patch.set_alpha(alpha)
        except Exception:
            pass


def _clean_color(v):
    v = str(v or '').strip()
    if re.match(r'^#[0-9a-fA-F]{3,8}$', v):
        return v
    if re.match(r'^rgba?\([\d.,\s]+\)$', v):
        return v
    return None


def _clean_fill(v):
    if v in (None, '', 'none'):
        return None
    return _clean_color(v)


def _num(v, lo=0.0, hi=100.0):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:
        return None
    return max(lo, min(hi, x))


def _svg_path_to_mpl(d):
    """SVG path 子集（M/L/Q/C/Z，绝对坐标）→ matplotlib (verts, codes)"""
    try:
        tokens = re.findall(r'[MLQCZ]|-?\d*\.?\d+', d.upper())
    except Exception:
        return None
    items = []
    for t in tokens:
        if t in ('M', 'L', 'Q', 'C', 'Z'):
            items.append(t)
        else:
            try:
                items.append(float(t))
            except ValueError:
                return None
    from matplotlib.path import Path as MplPath
    verts, codes = [], []
    i = 0
    cur = None

    def take(n):
        nonlocal i
        vals = items[i:i + n]
        if len(vals) != n or any(isinstance(v, str) for v in vals):
            return None
        i += n
        return vals

    while i < len(items):
        it = items[i]
        if isinstance(it, str):
            cur = it
            i += 1
        if cur == 'Z':
            if verts:
                verts.append(verts[0])
                codes.append(MplPath.CLOSEPOLY)
            cur = None
            continue
        if cur is None:
            return None
        if cur == 'M':
            v = take(2)
            if not v:
                return None
            verts.append((v[0], v[1]))
            codes.append(MplPath.MOVETO if not codes else MplPath.LINETO)
            cur = 'L'
        elif cur == 'L':
            v = take(2)
            if not v:
                return None
            verts.append((v[0], v[1]))
            codes.append(MplPath.LINETO)
        elif cur == 'Q':
            v = take(4)
            if not v:
                return None
            verts += [(v[0], v[1]), (v[2], v[3])]
            codes += [MplPath.CURVE3, MplPath.CURVE3]
        elif cur == 'C':
            v = take(6)
            if not v:
                return None
            verts += [(v[0], v[1]), (v[2], v[3]), (v[4], v[5])]
            codes += [MplPath.CURVE4, MplPath.CURVE4, MplPath.CURVE4]
        else:
            return None
    if len(verts) < 2:
        return None
    return verts, codes


def _clean_element(e):
    if not isinstance(e, dict):
        return None
    t = e.get('type')
    color = _clean_color(e.get('color'))
    fill = _clean_fill(e.get('fill'))
    if t == 'line':
        f = e.get('from')
        to = e.get('to')
        if not (isinstance(f, list) and len(f) == 2 and isinstance(to, list) and len(to) == 2):
            return None
        x1, y1, x2, y2 = _num(f[0]), _num(f[1]), _num(to[0]), _num(to[1])
        if None in (x1, y1, x2, y2):
            return None
        return {'type': 'line', 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                'arrow': bool(e.get('arrow')), 'dashed': e.get('style') == 'dashed', 'color': color or INK}
    if t == 'rect':
        x, y = _num(e.get('x')), _num(e.get('y'))
        w, h = _num(e.get('w'), 0, 100), _num(e.get('h'), 0, 100)
        if None in (x, y, w, h):
            return None
        w, h = min(w, 100 - x), min(h, 100 - y)
        if w < 1 or h < 1:
            return None
        return {'type': 'rect', 'x': x, 'y': y, 'w': w, 'h': h,
                'rx': _num(e.get('rx'), 0, 10) or 0, 'fill': fill, 'color': color or INK}
    if t == 'circle':
        cx, cy, r = _num(e.get('cx')), _num(e.get('cy')), _num(e.get('r'), 0.5, 50)
        if None in (cx, cy, r):
            return None
        return {'type': 'circle', 'cx': cx, 'cy': cy, 'r': r, 'fill': fill, 'color': color or INK}
    if t == 'arc':
        cx, cy, r = _num(e.get('cx')), _num(e.get('cy')), _num(e.get('r'), 0.5, 50)
        a1, a2 = _num(e.get('a1'), -360, 360), _num(e.get('a2'), -360, 360)
        if None in (cx, cy, r, a1, a2):
            return None
        return {'type': 'arc', 'cx': cx, 'cy': cy, 'r': r, 'a1': a1, 'a2': a2, 'color': color or INK}
    if t == 'text':
        s = normalize_math_step(str(e.get('s') or ''))[:48]
        x, y = _num(e.get('x')), _num(e.get('y'))
        if not s or None in (x, y):
            return None
        size = _num(e.get('size'), 1, 10) or 4
        return {'type': 'text', 'x': x, 'y': y, 's': s, 'size': size, 'color': color or INK}
    if t == 'path':
        d = str(e.get('d') or '').strip()
        if not d or len(d) > 400 or not _PATH_D_RE.match(d):
            return None
        parsed = _svg_path_to_mpl(d)
        if not parsed:
            return None
        return {'type': 'path', 'verts': parsed[0], 'codes': parsed[1], 'fill': fill, 'color': color or INK}
    if t == 'poly':
        pts = e.get('points')
        if not isinstance(pts, list) or len(pts) < 3 or len(pts) > 20:
            return None
        cl = []
        for pt in pts:
            if not (isinstance(pt, list) and len(pt) == 2):
                return None
            x, y = _num(pt[0]), _num(pt[1])
            if None in (x, y):
                return None
            cl.append((x, y))
        return {'type': 'poly', 'points': cl, 'fill': fill, 'color': color or INK}
    return None


def _clean_custom(params):
    if not isinstance(params, dict):
        return None
    raw = params.get('frames')
    if not isinstance(raw, list) or len(raw) < 2:
        return None
    frames = []
    for f in raw[:CUSTOM_MAX_FRAMES]:
        if not isinstance(f, dict):
            return None
        els = f.get('elements') if isinstance(f.get('elements'), list) else []
        clean_els = []
        for e in els[:CUSTOM_MAX_ELS]:
            c = _clean_element(e)
            if c:
                clean_els.append(c)
        if not clean_els:
            return None
        frames.append({'caption': str(f.get('caption') or '')[:24], 'static': bool(f.get('static')), 'elements': clean_els})
    return frames if len(frames) >= 2 else None


@template
def custom(ax, p, color, dur, fps):
    from matplotlib.path import Path as MplPath
    from matplotlib.patches import PathPatch
    frames = _clean_custom(p)
    if not frames:
        raise RenderError('custom demo requires frames: 2~%d 帧，每帧 elements 1~%d 个图元' % (CUSTOM_MAX_FRAMES, CUSTOM_MAX_ELS))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6)
    title = str(p.get('title') or '')[:20]
    if title:
        ax.text(0.3, 5.72, title, color=INK, fontsize=13, va='center', fontweight='bold')
    cax = fig_ref(ax).add_axes([0.04, 0.17, 0.92, 0.72])
    cax.set_xlim(0, 100)
    cax.set_ylim(100, 0)
    cax.set_aspect('equal', adjustable='box')
    cax.axis('off')

    def add_els(els):
        artists = []
        for e in els:
            t = e['type']
            if t == 'line':
                if e['arrow']:
                    a = cax.annotate('', xy=(e['x2'], e['y2']), xytext=(e['x1'], e['y1']),
                                     arrowprops=dict(arrowstyle='-|>', color=e['color'], lw=1.6,
                                                     shrinkA=0, shrinkB=0, linestyle='--' if e['dashed'] else '-'))
                else:
                    a, = cax.plot([e['x1'], e['x2']], [e['y1'], e['y2']], color=e['color'], lw=1.6,
                                  linestyle='--' if e['dashed'] else '-')
                artists.append(a)
            elif t == 'rect':
                box = FancyBboxPatch((e['x'], e['y']), e['w'], e['h'],
                                     boxstyle='round,pad=0,rounding_size=%s' % max(0.01, e['rx']),
                                     facecolor=e['fill'] or 'none', edgecolor=e['color'], lw=1.4)
                cax.add_patch(box)
                artists.append(box)
            elif t == 'circle':
                cir = plt.Circle((e['cx'], e['cy']), e['r'], facecolor=e['fill'] or 'none',
                                 edgecolor=e['color'], lw=1.4)
                cax.add_patch(cir)
                artists.append(cir)
            elif t == 'arc':
                arc = Arc((e['cx'], e['cy']), e['r'] * 2, e['r'] * 2, theta1=min(e['a1'], e['a2']),
                          theta2=max(e['a1'], e['a2']), edgecolor=e['color'], lw=1.4)
                cax.add_patch(arc)
                artists.append(arc)
            elif t == 'text':
                txt = cax.text(e['x'], e['y'], e['s'], color=e['color'],
                               fontsize=6 + e['size'] * 1.5, ha='center', va='center')
                artists.append(txt)
            elif t == 'path':
                pp = PathPatch(MplPath(e['verts'], e['codes']), facecolor=e['fill'] or 'none',
                               edgecolor=e['color'], lw=1.4)
                cax.add_patch(pp)
                artists.append(pp)
            elif t == 'poly':
                pg = plt.Polygon(e['points'], closed=True, facecolor=e['fill'] or 'none',
                                 edgecolor=e['color'], lw=1.4)
                cax.add_patch(pg)
                artists.append(pg)
        return artists

    frame_artists = []
    for f in frames:
        arts = add_els(f['elements'])
        for a in arts:
            _set_artist_alpha(a, 0)
        frame_artists.append((arts, f['static']))
    static_always = []
    moving = []
    for fi, (arts, is_static) in enumerate(frame_artists):
        if is_static:
            static_always.extend(arts)
        else:
            moving.append((fi, arts))
    for a in static_always:
        _set_artist_alpha(a, 1)

    n = len(frames)
    total = max(n * 6, int(dur * fps))
    seg = total / n
    caption = ax.text(5, 0.42, '', color=INK, fontsize=11.5, ha='center', va='center')
    dots = [ax.plot(5 - (n - 1) * 0.35 + i * 0.7, 0.95, 'o', ms=5,
                    color=color if i == 0 else '#C7CBD4')[0] for i in range(n)]

    def update(i):
        cur = min(n - 1, int(i // seg))
        for fi, arts in moving:
            for a in arts:
                _set_artist_alpha(a, 1 if fi == cur else 0)
        caption.set_text('%d/%d %s' % (cur + 1, n, frames[cur]['caption']))
        for di, dot in enumerate(dots):
            dot.set_color(color if di == cur else '#C7CBD4')
        return []

    return animation.FuncAnimation(fig_ref(ax), update, frames=total, interval=1000 // fps, blit=False)


def fig_ref(ax):
    return ax.figure


# ---------------- 对外接口 ----------------
DEFAULTS = {'width': 640, 'height': 360, 'fps': 20, 'seconds': 6.0}
LIMITS = {'max_seconds': 15.0, 'min_seconds': 2.0, 'min_fps': 10, 'max_fps': 30, 'max_px': 1280 * 720}
# matplotlib 的 pyplot 状态非线程安全，gRPC 多线程并发渲染会死锁/挂起，这里串行化
_RENDER_LOCK = threading.Lock()


def render_demo(kind, params=None, width=None, height=None, fps=None, seconds=None):
    """渲染一个原理演示动画，返回 {video: mp4 bytes, poster: png bytes, meta: json str}"""
    if kind not in TEMPLATES:
        raise RenderError('unknown demo kind: %s, allowed: %s' % (kind, ','.join(sorted(TEMPLATES))))
    with _RENDER_LOCK:
        return _render_demo_locked(kind, params, width, height, fps, seconds)


def _render_demo_locked(kind, params, width, height, fps, seconds):
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
