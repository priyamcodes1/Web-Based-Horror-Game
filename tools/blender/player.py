# PLAYER SURVIVOR - one rig, swappable garments/hair/accessories (6 profiles assembled in-game).
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/char.py").read())
import numpy as np

CFG = globals().get('CFG', {})
BAKE, ANIM, EXPORT = CFG.get('bake', False), CFG.get('anim', False), CFG.get('export', False)
TEX = CFG.get('tex', 1024)
rnd = random.Random(5)
reset_scene()

P = params(sz=1.0, sx=1.0, bulk=1.0)
body, J = humanoid('Player_Body', P, legs=True)
displace_noise(body, strength=0.0015, scale=0.04)
HC = V((0, -0.006, P['head_c']))
head = sculpt_head('Player_Head', HC, P['head'], taper=0.34, flatten=0.62, noise_amt=0.0005)
eyes = eyes_for(head, HC, x=0.032, z=0.018, r=0.0118, inset=0.0105, name='Player_Eyes')
EYEC = []
for s in (1, -1):
    vs = [v.co for v in eyes.data.vertices if v.co.x * s > 0]
    c = sum(vs, V((0, 0, 0))) / len(vs)
    EYEC.append(c)


def arm_param(c, side):
    sh, el, wr = J['sh' + side], J['el' + side], J['wr' + side]
    d1, t1 = _seg_dist(c, sh, el)
    d2, t2 = _seg_dist(c, el, wr)
    return (t1 * 0.5) if d1 < d2 else (0.5 + t2 * 0.5), min(d1, d2)


def is_arm(c, upto=0.97):
    side = 'L' if c.x > 0 else 'R'
    if abs(c.x) < P['sh_x'] * 0.8:
        return False
    t, d = arm_param(c, side)
    return d < 0.09 and t < upto


def is_torso(c, bottom):
    return abs(c.x) <= P['sh_x'] * 0.98 and bottom < c.z < P['neckb'] + 0.012 and not (
        c.z > P['neckb'] - 0.02 and abs(c.x) < 0.07)


def is_leg(c, top, bottom):
    return bottom < c.z < top and abs(c.x) < P['hip_x'] * 2.3


# ------------------------------------------------------------------ garments (all glued shells)
jacket = shell(body, 'Cloth_Jacket', lambda c: is_torso(c, P['pelvis'] - 0.13) or is_arm(c, 0.965),
               offset=0.017, thick=0.005, wrinkle=0.006, wrinkle_scale=0.05, seed=1)
collar = []
for i in range(2):
    ring = [V((0.075 * math.cos(a), 0.02 + 0.068 * math.sin(a), P['neckb'] + 0.01 + i * 0.03))
            for a in [k / 32 * TAU for k in range(33)]]
    collar.append(tube_along('collar', ring, 0.012 - i * 0.004, seg=8, cap=False))
jacket = join([jacket] + collar, 'Cloth_Jacket')

hoodie = shell(body, 'Cloth_Hoodie', lambda c: is_torso(c, P['pelvis'] - 0.10) or is_arm(c, 0.975),
               offset=0.02, thick=0.005, wrinkle=0.009, wrinkle_scale=0.06, seed=2)
# hood resting down on the upper back: a flattened half-shell behind the neck
hood = lathe('hood', [(0.02, 0.0), (0.09, 0.02), (0.12, 0.06), (0.125, 0.10), (0.11, 0.13), (0.07, 0.15)], seg=32)
hood.scale = (1.0, 0.55, 1.0)
hood.rotation_euler = (math.radians(-100), 0, 0)
hood.location = (0, 0.1, P['neckb'] - 0.02)
apply_transform(hood)
bm = bmesh.new(); bm.from_mesh(hood.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < 0.08], context='FACES')
bm.to_mesh(hood.data); bm.free()
add_solidify(hood, 0.006)
shade_smooth(hood)
strings = [tube_along('str', [V((0.035 * s, -0.09, P['neckb'] - 0.01)), V((0.04 * s, -0.12, P['neckb'] - 0.12)),
                              V((0.042 * s, -0.125, P['neckb'] - 0.2))], 0.0035, seg=6) for s in (1, -1)]
hoodie = join([hoodie, hood] + strings, 'Cloth_Hoodie')

flannel = shell(body, 'Cloth_Flannel', lambda c: is_torso(c, P['pelvis'] - 0.08) or is_arm(c, 0.72),
                offset=0.012, thick=0.004, wrinkle=0.005, wrinkle_scale=0.05, seed=4)
cuffs = []
for t in ('L', 'R'):
    c0 = J['el' + t].lerp(J['wr' + t], 0.42)
    d = (J['wr' + t] - J['el' + t]).normalized()
    cuffs.append(tube_along('cuff', [c0 - d * 0.02, c0 + d * 0.025], P['r_fa'][0] * 1.45, seg=18))
flannel = join([flannel] + cuffs, 'Cloth_Flannel')

jeans = shell(body, 'Pants_Jeans', lambda c: is_leg(c, P['pelvis'] + 0.07, P['ankle_z'] + 0.05),
              offset=0.012, thick=0.004, wrinkle=0.006, wrinkle_scale=0.05, seed=5)
cargo = shell(body, 'Pants_Cargo', lambda c: is_leg(c, P['pelvis'] + 0.07, P['ankle_z'] + 0.06),
              offset=0.019, thick=0.004, wrinkle=0.012, wrinkle_scale=0.06, seed=6)
pockets = []
for s in (1, -1):
    pk = prim('cube', 'pocket', size=(0.018, 0.13, 0.15), loc=(P['hip_x'] * s + 0.078 * s, -0.005, 0.72))
    pockets.append(pk)
cargo = join([cargo] + pockets, 'Pants_Cargo')
boots = shell(body, 'Shoes_Boots', lambda c: c.z < P['ankle_z'] + 0.13 and abs(c.x) < P['hip_x'] * 2.3,
              offset=0.017, thick=0.006, wrinkle=0.004, wrinkle_scale=0.03, seed=7)
for v in boots.data.vertices:
    if v.co.z < 0.022:
        v.co.z = max(v.co.z - 0.016, -0.004)
boots.data.update()
sneakers = shell(body, 'Shoes_Sneakers', lambda c: c.z < P['ankle_z'] + 0.04 and abs(c.x) < P['hip_x'] * 2.3,
                 offset=0.013, thick=0.005, wrinkle=0.002, wrinkle_scale=0.03, seed=8)
for v in sneakers.data.vertices:
    if v.co.z < 0.02:
        v.co.z = max(v.co.z - 0.012, -0.003)
sneakers.data.update()

# ------------------------------------------------------------------ hair & headwear
def scalp(c, low=-0.025):
    lz, ly = c.z - HC.z, c.y - HC.y
    face = ly < -0.05 and lz < 0.075
    ear = abs(c.x) > 0.058 and -0.03 < lz < 0.03 and ly > -0.03
    return lz > low and not face and not ear


hair_short = shell(head, 'Hair_Short', lambda c: scalp(c, -0.045) and not (c.z - HC.z < 0.0 and c.y - HC.y < -0.02),
                   offset=0.009, thick=0.006, wrinkle=0.006, wrinkle_scale=0.012, seed=9)
cap = shell(head, 'Hat_Cap', lambda c: c.z - HC.z > 0.035, offset=0.017, thick=0.004, wrinkle=0.002, seed=10)
brim_pts = []
brim = lathe('brim', [(0.0, 0.0), (0.09, 0.0)], seg=24, cap_bottom=False)
brim.scale = (0.95, 1.1, 1)
brim.location = (0, HC.y - 0.07, HC.z + 0.045)
brim.rotation_euler = (math.radians(-12), 0, 0)
apply_transform(brim)
bm = bmesh.new(); bm.from_mesh(brim.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y > HC.y - 0.07], context='FACES')
bm.to_mesh(brim.data); bm.free()
add_solidify(brim, 0.006)
button = prim('uvsphere', 'btn', u=12, v=8, r=0.008, loc=(0, HC.y + 0.005, HC.z + 0.128))
cap = join([cap, brim, button], 'Hat_Cap')
beanie = shell(head, 'Hat_Beanie', lambda c: c.z - HC.z > 0.0 and not (c.y - HC.y < -0.06 and c.z - HC.z < 0.05),
               offset=0.02, thick=0.006, wrinkle=0.003, wrinkle_scale=0.01, seed=11)
cuffb = prim('torus', 'bcuff', R=1.0, r=0.14, u=48, v=10)
cuffb.scale = (P['head'][0] + 0.025, P['head'][1] + 0.025, 0.12)
cuffb.location = (0, HC.y + 0.005, HC.z + 0.012)
apply_transform(cuffb)
beanie = join([beanie, cuffb], 'Hat_Beanie')

# long hair cards (shoulder length, parted)
tree, _ = bvh_from([head, body])
roots = [(v.co.copy(), v.normal.copy()) for v in head.data.vertices if scalp(v.co, -0.02) and not ((v.co.y - HC.y) < -0.03 and abs(v.co.x) < 0.035)]
rnd.shuffle(roots)
roots = roots[:260]
hv, hf, huv = [], [], []
for co, nrm in roots:
    front = (co.y - HC.y) < -0.04
    L = rnd.uniform(0.18, 0.28) if front else rnd.uniform(0.3, 0.42)
    nseg = 12
    part = V((math.copysign(1, co.x) if abs(co.x) > 0.005 else 1, 0, 0))
    flow = (V((0, 0, -1)) + part * 0.7 + (V((0, 0.4, 0)) if not front else V((0, 0.1, 0)))).normalized()
    tang = (flow - nrm * flow.dot(nrm)).normalized()
    pts = drape_path(tree, co + nrm * 0.003, nseg, L / nseg, init_dir=(tang * 0.92 + nrm * 0.08),
                     clearance=0.005 + rnd.uniform(0, 0.007), stiff=0.74, jitter=0.02, rnd=rnd)
    w0 = rnd.uniform(0.02, 0.034); u0 = rnd.uniform(0, 0.6)
    b0 = len(hv)
    for i, p in enumerate(pts):
        dv = (pts[min(i + 1, nseg)] - pts[max(i - 1, 0)]).normalized()
        hit = tree.find_nearest(p, 0.3)
        out = (p - hit[0]).normalized() if hit[0] is not None and (p - hit[0]).length > 1e-5 else nrm
        side = dv.cross(out).normalized()
        w = w0 * (1 - 0.5 * i / nseg)
        hv += [p - side * w / 2, p + side * w / 2]
        huv += [(u0, i / nseg), (u0 + 0.4, i / nseg)]
    for i in range(nseg):
        a = b0 + i * 2
        hf.append((a, a + 1, a + 3, a + 2))
hair_long = mesh_obj('Hair_Long', hv, hf)
uvl = hair_long.data.uv_layers.new(name='UVMap')
for poly in hair_long.data.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = huv[hair_long.data.loops[li].vertex_index]
shade_smooth(hair_long)
# a scalp cap under the long hair so no skin shows through the cards
hair_long_cap = shell(head, 'hlc', lambda c: scalp(c, -0.03), offset=0.004, thick=0.0, wrinkle=0.0)

glasses = []
for s in (1, -1):
    c = EYEC[0 if s > 0 else 1]
    rim = prim('torus', 'rim', R=0.021, r=0.0022, u=28, v=6)
    rim.scale = (1.0, 0.82, 1.0)
    rim.rotation_euler = (math.radians(90), 0, 0)
    rim.location = (c.x, c.y - 0.024, c.z)
    apply_transform(rim)
    glasses.append(rim)
    tmp = tube_along('temple', [V((c.x + 0.021 * s, c.y - 0.022, c.z + 0.004)), V((0.074 * s, HC.y + 0.0, c.z + 0.006)),
                                V((0.072 * s, HC.y + 0.06, c.z - 0.012))], 0.0018, seg=5)
    glasses.append(tmp)
glasses.append(tube_along('bridge', [V((0.011, EYEC[0].y - 0.026, EYEC[0].z + 0.004)), V((0, EYEC[0].y - 0.03, EYEC[0].z + 0.008)),
                                     V((-0.011, EYEC[0].y - 0.026, EYEC[0].z + 0.004))], 0.0018, seg=5))
glasses = join(glasses, 'Acc_Glasses')

# backpack
bp = prim('cube', 'bp', size=(0.30, 0.14, 0.42), loc=(0, 0.20, P['chest'] + 0.02))
m = bp.modifiers.new('bev', 'BEVEL'); m.width = 0.035; m.segments = 4
apply_modifiers(bp)
add_subsurf(bp, 1)
displace_noise(bp, 0.004, 0.08)
flap = prim('cube', 'flap', size=(0.28, 0.06, 0.12), loc=(0, 0.25, P['chest'] + 0.18))
m = flap.modifiers.new('bev', 'BEVEL'); m.width = 0.02; m.segments = 3
apply_modifiers(flap)
pocket = prim('cube', 'bpp', size=(0.22, 0.05, 0.16), loc=(0, 0.285, P['chest'] - 0.08))
m = pocket.modifiers.new('bev', 'BEVEL'); m.width = 0.02; m.segments = 3
apply_modifiers(pocket)
straps = []
for s in (1, -1):
    straps.append(tube_along('strap', [V((0.08 * s, 0.14, P['chest'] + 0.2)), V((0.1 * s, 0.02, P['neckb'] - 0.01)),
                                       V((0.11 * s, -0.12, P['upchest'] - 0.03)), V((0.12 * s, -0.13, P['chest'] - 0.08)),
                                       V((0.13 * s, 0.0, P['belly'] - 0.02)), V((0.1 * s, 0.14, P['chest'] - 0.12))],
                              (0.022, 0.004), seg=6))
backpack = join([bp, flap, pocket] + straps, 'Acc_Backpack')
shade_smooth(backpack)

# ------------------------------------------------------------------ materials (neutral bases, tinted in-game)
def near_fac(nt, co, pt, r):
    dd = nt.node('ShaderNodeVectorMath'); dd.operation = 'DISTANCE'
    nt.link(co, dd.inputs[0]); dd.inputs[1].default_value = pt
    return nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', dd.outputs['Value'], r), clamp=True)


def with_ao(nt, c, dist=0.05, lo=0.1):
    ao = nt.ao(distance=dist)
    aof = nt.ramp(ao.outputs['AO'], [(0.0, (lo, lo, lo, 1)), (0.9, (1, 1, 1, 1))])
    return nt.mix(c, aof.outputs['Color'], 1.0, 'MULTIPLY')


def skin_mat():
    m, nt = new_mat('Player_SkinProc', rough=0.5)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    mott = nt.noise(co, scale=30, detail=6)
    c = nt.ramp(mott.outputs['Fac'], [(0.3, (0.74, 0.60, 0.52, 1)), (0.7, (0.80, 0.66, 0.57, 1))]).outputs['Color']
    blush = nt.math('MAXIMUM', near_fac(nt, co, (0.045, HC.y - 0.07, HC.z - 0.02), 0.035),
                    near_fac(nt, co, (-0.045, HC.y - 0.07, HC.z - 0.02), 0.035))
    c = nt.mix(c, (0.78, 0.5, 0.45, 1), nt.math('MULTIPLY', blush, 0.35))
    lips = near_fac(nt, co, (0, HC.y - 0.09, HC.z - 0.05), 0.022)
    c = nt.mix(c, (0.55, 0.30, 0.28, 1), nt.math('POWER', lips, 0.5))
    for s in (1, -1):   # eyebrows
        brow = nt.math('MULTIPLY', near_fac(nt, co, (0.032 * s, HC.y - 0.09, HC.z + 0.04), 0.03),
                       nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', sep.outputs['Z'], HC.z + 0.041)), 0.0055))
        c = nt.mix(c, (0.09, 0.06, 0.04, 1), nt.math('MULTIPLY', nt.math('GREATER_THAN', brow, 0.05), 0.85))
    # knuckles / palms a bit redder, soles dirty
    c = with_ao(nt, c, 0.03, 0.15)
    nt.link(c, b.inputs['Base Color'])
    pores = nt.noise(co, scale=900, detail=2)
    nt.link(nt.bump(pores.outputs['Fac'], 0.2, 0.0008), b.inputs['Normal'])
    b.inputs['Subsurface Weight'].default_value = 0.15
    return m


def eye_mat():
    m, nt = new_mat('Player_EyeMat', rough=0.1)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    c = (0.85, 0.83, 0.8, 1)
    iris = None; pupil = None
    for ec in EYEC:
        f = V((ec.x, ec.y - 0.0118, ec.z))
        ir = near_fac(nt, co, f, 0.0062); pu = near_fac(nt, co, f, 0.0026)
        iris = ir if iris is None else nt.math('MAXIMUM', iris, ir)
        pupil = pu if pupil is None else nt.math('MAXIMUM', pupil, pu)
    col = nt.mix(c, (0.22, 0.16, 0.09, 1), nt.math('GREATER_THAN', iris, 0.0))
    col = nt.mix(col, (0.01, 0.01, 0.01, 1), nt.math('GREATER_THAN', pupil, 0.0))
    nt.link(col, b.inputs['Base Color'])
    return m


def fabric_mat(name, c1, c2, scale=500, dirt=0.35, stripes=False, knit=False, denim=False, rough=0.85):
    m, nt = new_mat(name, rough=rough)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    tone = nt.noise(co, scale=5, detail=6)
    c = nt.ramp(tone.outputs['Fac'], [(0.3, (*c1, 1)), (0.7, (*c2, 1))]).outputs['Color']
    if stripes:  # plaid (tartan) - tinted later, so keep in greys
        w1 = nt.wave(co, scale=14, distortion=0, kind='BANDS', direction='X')
        w2 = nt.wave(co, scale=14, distortion=0, kind='BANDS', direction='Z')
        pl = nt.math('MULTIPLY', nt.math('GREATER_THAN', w1.outputs['Fac'], 0.6), 0.5)
        pl = nt.math('ADD', pl, nt.math('MULTIPLY', nt.math('GREATER_THAN', w2.outputs['Fac'], 0.6), 0.5))
        c = nt.mix(c, (0.12, 0.12, 0.12, 1), nt.math('MULTIPLY', pl, 0.7))
    grime = nt.noise(co, scale=3, detail=8, distortion=0.5)
    c = nt.mix(c, (0.12, 0.1, 0.08, 1), nt.math('MULTIPLY', grime.outputs['Fac'], dirt))
    c = with_ao(nt, c, 0.05)
    nt.link(c, b.inputs['Base Color'])
    if knit:
        w1 = nt.wave(co, scale=scale, distortion=2, kind='BANDS', direction='Z')
        h = w1.outputs['Fac']
    else:
        w1 = nt.wave(co, scale=scale, distortion=0, kind='BANDS', direction='X')
        w2 = nt.wave(co, scale=scale, distortion=0, kind='BANDS', direction='Z')
        h = nt.math('ADD', nt.math('MULTIPLY', w1.outputs['Fac'], 0.3), nt.math('MULTIPLY', w2.outputs['Fac'], 0.3))
    if denim:
        tw = nt.wave(nt.mapping(co, rot=(0.0, 0.0, 0.7)), scale=scale * 0.8, distortion=0.2, kind='BANDS', direction='X')
        h = nt.math('ADD', h, nt.math('MULTIPLY', tw.outputs['Fac'], 0.5))
    nt.link(nt.bump(h, 0.3, 0.002), b.inputs['Normal'])
    return m


def leather(name, col, rough=0.5):
    m, nt = new_mat(name, rough=rough)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    grain = nt.voronoi(co, scale=220)
    tone = nt.noise(co, scale=6, detail=6)
    c = nt.ramp(tone.outputs['Fac'], [(0.3, (col[0] * 0.7, col[1] * 0.7, col[2] * 0.7, 1)), (0.7, (*col, 1))]).outputs['Color']
    wear = nt.noise(co, scale=20, detail=8)
    c = nt.mix(c, (col[0] * 1.5, col[1] * 1.45, col[2] * 1.4, 1), nt.math('MULTIPLY', nt.math('GREATER_THAN', wear.outputs['Fac'], 0.64), 0.6))
    c = with_ao(nt, c, 0.04)
    nt.link(c, b.inputs['Base Color'])
    nt.link(nt.bump(nt.math('ADD', grain.outputs['Distance'], nt.math('MULTIPLY', wear.outputs['Fac'], 0.2)), 0.25, 0.0015), b.inputs['Normal'])
    return m


def hair_image(name, tone):
    W_, H_ = 256, 512
    ys = np.arange(H_, dtype=np.float32); X = np.arange(W_, dtype=np.float32)[None, :]
    g = np.random.default_rng(9)
    cov = np.zeros((H_, W_), np.float32); sh = np.zeros((H_, W_), np.float32)
    for i in range(460):
        x0 = g.uniform(0, W_); w = g.uniform(0.8, 2.4)
        amp, fr, ph = g.uniform(1, 4), g.uniform(1, 4), g.uniform(0, 6.3)
        end = g.uniform(0.55, 1.0) * H_
        xs = (x0 + amp * np.sin(ys / H_ * fr * 6.283 + ph))[:, None]
        a = np.clip(1 - np.abs(X - xs) / w, 0, 1) * (ys[:, None] < end)
        a *= np.clip((end - ys[:, None]) / (0.15 * H_), 0, 1) ** 0.6
        cov = np.maximum(cov, a)
        sh = np.where(a > 0.3, g.uniform(0.75, 1.15), sh)
    arr = np.zeros((H_, W_, 4), np.float32)
    for k in range(3):
        arr[..., k] = np.clip(sh * tone[k], 0, 1)
    arr[..., 3] = cov
    return np_image(name, arr)


body = join([body, head], 'Player_Body')
assign(body, skin_mat())
assign(eyes, eye_mat())
assign(jacket, leather('Cloth_JacketProc', (0.55, 0.55, 0.55), 0.55))      # neutral - tinted per profile
assign(hoodie, fabric_mat('Cloth_HoodieProc', (0.62, 0.62, 0.62), (0.55, 0.55, 0.55), 350, knit=True, rough=0.95))
assign(flannel, fabric_mat('Cloth_FlannelProc', (0.66, 0.66, 0.66), (0.6, 0.6, 0.6), 500, stripes=True))
assign(jeans, fabric_mat('Pants_JeansProc', (0.16, 0.22, 0.34), (0.22, 0.29, 0.42), 700, denim=True))
assign(cargo, fabric_mat('Pants_CargoProc', (0.5, 0.5, 0.5), (0.44, 0.44, 0.44), 450))
assign(boots, leather('Shoes_BootsProc', (0.16, 0.10, 0.06), 0.45))
assign(sneakers, fabric_mat('Shoes_SneakersProc', (0.7, 0.7, 0.7), (0.62, 0.62, 0.62), 600, dirt=0.5))
hm, _ = new_mat('Hair_ShortProc', rough=0.6)
nt_h = NT(hm)
co_ = nt_h.tex_coord('Object')
clumps = nt_h.noise(nt_h.mapping(co_, scale=(1, 1, 3)), scale=120, detail=4)
cc = nt_h.ramp(clumps.outputs['Fac'], [(0.3, (0.35, 0.35, 0.35, 1)), (0.7, (0.62, 0.62, 0.62, 1))])
nt_h.link(cc.outputs['Color'], nt_h.bsdf().inputs['Base Color'])
nt_h.link(nt_h.bump(clumps.outputs['Fac'], 0.8, 0.002), nt_h.bsdf().inputs['Normal'])
assign(hair_short, hm)
assign(hair_long, image_mat('Hair_Long', hair_image('Hair_Long_tex', (0.62, 0.62, 0.62)), alpha=True, rough=0.5))
assign(hair_long_cap, hm)
hair_long = join([hair_long, hair_long_cap], 'Hair_Long')
assign(cap, fabric_mat('Hat_CapProc', (0.6, 0.6, 0.6), (0.52, 0.52, 0.52), 400))
assign(beanie, fabric_mat('Hat_BeanieProc', (0.6, 0.6, 0.6), (0.5, 0.5, 0.5), 260, knit=True, rough=0.95))
gm, _ = new_mat('Acc_GlassesMat', color=(0.03, 0.03, 0.03, 1), rough=0.3, metal=0.6)
assign(glasses, gm)
assign(backpack, fabric_mat('Acc_BackpackProc', (0.22, 0.25, 0.2), (0.18, 0.2, 0.16), 500, dirt=0.4))

GARMENTS = [jacket, hoodie, flannel, jeans, cargo, boots, sneakers]
HEADWEAR = [hair_short, hair_long, cap, beanie, glasses]
result = {"body": len(body.data.vertices)}
if CFG.get('preview', True):
    # preview profile: jacket + jeans + boots + short hair + backpack
    show = {'Player_Body', 'Player_Eyes', 'Cloth_Jacket', 'Pants_Jeans', 'Shoes_Boots', 'Hair_Short', 'Acc_Backpack'}
    hide = tuple(o.name for o in bpy.data.objects if o.type == 'MESH' and o.name not in show)
    result['p1'] = preview('player_a.png', target=(0, 0, 1.0), cam=(0.9, -3.4, 1.4), lens=40, hide=hide)
    show2 = {'Player_Body', 'Player_Eyes', 'Cloth_Hoodie', 'Pants_Cargo', 'Shoes_Sneakers', 'Hair_Long'}
    hide2 = tuple(o.name for o in bpy.data.objects if o.type == 'MESH' and o.name not in show2)
    result['p2'] = preview('player_b.png', target=(0, 0, 1.0), cam=(-1.2, -3.2, 1.4), lens=40, hide=hide2)
    result['p3'] = preview('player_face.png', target=(0, 0, HC.z), cam=(0.15, -0.6, HC.z + 0.02), lens=55,
                           res=(720, 720), hide=hide)

exec(open("D:/Web Based - Horror Game/tools/blender/player_rig.py").read())
