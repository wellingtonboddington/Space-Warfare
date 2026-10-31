"""Procedural textures (numpy + Pillow only; runs without bpy):  python3 blender/textures.py [outdir]

Tiling detail maps (docs/ASSETS.md 1.3; seamless by construction: FFT-shaped periodic noise, wrapped stamps,
3x3-canvas folding for strokes):
  detail_paint_normal.png 1024²  tangent-space (OpenGL, +G up) orange peel + shallow dents
  detail_scratch.png      1024²  grey scratch / scuff mask (white = scratch)
  detail_grime.png        1024²  grey streaky grime (white = dirty), streaks run along -V
  detail_mli_normal.png   1024²  crinkled foil (Voronoi facets + crease ridges), tangent space
  detail_nonslip.png       512²  cockpit floor tread height (raised diamond lugs = white) + grit
Sky (section 7; equirectangular, u = (lon + 180)/360, v = (90 - lat)/180, row 0 = north):
  moon_albedo.jpg 4096x2048 (sRGB of the linear normal albedo: highlands ~0.12, maria ~0.07)
  moon_normal.jpg 4096x2048 (tangent space R = east, G = north), moon_height.png 2048x1024 (8-bit)
  earth_albedo.jpg 2048x1024, earth_clouds.jpg 2048x1024, earth_ocean_mask.png 1024x512 (white = ocean)
"""
import json
import math
import os
import sys
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
R_MOON = 1737.4


# ============================================================================================ helpers
def save_gray(path, a):
    Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8), 'L').save(path, optimize=True)


def save_rgb(path, a, quality=None):
    im = Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8), 'RGB')
    if path.endswith('.jpg'):
        im.save(path, quality=quality or 90, subsampling=0, optimize=True)
    else:
        im.save(path, optimize=True)


def lin2srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def pnoise(rng, n, beta=2.0, fmin=1.0, fmax=None, aniso=(1.0, 1.0), angle=0.0):
    """Periodic (tileable) noise with a power-law spectrum, zero mean / unit std."""
    w = rng.standard_normal((n, n))
    F = np.fft.fft2(w)
    k = np.fft.fftfreq(n) * n
    KX, KY = np.meshgrid(k, k)
    c, s = math.cos(angle), math.sin(angle)
    u = (KX * c + KY * s) * aniso[0]
    v = (-KX * s + KY * c) * aniso[1]
    r = np.sqrt(u * u + v * v)
    amp = np.where(r >= fmin, np.power(np.maximum(r, 1e-9), -beta / 2), 0.0)
    if fmax:
        amp *= np.exp(-(r / fmax) ** 2)
    out = np.real(np.fft.ifft2(F * amp))
    return (out - out.mean()) / (out.std() + 1e-12)


def normal_map(h, strength):
    """Tangent-space normal (OpenGL convention: +X right, +Y up = toward row 0) from a periodic height."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * 0.5
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def periodic_blur(a, sigma):
    n0, n1 = a.shape
    k0 = np.fft.fftfreq(n0)
    k1 = np.fft.fftfreq(n1)
    K0, K1 = np.meshgrid(k0, k1, indexing='ij')
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (K0 ** 2 + K1 ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def wrapped_delta(a, b, n):
    d = a - b
    return (d + n / 2) % n - n / 2


def seam_error(a):
    """Mean |difference| across the wrap seams vs inside the image (tileability check)."""
    a = a.astype(np.float64)
    if a.ndim == 3:
        a = a.mean(-1)
    inner = np.abs(np.diff(a, axis=1)).mean() + np.abs(np.diff(a, axis=0)).mean()
    seam = np.abs(a[:, 0] - a[:, -1]).mean() + np.abs(a[0, :] - a[-1, :]).mean()
    return seam / max(inner, 1e-9)


# ============================================================================================ detail maps
def detail_paint_normal(out, rng, n=1024):
    peel = pnoise(rng, n, beta=1.2, fmin=40, fmax=220) * 0.35
    wave = pnoise(rng, n, beta=3.5, fmin=1, fmax=12) * 1.2
    h = peel + wave
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    for _ in range(46):                      # shallow dents (impacts, tool marks), wrapped
        cx, cy = rng.uniform(0, n), rng.uniform(0, n)
        r = rng.uniform(6, 34)
        dx = wrapped_delta(xx, cx, n)
        dy = wrapped_delta(yy, cy, n)
        sx = rng.uniform(0.6, 1.4)
        h -= rng.uniform(1.5, 5.0) * np.exp(-((dx * sx) ** 2 + (dy / sx) ** 2) / (2 * r * r))
    nm = normal_map(h, 0.25)
    save_rgb(os.path.join(out, 'detail_paint_normal.png'), nm)
    return nm


def strokes_canvas(n, draw_fn, blur=0.0):
    big = Image.new('L', (n * 3, n * 3), 0)
    d = ImageDraw.Draw(big)
    draw_fn(d, n)
    if blur:
        big = big.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(big, dtype=np.float32) / 255.0
    tile = np.zeros((n, n), np.float32)
    for i in range(3):
        for j in range(3):
            tile = np.maximum(tile, a[i * n:(i + 1) * n, j * n:(j + 1) * n])
    return tile


def detail_scratch(out, rng, n=1024):
    def draw(d, n):
        dom = rng.uniform(0, math.pi)
        for k in range(520):
            x, y = rng.uniform(n, 2 * n), rng.uniform(n, 2 * n)
            a = dom + rng.normal(0, 0.25) if rng.random() < 0.6 else rng.uniform(0, math.pi)
            L = rng.uniform(8, 140) * (1.0 if rng.random() < 0.85 else 2.5)
            w = 1 if rng.random() < 0.8 else 2
            v = int(rng.uniform(90, 255))
            pts = [(x, y)]
            for s in range(4):
                a += rng.normal(0, 0.06)
                x += math.cos(a) * L / 4
                y += math.sin(a) * L / 4
                pts.append((x, y))
            d.line(pts, fill=v, width=w)
        for k in range(26):                  # scuff patches: bundles of short parallel strokes
            cx, cy = rng.uniform(n, 2 * n), rng.uniform(n, 2 * n)
            a = rng.uniform(0, math.pi)
            for s in range(rng.integers(12, 40)):
                ox, oy = rng.normal(0, 14), rng.normal(0, 14)
                L = rng.uniform(4, 22)
                d.line([(cx + ox, cy + oy), (cx + ox + math.cos(a) * L, cy + oy + math.sin(a) * L)],
                       fill=int(rng.uniform(50, 160)), width=1)
    t = strokes_canvas(n, draw, blur=0.55)
    t = np.clip(t * 1.3, 0, 1)
    save_gray(os.path.join(out, 'detail_scratch.png'), t)
    return t


def detail_grime(out, rng, n=1024):
    streak = pnoise(rng, n, beta=2.2, fmin=2, aniso=(1.0, 0.12))
    blotch = pnoise(rng, n, beta=2.4, fmin=3, fmax=60)
    fine = pnoise(rng, n, beta=1.0, fmin=80)
    g = 0.42 + 0.16 * streak + 0.18 * blotch + 0.05 * fine
    g = smoothstep(0.15, 0.95, g)
    save_gray(os.path.join(out, 'detail_grime.png'), g)
    return g


def voronoi_facets(rng, n, npts, tilt):
    px = rng.uniform(0, n, npts)
    py = rng.uniform(0, n, npts)
    ax = rng.normal(0, tilt, npts)
    ay = rng.normal(0, tilt, npts)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    f1 = np.full((n, n), 1e9, np.float32)
    f2 = np.full((n, n), 1e9, np.float32)
    h = np.zeros((n, n), np.float32)
    for i in range(npts):
        dx = wrapped_delta(xx, px[i], n)
        dy = wrapped_delta(yy, py[i], n)
        d = dx * dx + dy * dy
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        h = np.where(closer, ax[i] * dx + ay[i] * dy, h)
        f1 = np.where(closer, d, f1)
    return h, np.sqrt(f2) - np.sqrt(f1)


def detail_mli_normal(out, rng, n=1024):
    h1, e1 = voronoi_facets(rng, n, 150, 0.35)
    h2, e2 = voronoi_facets(rng, n, 600, 0.22)
    crease = np.exp(-e1 / 3.0) * 3.0 + np.exp(-e2 / 2.0) * 1.2
    h = h1 + 0.5 * h2 - crease + pnoise(rng, n, beta=2.5, fmin=2, fmax=30) * 6.0
    nm = normal_map(h, 0.35)
    save_rgb(os.path.join(out, 'detail_mli_normal.png'), nm)
    return nm


def detail_nonslip(out, rng, n=512):
    cell = 64
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    cx = (xx % cell) / cell - 0.5
    cy = (yy % cell) / cell - 0.5
    parity = ((xx // cell) + (yy // cell)) % 2
    ang = np.where(parity == 0, math.pi / 4, -math.pi / 4)
    u = cx * np.cos(ang) + cy * np.sin(ang)
    v = -cx * np.sin(ang) + cy * np.cos(ang)
    d = np.abs(u) / 0.36 + np.abs(v) / 0.14
    lug = smoothstep(1.0, 0.75, d)
    grit = pnoise(rng, n, beta=0.6, fmin=90) * 0.05 + pnoise(rng, n, beta=2.5, fmin=2, fmax=8) * 0.02
    h = np.clip(0.25 + 0.6 * lug + grit, 0, 1)
    save_gray(os.path.join(out, 'detail_nonslip.png'), h)
    return h


# ============================================================================================ sphere noise
class Perlin3:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256)
        self.p = np.concatenate([p, p]).astype(np.int32)
        g = rng.standard_normal((256, 3)).astype(np.float32)
        self.g = g / np.linalg.norm(g, axis=1, keepdims=True)

    def __call__(self, x, y, z):
        xi, yi, zi = np.floor(x), np.floor(y), np.floor(z)
        xf, yf, zf = x - xi, y - yi, z - zi
        xi = xi.astype(np.int32) & 255
        yi = yi.astype(np.int32) & 255
        zi = zi.astype(np.int32) & 255
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        w = zf * zf * zf * (zf * (zf * 6 - 15) + 10)
        p, g = self.p, self.g

        def gd(ix, iy, iz, fx, fy, fz):
            h = p[p[p[ix] + iy] + iz]
            gg = g[h]
            return gg[..., 0] * fx + gg[..., 1] * fy + gg[..., 2] * fz
        x1, y1, z1 = (xi + 1) & 255, (yi + 1) & 255, (zi + 1) & 255
        n000 = gd(xi, yi, zi, xf, yf, zf)
        n100 = gd(x1, yi, zi, xf - 1, yf, zf)
        n010 = gd(xi, y1, zi, xf, yf - 1, zf)
        n110 = gd(x1, y1, zi, xf - 1, yf - 1, zf)
        n001 = gd(xi, yi, z1, xf, yf, zf - 1)
        n101 = gd(x1, yi, z1, xf - 1, yf, zf - 1)
        n011 = gd(xi, y1, z1, xf, yf - 1, zf - 1)
        n111 = gd(x1, y1, z1, xf - 1, yf - 1, zf - 1)
        x00 = n000 + u * (n100 - n000)
        x10 = n010 + u * (n110 - n010)
        x01 = n001 + u * (n101 - n001)
        x11 = n011 + u * (n111 - n011)
        y0 = x00 + v * (x10 - x00)
        y1_ = x01 + v * (x11 - x01)
        return y0 + w * (y1_ - y0)


def sphere_grid(H, W):
    lat = (90.0 - (np.arange(H) + 0.5) * 180.0 / H).astype(np.float32)
    lon = (-180.0 + (np.arange(W) + 0.5) * 360.0 / W).astype(np.float32)
    la, lo = np.radians(lat)[:, None], np.radians(lon)[None, :]
    X = (np.cos(la) * np.cos(lo)).astype(np.float32)
    Y = (np.cos(la) * np.sin(lo)).astype(np.float32)
    Z = np.broadcast_to(np.sin(la), (H, W)).astype(np.float32)
    return lat, lon, X, Y, Z


def fbm_sphere(X, Y, Z, seed, octaves=5, freq=2.0, gain=0.5, lac=2.0, chunk=256, warp=None):
    noise = Perlin3(seed)
    H = X.shape[0]
    out = np.zeros(X.shape, np.float32)
    for r0 in range(0, H, chunk):
        sl = slice(r0, min(H, r0 + chunk))
        x, y, z = X[sl], Y[sl], Z[sl]
        if warp is not None:
            wx, wy, wz = warp
            x, y, z = x + wx[sl], y + wy[sl], z + wz[sl]
        a, f, acc = 1.0, freq, np.zeros(x.shape, np.float32)
        for o in range(octaves):
            acc += a * noise(x * f + 17.1 * o, y * f + 3.3 * o, z * f + 7.7 * o)
            a *= gain
            f *= lac
        out[sl] = acc
    return out


def upsample(a, H, W):
    return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((W, H), Image.BILINEAR), dtype=np.float32)


def unit(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)], np.float32)


# ============================================================================================ moon
MARIA = [  # name, lat, lon, semi-axis lat (deg), semi-axis lon-ish (deg), rotation (deg), albedo, tint
    ('Procellarum', 18, -57, 26, 17, 20, 0.068, (1.02, 1.0, 0.97)),
    ('Imbrium', 33, -16, 16, 19, 0, 0.066, (1.03, 1.0, 0.95)),
    ('Serenitatis', 28, 17, 10, 10, 0, 0.074, (1.04, 1.0, 0.95)),
    ('Tranquillitatis', 8.5, 31, 11, 13, 25, 0.064, (0.95, 0.98, 1.05)),
    ('Crisium', 17, 59, 8, 9, 0, 0.068, (0.98, 0.99, 1.02)),
    ('Fecunditatis', -8, 51, 12, 8, -15, 0.07, (0.99, 1.0, 1.0)),
    ('Nubium', -21, -17, 10, 11, 0, 0.072, (1.0, 1.0, 0.99)),
    ('Frigoris', 56, 1, 4.5, 38, 0, 0.074, (1.02, 1.0, 0.97)),
    ('Nectaris', -15, 35, 5, 5, 0, 0.07, (1.0, 1.0, 1.0)),
    ('Humorum', -24, -39, 6, 6, 0, 0.069, (1.0, 1.0, 1.0)),
    ('Cognitum', -10, -23, 5, 6, 0, 0.071, (1.0, 1.0, 1.0)),
    ('Vaporum', 13, 4, 4, 5, 0, 0.073, (1.02, 1.0, 0.97)),
    ('Insularum', 7, -31, 5, 7, 0, 0.072, (1.0, 1.0, 1.0)),
    ('Smythii', -1, 87, 6, 6, 0, 0.074, (1.0, 1.0, 1.0)),
    ('Marginis', 13, 86, 5, 5, 0, 0.076, (1.0, 1.0, 1.0)),
    ('Orientale', -19, -93, 4, 4, 0, 0.074, (1.0, 1.0, 1.0)),
    ('Moscoviense', 27, 147, 4, 4, 0, 0.074, (1.0, 1.0, 1.0)),
    ('Australe', -46, 91, 6, 9, 0, 0.078, (1.0, 1.0, 1.0)),
]
RAYED = [  # name, lat, lon, D km, ray length km, brightness
    ('Tycho', -43.3, -11.2, 86, 1500, 1.0), ('Copernicus', 9.6, -20.1, 93, 800, 0.8),
    ('Kepler', 8.1, -38.0, 32, 400, 0.6), ('Aristarchus', 23.7, -47.4, 40, 300, 0.7),
    ('Proclus', 16.1, 46.8, 28, 450, 0.6), ('Giordano Bruno', 35.9, 102.8, 22, 350, 0.7),
    ('Jackson', 22.4, -163.1, 71, 650, 0.7), ('Ohm', 18.4, -113.5, 64, 400, 0.5),
]


def mare_masks(X, Y, Z, rough, edge):
    """Soft irregular maria (ellipses on local tangent planes, edges perturbed by noise)."""
    m = np.zeros(X.shape, np.float32)
    alb = np.zeros(X.shape, np.float32)
    tint = np.zeros(X.shape + (3,), np.float32)
    for name, la, lo, a_lat, a_lon, rot, al, tn in MARIA:
        c = unit(la, lo)
        e = np.array([-math.sin(math.radians(lo)), math.cos(math.radians(lo)), 0.0], np.float32)
        nvec = np.cross(c, e)
        dc = X * c[0] + Y * c[1] + Z * c[2]
        de = X * e[0] + Y * e[1] + Z * e[2]
        dn = X * nvec[0] + Y * nvec[1] + Z * nvec[2]
        u = np.degrees(np.arctan2(de, dc))
        v = np.degrees(np.arctan2(dn, dc))
        cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        uu, vv = u * cr - v * sr, u * sr + v * cr
        d = np.sqrt((uu / a_lon) ** 2 + (vv / a_lat) ** 2)
        d = np.where(dc > 0, d, 9.0)
        mk = 1.0 - smoothstep(0.8, 1.05, d + 0.32 * rough + 0.12 * edge)
        newer = mk > m
        alb = np.where(newer, al, alb)
        tint = np.where(newer[..., None], np.array(tn, np.float32), tint)
        m = np.maximum(m, mk)
    return m, alb, tint


def stamp_crater(Hf, fresh, ejecta_a, X, Y, Z, lat_rad, W, H, c, D, age, rng):
    a = (D * 0.5) / R_MOON
    win = 3.2 * a if age < 0.6 else 2.2 * a
    lat0 = math.asin(max(-1.0, min(1.0, float(c[2]))))
    lon0 = math.atan2(float(c[1]), float(c[0]))
    r0 = int(max(0, math.floor((math.pi / 2 - (lat0 + win)) / math.pi * H)))
    r1 = int(min(H, math.ceil((math.pi / 2 - (lat0 - win)) / math.pi * H) + 1))
    if r1 <= r0:
        return
    cl = math.cos(lat0)
    if abs(lat0) + win > math.radians(84) or cl < 1e-3:
        cols = np.arange(W)
    else:
        dl = win / cl
        cc0 = (lon0 - dl + math.pi) / math.tau * W
        cc1 = (lon0 + dl + math.pi) / math.tau * W
        cols = np.arange(int(math.floor(cc0)), int(math.ceil(cc1)) + 1) % W
    xs = X[r0:r1][:, cols]
    ys = Y[r0:r1][:, cols]
    zs = Z[r0:r1][:, cols]
    dot = np.clip(xs * c[0] + ys * c[1] + zs * c[2], -1, 1)
    r = np.arccos(dot) / a
    if not (r < 3.2).any():
        return
    complex_ = D > 18
    if complex_:
        depth = 1.044 * D ** 0.301
        rim = 0.236 * D ** 0.399
    else:
        depth = 0.196 * D ** 1.01
        rim = 0.036 * D ** 1.014
    depth *= (1 - 0.65 * age)
    rim *= (1 - 0.8 * age)
    h = np.zeros_like(r)
    inside = r < 1.0
    if complex_:
        rf = 0.45
        wall = np.clip((r - rf) / (1 - rf), 0, 1)
        prof = -depth + (depth + rim) * wall ** 1.6
        prof += 0.06 * depth * np.sin(wall * math.pi * 3) * (wall > 0) * (1 - age)       # terraces
        peak = 0.45 * depth * np.clip(1 - r / 0.16, 0, 1) ** 1.5 * (1 - 0.5 * age) if D > 26 else 0.0
        h = np.where(inside, prof + peak, h)
    else:
        prof = -depth + (depth + rim) * r ** 2
        if age > 0.4:
            prof = -depth * (1 - smoothstep(0.0, 1.05, r)) + rim * np.exp(-((r - 1.0) / 0.25) ** 2)
        h = np.where(inside, prof, h)
    outside = ~inside
    ej = rim * np.power(np.maximum(r, 1.0), -3.0) * (1 - smoothstep(2.2, 3.2, r))
    h = np.where(outside, ej, h)
    Hf[r0:r1, cols] += h.astype(np.float32)
    if age < 0.25:
        f = (1 - age / 0.25) * (np.clip(1.0 - r / 2.6, 0, 1) ** 1.5)
        fresh[r0:r1, cols] = np.maximum(fresh[r0:r1, cols], f.astype(np.float32))
    if age > 0.5 and complex_:
        ejecta_a[r0:r1, cols] += (-0.004 * inside * (age - 0.5)).astype(np.float32)


def rays(X, Y, Z, H, W, lat, lon, D, L, rng):
    c = unit(lat, lon)
    a = L / R_MOON
    lat0, lon0 = math.radians(lat), math.radians(lon)
    r0 = int(max(0, math.floor((math.pi / 2 - (lat0 + a)) / math.pi * H)))
    r1 = int(min(H, math.ceil((math.pi / 2 - (lat0 - a)) / math.pi * H)))
    xs, ys, zs = X[r0:r1], Y[r0:r1], Z[r0:r1]
    dot = np.clip(xs * c[0] + ys * c[1] + zs * c[2], -1, 1)
    dist = np.arccos(dot)
    # bearing from the crater centre
    e = np.array([-math.sin(lon0), math.cos(lon0), 0.0], np.float32)
    nv = np.cross(c, e)
    be = np.arctan2(xs * nv[0] + ys * nv[1] + zs * nv[2], xs * e[0] + ys * e[1] + zs * e[2])
    out = np.zeros(dist.shape, np.float32)
    K = 26
    for k in range(K):
        th = rng.uniform(-math.pi, math.pi)
        Lk = a * rng.uniform(0.35, 1.0)
        wk = (rng.uniform(14, 40) / R_MOON)
        d_th = np.angle(np.exp(1j * (be - th)))
        perp = np.abs(d_th) * np.sin(np.minimum(dist, math.pi / 2))
        w_here = wk * (1 + 2.5 * dist / a)
        g = np.exp(-(perp / w_here) ** 2) * np.clip(1 - dist / Lk, 0, 1) ** 1.2 * smoothstep(0.0, 3.0 * D / R_MOON, dist)
        out = np.maximum(out, g.astype(np.float32))
    halo = 0.6 * np.exp(-(dist / (D * 1.1 / R_MOON)) ** 2)
    mask = np.clip(out * 0.7 + halo, 0, 1)
    return r0, r1, mask


def moon(out, seed=4242):
    t0 = time.time()
    H, W = 2048, 4096
    lat, lon, X, Y, Z = sphere_grid(H, W)
    rng = np.random.default_rng(seed)
    # large-scale terrain + edge roughness (computed at half res, upsampled)
    lat2, lon2, X2, Y2, Z2 = sphere_grid(H // 2, W // 2)
    big = upsample(fbm_sphere(X2, Y2, Z2, seed + 1, octaves=6, freq=1.6), H, W)
    rough = upsample(fbm_sphere(X2, Y2, Z2, seed + 2, octaves=4, freq=5.0), H, W)
    fine = fbm_sphere(X, Y, Z, seed + 3, octaves=2, freq=60.0)
    edge = fbm_sphere(X, Y, Z, seed + 4, octaves=3, freq=22.0)
    mare, mare_alb, mare_tint = mare_masks(X, Y, Z, rough, edge)
    # South Pole-Aitken: subtle darker depression, 2500 km
    spa_c = unit(-53, -169)
    spa_d = np.arccos(np.clip(X * spa_c[0] + Y * spa_c[1] + Z * spa_c[2], -1, 1)) / (1250 / R_MOON)
    spa = 1 - smoothstep(0.6, 1.15, spa_d + 0.15 * rough)
    Hf = (big * 1.4 - 1.6 * mare - 2.5 * spa + 0.12 * fine).astype(np.float32)
    fresh = np.zeros((H, W), np.float32)
    ejecta_a = np.zeros((H, W), np.float32)
    # crater population: N(>D) ~ D^-2 (D 8 .. 420 km), large first (old), maria resurfaced
    n = 24000
    D = 8.0 * np.power(rng.random(n), -0.5)
    D = D[D < 420]
    D = np.sort(D)[::-1]
    print(f'  moon: {len(D)} craters', flush=True)
    for Dk in D:
        z = rng.uniform(-1, 1)
        ph = rng.uniform(-math.pi, math.pi)
        s = math.sqrt(1 - z * z)
        c = np.array([s * math.cos(ph), s * math.sin(ph), z], np.float32)
        lat_c = math.degrees(math.asin(z))
        lon_c = math.degrees(ph)
        row = int((90 - lat_c) / 180 * (H - 1))
        col = int((lon_c + 180) / 360 * (W - 1))
        on_mare = mare[row, col]
        age = float(np.clip(rng.beta(2.2, 1.6) * (0.6 + 0.4 * min(1.0, Dk / 60)), 0, 1))
        if on_mare > 0.5:
            if Dk > 40 or rng.random() < 0.82:
                continue            # buried by mare flooding; the survivors are young
            age *= 0.5
        stamp_crater(Hf, fresh, ejecta_a, X, Y, Z, lat, W, H, c, float(Dk), age, rng)
    # named craters
    named = [('Shackleton', -89.9, 0.0, 21, 0.3), ('Tycho', -43.3, -11.2, 86, 0.02),
             ('Copernicus', 9.6, -20.1, 93, 0.05), ('Kepler', 8.1, -38.0, 32, 0.05),
             ('Aristarchus', 23.7, -47.4, 40, 0.03), ('Proclus', 16.1, 46.8, 28, 0.06),
             ('Giordano Bruno', 35.9, 102.8, 22, 0.01), ('Jackson', 22.4, -163.1, 71, 0.05),
             ('Ohm', 18.4, -113.5, 64, 0.08), ('Plato', 51.6, -9.4, 101, 0.4), ('Clavius', -58.4, -14.4, 225, 0.7),
             ('Ptolemaeus', -9.3, -1.9, 153, 0.85), ('Langrenus', -8.9, 61.0, 132, 0.3)]
    for name, la, lo, Dn, age in named:
        stamp_crater(Hf, fresh, ejecta_a, X, Y, Z, lat, W, H, unit(la, lo), float(Dn), age, rng)
    ray = np.zeros((H, W), np.float32)
    bright = np.zeros((H, W), np.float32)
    for name, la, lo, Dn, L, b in RAYED:
        r0, r1, mk = rays(X, Y, Z, H, W, la, lo, Dn, L, rng)
        ray[r0:r1] = np.maximum(ray[r0:r1], mk * b)
        if name == 'Aristarchus':
            c = unit(la, lo)
            d = np.arccos(np.clip(X * c[0] + Y * c[1] + Z * c[2], -1, 1)) / (Dn / R_MOON)
            bright = np.maximum(bright, np.exp(-d * d).astype(np.float32))
    print(f'  moon: terrain done {time.time() - t0:.1f}s', flush=True)
    # ---- albedo (linear normal albedo -> sRGB)
    alb_hi = 0.12 * (1 + 0.1 * big + 0.05 * fine) - 0.012 * spa
    alb = alb_hi * (1 - mare) + (mare_alb * (1 + 0.05 * fine)) * mare
    hp = Hf - upsample(Hf.reshape(H // 8, 8, W // 8, 8).mean(axis=(1, 3)), H, W)
    alb = alb * (1 + 0.09 * np.clip(hp, -2.5, 2.5)) + 0.12 * (1 - mare) * 0.08 * np.clip(big, -1, 1)
    alb = alb * (1 + 0.06 * edge * mare)
    alb = alb + 0.022 * fresh + 0.065 * ray * (1 - 0.3 * mare) + 0.12 * bright + ejecta_a
    alb = np.clip(alb, 0.03, 0.4)
    tint_hi = np.array([1.0, 0.985, 0.955], np.float32)
    tint = tint_hi * (1 - mare[..., None]) + mare_tint * mare[..., None]
    rgb = lin2srgb(alb[..., None] * tint)
    save_rgb(os.path.join(out, 'moon_albedo.jpg'), rgb, 90)
    # ---- normal map (tangent: R = east, G = north), slopes in true units, exaggerated x2
    dlon = 2 * math.pi / W
    dlat = math.pi / H
    coslat = np.maximum(np.cos(np.radians(lat)), 0.03)[:, None]
    gx = (np.roll(Hf, -1, 1) - np.roll(Hf, 1, 1)) / (2 * R_MOON * coslat * dlon)
    gy = np.zeros_like(Hf)
    gy[1:-1] = (Hf[:-2] - Hf[2:]) / (2 * R_MOON * dlat)
    k = 2.0
    nmap = np.stack([-gx * k, -gy * k, np.ones_like(Hf)], -1)
    nmap /= np.linalg.norm(nmap, axis=-1, keepdims=True)
    save_rgb(os.path.join(out, 'moon_normal.jpg'), nmap * 0.5 + 0.5, 92)
    # ---- height (2048 x 1024, 8-bit, percentile-normalised)
    h2 = Hf.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
    lo_, hi_ = np.percentile(h2, [0.3, 99.7])
    save_gray(os.path.join(out, 'moon_height.png'), np.clip((h2 - lo_) / (hi_ - lo_), 0, 1))
    print(f'  moon: {time.time() - t0:.1f}s', flush=True)


# ============================================================================================ earth
def topo_land(path):
    """Decode a TopoJSON MultiPolygon land layer: delta-encoded, quantised arcs -> lon/lat rings."""
    with open(path) as f:
        d = json.load(f)
    sx, sy = d['transform']['scale']
    tx, ty = d['transform']['translate']
    arcs = []
    for arc in d['arcs']:
        a = np.cumsum(np.array(arc, dtype=np.int64), axis=0)
        arcs.append(np.column_stack([a[:, 0] * sx + tx, a[:, 1] * sy + ty]))

    def ring(ids):
        pts = []
        for k, i in enumerate(ids):
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.append(a if k == 0 else a[1:])
        return np.concatenate(pts)
    polys = []
    for g in d['objects']['land']['geometries']:
        coords = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
        for poly in coords:
            polys.append([ring(r) for r in poly])
    return polys


def land_mask(polys, W, H, ss=2):
    im = Image.new('L', (W * ss, H * ss), 0)
    dr = ImageDraw.Draw(im)
    for poly in polys:
        for k, rg in enumerate(poly):
            lon, lat = rg[:, 0].copy(), rg[:, 1]
            # unwrap antimeridian jumps so no ring smears across the map
            for i in range(1, len(lon)):
                dlon = lon[i] - lon[i - 1]
                if dlon > 180:
                    lon[i:] -= 360
                elif dlon < -180:
                    lon[i:] += 360
            for shift in (-360, 0, 360):
                xs = (lon + 180 + shift) / 360 * W * ss
                if xs.max() < 0 or xs.min() > W * ss:
                    continue
                ys = (90 - lat) / 180 * H * ss
                dr.polygon(list(zip(xs.tolist(), ys.tolist())), fill=255 if k == 0 else 0)
    im = im.resize((W, H), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def earth(out, seed=777):
    t0 = time.time()
    W, H = 2048, 1024
    polys = topo_land(os.path.join(ROOT, 'node_modules', 'world-atlas', 'land-50m.json'))
    land = land_mask(polys, W, H)
    lat, lon, X, Y, Z = sphere_grid(H, W)
    alat = np.abs(lat)[:, None] * np.ones((1, W), np.float32)
    LON = np.ones((H, 1), np.float32) * lon[None, :]
    LAT = lat[:, None] * np.ones((1, W), np.float32)
    n1 = fbm_sphere(X, Y, Z, seed, octaves=5, freq=3.0)
    n2 = fbm_sphere(X, Y, Z, seed + 1, octaves=4, freq=9.0)
    # distance from the coast (continentality) via blurred land mask
    cont = periodic_blur(land, 14).astype(np.float32)
    shelf = periodic_blur(land, 4).astype(np.float32)

    def blob(la, lo, sla, slo):
        return np.exp(-(((LAT - la) / sla) ** 2 + ((LON - lo) / slo) ** 2))
    arid = (np.exp(-((alat - 24) / 7.0) ** 2) * 0.35 * smoothstep(0.75, 1.0, cont)
            + 1.0 * blob(23, 10, 7, 24) + 0.8 * blob(24, 46, 7, 11) + 0.75 * blob(-25, 132, 7, 12)
            + 0.6 * blob(42, 102, 4, 16) + 0.5 * blob(-23, 19, 5, 6) + 0.4 * blob(33, -113, 5, 7)
            + 0.45 * blob(28, 66, 5, 8) + 0.5 * blob(-24, -69, 7, 2.5) + 0.35 * blob(40, 60, 5, 10)
            + 0.15 * n1)
    arid = np.clip(arid - 0.3 * np.exp(-((alat - 2) / 7.0) ** 2), 0, 1.4)
    forest_trop = np.exp(-(alat / 11.0) ** 2) * (1 - 0.6 * arid)
    boreal = np.exp(-((alat - 58) / 7.0) ** 2)
    tundra = smoothstep(63, 70, alat)
    ice_land = smoothstep(72, 78, alat + 6 * n2) + blob(72, -40, 9, 22) * (LAT > 60) * 1.2
    ice_land = np.clip(ice_land + (LAT < -62) * 1.0, 0, 1)
    c_trop = np.array([0.10, 0.20, 0.07])
    c_sav = np.array([0.34, 0.33, 0.17])
    c_temp = np.array([0.22, 0.28, 0.13])
    c_bor = np.array([0.12, 0.18, 0.10])
    c_desert = np.array([0.72, 0.58, 0.38])
    c_tundra = np.array([0.40, 0.37, 0.31])
    c_ice = np.array([0.92, 0.94, 0.96])
    col = c_temp * np.ones((H, W, 1))
    sav_w = np.clip(np.exp(-((alat - 13) / 7.0) ** 2) + 0.3 * arid, 0, 1)[..., None]
    col = col * (1 - sav_w) + c_sav * sav_w
    col = col * (1 - forest_trop[..., None]) + c_trop * forest_trop[..., None]
    col = col * (1 - boreal[..., None]) + c_bor * boreal[..., None]
    dw = smoothstep(0.45, 0.9, arid)[..., None]
    col = col * (1 - dw) + c_desert * dw
    col = col * (1 - tundra[..., None]) + c_tundra * tundra[..., None]
    col = col * (1 - ice_land[..., None]) + c_ice * ice_land[..., None]
    col *= (1 + 0.12 * n2[..., None])
    # oceans: deep blue, lighter shelves, polar sea ice
    ocean = np.array([0.015, 0.055, 0.15]) * (1 + 0.15 * n1[..., None])
    sh = smoothstep(0.02, 0.4, shelf)[..., None] * (1 - land[..., None])
    ocean = ocean * (1 - sh) + np.array([0.03, 0.13, 0.22]) * sh
    seaice = np.clip(smoothstep(72, 82, LAT + 4 * n2) + smoothstep(-66, -72, LAT + 3 * n2), 0, 1)[..., None]
    ocean = ocean * (1 - seaice * 0.9) + np.array([0.85, 0.88, 0.92]) * seaice * 0.9
    rgb = col * land[..., None] + ocean * (1 - land[..., None])
    save_rgb(os.path.join(out, 'earth_albedo.jpg'), np.clip(rgb, 0, 1) ** (1 / 1.25), 90)
    mask = (1 - land).reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
    save_gray(os.path.join(out, 'earth_ocean_mask.png'), mask)
    # clouds: 3D noise with domain warp (cyclone swirls) and latitude banding
    wx = fbm_sphere(X, Y, Z, seed + 5, octaves=3, freq=2.5) * 0.25
    wy = fbm_sphere(X, Y, Z, seed + 6, octaves=3, freq=2.5) * 0.25
    wz = fbm_sphere(X, Y, Z, seed + 7, octaves=3, freq=2.5) * 0.25
    cl = fbm_sphere(X, Y, Z, seed + 8, octaves=7, freq=4.0, warp=(wx, wy, wz))
    band = (0.55 * np.exp(-((LAT - 6) / 6.0) ** 2) + 0.55 * np.exp(-((alat - 52) / 12.0) ** 2)
            - 0.35 * np.exp(-((alat - 24) / 8.0) ** 2) + 0.2 * smoothstep(60, 80, alat))
    c = smoothstep(0.05, 0.75, cl * 0.9 + band * 0.75 + 0.05)
    c = np.clip(c * (0.75 + 0.25 * smoothstep(-0.2, 0.6, n2)), 0, 1)
    save_rgb(os.path.join(out, 'earth_clouds.jpg'), np.repeat(c[..., None], 3, -1), 88)
    print(f'  earth: {time.time() - t0:.1f}s', flush=True)


# ============================================================================================ main
def main(out=None):
    out = out or os.path.join(ROOT, 'assets', 'tex')
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(20261030)
    t0 = time.time()
    checks = {
        'detail_paint_normal': detail_paint_normal(out, rng),
        'detail_scratch': detail_scratch(out, rng),
        'detail_grime': detail_grime(out, rng),
        'detail_mli_normal': detail_mli_normal(out, rng),
        'detail_nonslip': detail_nonslip(out, rng),
    }
    for k, a in checks.items():
        e = seam_error(a)
        print(f'  {k}: seam/inner gradient ratio {e:.2f} ({"seamless" if e < 1.6 else "CHECK SEAM"})', flush=True)
    print(f'  detail maps {time.time() - t0:.1f}s', flush=True)
    earth(out)
    moon(out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
