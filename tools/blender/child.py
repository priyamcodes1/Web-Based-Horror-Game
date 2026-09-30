# THE HOLLOW CHILD - porcelain-faced girl in a filthy nightgown, clutching a torn teddy bear.
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/char.py").read())
import numpy as np

CFG = globals().get('CFG', {})
BAKE, ANIM, EXPORT = CFG.get('bake', False), CFG.get('anim', False), CFG.get('export', False)
TEX = CFG.get('tex', 2048)
rnd = random.Random(21)
reset_scene()

P = params(sz=0.66, sx=0.62, bulk=0.82, limb=1.02, head=(0.072, 0.089, 0.104), finger=1.05, hand=1.25,
           foot=1.0, finger_thick=0.95)
P['head_c'] = 1.10
body, J = humanoid('Child_Body', P, legs=True)
displace_noise(body, strength=0.0025, scale=0.03)
HC = V((0, -0.006, P['head_c']))

# porcelain doll face: deep hollow sockets, tiny nose, carved smile
sym = [
    (0.031, 0.012, 0.016, 0.024, (1.3, 1, 1.05), (0, 1, 0)),     # hollow sockets
    (0.032, 0.036, 0.014, 0.003, (1.6, 1, 0.7), (0, -1, 0)),     # soft brow
    (0.045, -0.024, 0.02, 0.006, (1, 1, 1), (1, -0.6, 0)),       # round child cheeks
    (0.069, 0.0, 0.011, 0.008, (0.5, 1.2, 1.8), (1, 0, 0)),      # ears
]
cen = [
    (0, -0.016, 0.008, 0.008, (1, 1, 1), (0, -1, 0)),            # button nose
    (0, -0.050, 0.010, 0.003, (1.4, 1, 0.5), (0, -1, 0)),        # lips
    (0, -0.080, 0.012, 0.004, (1.5, 1, 1), (0, -1, 0)),          # chin
]
head = sculpt_head('Child_Head', HC, P['head'], sym, cen, taper=0.30, flatten=0.7, noise_amt=0.0006)
# carved "smile" from mouth corners up the cheeks
SMILE = []
for s in (1, -1):
    for i in range(9):
        u = i / 8
        x = (0.012 + 0.036 * u) * s
        z = HC.z - 0.050 + 0.030 * u ** 1.6
        SMILE.append((x, z))
for (x, z) in SMILE:
    ys = [v.co.y for v in head.data.vertices if abs(v.co.x - x) < 0.006 and abs(v.co.z - z) < 0.006]
    if ys:
        push(head, (x, min(ys), z), 0.0035, 0.004, (1, 1, 1), (0, 1, 0))
push(head, (0, HC.y - 0.07, HC.z - 0.05), 0.006, 0.006, (2.5, 1, 0.5), (0, 1, 0))
shade_smooth(head)

eyes = eyes_for(head, HC, x=0.031, z=0.012, r=0.0125, inset=0.014, name='Child_Eyes')
# pinprick pupils that glow faintly in the dark
pups = []
for s in (1, -1):
    ey = min(v.co.y for v in eyes.data.vertices if (v.co.x * s) > 0)
    pups.append(prim('uvsphere', f'pup{s}', u=12, v=8, r=0.0022, loc=(0.031 * s, ey + 0.001, HC.z + 0.012)))
pupils = join(pups, 'Child_Pupils'); apply_transform(pupils)

# stitches across the carved smile
st = []
for s in (1, -1):
    for i in range(1, 8):
        u = i / 8
        x = (0.012 + 0.036 * u) * s
        z = HC.z - 0.050 + 0.030 * u ** 1.6
        ys = [v.co.y for v in head.data.vertices if abs(v.co.x - x) < 0.005 and abs(v.co.z - z) < 0.005]
        if not ys:
            continue
        c = prim('cylinder', 'stitch', seg=5, r=0.0008, h=0.012, loc=(x, min(ys) - 0.0006, z),
                 rot=(0, math.radians(90 + 25 * s), 0))
        apply_transform(c); st.append(c)
stitches = join(st, 'Child_Stitches')

# ------------------------------------------------------------------ hair: matted shoulder-length bob
tree, _ = bvh_from([head, body])
roots = []
for v in head.data.vertices:
    lz, ly = v.co.z - HC.z, v.co.y - HC.y
    if lz < -0.02 or (ly < -0.03 and lz < 0.06):
        continue
    roots.append((v.co.copy(), v.normal.copy()))
rnd.shuffle(roots)
roots = roots[:210]
hv, hf, huv = [], [], []
for co, nrm in roots:
    front = (co.y - HC.y) < -0.03
    L = rnd.uniform(0.10, 0.16) if front else rnd.uniform(0.2, 0.32)
    nseg = 10
    part = V((math.copysign(1, co.x) if abs(co.x) > 0.004 else 1, 0, 0))
    flow = (V((0, 0, -1)) + part * 0.5 + (V((0, 0.3, 0)) if not front else V((0, -0.3, 0)))).normalized()
    tang = (flow - nrm * flow.dot(nrm)).normalized()
    pts = drape_path(tree, co + nrm * 0.003, nseg, L / nseg, init_dir=(tang * 0.9 + nrm * 0.1),
                     clearance=0.004 + rnd.uniform(0, 0.006), stiff=0.75, jitter=0.04, rnd=rnd)
    w0 = rnd.uniform(0.018, 0.03)
    u0 = rnd.uniform(0, 0.6)
    b0 = len(hv)
    for i, p in enumerate(pts):
        dv = (pts[min(i + 1, nseg)] - pts[max(i - 1, 0)]).normalized()
        hit = tree.find_nearest(p, 0.3)
        out = (p - hit[0]).normalized() if hit[0] is not None and (p - hit[0]).length > 1e-5 else nrm
        side = dv.cross(out).normalized()
        w = w0 * (1 - 0.45 * i / nseg)
        hv += [p - side * w / 2, p + side * w / 2]
        huv += [(u0, i / nseg), (u0 + 0.4, i / nseg)]
    for i in range(nseg):
        a = b0 + i * 2
        hf.append((a, a + 1, a + 3, a + 2))
hair = mesh_obj('Child_Hair', hv, hf)
uvl = hair.data.uv_layers.new(name='UVMap')
for poly in hair.data.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = huv[hair.data.loops[li].vertex_index]
shade_smooth(hair)

# ------------------------------------------------------------------ nightgown
z0 = P['neckt'] - 0.01
prof = [(z0, 0.040, 0.038), (z0 - 0.035, 0.07, 0.055), (P['sh_z'] + 0.005, 0.125, 0.078),
        (P['upchest'] - 0.02, 0.118, 0.080), (P['chest'], 0.108, 0.078), (P['belly'], 0.108, 0.082),
        (P['pelvis'], 0.13, 0.10), (0.5, 0.20, 0.17), (0.30, 0.24, 0.21)]
gown, gprof = lathe_garment('Child_Gown', prof, rows_step=0.008, seg=120, folds=0.022, fold_start=P['pelvis'],
                            tatter=0.10, seed=3.0)
# puffy short sleeves grown from the arm surface
sleeves = shell(body, 'Child_Sleeves',
                lambda c: abs(c.x) > P['sh_x'] * 0.55 and c.z > (J['shL'].z - 0.13) and c.z < P['sh_z'] + 0.06 and
                abs(c.x) < P['sh_x'] + 0.07, offset=0.014, thick=0.004, wrinkle=0.005)
gown = join([gown, sleeves], 'Child_Gown')
add_solidify(gown, 0.004, offset=1.0)
shade_smooth(gown)

# ------------------------------------------------------------------ teddy bear (held in left hand)
bear_parts = []
def ball(name, loc, r, sc=(1, 1, 1)):
    o = prim('uvsphere', name, u=20, v=14, r=r, loc=loc)
    o.scale = sc
    apply_transform(o)
    bear_parts.append(o)
    return o
ball('b_body', (0, 0, 0), 0.05, (1, 0.8, 1.15))
ball('b_head', (0, -0.005, 0.075), 0.042)
ball('b_snout', (0, -0.038, 0.066), 0.017, (1, 0.8, 0.8))
for s in (1, -1):
    ball('b_ear', (0.032 * s, 0.0, 0.108), 0.014, (1, 0.5, 1))
    ball('b_arm', (0.052 * s, -0.01, 0.018), 0.017, (0.8, 0.8, 1.5))
    ball('b_leg', (0.03 * s, -0.02, -0.05), 0.02, (0.9, 1.2, 0.9))
bear = join(bear_parts, 'Child_Bear')
displace_noise(bear, 0.003, 0.01)
be = prim('cylinder', 'button', seg=10, r=0.007, h=0.003, loc=(0.016, -0.042, 0.083), rot=(math.radians(90), 0, 0))
apply_transform(be)
# stuffing spilling from a torn belly
stuff = prim('icosphere', 'stuff', sub=2, r=0.016, loc=(0.0, -0.042, -0.005))
displace_noise(stuff, 0.008, 0.006)
bear = join([bear, be, stuff], 'Child_Bear')
# place in left hand, hanging by one arm
wr, kn = J['wrL'], J['knL']
bear.rotation_euler = (math.radians(-10), math.radians(-35), math.radians(15))
bear.location = kn + V((0.015, -0.035, -0.07))
apply_transform(bear)
shade_smooth(bear)

# ------------------------------------------------------------------ materials
def skin_mat():
    m, nt = new_mat('Child_SkinProc', rough=0.5)
    b = nt.bsdf()
    co = nt.tex_coord('Object')
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    mott = nt.noise(co, scale=22, detail=8)
    base = nt.ramp(mott.outputs['Fac'], [(0.3, (0.52, 0.52, 0.53, 1)), (0.7, (0.66, 0.65, 0.63, 1))])
    # bruises
    br = nt.noise(co, scale=7, detail=6, distortion=0.6)
    brm = nt.math('GREATER_THAN', br.outputs['Fac'], 0.63)
    c = nt.mix(base.outputs['Color'], (0.26, 0.17, 0.30, 1), nt.math('MULTIPLY', brm, 0.55))
    # dirt climbing from bare feet
    dn = nt.noise(co, scale=12, detail=8)
    dirt = nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', sep.outputs['Z'], 0.45), clamp=True)
    dirt = nt.math('MULTIPLY', dirt, nt.math('ADD', 0.35, dn.outputs['Fac']), clamp=True)
    c = nt.mix(c, (0.13, 0.10, 0.07, 1), nt.math('POWER', dirt, 0.9))
    # porcelain face: whiter, with black cracks
    face = nt.math('MULTIPLY', nt.math('GREATER_THAN', sep.outputs['Z'], HC.z - 0.10),
                   nt.math('LESS_THAN', sep.outputs['Y'], HC.y + 0.02))
    c = nt.mix(c, (0.86, 0.84, 0.80, 1), nt.math('MULTIPLY', face, 0.85))
    vor = nt.voronoi(co, scale=26, feature='DISTANCE_TO_EDGE')
    crk_n = nt.noise(co, scale=40, detail=3)
    crack = nt.math('LESS_THAN', nt.math('ADD', vor.outputs['Distance'], nt.math('MULTIPLY', crk_n.outputs['Fac'], 0.01)), 0.012)
    crack = nt.math('MULTIPLY', crack, nt.math('GREATER_THAN', crk_n.outputs['Fac'], 0.45))
    c = nt.mix(c, (0.03, 0.02, 0.02, 1), crack)
    # sockets pitch-black, carved smile dark red
    def near(pt, r):
        d = nt.node('ShaderNodeVectorMath'); d.operation = 'DISTANCE'
        nt.link(co, d.inputs[0]); d.inputs[1].default_value = pt
        return nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', d.outputs['Value'], r), clamp=True)
    sock = nt.math('MAXIMUM', near((0.031, HC.y - 0.06, HC.z + 0.012), 0.042),
                   near((-0.031, HC.y - 0.06, HC.z + 0.012), 0.042))
    c = nt.mix(c, (0.01, 0.01, 0.012, 1), nt.math('POWER', sock, 0.25))
    sm = None
    for (x, z) in SMILE:
        n_ = near((x, HC.y - 0.075, z), 0.008)
        sm = n_ if sm is None else nt.math('MAXIMUM', sm, n_)
    c = nt.mix(c, (0.16, 0.01, 0.01, 1), nt.math('POWER', sm, 0.5))
    ao = nt.ao(distance=0.03)
    aof = nt.ramp(ao.outputs['AO'], [(0.0, (0.05, 0.05, 0.05, 1)), (0.85, (1, 1, 1, 1))])
    c = nt.mix(c, aof.outputs['Color'], 1.0, 'MULTIPLY')
    nt.link(c, b.inputs['Base Color'])
    rough = nt.math('SUBTRACT', 0.6, nt.math('MULTIPLY', face, 0.42))
    nt.link(rough, b.inputs['Roughness'])
    h = nt.math('ADD', nt.math('MULTIPLY', nt.noise(co, scale=700, detail=2).outputs['Fac'], 0.2),
                nt.math('MULTIPLY', crack, -0.8))
    nt.link(nt.bump(h, strength=0.4, distance=0.0012), b.inputs['Normal'])
    return m


def gown_mat():
    m, nt = new_mat('Child_GownProc', rough=0.8)
    b = nt.bsdf()
    co = nt.tex_coord('Object')
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    n1 = nt.noise(co, scale=4, detail=6)
    base = nt.ramp(n1.outputs['Fac'], [(0.3, (0.60, 0.58, 0.54, 1)), (0.7, (0.48, 0.46, 0.42, 1))])
    gn = nt.noise(co, scale=8, detail=8, distortion=0.5)
    hem = nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', nt.math('SUBTRACT', sep.outputs['Z'], 0.28), 0.45), clamp=True)
    hem = nt.math('MULTIPLY', hem, nt.math('ADD', 0.35, gn.outputs['Fac']), clamp=True)
    c = nt.mix(base.outputs['Color'], (0.17, 0.14, 0.10, 1), hem)
    # small bloody handprints (voronoi cells) on the front
    hv_ = nt.voronoi(nt.mapping(co, scale=(1.4, 1.4, 1)), scale=6)
    hp = nt.math('LESS_THAN', nt.math('ADD', hv_.outputs['Distance'], nt.math('MULTIPLY', gn.outputs['Fac'], 0.3)), 0.2)
    hp = nt.math('MULTIPLY', hp, nt.math('LESS_THAN', sep.outputs['Y'], -0.02))
    hp = nt.math('MULTIPLY', hp, nt.math('GREATER_THAN', n1.outputs['Fac'], 0.52))
    c = nt.mix(c, (0.14, 0.012, 0.01, 1), nt.math('MULTIPLY', hp, 0.9))
    # tiny floral print
    fl = nt.voronoi(co, scale=90)
    flm = nt.math('LESS_THAN', fl.outputs['Distance'], 0.12)
    c = nt.mix(c, (0.42, 0.32, 0.36, 1), nt.math('MULTIPLY', flm, 0.35))
    ao = nt.ao(distance=0.06)
    aof = nt.ramp(ao.outputs['AO'], [(0.0, (0.1, 0.09, 0.08, 1)), (0.9, (1, 1, 1, 1))])
    c = nt.mix(c, aof.outputs['Color'], 1.0, 'MULTIPLY')
    nt.link(c, b.inputs['Base Color'])
    weave = nt.wave(co, scale=600, distortion=0, kind='BANDS', direction='X')
    weave2 = nt.wave(co, scale=600, distortion=0, kind='BANDS', direction='Z')
    h = nt.math('ADD', nt.math('MULTIPLY', weave.outputs['Fac'], 0.3), nt.math('MULTIPLY', weave2.outputs['Fac'], 0.3))
    nt.link(nt.bump(h, strength=0.2, distance=0.002), b.inputs['Normal'])
    b.inputs['Sheen Weight'].default_value = 0.5
    return m


def bear_mat():
    m, nt = new_mat('Child_BearProc', rough=0.9)
    b = nt.bsdf()
    co = nt.tex_coord('Object')
    fur = nt.noise(co, scale=300, detail=4)
    patch = nt.noise(co, scale=30, detail=3)
    base = nt.ramp(patch.outputs['Fac'], [(0.4, (0.24, 0.15, 0.08, 1)), (0.6, (0.33, 0.22, 0.12, 1))])
    c = nt.mix(base.outputs['Color'], (0.1, 0.06, 0.03, 1), nt.math('MULTIPLY', fur.outputs['Fac'], 0.5))
    ao = nt.ao(distance=0.02)
    aof = nt.ramp(ao.outputs['AO'], [(0.0, (0.1, 0.1, 0.1, 1)), (0.9, (1, 1, 1, 1))])
    c = nt.mix(c, aof.outputs['Color'], 1.0, 'MULTIPLY')
    nt.link(c, b.inputs['Base Color'])
    nt.link(nt.bump(fur.outputs['Fac'], strength=0.6, distance=0.002), b.inputs['Normal'])
    return m


def hair_image():
    W, H = 256, 512
    ys = np.arange(H, dtype=np.float32)
    X = np.arange(W, dtype=np.float32)[None, :]
    g = np.random.default_rng(4)
    cov = np.zeros((H, W), np.float32); sh = np.zeros((H, W), np.float32)
    for i in range(420):
        x0 = g.uniform(0, W); w = g.uniform(0.8, 2.6)
        amp, fr, ph = g.uniform(1, 8), g.uniform(1.5, 6), g.uniform(0, 6.3)
        end = g.uniform(0.5, 1.0) * H
        xs = (x0 + amp * np.sin(ys / H * fr * 6.283 + ph))[:, None]
        a = np.clip(1 - np.abs(X - xs) / w, 0, 1) * (ys[:, None] < end)
        a *= np.clip((end - ys[:, None]) / (0.15 * H), 0, 1) ** 0.6
        cov = np.maximum(cov, a)
        sh = np.where(a > 0.3, g.uniform(0.03, 0.09), sh)
    arr = np.zeros((H, W, 4), np.float32)
    arr[..., 0] = sh * 1.1; arr[..., 1] = sh * 0.85; arr[..., 2] = sh * 0.65; arr[..., 3] = cov
    return np_image('Child_Hair_tex', arr)


body = join([body, head, stitches], 'Child_Body')
assign(body, skin_mat())
m_eye, _ = new_mat('Child_EyeMat', color=(0.0, 0.0, 0.0, 1), rough=1.0)
assign(eyes, m_eye)
m_pup, nt_ = new_mat('Child_PupilMat', color=(1, 0.95, 0.85, 1), rough=0.2)
nt_.bsdf().inputs['Emission Color'].default_value = (1, 0.9, 0.75, 1)
nt_.bsdf().inputs['Emission Strength'].default_value = 6.0
assign(pupils, m_pup)
eyes = join([eyes, pupils], 'Child_Eyes')
assign(gown, gown_mat())
assign(bear, bear_mat())
assign(hair, image_mat('Child_Hair', hair_image(), alpha=True, rough=0.5))

result = {"body": len(body.data.vertices), "gown": len(gown.data.vertices), "hair": len(hair.data.vertices)}
if CFG.get('preview', True):
    result['p1'] = preview('child_front.png', target=(0, 0, 0.75), cam=(0.5, -2.6, 1.0), lens=45)
    result['p2'] = preview('child_face.png', target=(0, 0, HC.z), cam=(0.12, -0.5, HC.z + 0.02), lens=55,
                           res=(720, 720), hide=('Child_Hair',))

exec(open("D:/Web Based - Horror Game/tools/blender/child_rig.py").read())
