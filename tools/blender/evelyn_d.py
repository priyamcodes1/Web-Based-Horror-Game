# EVELYN HART - stage D: mission outfit.
# Garments start as offsets of her body surface (exact fit, glued weights later), then:
#   * inflate(): outward-only relaxation -> fabric bridges hollows (cleavage, small of back, toes) like real cloth
#   * clean hems/cuffs/openings (boundary snapping), lofted collars & ribbed cuffs measured from the body
#   * surface-conforming details (pockets, flaps, epaulettes, belt, strap, zips, laces) projected onto the cloth
import bpy
bpy.ops.wm.open_mainfile(filepath=r"D:\Web Based - Horror Game\tools\blender\evelyn_stageC.blend")
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/props_lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/char.py").read())
import numpy as np

CFG = globals().get('CFG', {})
STAGE_D = r"D:\Web Based - Horror Game\tools\blender\evelyn_stageD.blend"
BAKE = CFG.get('bake', False)
TEXR = CFG.get('tex', 2048)
body = bpy.data.objects['Evelyn_Body']
for o in [o for o in bpy.data.objects if o.name.startswith('EvCloth_')]:
    bpy.data.objects.remove(o, do_unlink=True)

# measured joints (character left = +X, front = -Y)
J = dict(shoulder=V((0.175, 0.01, 1.37)), elbow=V((0.248, 0.027, 1.08)), wrist=V((0.35, -0.022, 0.895)),
         hip=V((0.088, 0.0, 0.87)), knee=V((0.11, 0.0, 0.47)), ankle=V((0.122, 0.035, 0.085)),
         toe=V((0.146, -0.15, 0.015)))
def side(p, s):
    return V((p.x * s, p.y, p.z))

def _proj(c, a, b):
    ab = b - a
    t = (c - a).dot(ab) / ab.length_squared
    return t, (c - (a + ab * max(0, min(1, t)))).length

def arm_t(c):
    """0..0.5 upper arm, 0.5..1 forearm (unclamped past the wrist), + distance to the bone line."""
    s = 1 if c.x >= 0 else -1
    sh, el, wr = side(J['shoulder'], s), side(J['elbow'], s), side(J['wrist'], s)
    t1, d1 = _proj(c, sh, el); t2, d2 = _proj(c, el, wr)
    return (0.5 * max(0, t1), d1) if (d1 < d2 and t1 < 1) else (0.5 + 0.5 * t2, d2)

def is_arm(c, upto):
    if abs(c.x) < 0.16 or c.z < 0.75:
        return False
    t, d = arm_t(c)
    return d < 0.08 and t < upto

def leg_t(c):
    s = 1 if c.x >= 0 else -1
    h, k, a = side(J['hip'], s), side(J['knee'], s), side(J['ankle'], s)
    t1, d1 = _proj(c, h, k); t2, d2 = _proj(c, k, a)
    return (0.5 * max(0, min(1, t1)), d1) if d1 < d2 else (0.5 + 0.5 * max(0, min(1, t2)), d2)

# --------------------------------------------------------------------------- mesh helpers (numpy)
def mesh_np(obj):
    me = obj.data
    P = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', P)
    E = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get('vertices', E)
    return P.reshape(-1, 3), E.reshape(-1, 2)

def set_co(obj, P):
    obj.data.vertices.foreach_set('co', P.astype(np.float32).ravel()); obj.data.update()

def vnormals(obj):
    me = obj.data
    N = np.empty(len(me.vertices) * 3, np.float32); me.vertex_normals.foreach_get('vector', N)
    return N.reshape(-1, 3)

def boundary_mask(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    m = np.array([v.is_boundary for v in bm.verts]); bm.free()
    return m

def inflate(obj, iters=40, k=0.6, relax=0.3, w=None):
    """Outward-only Laplacian: concave regions rise until the fabric spans them; convex parts stay put."""
    P, E = mesh_np(obj); n = len(P)
    deg = np.bincount(E.ravel(), minlength=n).astype(np.float32); deg[deg == 0] = 1
    B = boundary_mask(obj)
    W = np.ones(n, np.float32) if w is None else np.array([w(V(p)) for p in P], np.float32)
    N = None
    for it in range(iters):
        if it % 4 == 0:
            set_co(obj, P); N = vnormals(obj)
        S = np.zeros_like(P)
        np.add.at(S, E[:, 0], P[E[:, 1]]); np.add.at(S, E[:, 1], P[E[:, 0]])
        d = S / deg[:, None] - P
        dn = (d * N).sum(1)
        tang = d - N * dn[:, None]
        mv = N * (np.maximum(dn, 0) * k)[:, None] + tang * relax * (~B)[:, None]
        P = P + mv * W[:, None]
    set_co(obj, P)

def fold_disp(obj, amp_fn):
    me = obj.data; me.update()
    for v in me.vertices:
        v.co += v.normal * amp_fn(v.co.copy())
    me.update()

def boundary_edit(obj, sel, fn):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    hits = [v for v in bm.verts if v.is_boundary and sel(v.co)]
    fn(hits)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    return len(hits)

def snap_plane(obj, sel, normal, extreme=True):
    """Flatten a ragged open edge onto a plane (its outermost extent along `normal`)."""
    n = V(normal).normalized()
    def f(vs):
        if not vs:
            return
        tgt = max(v.co.dot(n) for v in vs) if extreme else sum(v.co.dot(n) for v in vs) / len(vs)
        for v in vs:
            v.co += n * (tgt - v.co.dot(n))
    return boundary_edit(obj, sel, f)

def loft(name, rings, closed=True):
    """Quad surface through rings of equal point count."""
    m = len(rings[0]); verts, faces = [], []
    for r in rings:
        verts += [V(p) for p in r]
    span = m if closed else m - 1
    for i in range(len(rings) - 1):
        for k in range(span):
            k2 = (k + 1) % m
            faces.append((i * m + k, i * m + k2, (i + 1) * m + k2, (i + 1) * m + k))
    return mesh_obj(name, verts, faces)

def frame(axis):
    axis = V(axis).normalized()
    a0 = V((1, 0, 0)) if abs(axis.x) < 0.9 else V((0, 1, 0))
    e1 = (a0 - axis * a0.dot(axis)).normalized()
    return axis, e1, axis.cross(e1)

def ring_pts(tree, center, axis, off, seg=48, reach=0.35):
    """Points on the outermost surface around an axis (rays fired inward), pushed out radially by `off`."""
    axis, e1, e2 = frame(axis)
    pts = []
    for k in range(seg):
        a = math.tau * k / seg
        r = e1 * math.cos(a) + e2 * math.sin(a)
        hit = tree.ray_cast(V(center) + r * reach, -r, reach)
        p = hit[0] if hit[0] is not None else V(center) + r * 0.05
        o = off(a) if callable(off) else off
        pts.append(p + r * o)
    return pts

def ring_band(name, tree, center, axis, width, off, seg=48, ribs=0, rib_amp=0.0, rows=4, thick=0.003, reach=0.35):
    axis_n = V(axis).normalized()
    rings = []
    for j in range(rows + 1):
        c = V(center) + axis_n * (width * (j / rows - 0.5))
        bulge = math.sin(math.pi * j / rows)
        def o(a, bulge=bulge):
            base = off(a) if callable(off) else off
            return base + 0.0015 * bulge + (rib_amp * (0.5 + 0.5 * math.cos(a * ribs)) if ribs else 0)
        rings.append(ring_pts(tree, c, axis_n, o, seg=seg, reach=reach))
    ob = loft(name, rings)
    add_solidify(ob, thick, offset=-1.0)
    return ob

def surf_at(tree, p, toward):
    """Outermost surface hit when looking from p toward `toward`."""
    d = (V(toward) - V(p))
    hit = tree.ray_cast(V(p), d.normalized(), d.length + 0.3)
    return (hit[0], hit[1]) if hit[0] is not None else (None, None)

def conform_patch(name, tree, center, u_dir, w, h, depth=0.003, puff=0.0, n=(10, 10), thick=0.0025, look=None):
    """A panel (pocket, flap, epaulette) whose every vertex is projected onto the cloth below."""
    if look is not None:
        loc, nr = surf_at(tree, center, look)
    else:
        loc, nr, _, _ = tree.find_nearest(V(center))
    if loc is None:
        return None
    u = (V(u_dir) - nr * V(u_dir).dot(nr)).normalized(); v = nr.cross(u)
    verts, faces = [], []
    for j in range(n[1] + 1):
        for i in range(n[0] + 1):
            x, y = (i / n[0] - 0.5) * w, (j / n[1] - 0.5) * h
            p0 = loc + u * x + v * y + nr * 0.03
            hit = tree.ray_cast(p0, -nr, 0.08)
            q = hit[0] if hit[0] is not None else tree.find_nearest(p0)[0]
            pf = (1 - abs(2 * x / w) ** 4) * (1 - abs(2 * y / h) ** 4)
            verts.append(q + nr * (depth + puff * pf))
    for j in range(n[1]):
        for i in range(n[0]):
            a = j * (n[0] + 1) + i
            faces.append((a, a + 1, a + n[0] + 2, a + n[0] + 1))
    ob = mesh_obj(name, verts, faces)
    add_solidify(ob, thick, offset=-1.0)
    return ob, loc, nr, u, v

def oriented(ob, loc, nrm):
    q = V(nrm).to_track_quat('Z', 'Y')
    ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = q; ob.location = loc
    apply_transform(ob)
    return ob

def conform_strip(name, tree, guide, width, off, toward_fn, n_per=6, thick=0.003, free_tail=0):
    """Strap/band laid along a guide polyline, each sample dropped onto the outermost surface."""
    pts = []
    for i in range(len(guide) - 1):
        for k in range(n_per):
            pts.append(V(guide[i]).lerp(V(guide[i + 1]), k / n_per))
    pts.append(V(guide[-1]))
    out, nrms = [], []
    for i, p in enumerate(pts):
        if i >= len(pts) - free_tail:
            out.append(p); nrms.append(nrms[-1] if nrms else V((0, -1, 0))); continue
        loc, nr = surf_at(tree, p, toward_fn(p))
        if loc is None:
            out.append(p); nrms.append(V((0, -1, 0))); continue
        out.append(loc + nr * off); nrms.append(nr)
    for _ in range(3):   # straps are taut
        out = [out[0]] + [(out[i - 1] + out[i] * 2 + out[i + 1]) / 4 for i in range(1, len(out) - 1)] + [out[-1]]
    verts = []
    for i, p in enumerate(out):
        t = (out[min(i + 1, len(out) - 1)] - out[max(i - 1, 0)]).normalized()
        sd = t.cross(nrms[i]).normalized()
        verts += [p - sd * width / 2, p + sd * width / 2]
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(out) - 1)]
    ob = mesh_obj(name, verts, faces)
    add_solidify(ob, thick, offset=-1.0)
    return ob, out, nrms

def snap_button(name, loc, nrm, r=0.0055, h=0.003):
    b = prim('cylinder', name, seg=14, r=r, r2=r * 0.85, h=h)
    return oriented(b, loc + nrm * h * 0.5, nrm)

def sleeve_end_info(obj, s, tmin):
    """Centroid, mean radius and axis of a sleeve's open end (for cuffs)."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    pts = [v.co.copy() for v in bm.verts if v.is_boundary and (v.co.x * s) > 0.2 and arm_t(v.co)[0] > tmin]
    bm.free()
    el, wr = side(J['elbow'], s), side(J['wrist'], s)
    d = (wr - el).normalized()
    c = sum(pts, V((0, 0, 0))) / max(1, len(pts))
    r = sum(((p - c) - d * (p - c).dot(d)).length for p in pts) / max(1, len(pts))
    return c, r, d

# --------------------------------------------------------------------------- fold fields
def sleeve_folds(c, scale=1.0):
    if abs(c.x) < 0.17:
        return 0.0
    t, d = arm_t(c)
    ex = math.exp(-((t - 0.5) / 0.07) ** 2)
    wx = max(0.0, min(1.0, (t - 0.8) / 0.18))
    n = noise.noise(c * 55.0)
    a = 0.0035 * ex * (0.5 + 0.5 * math.sin(t * 140 + n * 3))
    a += 0.003 * wx * (0.5 + 0.5 * math.sin(t * 170 + n * 4))
    a += 0.0012 * noise.noise(c * 22.0)
    return a * scale

def torso_folds(c, scale=1.0):
    a = 0.0012 * noise.noise(c * 18.0) + 0.0007 * noise.noise(c * 45.0)
    a += 0.0016 * math.exp(-((c.z - 1.0) / 0.05) ** 2) * (0.5 + 0.5 * math.sin(c.z * 300 + noise.noise(c * 12) * 4))
    if abs(c.x) > 0.12 and 1.2 < c.z < 1.36:
        a += 0.0014 * (0.5 + 0.5 * math.sin(math.atan2(c.y, c.x) * 30 + c.z * 40))
    return a * scale

def leg_folds(c, scale=1.0):
    t, d = leg_t(c)
    kx = math.exp(-((t - 0.5) / 0.06) ** 2)
    ax = max(0.0, (t - 0.82) / 0.18)
    n = noise.noise(c * 40.0)
    a = 0.003 * kx * (0.5 + 0.5 * math.sin(t * 120 + n * 3))
    a += 0.004 * ax * (0.5 + 0.5 * math.sin(t * 150 + n * 5))
    a += 0.0015 * noise.noise(c * 16.0)
    if c.z > 0.72 and abs(c.x) < 0.12:
        a += 0.0012 * (0.5 + 0.5 * math.sin(math.atan2(c.y, c.x) * 18 + c.z * 60))
    return a * scale

body_tree, _ = bvh_from([body])
metal_bits = []

# =========================================================================== SWEATER (cable-knit turtleneck)
def sweater_region(c):
    torso = abs(c.x) <= 0.19 and 1.0 < c.z < 1.425 and not (c.z > 1.395 and abs(c.x) < 0.085)
    return torso or is_arm(c, 0.985)
sweater = shell(body, 'EvCloth_Sweater', sweater_region, offset=0.005, thick=0.0, wrinkle=0.0)
inflate(sweater, iters=24, k=0.45, relax=0.25)
fold_disp(sweater, lambda c: torso_folds(c, 0.7) + sleeve_folds(c, 0.8))
for s in (1, -1):
    el, wr = side(J['elbow'], s), side(J['wrist'], s)
    snap_plane(sweater, lambda c, s=s: c.x * s > 0.2 and arm_t(c)[0] > 0.85, (wr - el))
snap_plane(sweater, lambda c: c.z < 1.04, (0, 0, -1))
sw_ends = {s: sleeve_end_info(sweater, s, 0.85) for s in (1, -1)}
add_solidify(sweater, 0.003, offset=-1.0)
sw_parts = [sweater]
# turtleneck: lofted from rings measured around her neck, front top lower (clears the jaw), folded roll
neck_c = [p.co for p in body.data.vertices if abs(p.co.z - 1.43) < 0.004 and abs(p.co.x) < 0.08 and -0.09 < p.co.y < 0.1]
NC = sum(neck_c, V((0, 0, 0))) / len(neck_c) if neck_c else V((0.0, 0.012, 1.43))
SEG = 64
rad = []
for k in range(SEG):
    a = k / SEG * math.tau
    r = V((math.cos(a), math.sin(a), 0))
    hit = body_tree.ray_cast(V((NC.x, NC.y, 1.43)) + r * 0.25, -r, 0.25)
    rad.append((hit[0] - V((NC.x, NC.y, 1.43))).length if hit[0] is not None else 0.055)
rings = []
H = 18
for j in range(H + 1):
    t = j / H
    ring = []
    for k in range(SEG):
        a = k / SEG * math.tau
        front = max(0.0, -math.sin(a))                     # 1 at the front (-Y)
        ztop = 1.492 - 0.03 * front ** 1.5
        z = 1.375 + (ztop - 1.375) * t
        flare = 0.03 * (1 - t) ** 3                        # widens into the shoulders
        roll = 0.009 * math.exp(-((t - 0.72) / 0.16) ** 2)  # folded-over roll
        knit = 0.0016 * (0.5 + 0.5 * math.cos(a * 34)) + 0.001 * math.sin(t * 40 + a * 3)
        rr = rad[k] + 0.009 + flare + roll + knit
        ring.append(V((NC.x + math.cos(a) * rr, NC.y + math.sin(a) * rr, z)))
    rings.append(ring)
tneck = loft('EvCloth_Turtleneck', rings)
add_solidify(tneck, 0.005, offset=-1.0)
sw_parts.append(tneck)
sw_tree, _ = bvh_from([sweater])
for s in (1, -1):
    c, r, d = sw_ends[s]
    sw_parts.append(ring_band('scuff', sw_tree, c - d * 0.022, d, 0.045, 0.0025, seg=48, ribs=40, rib_amp=0.0012, rows=6, reach=0.09))
sweater = join(sw_parts, 'EvCloth_Sweater'); shade_smooth(sweater)

# =========================================================================== CARGO TROUSERS
def pants_region(c):
    return 0.13 < c.z < 1.07 and abs(c.x) < 0.24 and not (abs(c.x) > 0.19 and c.z > 0.72)
pants = shell(body, 'EvCloth_Pants', pants_region, offset=0.012, thick=0.0, wrinkle=0.0)
inflate(pants, iters=36, k=0.5, relax=0.3)
P, _E = mesh_np(pants); Nn = vnormals(pants)     # relaxed cargo cut: ease on thighs/calves, not at the waist
ease = np.array([0.0 if p[2] > 0.95 else 0.006 * min(1, (0.95 - p[2]) / 0.1) for p in P], np.float32)
set_co(pants, P + Nn * ease[:, None])
fold_disp(pants, lambda c: leg_folds(c, 1.0))
for v in pants.data.vertices:
    if v.co.z < 0.26:
        s_ = 1 if v.co.x >= 0 else -1
        r = V((v.co.x - J['ankle'].x * s_, v.co.y - 0.02, 0))
        if r.length > 1e-4:
            v.co += r.normalized() * (0.26 - v.co.z) * 0.12
pants.data.update()
snap_plane(pants, lambda c: c.z < 0.16, (0, 0, -1))
snap_plane(pants, lambda c: c.z > 1.0, (0, 0, 1))
add_solidify(pants, 0.003, offset=-1.0)
shade_smooth(pants)
ptree, _ = bvh_from([pants])

# =========================================================================== FIELD JACKET (open front)
def xe(z):  # half-width of the open front
    return 0.042 + (1.40 - z) * 0.055
def jacket_region(c):
    torso = abs(c.x) <= 0.2 and 0.79 < c.z < 1.43 and not (c.z > 1.385 and abs(c.x) < 0.078)
    return torso or is_arm(c, 0.93)
jacket = shell(body, 'EvCloth_Jacket', jacket_region, offset=0.024, thick=0.0, wrinkle=0.0)
inflate(jacket, iters=150, k=0.55, relax=0.3)
fold_disp(jacket, lambda c: torso_folds(c, 1.3) + sleeve_folds(c, 1.3))
bm = bmesh.new(); bm.from_mesh(jacket.data)
kill = [f for f in bm.faces if (lambda m: abs(m.x) < xe(m.z) and m.y < 0.0 and m.z < 1.40)(f.calc_center_median())]
bmesh.ops.delete(bm, geom=kill, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(jacket.data); bm.free()
def straighten(vs):
    for v in vs:
        s = 1 if v.co.x >= 0 else -1
        v.co.x = s * xe(v.co.z)
boundary_edit(jacket, lambda c: c.y < -0.02 and abs(c.x) < 0.14 and c.z < 1.40, straighten)
snap_plane(jacket, lambda c: c.z < 0.84 and abs(c.x) < 0.25, (0, 0, -1))
for s in (1, -1):
    el, wr = side(J['elbow'], s), side(J['wrist'], s)
    snap_plane(jacket, lambda c, s=s: c.x * s > 0.2 and arm_t(c)[0] > 0.8, (wr - el))
for v in jacket.data.vertices:      # stiff waxed canvas: the hem flares a little off the hips
    if v.co.z < 0.97:
        f = (0.97 - v.co.z) / 0.17
        r = V((v.co.x, v.co.y + 0.01, 0))
        if r.length > 1e-4:
            v.co += r.normalized() * 0.014 * f * f
jacket.data.update()
j_ends = {s: sleeve_end_info(jacket, s, 0.8) for s in (1, -1)}
add_solidify(jacket, 0.004, offset=-1.0)
shade_smooth(jacket)
jtree, _ = bvh_from([jacket])

jdet = []
# stand collar, open at the front, rolled slightly outward
crings = []
for j in range(7):
    t = j / 6
    ring = []
    for k in range(49):
        a = math.radians(-60) + math.radians(300) * (k / 48) + math.pi    # starts front-right, wraps the back
        ki = int(((a % math.tau) / math.tau) * SEG) % SEG
        rr = rad[ki] + 0.026 + 0.012 * t * t
        ring.append(V((NC.x + math.cos(a) * rr, NC.y + math.sin(a) * rr, 1.39 + 0.055 * t)))
    crings.append(ring)
collar = loft('jcollar', crings, closed=False)
add_solidify(collar, 0.004, offset=-1.0)
jdet.append(collar)
for s in (1, -1):
    # chest pockets above the bust line, hip bellows pockets
    for (px, pz, w, h) in ((0.095, 1.29, 0.085, 0.10), (0.125, 0.90, 0.13, 0.15)):
        r = conform_patch('pocket', jtree, V((px * s, -0.35, pz)), (1, 0, 0), w, h, depth=0.002, puff=0.006,
                          look=V((px * s * 0.6, 0.0, pz)))
        if not r:
            continue
        pk, loc, nr, u, v = r
        jdet.append(pk)
        fl = conform_patch('flap', jtree, loc + v * h * 0.36 + nr * 0.2, (1, 0, 0), w + 0.01, h * 0.32, depth=0.009,
                           puff=0.002, look=loc + v * h * 0.36)
        if fl:
            jdet.append(fl[0])
            metal_bits.append(snap_button('snap', fl[1] - fl[4] * h * 0.08 + fl[2] * 0.011, fl[2]))
for s in (1, -1):   # epaulettes along the shoulder seam
    sh = side(J['shoulder'], s)
    r = conform_patch('epaulette', jtree, V((sh.x * 0.78, 0.005, sh.z + 0.25)), (s, 0, 0), 0.10, 0.035, depth=0.003,
                      puff=0.002, look=V((sh.x * 0.78, 0.005, sh.z - 0.1)))
    if r:
        jdet.append(r[0])
        metal_bits.append(snap_button('epsnap', r[1] - r[3] * s * 0.035 + r[2] * 0.007, r[2], r=0.0045))
for s in (1, -1):   # sleeve cuff bands
    c, r, d = j_ends[s]
    jdet.append(ring_band('jcuff', jtree, c - d * 0.028, d, 0.05, 0.003, seg=48, rows=4, reach=0.1))
zips, tapes = [], []
for s in (1, -1):   # zip tape + teeth down both open edges
    zs = np.linspace(0.81, 1.385, 12)
    toward = lambda p: V((p.x * 0.7, 0.05, p.z))
    tape, pts, nrms = conform_strip('ztape', jtree, [V((s * (xe(z) + 0.004), -0.4, z)) for z in zs], 0.014, 0.0015, toward, n_per=5, thick=0.002)
    teeth, _, _ = conform_strip('zteeth', jtree, [V((s * (xe(z) + 0.0005), -0.4, z)) for z in zs], 0.005, 0.0035, toward, n_per=5, thick=0.003)
    tapes.append(tape); zips.append(teeth)
    if s == 1:
        tab = rbox('zpull', (0.009, 0.003, 0.026), (0, 0, 0), bevel=0.0015)
        tab.location = pts[6] + nrms[6] * 0.006 - V((0, 0, 0.012)); apply_transform(tab)
        zips.append(tab)
jacket_details = join(jdet + tapes, 'EvCloth_JacketDetail')

# =========================================================================== BELT + CARGO POCKETS + THIGH HOLSTER
pdet = []
belt = ring_band('EvCloth_Belt', ptree, V((0, 0.0, 1.03)), (0, 0, 1), 0.034, 0.004, seg=72, rows=3)
btree, _ = bvh_from([belt, pants])
bloc, bn = surf_at(btree, V((0, -0.4, 1.03)), V((0, 0, 1.03)))
buck = []
for (sx, sz, ox, oz) in ((0.05, 0.006, 0, 0.0215), (0.05, 0.006, 0, -0.0215), (0.006, 0.049, 0.022, 0), (0.006, 0.049, -0.022, 0)):
    buck.append(rbox('bk', (sx, 0.005, sz), (ox, bloc.y - 0.006, 1.03 + oz), bevel=0.0015))
buck.append(rbox('prong', (0.003, 0.004, 0.02), (0.0, bloc.y - 0.008, 1.03), bevel=0.001))
buckle_o = join(buck, 'EvCloth_Buckle')
for a in (-150, -112, -68, -30, 30, 68, 112, 150, 210, 270, 330):
    ar = math.radians(a - 90)
    r = conform_patch('bloop', btree, V((math.cos(ar) * 0.4, math.sin(ar) * 0.4, 1.03)), (0, 0, 1), 0.05, 0.012,
                      depth=0.002, n=(4, 2), look=V((0, 0, 1.03)))
    if r:
        pdet.append(r[0])
for s in (1, -1):
    hp, kn = side(J['hip'], s), side(J['knee'], s)
    mid = hp.lerp(kn, 0.48)
    r = conform_patch('cargo', ptree, mid + V((0.3 * s, -0.01, 0)), (0, 0, 1), 0.17, 0.14, depth=0.002, puff=0.012,
                      n=(12, 12), look=mid + V((0, -0.01, 0)))
    if r:
        pk, loc, nr, u, v = r
        pdet.append(pk)
        fl = conform_patch('cflap', ptree, loc + u * 0.06 + nr * 0.2, (0, 0, 1), 0.05, 0.15, depth=0.016, puff=0.002,
                           n=(6, 10), look=loc + u * 0.06)
        if fl:
            pdet.append(fl[0])
            metal_bits.append(snap_button('csnap', fl[1] + fl[2] * 0.0025 - u * 0.012, fl[2]))
pants_details = join(pdet, 'EvCloth_PantsDetail')
# flashlight in a thigh holster on her right leg (her lifeline in the dark)
hp, kn = side(J['hip'], -1), side(J['knee'], -1)
hc = hp.lerp(kn, 0.3)
hloc, hn = surf_at(ptree, hc + V((-0.3, 0.01, 0)), hc + V((0, 0.01, 0)))
holster_o = flashlight = None
if hloc is not None:
    ax = (kn - hp).normalized()
    hcen = hloc + hn * 0.026
    hold = [tube_along('holster', [hcen + ax * 0.07, hcen - ax * 0.09], [(0.024, 0.022), (0.021, 0.019)], seg=20, cap=True)]
    for zt in (0.25, 0.42):
        hold.append(ring_band('legstrap', ptree, hp.lerp(kn, zt), ax, 0.022, 0.003, seg=48, rows=2, reach=0.11))
    holster_o = join(hold, 'EvCloth_Holster')
    fl_parts = [tube_along('fbody', [hcen + ax * 0.03, hcen - ax * 0.11], 0.0145, seg=20)]
    fl_parts.append(tube_along('fhead', [hcen - ax * 0.11, hcen - ax * 0.14, hcen - ax * 0.16], [0.0175, 0.022, 0.022], seg=24))
    fl_parts.append(tube_along('flens', [hcen - ax * 0.16, hcen - ax * 0.1615], 0.019, seg=24))
    flashlight = join(fl_parts, 'EvCloth_Flashlight')

# =========================================================================== HIKING BOOTS
# ---- built boot: a last lofted from measured foot slices + an ankle shaft (clean leather, no toes)
SOLE_Z = 0.028
FP = np.array([tuple(v.co) for v in body.data.vertices if v.co.z < 0.22], np.float32)
def superellipse_section(cx, a, b, n_top=18, n_bot=5, e=2.6):
    pts = []
    for i in range(n_top + 1):                       # right -> over the top -> left
        th = math.pi * i / n_top
        c_, s_ = math.cos(th), math.sin(th)
        rr = (abs(c_) ** e + abs(s_) ** e) ** (-1 / e)
        pts.append((cx + a * rr * c_, SOLE_Z + b * rr * s_))
    for i in range(1, n_bot):                         # flat underside back to the right
        pts.append((cx - a + 2 * a * i / n_bot, SOLE_Z))
    return pts
boot_parts = []
for s in (1, -1):
    heel, tip = V((0.122 * s, 0.098, 0)), V((0.146 * s, -0.152, 0))
    f = (tip - heel); L = f.length; f.normalize()
    lat = f.cross(V((0, 0, 1))).normalized() * (1 if s > 0 else -1)   # points to her outside
    rel = FP[(FP[:, 0] * s) > 0.04] - np.array(heel)
    u = rel @ np.array(f); w = rel @ np.array(lat); z = rel[:, 2] + 0.0
    NS = 34
    us = np.linspace(-0.004, L + 0.004, NS)
    prof = []
    for uu in us:
        m = (np.abs(u - uu) < 0.008) & (z < 0.12)
        mw = m & (z < 0.065)                      # width from the foot only (ankle bones excluded)
        if mw.sum() < 3:
            prof.append(None); continue
        prof.append((w[mw].min(), w[mw].max(), min(z[m].max(), 0.105)))
    ok = [i for i, p in enumerate(prof) if p is not None]
    arr = np.array([prof[i] for i in ok])
    wmin = np.interp(range(NS), ok, arr[:, 0]); wmax = np.interp(range(NS), ok, arr[:, 1]); ztop = np.interp(range(NS), ok, arr[:, 2])
    def env(a, fn, r=3):
        out = np.array([fn(a[max(0, i - r):i + r + 1]) for i in range(NS)])
        return np.convolve(np.pad(out, 3, mode='edge'), np.ones(7) / 7, mode='valid')
    wmin, wmax, ztop = env(wmin, np.min), env(wmax, np.max), env(ztop, np.max)
    rings = []
    for i, uu in enumerate(us):
        a = (wmax[i] - wmin[i]) / 2 + 0.007
        cw = (wmax[i] + wmin[i]) / 2
        b = max(0.03, ztop[i] - SOLE_Z + 0.009)
        rings.append([(uu, cw, a, b)])
    # rounded toe cap and heel counter: shrink sections past the ends on a quarter circle
    sec = []
    for k in range(5, 0, -1):
        q = k / 5; ss = math.sqrt(max(0.0, 1 - q * q)); uu, cw, a, b = rings[0][0]
        sec.append((uu - 0.022 * q, cw, max(0.004, a * (0.35 + 0.65 * ss)), max(0.006, b * (0.75 + 0.25 * ss))))
    sec += [r[0] for r in rings]
    for k in range(1, 7):
        q = k / 6; ss = math.sqrt(max(0.0, 1 - q * q)); uu, cw, a, b = rings[-1][0]
        sec.append((uu + 0.03 * q, cw, max(0.004, a * (0.25 + 0.75 * ss)), max(0.006, b * (0.35 + 0.65 * ss))))
    loops = []
    for (uu, cw, a, b) in sec:
        loop = []
        for (ww, zz) in superellipse_section(cw, a, b):
            loop.append(heel + f * uu + lat * ww + V((0, 0, zz - SOLE_Z + SOLE_Z)))
        loops.append(loop)
    last = loft('bootlast', loops)
    bm = bmesh.new(); bm.from_mesh(last.data)
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bmesh.ops.triangulate(bm, faces=[fc for fc in bm.faces if len(fc.verts) > 4])
    bm.to_mesh(last.data); bm.free()
    add_subsurf(last, 1)
    boot_parts.append(last)
    # ankle shaft: measured leg slices around the ankle, + margin, flares a little at the collar
    ac = V((0.122 * s, 0.03, 0))
    srings = []
    for zz in np.linspace(0.088, 0.205, 9):
        m = (np.abs(FP[:, 2] - zz) < 0.01) & (np.hypot(FP[:, 0] - ac.x, FP[:, 1] - ac.y) < 0.075)
        pts = FP[m]
        cxy = pts[:, :2].mean(0) if len(pts) else np.array((ac.x, ac.y))
        ring = []
        for k in range(32):
            th = math.tau * k / 32
            dvec = np.array((math.cos(th), math.sin(th)))
            proj = ((pts[:, :2] - cxy) @ dvec) if len(pts) else np.array([0.04])
            rr = float(proj.max()) + 0.011 + 0.004 * max(0, (zz - 0.17) / 0.035)
            ring.append(V((cxy[0] + dvec[0] * rr, cxy[1] + dvec[1] * rr, zz)))
        srings.append(ring)
    shaft = loft('bootshaft', srings)
    add_solidify(shaft, 0.004, offset=-1.0)
    boot_parts.append(shaft)
boots = join(boot_parts, 'EvCloth_Boots')
# flex creases across the vamp + scuffed leather
fold_disp(boots, lambda c: 0.0008 * noise.noise(c * 60) + (0.0012 * max(0, math.sin((c.y + 0.07) * 260)) if -0.1 < c.y < -0.04 and c.z > 0.05 else 0.0))
shade_smooth(boots)
btree2, _ = bvh_from([boots])

def hull2d(pts):
    pts = sorted(set(pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

bdet, soles = [], []
for s in (1, -1):
    foot = [(round(v.co.x, 4), round(v.co.y, 4)) for v in boots.data.vertices if v.co.z < 0.045 and v.co.x * s > 0]
    hull = hull2d(foot)
    cen = V((sum(p[0] for p in hull) / len(hull), sum(p[1] for p in hull) / len(hull), 0))
    ring = [V((p[0], p[1], 0)) + (V((p[0], p[1], 0)) - cen).normalized() * 0.005 for p in hull]   # welt
    rings = [[cen + (p - cen) * (1 + sh / max(0.01, (p - cen).length)) + V((0, 0, z)) for p in ring]
             for (z, sh) in ((0.0, -0.003), (0.004, 0.0), (0.024, 0.0), (0.031, -0.001))]
    sole = loft('sole', rings)
    bm = bmesh.new(); bm.from_mesh(sole.data)
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bm.to_mesh(sole.data); bm.free()
    soles.append(sole)
    # laces: eyelet rows either side of the tongue, criss-crossed laces, a bow at the top
    top, low = V((0.125 * s, -0.045, 0.15)), V((0.136 * s, -0.1, 0.062))
    fwd = (low - top).normalized(); sideways = fwd.cross(V((0, 0, 1))).normalized()
    rows = []
    for i in range(6):
        m = top.lerp(low, i / 5)
        pair = []
        for k in (-1, 1):
            p = m + sideways * 0.017 * k * (1 - 0.25 * i / 6)
            loc, nr = surf_at(btree2, p + V((0, -0.12, 0.08)), p)
            if loc is None:
                continue
            pair.append((loc, nr))
            et = prim('torus', 'eyelet', R=0.0042, r=0.0011, u=12, v=6)
            metal_bits.append(oriented(et, loc + nr * 0.0012, nr))
        rows.append(pair)
    for i in range(len(rows) - 1):
        if len(rows[i]) == 2 and len(rows[i + 1]) == 2:
            for k in (0, 1):
                a, na = rows[i][k]; b, nb = rows[i + 1][1 - k]
                mid = (a + b) / 2 + (na + nb).normalized() * 0.004
                bdet.append(tube_along('lace', [a + na * 0.002, mid, b + nb * 0.002], 0.0015, seg=6))
    if len(rows[0]) == 2:
        (a, na), (b, nb) = rows[0]
        c = (a + b) / 2 + na * 0.006
        for k in (-1, 1):
            bdet.append(tube_along('bow', [c, c + sideways * 0.016 * k + V((0, 0, 0.008)), c + sideways * 0.022 * k - V((0, 0.004, 0.004)), c], 0.0016, seg=6))
            bdet.append(tube_along('tail', [c, c + sideways * 0.008 * k - V((0, 0.006, 0.035)), c + sideways * 0.012 * k - V((0, 0.004, 0.06))], 0.0014, seg=6))
boot_details = join(bdet, 'EvCloth_BootDetail')
soles_o = join(soles, 'EvCloth_Soles')

# =========================================================================== SATCHEL + CROSSBODY STRAP + WATCH
tor_tree, _ = bvh_from([jacket, sweater])
bl, bnrm = surf_at(jtree, V((0.30, -0.36, 0.87)), V((0.0, 0.0, 0.87)))
bn_h = V((bnrm.x, bnrm.y, 0)).normalized(); up = V((0, 0, 1)); bu = up.cross(bn_h).normalized()
BM = Matrix((bu, -bn_h, up)).transposed().to_4x4()      # local -Y faces away from her hip
bcen = bl + bn_h * 0.036
bag = rbox('bag', (0.25, 0.06, 0.19), (0, 0, 0), bevel=0.022, segs=4)
bflap = rbox('bflap', (0.255, 0.068, 0.13), (0, -0.004, 0.045), bevel=0.016, segs=4)
for v in bflap.data.vertices:          # flap drapes over the outer face
    if v.co.y < -0.02:
        v.co.z -= 0.012 * (-0.02 - v.co.y) / 0.02
bags = [bag, bflap]
for k in (-1, 1):
    bags.append(rbox('bstrap', (0.018, 0.004, 0.075), (k * 0.065, -0.041, 0.01), bevel=0.0012))
    bb = rbox('bbuckle', (0.022, 0.003, 0.016), (k * 0.065, -0.044, 0.02), bevel=0.001)
    bb.matrix_world = Matrix.Translation(bcen) @ BM; apply_transform(bb); metal_bits.append(bb)
for o in bags:
    o.matrix_world = Matrix.Translation(bcen) @ BM; apply_transform(o)
satchel = join(bags, 'EvCloth_Satchel')
displace_noise(satchel, 0.0012, 0.05)
bag_top = bcen + up * 0.1 + bu * 0.1
guide = [V((-0.15, 0.30, 1.32)), V((-0.135, 0.12, 1.43)), V((-0.10, -0.25, 1.36)), V((-0.02, -0.3, 1.22)),
         V((0.08, -0.3, 1.08)), V((0.15, -0.3, 1.0)), bag_top - bn_h * 0.2 + up * 0.02, bag_top]
def strap_target(p):
    if p.y > 0.05:
        return V((p.x * 0.4, 0.0, p.z - 0.15))         # over the shoulder: fire downward/forward
    return V((p.x * 0.4, 0.02, p.z - 0.02))
strap, spts, _ = conform_strip('EvCloth_Strap', tor_tree, guide, 0.032, 0.004, strap_target, n_per=7, thick=0.003, free_tail=1)
wr, el = side(J['wrist'], 1), side(J['elbow'], 1)
d = (wr - el).normalized()
w_c = wr - d * 0.005
wband = ring_band('wband', body_tree, w_c, d, 0.018, 0.0035, seg=40, rows=2, reach=0.07)
wloc, wn = surf_at(body_tree, w_c + V((0.0, -0.1, 0.05)), w_c)
parts = [wband]
if wloc is not None:
    parts.append(oriented(prim('cylinder', 'wcase', seg=28, r=0.017, r2=0.016, h=0.008), wloc + wn * 0.007, wn))
    parts.append(oriented(prim('cylinder', 'wglass', seg=28, r=0.0145, h=0.0015), wloc + wn * 0.0115, wn))
watch = join(parts, 'EvCloth_Watch')

# =========================================================================== tuck the skin away under clothing
def covered(c):
    if c.z > 1.40:
        return False
    if abs(c.x) < 0.2 and c.z > 0.12:
        return True
    return is_arm(c, 0.97) or c.z < 0.2
for v in body.data.vertices:
    if covered(v.co):
        v.co -= v.normal * 0.004
body.data.update()

# =========================================================================== materials
def fabric(name, c1, c2, weave=600, rough=0.85, knit=False, cable=False, wax=False, dirt=0.35, twill=False, sheen=0.0):
    m, nt = new_mat(name, rough=rough)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    tone = nt.noise(co, scale=7, detail=6)
    c = nt.ramp(tone.outputs['Fac'], [(0.3, (*c1, 1)), (0.7, (*c2, 1))]).outputs['Color']
    grime = nt.noise(co, scale=4, detail=8, distortion=0.5)
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    low = nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', sep.outputs['Z'], 0.6), clamp=True)
    c = nt.mix(c, (0.075, 0.062, 0.05, 1), nt.math('MULTIPLY', nt.math('ADD', nt.math('MULTIPLY', grime.outputs['Fac'], dirt), nt.math('MULTIPLY', low, 0.35)), 0.7))
    if knit:
        h = nt.wave(co, scale=weave, distortion=1.2, detail=1, kind='BANDS', direction='Z').outputs['Fac']
        if cable:
            cb = nt.wave(co, scale=45, distortion=7, detail=2, kind='BANDS', direction='X')
            h = nt.math('ADD', nt.math('MULTIPLY', h, 0.45), nt.math('MULTIPLY', cb.outputs['Fac'], 0.9))
    else:
        w1 = nt.wave(co, scale=weave, distortion=0, kind='BANDS', direction='X')
        w2 = nt.wave(co, scale=weave, distortion=0, kind='BANDS', direction='Z')
        h = nt.math('ADD', nt.math('MULTIPLY', w1.outputs['Fac'], 0.3), nt.math('MULTIPLY', w2.outputs['Fac'], 0.3))
        if twill:
            tw = nt.wave(nt.mapping(co, rot=(0, 0.7, 0)), scale=weave * 0.9, distortion=0.2, kind='BANDS', direction='X')
            h = nt.math('ADD', h, nt.math('MULTIPLY', tw.outputs['Fac'], 0.5))
    rough_s = nt.math('ADD', rough, nt.math('MULTIPLY', grime.outputs['Fac'], 0.06))
    if wax:
        wm = nt.math('GREATER_THAN', nt.noise(co, scale=14, detail=8).outputs['Fac'], 0.6)
        c = nt.mix(c, (c1[0] * 1.8, c1[1] * 1.7, c1[2] * 1.4, 1), nt.math('MULTIPLY', wm, 0.45))
        rough_s = nt.math('SUBTRACT', rough_s, nt.math('MULTIPLY', nt.math('SUBTRACT', 1.0, wm), 0.3))
    aof = nt.ramp(nt.ao(distance=0.04).outputs['AO'], [(0.0, (0.15, 0.15, 0.15, 1)), (0.9, (1, 1, 1, 1))])
    c = nt.mix(c, aof.outputs['Color'], 1.0, 'MULTIPLY')
    nt.link(c, b.inputs['Base Color'])
    nt.link(rough_s, b.inputs['Roughness'])
    nt.link(nt.bump(h, 0.35, 0.0015), b.inputs['Normal'])
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
    return m

def leather_m(name, col, rough=0.5, tread=False):
    m, nt = new_mat(name, rough=rough)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    grain = nt.voronoi(co, scale=420)
    tone = nt.noise(co, scale=8, detail=6)
    c = nt.ramp(tone.outputs['Fac'], [(0.3, (col[0] * 0.7, col[1] * 0.7, col[2] * 0.7, 1)), (0.7, (*col, 1))]).outputs['Color']
    wear = nt.noise(co, scale=30, detail=8)
    c = nt.mix(c, (col[0] * 1.35, col[1] * 1.3, col[2] * 1.25, 1), nt.math('MULTIPLY', nt.math('GREATER_THAN', wear.outputs['Fac'], 0.63), 0.55))
    mud = nt.noise(co, scale=6, detail=10, distortion=1.0)
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    lowz = nt.math('LESS_THAN', sep.outputs['Z'], nt.math('ADD', 0.06, nt.math('MULTIPLY', mud.outputs['Fac'], 0.05)))
    c = nt.mix(c, (0.05, 0.042, 0.032, 1), nt.math('MULTIPLY', lowz, 0.35))
    aof = nt.ramp(nt.ao(distance=0.03).outputs['AO'], [(0.0, (0.15, 0.15, 0.15, 1)), (0.9, (1, 1, 1, 1))])
    c = nt.mix(c, aof.outputs['Color'], 1.0, 'MULTIPLY')
    nt.link(c, b.inputs['Base Color'])
    hgt = nt.math('ADD', grain.outputs['Distance'], nt.math('MULTIPLY', wear.outputs['Fac'], 0.3))
    if tread:
        lug = nt.wave(co, scale=90, distortion=0.5, kind='BANDS', direction='Y')
        hgt = nt.math('ADD', hgt, nt.math('MULTIPLY', lug.outputs['Fac'], 2.0))
    nt.link(nt.bump(hgt, 0.8 if tread else 0.35, 0.0015), b.inputs['Normal'])
    return m

metal = bpy.data.materials.get('EvCloth_Metal') or new_mat('EvCloth_Metal', color=(0.42, 0.40, 0.36, 1), rough=0.35, metal=1.0)[0]
sweater_m = fabric('EvCloth_SweaterMat', (0.035, 0.038, 0.045), (0.05, 0.053, 0.062), weave=900, knit=True, cable=True, rough=0.95, dirt=0.15, sheen=0.6)
jacket_m = fabric('EvCloth_JacketMat', (0.055, 0.065, 0.032), (0.085, 0.09, 0.048), weave=750, wax=True, rough=0.72, dirt=0.4)
pants_m = fabric('EvCloth_PantsMat', (0.07, 0.064, 0.05), (0.1, 0.09, 0.07), weave=650, twill=True, rough=0.9, dirt=0.5)
boots_m = leather_m('EvCloth_BootsMat', (0.045, 0.025, 0.013), 0.58)
sole_m = leather_m('EvCloth_SoleMat', (0.03, 0.028, 0.025), 0.85, tread=True)
belt_m = leather_m('EvCloth_BeltMat', (0.07, 0.04, 0.022), 0.5)
bag_m = leather_m('EvCloth_SatchelMat', (0.17, 0.09, 0.045), 0.55)
assign(sweater, sweater_m)
assign(jacket, jacket_m); assign(jacket_details, jacket_m)
assign(pants, pants_m); assign(pants_details, pants_m)
assign(boots, boots_m); assign(boot_details, belt_m); assign(soles_o, sole_m)
assign(belt, belt_m); assign(strap, belt_m); assign(satchel, bag_m)
zip_o = join(zips + metal_bits, 'EvCloth_Metal')
for o in (buckle_o, zip_o, watch):
    assign(o, metal)
if holster_o:
    assign(holster_o, belt_m)
if flashlight:
    assign(flashlight, new_mat('EvCloth_FlashlightMat', color=(0.02, 0.02, 0.022, 1), rough=0.45, metal=0.6)[0])

CLOTHES = [o for o in bpy.data.objects if o.name.startswith('EvCloth_') and o.type == 'MESH']
for o in CLOTHES:
    shade_smooth(o)
    if not o.data.uv_layers:
        smart_uv(o, angle=60, margin=0.004)
if BAKE:
    for o, res in ((sweater, TEXR), (jacket, TEXR), (pants, TEXR), (boots, TEXR // 2), (satchel, TEXR // 2)):
        smart_uv(o, angle=60, margin=0.003)
        bake_maps(o, o.name + 'Tex', size=res, maps=('color', 'rough', 'normal'), samples=12)

result = {o.name: len(o.data.vertices) for o in CLOTHES}
if CFG.get('preview', True):
    L3 = [((1.6, -2.4, 2.4), 300, (1, 0.95, 0.9)), ((-2.2, -1.2, 1.6), 120, (0.7, 0.8, 1.0)), ((0, 2.4, 2.2), 200, (1, 1, 1))]
    result['front'] = preview('ev_outfit_front.png', target=(0, 0, 0.86), cam=(0.9, -3.4, 1.15), lens=40, res=(800, 1100), engine='CYCLES', lights=L3)
    result['back'] = preview('ev_outfit_back.png', target=(0, 0, 0.86), cam=(-1.2, 3.2, 1.25), lens=40, res=(800, 1100), engine='CYCLES', lights=L3)
    result['torso'] = preview('ev_outfit_torso.png', target=(0.05, -0.05, 1.15), cam=(0.6, -1.4, 1.3), lens=45, res=(900, 900), engine='CYCLES', lights=L3)
    result['boots'] = preview('ev_outfit_boots.png', target=(0.0, -0.03, 0.12), cam=(0.5, -0.9, 0.4), lens=45, res=(900, 700), engine='CYCLES', lights=L3)
bpy.ops.wm.save_as_mainfile(filepath=STAGE_D)
result['saved'] = STAGE_D
