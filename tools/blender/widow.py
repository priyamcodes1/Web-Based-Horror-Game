# THE WIDOW - a gaunt, floating bride in a rotted Victorian wedding dress and torn veil.
# Run: node tools/blender-client.cjs tools/blender/widow.py
exec(open(r"D:\Web Based - Horror Game\tools\blender\lib.py").read())
import numpy as np

CFG = globals().get('CFG', {})
BAKE = CFG.get('bake', False)
ANIM = CFG.get('anim', False)
EXPORT = CFG.get('export', False)
TEX = CFG.get('tex', 2048)
rnd = random.Random(7)

reset_scene()

# ============================================================================ BODY (skin modifier)
sk = Skel()
sk.add('hips', (0, 0.0, 1.00), (0.115, 0.085))
sk.add('spine', (0, 0.006, 1.20), (0.095, 0.072), 'hips')
sk.add('chest', (0, 0.0, 1.40), (0.12, 0.082), 'spine')
sk.add('upchest', (0, 0.006, 1.54), (0.125, 0.078), 'chest')
sk.add('neckb', (0, 0.012, 1.645), (0.052, 0.048), 'upchest')
sk.add('neck', (0, 0.014, 1.74), (0.040, 0.038), 'neckb')
sk.add('necktop', (0, 0.010, 1.86), (0.036, 0.036), 'neck')

FING = {}
THUMB = {}
KNUCK = {}
ELBOW = {}
WRIST = {}
HAND_DIR = {}
for s in (1, -1):
    t = 'L' if s > 0 else 'R'
    sk.add('clav' + t, (0.085 * s, 0.014, 1.605), 0.048, 'upchest')
    sk.add('sh' + t, (0.165 * s, 0.016, 1.598), 0.046, 'clav' + t)
    sk.add('arm' + t, (0.262 * s, 0.018, 1.50), 0.036, 'sh' + t)
    sk.add('el' + t, (0.36 * s, 0.02, 1.40), 0.030, 'arm' + t)
    sk.add('fa' + t, (0.455 * s, 0.012, 1.295), 0.027, 'el' + t)
    sk.add('wr' + t, (0.55 * s, 0.0, 1.19), 0.021, 'fa' + t)
    ELBOW[t] = V((0.36 * s, 0.02, 1.40)); WRIST[t] = V((0.55 * s, 0.0, 1.19))
    d = (WRIST[t] - ELBOW[t]).normalized()
    HAND_DIR[t] = d
    n = V((-abs(d.z) * s, 0, -abs(d.x))).normalized()  # palm normal (toward body/down)
    palm = WRIST[t] + d * 0.045
    kn = WRIST[t] + d * 0.088
    sk.add('pm' + t, palm, (0.026, 0.012), 'wr' + t)
    sk.add('kn' + t, kn, (0.03, 0.011), 'pm' + t)
    for fi, (off, L) in enumerate(((-0.024, 0.105), (-0.008, 0.118), (0.008, 0.108), (0.023, 0.088))):
        base = kn + V((0, off, 0)) + d * 0.004
        p1 = base + d * L * 0.45 + n * 0.006
        p2 = p1 + d * L * 0.32 + n * 0.012
        p3 = p2 + d * L * 0.23 + n * 0.014
        FING.setdefault(t, []).append([base, p1, p2, p3])
        sk.chain([f'f{fi}a{t}', f'f{fi}b{t}', f'f{fi}c{t}', f'f{fi}d{t}'], [base, p1, p2, p3],
                 [0.0085, 0.0074, 0.0062, 0.0046], 'kn' + t)
    tb = WRIST[t] + d * 0.03 + V((0, -0.022, 0)) + n * 0.008
    tdir = (d * 0.55 + V((0, -0.75, 0)) + n * 0.35).normalized()
    THUMB[t] = [tb, tb + tdir * 0.038, tb + tdir * 0.068, tb + tdir * 0.092]
    KNUCK[t] = kn
    sk.chain(['t0' + t, 't1' + t, 't2' + t, 't3' + t],
             [tb, tb + tdir * 0.038, tb + tdir * 0.068, tb + tdir * 0.092],
             [0.011, 0.0092, 0.0078, 0.0056], 'pm' + t)

body = sk.build('Widow_Body', subsurf=2, root='hips', branch_smooth=0.15)
# gaunt ribcage/collarbone definition
push(body, (0.06, -0.075, 1.60), 0.02, 0.006, direction=(0, -1, 0))
push(body, (-0.06, -0.075, 1.60), 0.02, 0.006, direction=(0, -1, 0))
push(body, (0, -0.07, 1.55), 0.018, -0.005, direction=(0, -1, 0))
displace_noise(body, strength=0.004, scale=0.03)

# ============================================================================ HEAD (sculpted sphere)
HC = V((0, -0.004, 1.925))
head = prim('uvsphere', 'Widow_Head', u=72, v=48, r=1.0)
AX, AY, AZ = 0.071, 0.095, 0.116


def head_shape(c):
    x, y, z = c.x * AX, c.y * AY, c.z * AZ
    f = max(0.0, -z / AZ)
    x *= 1 - 0.40 * f ** 1.5
    if y < 0:
        y *= 1 - 0.12 * f
    else:
        y *= 1 - 0.50 * f ** 1.15
    if y > 0 and z > -0.02:
        y *= 1.09
    if y < -0.055:
        y = -0.055 + (y + 0.055) * 0.62  # flatter face plane
    # long gaunt chin / jaw line
    if z < -0.06 and y < 0:
        z -= 0.012 * min(1.0, (-z - 0.06) / 0.05)
    return V((x, y, z))


deform(head, head_shape)
head.data.update()


def face_y(x, z, r=0.008):
    ys = [v.co.y for v in head.data.vertices if abs(v.co.x - x) < r and abs(v.co.z - z) < r and v.co.y < 0]
    return min(ys) if ys else -0.08


def feature(x, z, radius, amount, scale=(1, 1, 1), direction=None, dy=0.0):
    push(head, (x, face_y(x, z) + dy, z), radius, amount, scale, direction)


EYE_Z = 0.022
for s in (1, -1):
    feature(0.034 * s, EYE_Z, 0.017, 0.030, (1.35, 1.0, 0.95), (0, 1, 0))       # deep sockets
    feature(0.036 * s, 0.050, 0.014, 0.006, (1.5, 1, 0.7), (0, -1, 0))        # brow ridge
    feature(0.056 * s, -0.004, 0.016, 0.006, (1, 1, 0.8), (s, -0.4, 0))        # cheekbones
    feature(0.050 * s, -0.050, 0.020, -0.013, (1, 1, 1.4), (s, 0, 0))          # hollow cheeks
    feature(0.068 * s, 0.045, 0.02, -0.006, (1, 1, 1), (s, 0, 0))              # sunken temples
    feature(0.011 * s, -0.036, 0.0045, 0.006, (1, 1, 1), (0, 1, 0))            # nostrils
feature(0, 0.022, 0.008, 0.009, (1, 1, 2.2), (0, -1, 0))                        # nose bridge
feature(0, -0.024, 0.011, 0.016, (1.2, 1, 1), (0, -1, 0))                       # nose tip
feature(0, -0.070, 0.012, 0.038, (1.25, 1, 2.4), (0, 1, 0))                     # gaping mouth
feature(0, -0.118, 0.012, 0.006, (1.6, 1, 1), (0, -1, 0))                       # chin
recalc_normals(head)
add_subsurf(head, 1)
displace_noise(head, strength=0.0016, scale=0.012)
head.location = HC
apply_transform(head)
shade_smooth(head)

# Eyes: milky, recessed
eyes = []
for s in (1, -1):
    fy = min(v.co.y for v in head.data.vertices
             if abs(v.co.x - 0.034 * s) < 0.006 and abs(v.co.z - (HC.z + EYE_Z)) < 0.006)
    e = prim('uvsphere', f'Widow_Eye{s}', u=24, v=16, r=0.0118,
             loc=(0.034 * s, fy + 0.0135, HC.z + EYE_Z))
    eyes.append(e)
eye_obj = join(eyes, 'Widow_Eyes')
apply_transform(eye_obj)
shade_smooth(eye_obj)

# Teeth: long, uneven, yellowed (upper follows head, lower follows jaw)
teeth = []
mouth_y = face_y(0, -0.070) + 0.012 - HC.y
for i in range(9):
    x = -0.016 + i * 0.004
    for up in (True, False):
        L = rnd.uniform(0.010, 0.017)
        zt = HC.z - 0.048 if up else HC.z - 0.100
        yb = HC.y + mouth_y + 0.004 * abs(x) / 0.016
        t = prim('cylinder', 'tooth', seg=6, r=0.0021, r2=0.0006, h=L,
                 loc=(x, yb, zt - (L / 2 if up else -L / 2)),
                 rot=(math.pi if up else 0, rnd.uniform(-0.2, 0.2), 0))
        apply_transform(t)
        teeth.append(t)
teeth_obj = join(teeth, 'Widow_Teeth')

# ============================================================================ DRESS
PROFILE = [(1.77, 0.046, 0.044), (1.70, 0.050, 0.048), (1.655, 0.088, 0.066), (1.62, 0.172, 0.097),
           (1.56, 0.176, 0.102), (1.48, 0.156, 0.106), (1.40, 0.136, 0.096), (1.30, 0.113, 0.084),
           (1.22, 0.119, 0.090), (1.12, 0.162, 0.132), (1.00, 0.225, 0.195), (0.80, 0.305, 0.275),
           (0.55, 0.385, 0.355), (0.30, 0.465, 0.435), (0.10, 0.545, 0.505), (0.00, 0.585, 0.550)]


def prof(z):
    for i in range(len(PROFILE) - 1):
        z0, a0, b0 = PROFILE[i]
        z1, a1, b1 = PROFILE[i + 1]
        if z1 <= z <= z0:
            u = (z0 - z) / (z0 - z1)
            u = u * u * (3 - 2 * u) * 0.35 + u * 0.65
            return a0 + (a1 - a0) * u, b0 + (b1 - b0) * u
    return PROFILE[-1][1], PROFILE[-1][2]


NT_ = 160
rows = []
z = 1.77
while z > 0:
    rows.append(z)
    z -= 0.012 if z > 1.1 else (0.022 if z > 0.45 else 0.009)
rows.append(0.0)
verts, faces = [], []
for zi, z in enumerate(rows):
    rx, ry = prof(z)
    below = max(0.0, (1.12 - z) / 1.12)
    for i in range(NT_):
        th = i / NT_ * math.tau
        amp = 0.042 * below ** 1.3
        fold = amp * (0.62 * math.sin(th * 15 + 0.9 * math.sin(th * 4) + z * 1.5)
                      + 0.38 * (noise.noise(V((math.cos(th) * 2.2, math.sin(th) * 2.2, z * 1.6))) ))
        # lighter pleats on bodice
        x = (rx + fold) * math.cos(th)
        y = (ry + fold) * math.sin(th)
        # train at the back
        back = max(0.0, math.sin(th)) ** 2
        tr = back * max(0.0, (0.5 - z) / 0.5) ** 2
        y += tr * 0.38
        zz = max(0.0, z - tr * 0.02)
        verts.append((x, y, zz))
for zi in range(len(rows) - 1):
    for i in range(NT_):
        a = zi * NT_ + i
        b = zi * NT_ + (i + 1) % NT_
        faces.append((a, b, b + NT_, a + NT_))
dress = mesh_obj('Widow_Skirt', verts, faces)

# Tatter the hem and tear holes
bm = bmesh.new(); bm.from_mesh(dress.data)
kill = []
for f in bm.faces:
    c = f.calc_center_median()
    th = math.atan2(c.y, c.x)
    jag = (0.5 + 0.5 * noise.noise(V((math.cos(th) * 3.1, math.sin(th) * 3.1, 0.5)))) ** 2.2 * 0.34 \
        + (0.5 + 0.5 * noise.noise(V((math.cos(th) * 13, math.sin(th) * 13, 2.0)))) * 0.07
    if c.z < jag:
        kill.append(f)
bmesh.ops.delete(bm, geom=kill, context='FACES')
bm.to_mesh(dress.data); bm.free()
recalc_normals(dress)

# Sleeves: long bell sleeves with tattered cuffs
sleeves = []
for s in (1, -1):
    t = 'L' if s > 0 else 'R'
    d = HAND_DIR[t]
    ctrl = [V((0.10 * s, 0.014, 1.625)), V((0.17 * s, 0.016, 1.60)), V((0.262 * s, 0.018, 1.50)),
            V((0.36 * s, 0.02, 1.40)), V((0.455 * s, 0.012, 1.295)), WRIST[t] + d * 0.005,
            WRIST[t] + d * 0.045]
    rad = [0.066, 0.062, 0.052, 0.046, 0.044, 0.050, 0.085]
    pts, rr = [], []
    for i in range(len(ctrl) - 1):
        for k in range(6):
            u = k / 6
            pts.append(ctrl[i].lerp(ctrl[i + 1], u))
            rr.append(rad[i] + (rad[i + 1] - rad[i]) * u)
    pts.append(ctrl[-1]); rr.append(rad[-1])
    sl = tube_along(f'Widow_Sleeve{t}', pts, rr, seg=28, cap=False)
    # wrinkles at elbow + tattered cuff
    for v in sl.data.vertices:
        dd = (v.co - ELBOW[t]).length
        n = noise.noise(v.co * 40.0)
        v.co += V((0, 0, 1)) * (0.004 * n * math.exp(-dd * dd / 0.006))
    bm = bmesh.new(); bm.from_mesh(sl.data)
    kill = [f for f in bm.faces
            if (f.calc_center_median() - WRIST[t]).dot(d) > 0.005 + 0.04 *
            (0.5 + 0.5 * noise.noise(f.calc_center_median() * 60))]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(sl.data); bm.free()
    recalc_normals(sl)
    sleeves.append(sl)

# Sash with a bow at the back
sash = prim('torus', 'Widow_Sash', R=1.0, r=0.1, u=64, v=10)
sash.scale = (0.122, 0.092, 0.11)
sash.location = (0, 0.003, 1.285)
apply_transform(sash)
for s in (1, -1):
    tail = tube_along('sash_tail', [V((0.02 * s, 0.10, 1.28)), V((0.05 * s, 0.13, 1.1)),
                                    V((0.06 * s, 0.17, 0.85)), V((0.075 * s, 0.2, 0.62))],
                      [(0.028, 0.004), (0.03, 0.004), (0.032, 0.004), (0.036, 0.004)], seg=8)
    sleeves.append(tail)

dress = join([dress] + sleeves + [sash], 'Widow_Dress')
add_solidify(dress, 0.005, offset=1.0)
shade_smooth(dress)

# ============================================================================ HAIR (draped cards)
tree, _bm = bvh_from([head, body, dress])
hv = [v.co.copy() for v in head.data.vertices]
hn = [v.normal.copy() for v in head.data.vertices]
roots = []
for co, nrm in zip(hv, hn):
    lz = co.z - HC.z
    ly = co.y - HC.y
    if lz < -0.03:
        continue
    if ly < -0.035 and lz < 0.075:
        continue  # keep the face clear except fringe strands
    roots.append((co, nrm))
rnd.shuffle(roots)
roots = roots[:230]
# a few long wet strands that fall over the face (the rest is parted in the middle)
fringe = [(co, nrm) for co, nrm in zip(hv, hn)
          if (co.z - HC.z) > 0.06 and (co.y - HC.y) < -0.045 and abs(co.x) > 0.012]
rnd.shuffle(fringe)
roots += fringe[:7]

hverts, hfaces, huv = [], [], []
for ci, (co, nrm) in enumerate(roots):
    front = (co.y - HC.y) < -0.045
    L = rnd.uniform(0.40, 0.62) if front else rnd.uniform(0.60, 1.0)
    nseg = 16
    start = co + nrm * 0.003
    # comb: start tangent to the scalp, flowing down and away from the centre part
    down = V((0, 0, -1))
    part = V((math.copysign(1, co.x) if abs(co.x) > 0.004 else rnd.choice((-1, 1)), 0, 0))
    flow = (down + part * 0.6 + (V((0, 0.35, 0)) if not front else V((0, -0.2, 0)))).normalized()
    tang = (flow - nrm * flow.dot(nrm)).normalized()
    init = (tang * 0.92 + nrm * 0.08).normalized()
    pts = drape_path(tree, start, nseg, L / nseg, init_dir=init, clearance=0.004 + rnd.uniform(0, 0.008),
                     stiff=0.72, jitter=0.025, rnd=rnd)
    w0 = rnd.uniform(0.022, 0.04)
    u0 = rnd.uniform(0, 0.6)
    base = len(hverts)
    for i, p in enumerate(pts):
        dirv = (pts[min(i + 1, nseg)] - pts[max(i - 1, 0)]).normalized()
        hit = tree.find_nearest(p, 0.3)
        out = (p - hit[0]).normalized() if hit[0] is not None and (p - hit[0]).length > 1e-5 else nrm
        side = dirv.cross(out).normalized()
        w = w0 * (1 - 0.55 * i / nseg)
        hverts.append(p - side * w / 2)
        hverts.append(p + side * w / 2)
        huv.append((u0, i / nseg)); huv.append((u0 + 0.4, i / nseg))
    for i in range(nseg):
        a = base + i * 2
        hfaces.append((a, a + 1, a + 3, a + 2))
hair = mesh_obj('Widow_Hair', hverts, hfaces)
uvl = hair.data.uv_layers.new(name='UVMap')
for poly in hair.data.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = huv[hair.data.loops[li].vertex_index]
shade_smooth(hair)

# ============================================================================ VEIL (draped tulle)
tree2, _bm2 = bvh_from([head, body, dress, hair])
VT, VR = 84, 40
vverts = []
lengths = []
for i in range(VT):
    th = i / VT * math.tau
    back = (1 + math.sin(th)) / 2
    L = 0.30 + 0.80 * back ** 1.4
    lengths.append(L)
    # fabric gathered at a crown band, then falls over head/hair under gravity
    outward = V((math.cos(th), math.sin(th), 0))
    crown = HC + V((0.010 * math.cos(th), 0.012 * math.sin(th) + 0.012, AZ * 1.02 + 0.014))
    col = drape_path(tree2, crown, VR - 1, L / (VR - 1), init_dir=(outward * 0.9 + V((0, 0, -0.25))),
                     outward=outward * 0.12, clearance=0.009, stiff=0.78)
    # folds (outward only, growing downward)
    for k, p in enumerate(col):
        fr = k / (len(col) - 1)
        p += outward * (0.5 + 0.5 * math.sin(th * 11 + fr * 2)) * 0.02 * max(0.0, fr - 0.25) ** 1.2
    vverts.append(col)
vv, vf, vuv = [], [], []
for i in range(VT):
    for k in range(VR):
        vv.append(vverts[i][k])
        vuv.append((i / VT * 6, k / VR * 4))
for i in range(VT):
    i2 = (i + 1) % VT
    for k in range(VR - 1):
        vf.append((i * VR + k, i2 * VR + k, i2 * VR + k + 1, i * VR + k + 1))
veil = mesh_obj('Widow_Veil', vv, vf)
# tear the veil hem
bm = bmesh.new(); bm.from_mesh(veil.data)
bm.faces.ensure_lookup_table()
kill = []
for f in bm.faces:
    k = (f.verts[0].index % VR) / VR
    c = f.calc_center_median()
    if k > 0.8 and noise.noise(V((c.x * 4, c.y * 4, 0))) > 0.45 - (k - 0.8) * 2:
        kill.append(f)
bmesh.ops.delete(bm, geom=kill, context='FACES')
bm.to_mesh(veil.data); bm.free()
uvl = veil.data.uv_layers.new(name='UVMap')
for poly in veil.data.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = vuv[veil.data.loops[li].vertex_index]
shade_smooth(veil)

# ============================================================================ MATERIALS (procedural)
def skin_material():
    m, nt = new_mat('Widow_SkinProc', rough=0.62)
    b = nt.bsdf()
    co = nt.tex_coord('Object')
    mott = nt.noise(co, scale=18, detail=8, rough=0.6)
    base = nt.ramp(mott.outputs['Fac'], [(0.3, (0.40, 0.42, 0.41, 1)), (0.7, (0.55, 0.555, 0.53, 1))])
    blotch = nt.noise(co, scale=5, detail=3)
    c1 = nt.mix(base.outputs['Color'], (0.33, 0.38, 0.39, 1),
                nt.math('MULTIPLY', blotch.outputs['Fac'], 0.6))
    # faint branching veins (distorted noise ridges, not cracks)
    vn = nt.noise(co, scale=34, detail=5, distortion=1.2)
    ridge = nt.math('ABSOLUTE', nt.math('SUBTRACT', vn.outputs['Fac'], 0.5))
    vmask = nt.math('LESS_THAN', ridge, 0.012)
    vgate = nt.noise(co, scale=6, detail=2)
    vmask = nt.math('MULTIPLY', vmask, nt.math('GREATER_THAN', vgate.outputs['Fac'], 0.52))
    c2 = nt.mix(c1, (0.20, 0.22, 0.32, 1), nt.math('MULTIPLY', vmask, 0.35))
    # bruised, sunken eye sockets and a black gaping mouth
    def near(pt, r):
        d = nt.node('ShaderNodeVectorMath'); d.operation = 'DISTANCE'
        nt.link(co, d.inputs[0]); d.inputs[1].default_value = pt
        return nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', d.outputs['Value'], r), clamp=True)
    sock = nt.math('MAXIMUM', near((0.034, HC.y - 0.07, HC.z + 0.022), 0.05),
                   near((-0.034, HC.y - 0.07, HC.z + 0.022), 0.05))
    c2 = nt.mix(c2, (0.10, 0.06, 0.09, 1), nt.math('POWER', sock, 0.45))
    mouth = near((0, HC.y - 0.07, HC.z - 0.072), 0.042)
    c2 = nt.mix(c2, (0.03, 0.01, 0.01, 1), nt.math('POWER', mouth, 0.4))
    # black weeping streaks from the eyes
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    streak = None
    for sx in (0.034, -0.034):
        wob = nt.noise(co, scale=90, detail=2)
        dx = nt.math('ABSOLUTE', nt.math('SUBTRACT', sep.outputs['X'], sx + 0.0))
        dx = nt.math('ADD', dx, nt.math('MULTIPLY', wob.outputs['Fac'], 0.006))
        st = nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', dx, 0.0055), clamp=True)
        zin = nt.math('MULTIPLY', nt.math('LESS_THAN', sep.outputs['Z'], HC.z + 0.012),
                      nt.math('GREATER_THAN', sep.outputs['Z'], HC.z - 0.09))
        front = nt.math('LESS_THAN', sep.outputs['Y'], HC.y - 0.045)
        st = nt.math('MULTIPLY', nt.math('MULTIPLY', st, zin), front)
        streak = st if streak is None else nt.math('MAXIMUM', streak, st)
    c3 = nt.mix(c2, (0.02, 0.008, 0.008, 1), nt.math('MULTIPLY', streak, 0.95))
    ao = nt.ao(distance=0.035)
    aof = nt.ramp(ao.outputs['AO'], [(0.0, (0.0, 0.0, 0.0, 1)), (0.85, (1, 1, 1, 1))])
    c4 = nt.mix(c3, aof.outputs['Color'], 1.0, 'MULTIPLY')
    nt.link(c4, b.inputs['Base Color'])
    rough = nt.math('ADD', 0.55, nt.math('MULTIPLY', streak, -0.35))
    nt.link(rough, b.inputs['Roughness'])
    pores = nt.noise(co, scale=900, detail=2)
    wr = nt.noise(co, scale=140, detail=4, distortion=0.4)
    h = nt.math('ADD', nt.math('MULTIPLY', pores.outputs['Fac'], 0.3), wr.outputs['Fac'])
    h = nt.math('SUBTRACT', h, nt.math('MULTIPLY', vmask, 0.4))
    nt.link(nt.bump(h, strength=0.35, distance=0.0015), b.inputs['Normal'])
    b.inputs['Subsurface Weight'].default_value = 0.08
    return m


def dress_material():
    m, nt = new_mat('Widow_DressProc', rough=0.7)
    b = nt.bsdf()
    co = nt.tex_coord('Object')
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    n1 = nt.noise(co, scale=3, detail=6)
    base = nt.ramp(n1.outputs['Fac'], [(0.35, (0.70, 0.66, 0.56, 1)), (0.7, (0.60, 0.55, 0.42, 1))])
    # grime rising from the hem
    gn = nt.noise(co, scale=6, detail=8, distortion=0.6)
    hem = nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', sep.outputs['Z'], 0.9), clamp=True)
    hem = nt.math('MULTIPLY', hem, nt.math('ADD', 0.4, gn.outputs['Fac']), clamp=True)
    c1 = nt.mix(base.outputs['Color'], (0.20, 0.17, 0.13, 1), nt.math('POWER', hem, 1.3))
    # old blood
    # old dried blood: soaked from the chest downward in long drips
    bd = nt.noise(nt.mapping(co, scale=(9, 9, 1.6)), scale=3.5, detail=8, distortion=0.5)
    bsoak = nt.noise(co, scale=2.2, detail=4)
    frontm = nt.math('LESS_THAN', sep.outputs['Y'], -0.02)
    chestm = nt.math('GREATER_THAN', sep.outputs['Z'], nt.math('MULTIPLY', bsoak.outputs['Fac'], 1.6))
    blood = nt.math('GREATER_THAN', nt.math('ADD', bd.outputs['Fac'], nt.math('MULTIPLY', bsoak.outputs['Fac'], 0.25)), 0.74)
    blood = nt.math('MULTIPLY', nt.math('MULTIPLY', blood, frontm), chestm)
    blood_col = nt.ramp(bd.outputs['Fac'], [(0.66, (0.10, 0.012, 0.01, 1)), (0.85, (0.035, 0.005, 0.004, 1))])
    c2 = nt.mix(c1, blood_col.outputs['Color'], nt.math('MULTIPLY', blood, 0.9))
    # lace (bodice + sleeves)
    lv = nt.voronoi(co, scale=120, feature='DISTANCE_TO_EDGE')
    lw = nt.wave(co, scale=90, distortion=6, kind='RINGS', direction='SPHERICAL')
    lace = nt.math('MULTIPLY', nt.math('GREATER_THAN', lw.outputs['Fac'], 0.82),
                   nt.math('GREATER_THAN', sep.outputs['Z'], 1.3))
    c3 = nt.mix(c2, (0.80, 0.77, 0.68, 1), nt.math('MULTIPLY', lace, 0.25))
    ao = nt.ao(distance=0.08)
    aof = nt.ramp(ao.outputs['AO'], [(0.0, (0.12, 0.1, 0.09, 1)), (0.9, (1, 1, 1, 1))])
    c4 = nt.mix(c3, aof.outputs['Color'], 1.0, 'MULTIPLY')
    nt.link(c4, b.inputs['Base Color'])
    nt.link(nt.math('ADD', 0.72, nt.math('MULTIPLY', blood, -0.4)), b.inputs['Roughness'])
    weave = nt.wave(co, scale=700, distortion=0, kind='BANDS', direction='X')
    weave2 = nt.wave(co, scale=700, distortion=0, kind='BANDS', direction='Z')
    h = nt.math('ADD', nt.math('MULTIPLY', weave.outputs['Fac'], 0.3), nt.math('MULTIPLY', weave2.outputs['Fac'], 0.3))
    h = nt.math('ADD', h, nt.math('MULTIPLY', lace, 0.8))
    h = nt.math('ADD', h, nt.math('MULTIPLY', gn.outputs['Fac'], 0.4))
    nt.link(nt.bump(h, strength=0.25, distance=0.002), b.inputs['Normal'])
    b.inputs['Sheen Weight'].default_value = 0.4
    return m


def teeth_material():
    m, nt = new_mat('Widow_TeethProc', color=(0.55, 0.48, 0.32, 1), rough=0.45)
    return m


def eye_material():
    m, nt = new_mat('Widow_EyeMat', color=(0.8, 0.82, 0.78, 1), rough=0.15)
    b = nt.bsdf()
    b.inputs['Emission Color'].default_value = (0.75, 0.85, 0.9, 1)
    b.inputs['Emission Strength'].default_value = 2.5
    return m


def hair_image():
    W, H = 256, 1024
    arr = np.zeros((H, W, 4), np.float32)
    ys = np.arange(H, dtype=np.float32)
    X = np.arange(W, dtype=np.float32)[None, :]
    g = np.random.default_rng(11)
    cov = np.zeros((H, W), np.float32)
    shade = np.zeros((H, W), np.float32)
    for i in range(520):
        x0 = g.uniform(0, W)
        w = g.uniform(0.7, 2.4)
        amp, fr, ph = g.uniform(1, 6), g.uniform(1.5, 5), g.uniform(0, 6.3)
        end = g.uniform(0.55, 1.0) * H
        xs = (x0 + amp * np.sin(ys / H * fr * 6.283 + ph))[:, None]
        a = np.clip(1 - np.abs(X - xs) / w, 0, 1) * (ys[:, None] < end)
        a *= np.clip((end - ys[:, None]) / (0.12 * H), 0, 1) ** 0.6
        cov = np.maximum(cov, a)
        shade = np.where(a > 0.3, g.uniform(0.015, 0.075), shade)
    arr[..., 0] = shade * 1.0
    arr[..., 1] = shade * 0.9
    arr[..., 2] = shade * 0.85
    arr[..., 3] = cov
    return np_image('Widow_Hair_tex', arr)


def veil_image():
    S = 512
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S * 40
    def line(a):
        v = xx * math.cos(a) + yy * math.sin(a)
        return np.clip(1 - np.abs(v - np.round(v)) / 0.07, 0, 1)
    net = np.maximum(np.maximum(line(0.0), line(math.pi / 3)), line(2 * math.pi / 3))
    g = np.random.default_rng(5)
    stain = np.clip((g.random((S // 16, S // 16)).repeat(16, 0).repeat(16, 1)), 0, 1)
    arr = np.zeros((S, S, 4), np.float32)
    col = 0.78 - 0.18 * stain
    arr[..., 0] = col
    arr[..., 1] = col * 0.97
    arr[..., 2] = col * 0.9
    arr[..., 3] = np.clip(0.22 + net * 0.30, 0, 1)
    return np_image('Widow_Veil_tex', arr)


skin_m = skin_material()
body = join([body, head, teeth_obj], 'Widow_Body')
assign(body, skin_m)
assign(eye_obj, eye_material())
assign(dress, dress_material())
assign(hair, image_mat('Widow_Hair', hair_image(), alpha=True, rough=0.45))
assign(veil, image_mat('Widow_Veil', veil_image(), alpha=True, rough=0.8))

result = {"body": len(body.data.vertices), "dress": len(dress.data.vertices),
          "hair": len(hair.data.vertices), "veil": len(veil.data.vertices)}

if CFG.get('preview', True):
    result['p1'] = preview('widow_front.png', target=(0, 0, 1.45), cam=(0.35, -3.6, 1.55), lens=45)
    result['p2'] = preview('widow_face.png', target=(0, 0, 1.92), cam=(0.18, -0.75, 1.96), lens=60,
                           res=(720, 720), hide=('Widow_Veil',))
    result['p3'] = preview('widow_face_nohair.png', target=(0, 0, 1.9), cam=(0.25, -0.7, 1.95), lens=55,
                           res=(720, 720), hide=('Widow_Veil', 'Widow_Hair'))
    result['p4'] = preview('widow_back.png', target=(0, 0, 1.4), cam=(-1.6, 2.6, 1.8), lens=45)

exec(open("D:/Web Based - Horror Game/tools/blender/widow_rig.py").read())
