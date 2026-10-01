# Strand hair from a hairstyle envelope (any MakeHuman card/shell hair):
#   * roots: area-sampled on the scalp skin under the envelope (above the hairline)
#   * each strand is traced downward and projected into the envelope at its own depth (0 = outer surface,
#     1 = against the skull) so the strands reproduce the hairstyle, kept >= 3 mm off the skin; tracing stops
#     where the envelope ends (stall) with a ragged per-strand length
#   * clumping (k-means clumps, tip-weighted pull to the clump centre), low-frequency waviness, flyaways
#   * output: ribbon mesh (width across the hair surface), UV u = atlas column, v = root(0)->tip(1),
#     per-vertex attributes hair_t, hair_sid (strand id), colour variation; plus strands as numpy for rigging
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector as V
from mathutils.bvhtree import BVHTree


def bvh_of(obj, deps=None):
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.transform(obj.matrix_world)
    bm.normal_update()
    t = BVHTree.FromBMesh(bm); bm.free(); return t


def sample_scalp(body, shell_bvh, n, rng, hair_top_gap=0.03, min_z=None, face_y=None):
    """area-weighted random points on body faces that sit under the hair envelope"""
    me = body.data; mw = body.matrix_world
    tris = []
    me.calc_loop_triangles()
    P = np.array([mw @ v.co for v in me.vertices])
    for lt in me.loop_triangles:
        a, b, c = (P[i] for i in lt.vertices)
        cen = (a + b + c) / 3
        if min_z is not None and cen[2] < min_z:
            continue
        if face_y is not None and cen[1] < face_y and cen[2] < min_z + 0.11:
            continue                                          # no roots on the forehead / face
        loc, nrm, idx, dist = shell_bvh.find_nearest(V(cen))
        if loc is None or dist > hair_top_gap:
            continue
        # the envelope must sit over the skin along its normal (not merely nearby, like the hairline edge
        # seen from the forehead)
        fn = np.cross(b - a, c - a); fn /= np.linalg.norm(fn) + 1e-12
        if np.dot(np.array(loc) - cen, fn) < 0.6 * dist:
            continue
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a))
        tris.append((a, b, c, area))
    if not tris:
        raise RuntimeError('no scalp triangles found under the hair envelope')
    areas = np.array([t[3] for t in tris]); cdf = np.cumsum(areas) / areas.sum()
    roots = []
    for _ in range(n):
        k = int(np.searchsorted(cdf, rng.random()))
        a, b, c, _a = tris[k]
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1: r1, r2 = 1 - r1, 1 - r2
        roots.append(a + (b - a) * r1 + (c - a) * r2)
    return np.array(roots), len(tris)


def trace(root, shell, body, rng, step=0.01, max_len=0.9, depth=0.5, clear=0.003, part_x=0.0, head_c=(0, 0, 1.6)):
    p = V(root)
    bl, bn, _, _ = body.find_nearest(p)
    n0 = (p - bl).normalized() if (p - bl).length > 1e-6 else (bn or V((0, 0, 1)))
    # initial combing: away from the part line, then down
    side = 1.0 if p.x >= part_x else -1.0
    # start along the envelope's downhill direction (combs away from the part over the skull)
    sl, sn, _, _ = shell.find_nearest(p)
    if sn is not None:
        if sn.dot(p - V(head_c)) < 0: sn = -sn
        down = V((0, 0, -1)); tang = down - sn * down.dot(sn)
        if tang.length < 0.2:                                   # crown: comb away from the part + back
            tang = V((side * 0.7, 0.6, -0.2)) - sn * V((side * 0.7, 0.6, -0.2)).dot(sn)
        d = (tang.normalized() + V((side * 0.15, 0, 0))).normalized()
    else:
        d = (n0 * 0.6 + V((side * 0.35, 0.15, -0.6))).normalized()
    pts = [V(p)]
    p = p + n0 * 0.002
    L = 0.0; stall = 0
    while L < max_len:
        q = p + d * step
        loc, nrm, idx, dist = shell.find_nearest(q)
        if loc is not None:
            bl, bn, _, _ = body.find_nearest(loc)
            inward = bl - loc; gap = inward.length
            tgt = loc + (inward.normalized() * min(depth * gap, max(gap - clear, 0.0)) if gap > 1e-6 else V((0, 0, 0))) if depth >= 0 else loc - inward.normalized() * (-depth) * 0.02
            a = min(1.0, 0.35 + L / 0.02) * 0.9                # envelope engages almost immediately
            q = q.lerp(tgt, a)
        # keep off the skin
        bl, bn, _, _ = body.find_nearest(q)
        off = q - bl
        if bn is not None and off.dot(bn) < clear:
            q = bl + bn * clear
        mv = q - p; ml = mv.length
        if ml < step * 0.3:
            stall += 1
            if stall > 2: break
        else:
            stall = 0
        if ml > 1e-6:
            d = (d * 0.45 + mv.normalized() * 0.55).normalized()
            d = (d + V((0, 0, -0.08))).normalized()             # slight gravity bias
        pts.append(V(q)); p = q; L += ml
    return pts


def resample(pts, n):
    P = np.array([tuple(p) for p in pts])
    if len(P) < 2:
        P = np.vstack([P, P + [0, 0, -0.01]])
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1); s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] < 1e-6:
        return np.repeat(P[:1], n, 0), 0.0
    t = np.linspace(0, s[-1], n)
    out = np.stack([np.interp(t, s, P[:, k]) for k in range(3)], 1)
    return out, s[-1]


def smooth(S, it=2, k=0.35):
    S = S.copy()
    for _ in range(it):
        S[:, 1:-1] = S[:, 1:-1] * (1 - k) + (S[:, :-2] + S[:, 2:]) * (k / 2)
    return S


def kmeans(X, k, it=12, seed=0):
    rng = np.random.default_rng(seed)
    C = X[rng.choice(len(X), k, replace=False)]
    for _ in range(it):
        d = ((X[:, None, :] - C[None]) ** 2).sum(-1); lab = d.argmin(1)
        for j in range(k):
            m = lab == j
            if m.any(): C[j] = X[m].mean(0)
    return lab, C


def grow(body_obj, shell_obj, n_strands=4000, segs=20, seed=7, part_x=0.0, min_z=1.5, face_y=-0.06,
         clumps=260, clump_amt=(0.45, 0.8), max_len=0.85, depth_range=(-0.15, 0.85), face_box=None, top_gap=0.05, head_c=(0, 0, 1.6)):
    rng = random.Random(seed); nrng = np.random.default_rng(seed)
    shell = bvh_of(shell_obj); body = bvh_of(body_obj)
    roots, ntris = sample_scalp(body_obj, shell, n_strands, rng, hair_top_gap=top_gap, min_z=min_z, face_y=face_y)
    S, lens = [], []
    for r in roots:
        dep = depth_range[0] + (depth_range[1] - depth_range[0]) * rng.random() ** 0.8
        pts = trace(r, shell, body, rng, depth=dep, part_x=part_x, max_len=max_len, head_c=head_c)
        R, L = resample(pts, segs + 1)
        S.append(R); lens.append(L)
    S = np.array(S); lens = np.array(lens)
    keep = lens > 0.12
    n_short = int((~keep).sum())
    if face_box is not None:
        (x0, x1), (y0, y1), (z0, z1) = face_box
        inside = ((S[..., 0] > x0) & (S[..., 0] < x1) & (S[..., 1] > y0) & (S[..., 1] < y1) & (S[..., 2] > z0) & (S[..., 2] < z1)).any(1)
        keep &= ~inside
    n_face = int(inside.sum())
    S, lens, roots = S[keep], lens[keep], roots[keep]
    S = smooth(S, 3)
    # ragged ends: trim 0-12 % of each strand
    for i in range(len(S)):
        f = 1 - 0.12 * rng.random() ** 1.5
        R, L = resample(S[i][:max(2, int(round((segs + 1) * f)))], segs + 1)
        S[i] = R; lens[i] = L
    # clumps: cluster on root + mid + tip so clumps follow the flow
    X = np.concatenate([S[:, 0], S[:, segs // 2] * 0.7, S[:, -1] * 0.5], 1)
    lab, _ = kmeans(X, min(clumps, len(S)), seed=seed)
    t = np.linspace(0, 1, segs + 1)[None, :, None]
    C = np.zeros_like(S)
    for j in range(lab.max() + 1):
        m = lab == j
        if m.any(): C[m] = S[m].mean(0)
    amt = nrng.uniform(*clump_amt, size=(len(S), 1, 1))
    S = S + (C - S) * amt * t ** 1.3
    # waviness (low frequency, grows to the tip) + flyaways
    ph = nrng.uniform(0, 2 * np.pi, (len(S), 3)); fr = nrng.uniform(1.0, 2.2, (len(S), 1))
    for k in range(3):
        S[:, :, k] += 0.004 * np.sin(fr * t[..., 0] * 2 * np.pi * 2 + ph[:, k:k + 1]) * t[..., 0] ** 1.2
    fly = nrng.random(len(S)) < 0.03
    S[fly] += nrng.normal(0, 0.005, (fly.sum(), 1, 3)) * t ** 1.5
    S[:, 0] = roots                                   # roots stay planted
    return S, lens, lab, dict(roots=len(roots), scalp_tris=ntris, short=n_short, face=locals().get('n_face', 0))


def ribbon_mesh(name, S, head_center, width=(0.0042, 0.0022), cols=8, seed=3):
    """ribbons lying in the hair surface; returns object with UV + attributes"""
    nrng = np.random.default_rng(seed)
    ns, nv = S.shape[:2]
    verts = np.zeros((ns, nv, 2, 3))
    T = np.gradient(S, axis=1); T /= np.linalg.norm(T, axis=2, keepdims=True) + 1e-9
    out = S - np.array(head_center)[None, None]; out[..., 2] *= 0.35
    out /= np.linalg.norm(out, axis=2, keepdims=True) + 1e-9
    W = np.cross(T, out); W /= np.linalg.norm(W, axis=2, keepdims=True) + 1e-9
    t = np.linspace(0, 1, nv)
    wscale = nrng.uniform(0.75, 1.3, ns)
    w = (width[0] + (width[1] - width[0]) * t)[None, :] * wscale[:, None]
    w[:, 0] *= 0.6
    verts[:, :, 0] = S - W * (w[..., None] / 2)
    verts[:, :, 1] = S + W * (w[..., None] / 2)
    V_ = verts.reshape(-1, 3)
    faces = []
    for s in range(ns):
        b = s * nv * 2
        for i in range(nv - 1):
            a0, a1 = b + i * 2, b + i * 2 + 1
            c0, c1 = b + (i + 1) * 2, b + (i + 1) * 2 + 1
            faces.append((a0, c0, c1, a1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(V_.tolist(), [], faces)
    me.update()
    # UV: u = column of the strand atlas, v = root->tip
    col = nrng.integers(0, cols, ns)
    uv = me.uv_layers.new(name='UVMap')
    loops_uv = np.zeros((len(me.loops), 2))
    vi = np.zeros(len(me.loops), int); me.loops.foreach_get('vertex_index', vi)
    sid = vi // (nv * 2); row = (vi % (nv * 2)) // 2; side = vi % 2
    loops_uv[:, 0] = (col[sid] + 0.04 + 0.92 * side) / cols
    loops_uv[:, 1] = 1 - row / (nv - 1)
    uv.data.foreach_set('uv', loops_uv.ravel())
    # attributes
    ht = me.attributes.new('hair_t', 'FLOAT', 'POINT')
    ht.data.foreach_set('value', np.tile(np.repeat(t, 2), ns).astype(np.float32))
    hs = me.attributes.new('hair_sid', 'INT', 'POINT')
    hs.data.foreach_set('value', np.repeat(np.arange(ns), nv * 2).astype(np.int32))
    # colour: per-strand melanin variation, roots a little darker, a few lighter strands
    tone = nrng.normal(1.0, 0.12, ns); tone[nrng.random(ns) < 0.06] *= 1.45
    c = np.zeros((ns, nv * 2, 4), np.float32)
    shade = (0.82 + 0.3 * np.repeat(t, 2) ** 1.5)[None, :] * tone[:, None]
    c[..., 0] = shade; c[..., 1] = shade * 0.97; c[..., 2] = shade * 0.94; c[..., 3] = 1
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.clip(c, 0, 4).ravel())
    me.color_attributes.active_color = ca
    for p in me.polygons: p.use_smooth = True
    # shading normals point away from the head (like a hair volume), not along the flat ribbon
    nrm = np.repeat(out, 2, axis=1).reshape(-1, 3)
    me.normals_split_custom_set_from_vertices([tuple(n) for n in nrm])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def strand_atlas(size=2048, cols=8, seed=11, base=(0.050, 0.034, 0.024)):
    """RGBA atlas: `cols` columns of fibre bundles; alpha tapers at ragged tips, fibres vary in tone + width"""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 4), np.float32)
    cw = size // cols
    v = np.linspace(1, 0, size)[:, None]              # image rows top=v1 ... use v = 1 - row/size (root at v=1)
    x = np.arange(cw)[None, :]
    for c in range(cols):
        acc_a = np.zeros((size, cw)); acc_c = np.zeros((size, cw, 3)); acc_w = np.zeros((size, cw))
        nf = rng.integers(9, 15)
        for f in range(nf):
            x0 = rng.uniform(0.08, 0.92) * cw
            wav = rng.uniform(0.5, 2.5) * np.sin(v * rng.uniform(4, 10) + rng.uniform(0, 6))
            sig = rng.uniform(0.9, 2.2) * cw / 64
            prof = np.exp(-((x - x0 - wav) ** 2) / (2 * sig ** 2))
            tip = rng.uniform(0.0, 0.18)                  # fibre ends somewhere in the last 18 %
            fade = np.clip((v - tip) / 0.06, 0, 1)        # v=0 is the tip (image bottom)
            a = prof * fade * rng.uniform(0.75, 1.0)
            tone = rng.normal(1.0, 0.18) * np.array(base)
            acc_c += a[..., None] * tone; acc_w += a
            acc_a = 1 - (1 - acc_a) * (1 - a)
        col = np.where(acc_w[..., None] > 1e-4, acc_c / np.maximum(acc_w[..., None], 1e-4), np.array(base))
        col = np.clip(col, 0, 1)
        img[:, c * cw:(c + 1) * cw, :3] = col
        img[:, c * cw:(c + 1) * cw, 3] = np.clip(acc_a * 1.15, 0, 1)
    return img[::-1]                                   # Blender pixel rows go bottom -> top
