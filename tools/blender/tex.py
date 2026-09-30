# Seamless PBR texture library for the mansion (numpy, run inside Blender for image I/O).
# Output: public/textures/<name>_c.webp (color), _n.webp (normal, OpenGL +Y), _orm.webp (R=AO, G=rough, B=metal)
import bpy, os, math
import numpy as np

OUT = r"D:\Web Based - Horror Game\public\textures"
os.makedirs(OUT, exist_ok=True)
CFG = globals().get('CFG', {})
S = CFG.get('size', 1024)
ONLY = CFG.get('only')
R = np.random.default_rng(1234)


# ----------------------------------------------------------------------------- periodic noise
def pnoise(h, w, cy, cx, seed):
    g = np.random.default_rng(seed).random((cy, cx)).astype(np.float32)
    y = np.arange(h, dtype=np.float32) * cy / h
    x = np.arange(w, dtype=np.float32) * cx / w
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int)
    fy = y - y0; fx = x - x0
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y0 %= cy; x0 %= cx
    y1 = (y0 + 1) % cy; x1 = (x0 + 1) % cx
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    fx = fx[None, :]; fy = fy[:, None]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


def fbm(h, w, cy, cx, oct=5, seed=0, gain=0.5):
    s = np.zeros((h, w), np.float32); amp = 1.0; tot = 0.0
    for o in range(oct):
        s += amp * pnoise(h, w, cy * 2 ** o, cx * 2 ** o, seed + o * 101)
        tot += amp; amp *= gain
    return s / tot


def ridged(n, width=0.03):
    return np.clip(1 - np.abs(n - 0.5) / width, 0, 1)


def blur(a, r=1):
    out = a.copy()
    for _ in range(r):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5
    return out


def normal_from(h, strength=4.0):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gup = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * 0.5
    n = np.stack([-gx * strength * h.shape[1] / 256, -gup * strength * h.shape[0] / 256, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def ao_from(h, r=4, k=1.8):
    b = blur(h, r)
    return np.clip(1 - np.maximum(b - h, 0) * k * 10, 0.35, 1)


def lerp(a, b, t):
    t = t[..., None] if (isinstance(t, np.ndarray) and t.ndim == 2) else t
    return np.asarray(a, np.float32) + (np.asarray(b, np.float32) - np.asarray(a, np.float32)) * t


def save(name, arr, quality=88):
    h, w = arr.shape[:2]
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, -1)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img = bpy.data.images.new('__tex', w, h, alpha=False)
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).ravel())
    path = os.path.join(OUT, name + '.webp')
    img.filepath_raw = path
    img.file_format = 'WEBP'
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        img.save()
    bpy.data.images.remove(img)
    return path


def write_set(name, color, height, rough, metal=0.0, nstrength=4.0, ao=None, cq=86):
    save(name + '_c', color, cq)
    save(name + '_n', normal_from(height, nstrength), 90)
    a = ao if ao is not None else ao_from(height)
    m = metal if isinstance(metal, np.ndarray) else np.full_like(height, metal)
    rough = np.broadcast_to(np.asarray(rough, np.float32), height.shape)
    save(name + '_orm', np.stack([a, np.clip(rough, 0.03, 1), m], -1), 88)
    return name


YY, XX = np.mgrid[0:S, 0:S].astype(np.float32)
U, Vv = XX / S, YY / S
done = []


def want(n):
    return ONLY is None or n in ONLY


# ----------------------------------------------------------------------------- WOOD FLOOR (aged oak planks)
def planks(name, rows=6, seglen=0.55, c0=(0.18, 0.105, 0.06), c1=(0.33, 0.2, 0.11), seed=1, worn=0.35):
    col = np.zeros((S, S, 3), np.float32); hgt = np.zeros((S, S), np.float32)
    rough = np.zeros((S, S), np.float32)
    rh = S // rows
    g = np.random.default_rng(seed)
    grain = fbm(S, S, 48, 3, 5, seed)
    fine = fbm(S, S, 256, 8, 3, seed + 7)
    rings = np.sin((Vv * rows * 9 + grain * 6 + fine * 1.5) * math.pi * 2) * 0.5 + 0.5
    knots = fbm(S, S, 8, 8, 3, seed + 3)
    for r in range(rows):
        y0, y1 = r * rh, (r + 1) * rh if r < rows - 1 else S
        off = g.uniform(0, 1)
        L = seglen
        pos = (U[y0:y1] + off) % 1.0
        seg = np.floor(pos / L * 1.0).astype(int)
        nseg = int(math.ceil(1 / L)) + 1
        tones = g.uniform(0, 1, nseg + 2)
        t = tones[seg]
        base = lerp(c0, c1, (t * 0.6 + rings[y0:y1] * 0.25 + grain[y0:y1] * 0.3).clip(0, 1))
        col[y0:y1] = base
        # plank edges and end joints
        ly = (YY[y0:y1] - y0) / (y1 - y0)
        edge = np.minimum(ly, 1 - ly) * (y1 - y0)
        ej = np.abs(((pos / L) % 1.0) - 0.0)
        ej = np.minimum(ej, 1 - ej) * L * S
        gap = np.minimum(edge, ej)
        hgt[y0:y1] = np.clip(gap / 2.5, 0, 1) * 0.6 + rings[y0:y1] * 0.08 + fine[y0:y1] * 0.1
        col[y0:y1] *= (0.35 + 0.65 * np.clip(gap / 2.0, 0, 1))[..., None]
    wear = fbm(S, S, 3, 3, 4, seed + 11)
    col = lerp(col, col * 1.25 + 0.03, np.clip((wear - 0.55) * 3, 0, 1) * worn)
    dirt = fbm(S, S, 6, 6, 5, seed + 13)
    col *= (0.8 + 0.3 * dirt)[..., None]
    rough = 0.48 + 0.25 * fine + 0.2 * np.clip((0.5 - wear) * 2, 0, 1)
    return write_set(name, col, hgt, rough, nstrength=3.0)


if want('wood_floor'):
    done.append(planks('wood_floor'))
if want('wood_floor_light'):
    done.append(planks('wood_floor_light', rows=7, c0=(0.34, 0.24, 0.14), c1=(0.52, 0.38, 0.22), seed=5, worn=0.2))


# ----------------------------------------------------------------------------- PARQUET (basket weave)
if want('parquet'):
    n = 8; cell = S // n
    col = np.zeros((S, S, 3), np.float32); hgt = np.zeros((S, S), np.float32)
    grainA = fbm(S, S, 3, 64, 4, 21); grainB = fbm(S, S, 64, 3, 4, 22)
    g = np.random.default_rng(2)
    cx = (XX // cell).astype(int); cy = (YY // cell).astype(int)
    lx = (XX % cell) / cell; ly = (YY % cell) / cell
    horiz = ((cx + cy) % 2 == 0)
    slat = np.where(horiz, np.floor(ly * 4), np.floor(lx * 4))
    sl = np.where(horiz, (ly * 4) % 1, (lx * 4) % 1)
    tone = g.uniform(0, 1, (n, n, 4))
    t = tone[cy, cx, slat.astype(int)]
    gr = np.where(horiz, grainA, grainB)
    col = lerp((0.22, 0.12, 0.06), (0.42, 0.25, 0.12), np.clip(t * 0.5 + gr * 0.6, 0, 1))
    edge = np.minimum(np.minimum(sl, 1 - sl) * cell / 4, np.minimum(np.minimum(lx, 1 - lx), np.minimum(ly, 1 - ly)) * cell)
    col *= (0.4 + 0.6 * np.clip(edge / 1.5, 0, 1))[..., None]
    hgt = np.clip(edge / 2, 0, 1) * 0.5 + gr * 0.1
    col *= (0.85 + 0.25 * fbm(S, S, 5, 5, 4, 23))[..., None]
    rough = 0.35 + 0.2 * gr + 0.2 * fbm(S, S, 4, 4, 4, 24)
    done.append(write_set('parquet', col, hgt, rough, nstrength=3))


# ----------------------------------------------------------------------------- FURNITURE WOODS
def wood_grain(name, c0, c1, seed, rough0=0.45, lacquer=True):
    grain = fbm(S, S, 64, 4, 5, seed)
    fine = fbm(S, S, 512, 16, 3, seed + 1)
    rings = np.sin((Vv * 30 + grain * 8 + fbm(S, S, 6, 2, 3, seed + 2) * 5) * math.pi * 2) * 0.5 + 0.5
    col = lerp(c0, c1, np.clip(rings * 0.45 + grain * 0.5 + fine * 0.15, 0, 1))
    pores = (fine > 0.62).astype(np.float32)
    col *= (1 - pores * 0.25)[..., None]
    hgt = rings * 0.2 + fine * 0.3 - pores * 0.3
    rough = rough0 + 0.15 * fine + pores * 0.2
    if lacquer:
        scratch = ridged(fbm(S, S, 2, 40, 3, seed + 5), 0.01)
        rough = rough + scratch * 0.2
        col *= (1 + scratch * 0.2)[..., None]
    return write_set(name, col, hgt, rough, nstrength=2)


if want('wood_dark'):
    done.append(wood_grain('wood_dark', (0.09, 0.035, 0.02), (0.24, 0.1, 0.05), 31, 0.35))
if want('wood_light'):
    done.append(wood_grain('wood_light', (0.35, 0.24, 0.14), (0.55, 0.4, 0.24), 32, 0.6, lacquer=False))
if want('wood_old'):
    done.append(wood_grain('wood_old', (0.16, 0.13, 0.1), (0.3, 0.25, 0.19), 33, 0.75, lacquer=False))


# ----------------------------------------------------------------------------- WALLPAPER (aged damask)
def damask_mask(u, v):
    """Ornament in a unit cell centred at 0,0 (u,v in -1..1), mirrored around x."""
    x = np.abs(u); y = v
    m = np.zeros_like(u)
    def ell(cx, cy, rx, ry, rot=0.0):
        c, s = math.cos(rot), math.sin(rot)
        dx, dy = x - cx, y - cy
        px, py = dx * c + dy * s, -dx * s + dy * c
        return (px / rx) ** 2 + (py / ry) ** 2
    m = np.maximum(m, (ell(0, 0.05, 0.16, 0.42) < 1))                        # central spine
    m = np.maximum(m, (ell(0, -0.52, 0.10, 0.14) < 1))                       # lower bud
    m = np.maximum(m, (ell(0, 0.62, 0.08, 0.2) < 1))                         # top spire
    m = np.maximum(m, (ell(0.30, 0.20, 0.10, 0.34, -0.6) < 1))               # leaves
    m = np.maximum(m, (ell(0.36, -0.28, 0.08, 0.28, 0.7) < 1))
    m = np.maximum(m, (ell(0.55, 0.45, 0.07, 0.2, -1.0) < 1))
    ring = np.abs(np.sqrt((x - 0.55) ** 2 + (y - 0.05) ** 2) - 0.2)          # curls
    m = np.maximum(m, (ring < 0.03) & (y < 0.2))
    ring2 = np.abs(np.sqrt((x - 0.28) ** 2 + (y + 0.62) ** 2) - 0.16)
    m = np.maximum(m, (ring2 < 0.025) & (y > -0.62))
    m = np.maximum(m, (ell(0.72, -0.65, 0.05, 0.12, 0.4) < 1))
    hole = ell(0, 0.05, 0.07, 0.25) < 1                                      # cut-out
    m = np.where(hole, 0, m)
    m = np.maximum(m, (ell(0, 0.05, 0.035, 0.12) < 1))
    return m.astype(np.float32)


def wallpaper(name, base, pat, seed, stripes=False):
    reps = 4
    cw = S / reps
    lx = (XX % cw) / cw * 2 - 1
    row = (YY // (cw * 1.3)).astype(int)
    ly = ((YY % (cw * 1.3)) / (cw * 1.3)) * 2 - 1
    mask = damask_mask(lx * 1.05, ly * 1.05)
    # half-drop second column set
    lx2 = ((XX + cw / 2) % cw) / cw * 2 - 1
    ly2 = (((YY + cw * 0.65) % (cw * 1.3)) / (cw * 1.3)) * 2 - 1
    mask = np.maximum(mask, damask_mask(lx2 * 1.8, ly2 * 1.8) * 0.0)
    mask = blur(mask, 1)
    if stripes:
        st = (np.abs(((XX / S * 12) % 1) - 0.5) < 0.04).astype(np.float32)
        mask = np.maximum(mask * 0.6, st)
    fade = fbm(S, S, 3, 3, 5, seed)
    col = lerp(base, pat, mask * (0.75 + 0.25 * fade))
    # water stains (tide lines) and grime
    st = fbm(S, S, 2, 2, 6, seed + 1)
    tide = ridged(st, 0.012) * (st > 0.4)
    col = lerp(col, np.asarray(base) * 0.55 + np.array([0.06, 0.04, 0.02]), np.clip((st - 0.55) * 2.5, 0, 1) * 0.6)
    col *= (1 - tide * 0.35)[..., None]
    grime = fbm(S, S, 8, 8, 5, seed + 2)
    col *= (0.82 + 0.3 * grime)[..., None]
    # panel seams every 0.5 tile
    seam = (np.abs(((XX / S * 2) % 1) - 0.0) < 0.004) | (np.abs(((XX / S * 2) % 1) - 1.0) < 0.004)
    col *= np.where(seam, 0.6, 1.0)[..., None]
    paper = fbm(S, S, 128, 128, 3, seed + 3)
    hgt = mask * 0.35 + paper * 0.25 - seam * 0.4
    rough = 0.82 - mask * 0.2 + paper * 0.1
    return write_set(name, col, hgt, rough, nstrength=1.6)


PALETTES = {
    'wallpaper_red': ((0.20, 0.03, 0.035), (0.34, 0.08, 0.06)),
    'wallpaper_green': ((0.06, 0.12, 0.08), (0.14, 0.22, 0.14)),
    'wallpaper_blue': ((0.06, 0.08, 0.14), (0.16, 0.18, 0.28)),
    'wallpaper_grey': ((0.28, 0.26, 0.23), (0.42, 0.39, 0.33)),
    'wallpaper_gold': ((0.25, 0.18, 0.08), (0.45, 0.35, 0.16)),
}
for i, (nm, (b, p)) in enumerate(PALETTES.items()):
    if want(nm):
        done.append(wallpaper(nm, b, p, 40 + i * 3, stripes=(nm == 'wallpaper_grey')))


# ----------------------------------------------------------------------------- PLASTER (cracked, stained)
if want('plaster'):
    n1 = fbm(S, S, 4, 4, 6, 60)
    fine = fbm(S, S, 256, 256, 2, 61)
    crk = ridged(fbm(S, S, 6, 6, 5, 62), 0.008) * (fbm(S, S, 3, 3, 3, 63) > 0.5)
    col = lerp((0.60, 0.58, 0.52), (0.72, 0.70, 0.64), n1)
    stain = fbm(S, S, 2, 2, 5, 64)
    col = lerp(col, np.array([0.45, 0.38, 0.28]), np.clip((stain - 0.6) * 3, 0, 1) * 0.6)
    col *= (1 - crk * 0.6)[..., None]
    hgt = n1 * 0.3 + fine * 0.3 - crk * 0.6
    done.append(write_set('plaster', col, hgt, 0.85 + fine * 0.1, nstrength=2.5))


# ----------------------------------------------------------------------------- MARBLE + TILES
def marble_field(seed, c0, c1, vein, h=S, w=S):
    t = fbm(h, w, 3, 3, 6, seed)
    turb = fbm(h, w, 6, 6, 5, seed + 1)
    v = ridged(np.sin((t * 4 + turb * 3) * math.pi) * 0.5 + 0.5, 0.05)
    v2 = ridged(fbm(h, w, 5, 5, 6, seed + 2), 0.01)
    base = lerp(c0, c1, turb)
    col = lerp(base, vein, np.clip(v * 0.7 + v2 * 0.6, 0, 1))
    return col, v


if want('marble'):
    col, v = marble_field(70, (0.82, 0.81, 0.78), (0.92, 0.91, 0.88), (0.35, 0.34, 0.33))
    done.append(write_set('marble', col, v * 0.05, 0.15 + v * 0.1, nstrength=1))

if want('tile_checker'):
    n = 8; cell = S // n
    cx = (XX // cell).astype(int); cy = (YY // cell).astype(int)
    lx = (XX % cell) / cell; ly = (YY % cell) / cell
    white, v = marble_field(80, (0.72, 0.7, 0.66), (0.82, 0.8, 0.76), (0.4, 0.38, 0.36))
    black, v2 = marble_field(81, (0.03, 0.03, 0.035), (0.08, 0.08, 0.085), (0.25, 0.25, 0.26))
    chk = ((cx + cy) % 2 == 0)
    col = np.where(chk[..., None], white, black)
    edge = np.minimum(np.minimum(lx, 1 - lx), np.minimum(ly, 1 - ly)) * cell
    grout = np.clip(edge / 2.0, 0, 1)
    dirt = fbm(S, S, 8, 8, 4, 82)
    col = lerp(np.array([0.16, 0.14, 0.11]) * (0.6 + dirt[..., None] * 0.6), col, grout)
    col *= (0.8 + 0.3 * dirt)[..., None]
    hgt = grout * 0.6
    rough = np.where(grout > 0.5, 0.18 + dirt * 0.25, 0.9)
    done.append(write_set('tile_checker', col, hgt, rough, nstrength=3))

if want('tile_wall'):
    rows, cols_ = 16, 8
    ch, cw = S / rows, S / cols_
    ry = (YY // ch).astype(int)
    lxx = ((XX + (ry % 2) * cw / 2) % cw) / cw
    lyy = (YY % ch) / ch
    edge = np.minimum(np.minimum(lxx, 1 - lxx) * cw, np.minimum(lyy, 1 - lyy) * ch)
    grout = np.clip(edge / 2.0, 0, 1)
    bevel = np.clip(edge / 6.0, 0, 1)
    tone = fbm(S, S, 16, 8, 3, 90)
    col = lerp((0.62, 0.64, 0.6), (0.78, 0.79, 0.75), tone)
    grime = fbm(S, S, 4, 4, 6, 91)
    col = lerp(col, np.array([0.35, 0.33, 0.25]), np.clip((grime - 0.5) * 2, 0, 1) * 0.6)
    crk = ridged(fbm(S, S, 5, 5, 5, 92), 0.006) * (grime > 0.55)
    col *= (1 - crk * 0.5)[..., None]
    col = lerp(np.array([0.22, 0.2, 0.16]), col, grout)
    hgt = bevel * 0.8 - crk * 0.3
    done.append(write_set('tile_wall', col, hgt, np.where(grout > 0.5, 0.12 + grime * 0.3, 0.9), nstrength=4))


# ----------------------------------------------------------------------------- STONE, BRICK, CONCRETE
if want('stone_floor'):
    n = 4; cell = S / n
    g = np.random.default_rng(100)
    cy = (YY // cell).astype(int)
    shift = g.uniform(0, 1, n)[cy] * cell
    lx = ((XX + shift) % cell) / cell; ly = (YY % cell) / cell
    cx = ((XX + shift) // cell).astype(int) % n
    tone = g.uniform(0.0, 1.0, (n, n))[cy, cx]
    n1 = fbm(S, S, 8, 8, 6, 101); pits = (fbm(S, S, 128, 128, 2, 102) > 0.7).astype(np.float32)
    col = lerp((0.30, 0.28, 0.25), (0.46, 0.43, 0.38), np.clip(tone * 0.5 + n1 * 0.6, 0, 1))
    edge = np.minimum(np.minimum(lx, 1 - lx), np.minimum(ly, 1 - ly)) * cell
    joint = np.clip(edge / 4, 0, 1)
    col = lerp(np.array([0.1, 0.09, 0.08]), col, joint)
    col *= (1 - pits * 0.3)[..., None]
    hgt = joint * 0.7 + n1 * 0.2 - pits * 0.2
    done.append(write_set('stone_floor', col, hgt, 0.7 + n1 * 0.2, nstrength=3))

if want('brick'):
    rows, cols_ = 16, 4
    bh, bw = S / rows, S / cols_
    ry = (YY // bh).astype(int)
    lxx = ((XX + (ry % 2) * bw / 2) % bw) / bw
    lyy = (YY % bh) / bh
    bx = ((XX + (ry % 2) * bw / 2) // bw).astype(int) % cols_
    g = np.random.default_rng(110)
    tone = g.uniform(0, 1, (rows, cols_))[ry % rows, bx]
    n1 = fbm(S, S, 32, 32, 4, 111)
    col = lerp((0.28, 0.11, 0.07), (0.45, 0.2, 0.12), np.clip(tone * 0.6 + n1 * 0.5, 0, 1))
    edge = np.minimum(np.minimum(lxx, 1 - lxx) * bw, np.minimum(lyy, 1 - lyy) * bh)
    mort = np.clip((edge - 2) / 3, 0, 1)
    soot = fbm(S, S, 3, 3, 5, 112)
    col = lerp(np.array([0.33, 0.31, 0.27]) * (0.7 + n1[..., None] * 0.5), col, mort)
    col *= (0.7 + 0.4 * soot)[..., None]
    hgt = mort * 0.8 + n1 * 0.15
    done.append(write_set('brick', col, hgt, 0.85, nstrength=4))

if want('concrete'):
    n1 = fbm(S, S, 6, 6, 7, 120); fine = fbm(S, S, 200, 200, 2, 121)
    crk = ridged(fbm(S, S, 4, 4, 6, 122), 0.006) * (n1 > 0.45)
    stain = fbm(S, S, 2, 2, 5, 123)
    col = lerp((0.26, 0.26, 0.25), (0.42, 0.41, 0.39), n1)
    col = lerp(col, np.array([0.14, 0.12, 0.1]), np.clip((stain - 0.55) * 3, 0, 1) * 0.7)
    col *= (1 - crk * 0.6)[..., None]
    done.append(write_set('concrete', col, n1 * 0.3 + fine * 0.3 - crk * 0.5, 0.8 + fine * 0.15, nstrength=2.5))


# ----------------------------------------------------------------------------- METALS
if want('metal_rust'):
    n1 = fbm(S, S, 5, 5, 7, 130); fine = fbm(S, S, 256, 256, 2, 131)
    rust = np.clip((fbm(S, S, 4, 4, 6, 132) - 0.45) * 3, 0, 1)
    scratch = ridged(fbm(S, S, 1, 60, 3, 133), 0.008)
    col = lerp((0.30, 0.31, 0.32), (0.45, 0.46, 0.47), n1)
    rc = lerp((0.22, 0.08, 0.03), (0.42, 0.18, 0.06), fine)
    col = lerp(col, rc, rust)
    col = lerp(col, np.array([0.6, 0.6, 0.62]), scratch * (1 - rust) * 0.6)
    metal = np.clip(1 - rust * 1.2, 0, 1)
    done.append(write_set('metal_rust', col, rust * 0.5 + fine * 0.2, 0.35 + rust * 0.55 - scratch * 0.1, metal, 2.5))

if want('brass'):
    n1 = fbm(S, S, 6, 6, 6, 140)
    tarn = np.clip((fbm(S, S, 4, 4, 6, 141) - 0.5) * 3, 0, 1)
    col = lerp((0.55, 0.40, 0.16), (0.75, 0.58, 0.28), n1)
    col = lerp(col, np.array([0.18, 0.16, 0.09]), tarn * 0.7)
    done.append(write_set('brass', col, n1 * 0.1, 0.25 + tarn * 0.45, np.clip(1 - tarn * 0.5, 0, 1), 1))

if want('iron'):
    n1 = fbm(S, S, 8, 8, 6, 145); fine = fbm(S, S, 256, 256, 2, 146)
    col = lerp((0.05, 0.05, 0.055), (0.12, 0.12, 0.125), n1)
    rust = np.clip((fbm(S, S, 5, 5, 6, 147) - 0.6) * 3, 0, 1)
    col = lerp(col, np.array([0.25, 0.1, 0.04]), rust)
    done.append(write_set('iron', col, n1 * 0.3 + fine * 0.2 + rust * 0.3, 0.5 + rust * 0.4, 0.8 - rust * 0.6, 2))


# ----------------------------------------------------------------------------- FABRICS
def fabric(name, c0, c1, seed, crush=True, weave=260):
    n1 = fbm(S, S, 6, 6, 6, seed)
    crushed = fbm(S, S, 12, 40, 5, seed + 1) if crush else n1
    w = (np.sin(XX / S * weave * math.pi * 2) * np.sin(YY / S * weave * math.pi * 2)) * 0.5 + 0.5
    col = lerp(c0, c1, np.clip(crushed * 0.8 + n1 * 0.3, 0, 1))
    dust = fbm(S, S, 3, 3, 5, seed + 2)
    col = lerp(col, np.array([0.3, 0.28, 0.25]), np.clip((dust - 0.6) * 2, 0, 1) * 0.35)
    return write_set(name, col, w * 0.2 + crushed * 0.3, 0.75 + w * 0.15, nstrength=1.5)


if want('velvet_red'):
    done.append(fabric('velvet_red', (0.12, 0.012, 0.018), (0.32, 0.04, 0.05), 150))
if want('velvet_green'):
    done.append(fabric('velvet_green', (0.02, 0.07, 0.04), (0.07, 0.18, 0.1), 151))
if want('fabric_linen'):
    done.append(fabric('fabric_linen', (0.55, 0.52, 0.46), (0.7, 0.67, 0.6), 152, crush=False, weave=400))
if want('leather'):
    n1 = fbm(S, S, 6, 6, 6, 160)
    cell = ridged(fbm(S, S, 90, 90, 2, 161), 0.08)
    wear = np.clip((fbm(S, S, 4, 4, 6, 162) - 0.55) * 3, 0, 1)
    col = lerp((0.12, 0.05, 0.025), (0.26, 0.12, 0.06), n1)
    col = lerp(col, np.array([0.38, 0.24, 0.14]), wear * 0.6)
    col *= (1 - cell * 0.15)[..., None]
    done.append(write_set('leather', col, n1 * 0.2 - cell * 0.3, 0.45 + wear * 0.3 + cell * 0.1, nstrength=2.5))


# ----------------------------------------------------------------------------- PERSIAN RUG (single image)
if want('rug_persian'):
    H, W_ = S * 3 // 2, S
    yy, xx = np.mgrid[0:H, 0:W_].astype(np.float32)
    u = xx / W_; v = yy / H
    border = np.minimum(np.minimum(u, 1 - u) * W_, np.minimum(v, 1 - v) * H) / W_
    red = np.array([0.36, 0.05, 0.04]); navy = np.array([0.04, 0.06, 0.14]); gold = np.array([0.55, 0.40, 0.18])
    ivory = np.array([0.62, 0.55, 0.42])
    col = np.zeros((H, W_, 3), np.float32) + red
    cu, cv = (u - 0.5) * 2, (v - 0.5) * 2 * (H / W_)
    rr = np.sqrt(cu ** 2 + (cv * 0.8) ** 2)
    ang = np.arctan2(cv, cu)
    med = rr < (0.42 + 0.08 * np.cos(ang * 8))
    col = np.where(med[..., None], navy, col)
    med2 = rr < (0.24 + 0.05 * np.cos(ang * 12))
    col = np.where(med2[..., None], gold * 0.8, col)
    med3 = rr < 0.1
    col = np.where(med3[..., None], red * 0.8, col)
    fieldpat = (np.sin(u * 60) * np.sin(v * 90) > 0.6) & ~med
    col = np.where(fieldpat[..., None], ivory * 0.7, col)
    petals = (np.abs(np.sin(ang * 8)) > 0.9) & (rr > 0.12) & (rr < 0.4)
    col = np.where(petals[..., None], ivory * 0.8, col)
    b1 = (border < 0.1) & (border > 0.02)
    col = np.where(b1[..., None], navy, col)
    motif = b1 & (np.sin((u + v) * 80) * np.sin((u - v) * 80) > 0.3)
    col = np.where(motif[..., None], gold, col)
    b0 = border < 0.02
    col = np.where(b0[..., None], ivory * 0.6, col)
    b2 = (border > 0.1) & (border < 0.115)
    col = np.where(b2[..., None], gold * 0.9, col)
    # pile, wear, dirt
    pile = np.random.default_rng(170).random((H, W_)).astype(np.float32)
    pile = blur(pile, 1)
    wear = fbm(H, W_, 3, 2, 5, 171)
    col = lerp(col, col * 0.55 + np.array([0.12, 0.1, 0.07]), np.clip((wear - 0.55) * 2.5, 0, 1))
    col *= (0.8 + 0.35 * pile)[..., None]
    done.append(write_set('rug_persian', col, pile * 0.5 + (border < 0.02) * 0.3, 0.95, nstrength=1.2))


# ----------------------------------------------------------------------------- EXTERIOR
if want('ground_mud'):
    n1 = fbm(S, S, 6, 6, 7, 180); fine = fbm(S, S, 128, 128, 3, 181)
    grass = np.clip((fbm(S, S, 5, 5, 6, 182) - 0.45) * 3, 0, 1)
    blades = ridged(fbm(S, S, 200, 40, 2, 183), 0.1) * grass
    puddle = np.clip((fbm(S, S, 3, 3, 5, 184) - 0.62) * 6, 0, 1)
    col = lerp((0.09, 0.07, 0.05), (0.18, 0.14, 0.1), n1)
    col = lerp(col, lerp((0.08, 0.1, 0.04), (0.18, 0.2, 0.08), fine), grass * 0.8)
    col *= (1 - puddle * 0.5)[..., None]
    rough = np.clip(0.9 - puddle * 0.85 - blades * 0.1, 0.03, 1)
    done.append(write_set('ground_mud', col, n1 * 0.4 + fine * 0.3 + blades * 0.3 - puddle * 0.5, rough, nstrength=3))

if want('gravel'):
    g = np.random.default_rng(190)
    hgt = np.zeros((S, S), np.float32); col = np.zeros((S, S, 3), np.float32) + 0.12
    for i in range(2600):
        cx_, cy_ = g.uniform(0, S), g.uniform(0, S)
        r = g.uniform(4, 11) * S / 1024
        tone = g.uniform(0.25, 0.55)
        x0, x1 = int(cx_ - r - 1), int(cx_ + r + 2); y0, y1 = int(cy_ - r - 1), int(cy_ + r + 2)
        ys_ = np.arange(y0, y1) % S; xs_ = np.arange(x0, x1) % S
        dy = (np.arange(y0, y1)[:, None] - cy_) / r; dx = (np.arange(x0, x1)[None, :] - cx_) / (r * g.uniform(0.7, 1.3))
        d = 1 - (dx * dx + dy * dy)
        h = np.sqrt(np.clip(d, 0, 1))
        sub = hgt[np.ix_(ys_, xs_)]
        upd = h > sub
        hgt[np.ix_(ys_, xs_)] = np.where(upd, h, sub)
        cc = col[np.ix_(ys_, xs_)]
        col[np.ix_(ys_, xs_)] = np.where(upd[..., None], np.array([tone, tone * 0.95, tone * 0.88]) * (0.7 + 0.3 * h[..., None]), cc)
    done.append(write_set('gravel', col, hgt, 0.4 + (1 - hgt) * 0.5, nstrength=5))

if want('asphalt'):
    n1 = fbm(S, S, 8, 8, 6, 200); agg = (np.random.default_rng(201).random((S, S)) > 0.93).astype(np.float32)
    wet = np.clip((fbm(S, S, 3, 3, 5, 202) - 0.4) * 3, 0, 1)
    col = lerp((0.05, 0.05, 0.055), (0.12, 0.12, 0.12), n1) + agg[..., None] * 0.08
    col *= (1 - wet * 0.35)[..., None]
    done.append(write_set('asphalt', col, n1 * 0.3 + agg * 0.3, np.clip(0.75 - wet * 0.65, 0.05, 1), nstrength=2))

if want('roof_slate'):
    rows, cols_ = 12, 8
    ch, cw = S / rows, S / cols_
    ry = (YY // ch).astype(int)
    lxx = ((XX + (ry % 2) * cw / 2) % cw) / cw
    lyy = (YY % ch) / ch
    g = np.random.default_rng(210)
    bx = ((XX + (ry % 2) * cw / 2) // cw).astype(int) % cols_
    tone = g.uniform(0, 1, (rows, cols_))[ry % rows, bx]
    n1 = fbm(S, S, 16, 16, 5, 211)
    col = lerp((0.06, 0.065, 0.075), (0.16, 0.17, 0.19), np.clip(tone * 0.6 + n1 * 0.4, 0, 1))
    moss = np.clip((fbm(S, S, 4, 4, 6, 212) - 0.6) * 3, 0, 1)
    col = lerp(col, np.array([0.1, 0.14, 0.06]), moss * 0.6)
    edge = np.minimum(np.minimum(lxx, 1 - lxx) * cw, (1 - lyy) * ch)
    shadow = np.clip(edge / 3, 0, 1)
    col *= (0.4 + 0.6 * shadow)[..., None]
    hgt = lyy * 0.6 + shadow * 0.3 + n1 * 0.1
    done.append(write_set('roof_slate', col, hgt, 0.55 + n1 * 0.3, nstrength=4))

if want('bark'):
    n1 = fbm(S, S, 64, 4, 6, 220)
    ridges = ridged(n1, 0.2)
    fine = fbm(S, S, 256, 32, 3, 221)
    col = lerp((0.05, 0.04, 0.035), (0.2, 0.17, 0.14), np.clip(ridges * 0.7 + fine * 0.4, 0, 1))
    done.append(write_set('bark', col, ridges * 0.8 + fine * 0.2, 0.9, nstrength=6))

if want('paper'):
    n1 = fbm(S, S, 4, 4, 6, 230); fine = fbm(S, S, 256, 256, 2, 231)
    col = lerp((0.62, 0.55, 0.40), (0.78, 0.72, 0.56), n1)
    stain = fbm(S, S, 2, 2, 5, 232)
    tide = ridged(stain, 0.01) * (stain > 0.45)
    col = lerp(col, np.array([0.45, 0.35, 0.2]), np.clip((stain - 0.6) * 3, 0, 1) * 0.5)
    col *= (1 - tide * 0.3)[..., None]
    fold = (np.abs(U - 0.5) < 0.002) | (np.abs(Vv - 0.33) < 0.002) | (np.abs(Vv - 0.66) < 0.002)
    col *= np.where(fold, 0.8, 1.0)[..., None]
    done.append(write_set('paper', col, fine * 0.3 - fold * 0.2, 0.9, nstrength=1.5))

result = {"done": done}
