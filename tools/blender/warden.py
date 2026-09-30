# THE WARDEN - hulking butcher: burlap sack mask, blood-soaked leather apron, cleaver, dragging chain.
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/char.py").read())
import numpy as np

CFG = globals().get('CFG', {})
BAKE, ANIM, EXPORT = CFG.get('bake', False), CFG.get('anim', False), CFG.get('export', False)
TEX = CFG.get('tex', 2048)
rnd = random.Random(33)
reset_scene()

P = params(sz=1.16, sx=1.30, bulk=1.22, limb=1.0, head=(0.086, 0.104, 0.122), finger=0.95, hand=1.3, foot=1.18,
           finger_thick=1.45)
P['r_belly'] = (0.19, 0.17)
P['r_hips'] = (0.18, 0.135)
P['r_chest'] = (0.215, 0.15)
P['r_upchest'] = (0.23, 0.14)
P['r_neck'] = 0.085
body, J = humanoid('Warden_Body', P, legs=True)
push(body, (0, -0.16, P['belly'] - 0.03), 0.08, 0.025, (1.3, 1, 1), (0, -1, 0))   # sagging gut
displace_noise(body, strength=0.004, scale=0.04)
HC = V((0, -0.01, P['head_c']))
head = sculpt_head('Warden_Head', HC, P['head'], taper=0.22, flatten=0.8, noise_amt=0.001)

# ------------------------------------------------------------------ burlap sack mask (shell of the head)
sack = shell(head, 'Warden_Sack', lambda c: True, offset=0.013, thick=0.004, wrinkle=0.009, wrinkle_scale=0.03)
# gathered + tied at the neck: flare the bottom out a little
for v in sack.data.vertices:
    lz = v.co.z - HC.z
    if lz < -0.08:
        f = (-0.08 - lz) / 0.06
        d = V((v.co.x, v.co.y - HC.y, 0))
        v.co += d.normalized() * 0.02 * f if d.length > 1e-4 else V((0, 0, 0))
        v.co.z -= 0.035 * f
sack.data.update()
EYE = [(0.034, 0.02), (-0.03, 0.012)]          # crooked, uneven eye holes
bm = bmesh.new(); bm.from_mesh(sack.data)
kill = []
for f in bm.faces:
    c = f.calc_center_median()
    if c.y > HC.y - 0.03:
        continue
    for (ex, ez) in EYE:
        dx, dz = (c.x - ex) / 0.016, (c.z - (HC.z + ez)) / 0.013
        if dx * dx + dz * dz < 1.0 + 0.35 * noise.noise(c * 150):
            kill.append(f); break
bmesh.ops.delete(bm, geom=kill, context='FACES')
bm.to_mesh(sack.data); bm.free()
recalc_normals(sack)
shade_smooth(sack)
# rope noose around the neck
rope_pts = []
for i in range(41):
    a = i / 40 * TAU
    rope_pts.append(V((0.085 * math.cos(a), HC.y + 0.078 * math.sin(a) + 0.01, HC.z - 0.118)))
rope = tube_along('rope', rope_pts, 0.0085, seg=8, cap=False)
tail = tube_along('rope_t', [V((0.06, HC.y - 0.06, HC.z - 0.118)), V((0.09, HC.y - 0.1, HC.z - 0.2)),
                             V((0.1, HC.y - 0.12, HC.z - 0.32))], 0.0085, seg=8)
rope = join([rope, tail], 'Warden_Rope')
# eyes behind the holes: dim embers
eyes = []
for (ex, ez) in EYE:
    ys = [v.co.y for v in head.data.vertices if abs(v.co.x - ex) < 0.008 and abs(v.co.z - (HC.z + ez)) < 0.008]
    eyes.append(prim('uvsphere', 'we', u=16, v=10, r=0.009, loc=(ex, min(ys) + 0.004, HC.z + ez)))
eyes = join(eyes, 'Warden_Eyes'); apply_transform(eyes)

# ------------------------------------------------------------------ clothing (shells glued to the body)
chest_top = P['neckb'] + 0.01
shirt = shell(body, 'Warden_Shirt', lambda c: c.z > P['pelvis'] - 0.06 and c.z < chest_top and
              (abs(c.x) < P['sh_x'] + 0.02 or (c - J['elL' if c.x > 0 else 'elR']).length > 0.0 and
               ((c - (J['shL'] if c.x > 0 else J['shR'])).length < P['ua'] * 0.8)),
              offset=0.011, thick=0.004, wrinkle=0.006, wrinkle_scale=0.04, seed=1)
# rolled cuffs
cuffs = []
for t in ('L', 'R'):
    c0 = J['sh' + t].lerp(J['el' + t], 0.78)
    d = (J['el' + t] - J['sh' + t]).normalized()
    cuffs.append(tube_along('cuff', [c0 - d * 0.03, c0 + d * 0.02], P['r_ua'][1] * 1.55, seg=18))
pants = shell(body, 'Warden_Pants', lambda c: c.z < P['pelvis'] + 0.06 and c.z > P['ankle_z'] + 0.08,
              offset=0.014, thick=0.004, wrinkle=0.008, wrinkle_scale=0.05, seed=2)
boots = shell(body, 'Warden_Boots', lambda c: c.z < P['ankle_z'] + 0.16, offset=0.018, thick=0.006,
              wrinkle=0.003, wrinkle_scale=0.03, seed=3)
# thick soles
for v in boots.data.vertices:
    if v.co.z < 0.02:
        v.co.z = max(v.co.z - 0.018, -0.005)
boots.data.update()
belt = prim('torus', 'belt', R=1.0, r=0.08, u=48, v=6)
belt.scale = (P['r_hips'][0] + 0.03, P['r_hips'][1] + 0.03, 0.2)
belt.location = (0, 0.0, P['pelvis'] + 0.07)
apply_transform(belt)

# ------------------------------------------------------------------ apron (draped over the gut)
tree, _ = bvh_from([body])
AC, AR = 26, 34
top_z = P['upchest'] - 0.02
cols = []
for i in range(AC):
    u = i / (AC - 1) - 0.5
    x = u * 0.27
    # find the chest surface at the top of this column
    hit = tree.ray_cast(V((x, -1.0, top_z)), V((0, 1, 0)))
    y0 = (hit[0].y if hit[0] is not None else -0.2) - 0.012
    start = V((x, y0, top_z))
    L = (top_z - P['knee_z'] + 0.06)
    col = drape_path(tree, start, AR - 1, L / (AR - 1), init_dir=(0, -0.1, -1), pull=(0, -0.04, -1),
                     clearance=0.034, stiff=0.85)
    # widen toward the bottom
    for k, p in enumerate(col):
        fr = k / (AR - 1)
        p.x *= 1 + 0.25 * fr ** 1.2
    cols.append(col)
av, af, auv = [], [], []
for i in range(AC):
    for k in range(AR):
        av.append(cols[i][k]); auv.append((i / (AC - 1), 1 - k / (AR - 1)))
for i in range(AC - 1):
    for k in range(AR - 1):
        af.append((i * AR + k, (i + 1) * AR + k, (i + 1) * AR + k + 1, i * AR + k + 1))
apron = mesh_obj('Warden_Apron', av, af)
uvl = apron.data.uv_layers.new(name='UVMap')
for poly in apron.data.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = auv[apron.data.loops[li].vertex_index]
add_solidify(apron, 0.006, offset=1.0)
shade_smooth(apron)
straps = [tube_along('strap', [cols[0][0], V((-0.09, 0.02, P['neckb'] + 0.02)), V((0, 0.08, P['neckb'] + 0.04)),
                               V((0.09, 0.02, P['neckb'] + 0.02)), cols[-1][0]], 0.008, seg=6)]

# ------------------------------------------------------------------ cleaver (right hand)
wr, kn = J['wrR'], J['knR']
d = (kn - wr).normalized()
blade_pts = [(-0.05, 0), (0.17, 0), (0.19, -0.1), (-0.05, -0.1)]
blade = mesh_obj('blade', [(x, 0, z) for x, z in blade_pts] + [(x, 0.006, z) for x, z in blade_pts],
                 [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)])
add_subsurf(blade, 0, apply=False)
hole = prim('cylinder', 'hole', seg=12, r=0.012, h=0.02, loc=(0.14, 0.003, -0.02), rot=(math.radians(90), 0, 0))
handle = prim('cylinder', 'handle', seg=12, r=0.017, h=0.14, loc=(-0.12, 0.003, -0.02), rot=(0, math.radians(90), 0))
rivets = [prim('uvsphere', 'rv', u=8, v=6, r=0.005, loc=(-0.12 + k * 0.04, -0.012, -0.02)) for k in (-1, 0, 1)]
cleaver = join([blade, handle, hole] + rivets, 'Warden_Cleaver')
# grip: handle centred in the fist, blade pointing forward/down
cleaver.scale = (1.45, 1.45, 1.45)
cleaver.rotation_euler = (math.radians(90), 0, math.radians(90))
cleaver.location = kn + d * 0.01 + V((0.0, -0.02, -0.012))
apply_transform(cleaver)
shade_smooth(cleaver, auto_angle=40)

# ------------------------------------------------------------------ chain: wrapped on left forearm + dangling
links = []
el, wl = J['elL'], J['wrL']
fa_d = (wl - el).normalized()
side = fa_d.cross(V((0, 1, 0))).normalized()
up = side.cross(fa_d).normalized()
CHAIN_PTS = []
for i in range(34):                        # coil around the forearm
    a = i * 0.9
    p = el.lerp(wl, 0.15 + 0.7 * i / 33) + (side * math.cos(a) + up * math.sin(a)) * (P['r_fa'][0] * 1.3)
    CHAIN_PTS.append(p)
hang_top = wl + V((0, 0.02, -0.04))
for i in range(30):                        # dangling to the floor, last links dragging
    z = hang_top.z - i * 0.035
    CHAIN_PTS.append(V((hang_top.x + 0.02 * math.sin(i * 0.3), hang_top.y + 0.02 * i * 0.3 if z < 0.05 else hang_top.y,
                        max(z, 0.012))))
for i, p in enumerate(CHAIN_PTS[:-1]):
    q = CHAIN_PTS[i + 1]
    dd = (q - p)
    ln = prim('torus', 'link', R=0.016, r=0.0045, u=12, v=6)
    ln.scale = (1.0, 0.62, 1.0)
    apply_transform(ln)
    rot = dd.to_track_quat('X', 'Z').to_euler()
    ln.rotation_euler = rot
    ln.rotation_euler.rotate_axis('X', math.radians(90 * (i % 2)))
    ln.location = p.lerp(q, 0.5)
    apply_transform(ln)
    links.append(ln)
hook = tube_along('hook', [CHAIN_PTS[-1] + V((0, 0, 0.0)), CHAIN_PTS[-1] + V((0.0, -0.05, 0.01)),
                           CHAIN_PTS[-1] + V((0.0, -0.09, 0.04)), CHAIN_PTS[-1] + V((0.0, -0.08, 0.08)),
                           CHAIN_PTS[-1] + V((0.0, -0.05, 0.085))], [0.008, 0.008, 0.007, 0.005, 0.002], seg=10)
chain = join(links + [hook], 'Warden_Chain')
shade_smooth(chain)

# ------------------------------------------------------------------ materials
def near_fac(nt, co, pt, r):
    dd = nt.node('ShaderNodeVectorMath'); dd.operation = 'DISTANCE'
    nt.link(co, dd.inputs[0]); dd.inputs[1].default_value = pt
    return nt.math('SUBTRACT', 1.0, nt.math('DIVIDE', dd.outputs['Value'], r), clamp=True)


def with_ao(nt, c, dist=0.06, lo=0.08):
    ao = nt.ao(distance=dist)
    aof = nt.ramp(ao.outputs['AO'], [(0.0, (lo, lo, lo, 1)), (0.9, (1, 1, 1, 1))])
    return nt.mix(c, aof.outputs['Color'], 1.0, 'MULTIPLY')


def blood_layer(nt, co, c, amount=0.62, scale=3.0, stretch=1.8):
    amount = 0.5 + amount * 0.34
    bd = nt.noise(nt.mapping(co, scale=(1, 1, 1 / stretch)), scale=scale, detail=8, distortion=0.4)
    mask = nt.math('GREATER_THAN', bd.outputs['Fac'], amount)
    col = nt.ramp(bd.outputs['Fac'], [(amount, (0.16, 0.015, 0.01, 1)), (min(amount + 0.15, 1), (0.05, 0.005, 0.004, 1))])
    return nt.mix(c, col.outputs['Color'], mask), mask


def skin_mat():
    m, nt = new_mat('Warden_SkinProc', rough=0.55)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    mott = nt.noise(co, scale=16, detail=8)
    c = nt.ramp(mott.outputs['Fac'], [(0.3, (0.30, 0.17, 0.13, 1)), (0.7, (0.40, 0.25, 0.19, 1))]).outputs['Color']
    dirt = nt.noise(co, scale=6, detail=6)
    c = nt.mix(c, (0.15, 0.11, 0.08, 1), nt.math('MULTIPLY', dirt.outputs['Fac'], 0.6))
    c, bm_ = blood_layer(nt, co, c, 0.6, 4, 1.2)
    c = with_ao(nt, c, 0.04)
    nt.link(c, b.inputs['Base Color'])
    nt.link(nt.bump(nt.noise(co, scale=500, detail=3).outputs['Fac'], 0.3, 0.001), b.inputs['Normal'])
    return m


def sack_mat():
    m, nt = new_mat('Warden_SackProc', rough=0.95)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    w1 = nt.wave(co, scale=260, distortion=1.2, detail=2, kind='BANDS', direction='X')
    w2 = nt.wave(co, scale=260, distortion=1.2, detail=2, kind='BANDS', direction='Z')
    weave = nt.math('MULTIPLY', w1.outputs['Fac'], w2.outputs['Fac'])
    tone = nt.noise(co, scale=12, detail=6)
    c = nt.ramp(tone.outputs['Fac'], [(0.3, (0.24, 0.18, 0.11, 1)), (0.7, (0.34, 0.26, 0.16, 1))]).outputs['Color']
    c = nt.mix(c, (0.18, 0.13, 0.08, 1), nt.math('MULTIPLY', weave, 0.6))
    # blood soaked from the mouth downward + around the eye holes
    mouth = near_fac(nt, co, (0.0, HC.y - 0.1, HC.z - 0.07), 0.05)
    drip = nt.noise(nt.mapping(co, scale=(8, 8, 1)), scale=4, detail=6)
    mb = nt.math('MULTIPLY', nt.math('GREATER_THAN', nt.math('ADD', mouth, nt.math('MULTIPLY', drip.outputs['Fac'], 0.5)), 0.78), 0.55)
    c = nt.mix(c, (0.07, 0.012, 0.008, 1), nt.math('MULTIPLY', mb, 0.85))
    for (ex, ez) in EYE:
        c = nt.mix(c, (0.05, 0.02, 0.01, 1), nt.math('POWER', near_fac(nt, co, (ex, HC.y - 0.1, HC.z + ez), 0.03), 0.7))
    # crude stitched mouth line
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    line = nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', sep.outputs['Z'], HC.z - 0.055)), 0.0025)
    line = nt.math('MULTIPLY', line, nt.math('LESS_THAN', nt.math('ABSOLUTE', sep.outputs['X']), 0.045))
    stw = nt.wave(co, scale=120, distortion=0, kind='BANDS', direction='X')
    stitch = nt.math('MULTIPLY', nt.math('GREATER_THAN', stw.outputs['Fac'], 0.7),
                     nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', sep.outputs['Z'], HC.z - 0.055)), 0.009))
    stitch = nt.math('MULTIPLY', stitch, nt.math('LESS_THAN', nt.math('ABSOLUTE', sep.outputs['X']), 0.045))
    c = nt.mix(c, (0.02, 0.015, 0.01, 1), nt.math('MAXIMUM', line, stitch))
    c = with_ao(nt, c, 0.03)
    nt.link(c, b.inputs['Base Color'])
    nt.link(nt.bump(nt.math('ADD', weave, nt.math('MULTIPLY', stitch, 0.8)), 0.6, 0.002), b.inputs['Normal'])
    return m


def cloth_mat(name, c1, c2, blood=0.66, rough=0.85, weave_scale=500):
    m, nt = new_mat(name, rough=rough)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    tone = nt.noise(co, scale=6, detail=7)
    c = nt.ramp(tone.outputs['Fac'], [(0.3, (*c1, 1)), (0.7, (*c2, 1))]).outputs['Color']
    grime = nt.noise(co, scale=3, detail=8, distortion=0.5)
    c = nt.mix(c, (0.1, 0.08, 0.06, 1), nt.math('MULTIPLY', grime.outputs['Fac'], 0.55))
    c, bm_ = blood_layer(nt, co, c, blood, 3.2, 2.0)
    c = with_ao(nt, c, 0.06)
    nt.link(c, b.inputs['Base Color'])
    nt.link(nt.math('SUBTRACT', rough, nt.math('MULTIPLY', bm_, 0.4)), b.inputs['Roughness'])
    w1 = nt.wave(co, scale=weave_scale, distortion=0, kind='BANDS', direction='X')
    w2 = nt.wave(co, scale=weave_scale, distortion=0, kind='BANDS', direction='Z')
    h = nt.math('ADD', nt.math('MULTIPLY', w1.outputs['Fac'], 0.3), nt.math('MULTIPLY', w2.outputs['Fac'], 0.3))
    nt.link(nt.bump(h, 0.25, 0.002), b.inputs['Normal'])
    return m


def leather_mat(name, col, blood=0.55):
    m, nt = new_mat(name, rough=0.55)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    grain = nt.voronoi(co, scale=160)
    tone = nt.noise(co, scale=5, detail=6)
    c = nt.ramp(tone.outputs['Fac'], [(0.3, (col[0] * 0.7, col[1] * 0.7, col[2] * 0.7, 1)), (0.7, (*col, 1))]).outputs['Color']
    scuff = nt.noise(co, scale=25, detail=6)
    c = nt.mix(c, (col[0] * 1.6, col[1] * 1.5, col[2] * 1.4, 1), nt.math('MULTIPLY', nt.math('GREATER_THAN', scuff.outputs['Fac'], 0.66), 0.5))
    c, bm_ = blood_layer(nt, co, c, blood, 2.6, 2.5)
    c = with_ao(nt, c, 0.05)
    nt.link(c, b.inputs['Base Color'])
    nt.link(nt.math('SUBTRACT', 0.6, nt.math('MULTIPLY', bm_, 0.35)), b.inputs['Roughness'])
    nt.link(nt.bump(nt.math('ADD', grain.outputs['Distance'], nt.math('MULTIPLY', scuff.outputs['Fac'], 0.3)), 0.3, 0.002), b.inputs['Normal'])
    return m


def metal_mat(name, rust=0.5):
    m, nt = new_mat(name, rough=0.4, metal=1.0)
    b = nt.bsdf(); co = nt.tex_coord('Object')
    rn = nt.noise(co, scale=40, detail=8, distortion=0.4)
    rm = nt.math('GREATER_THAN', rn.outputs['Fac'], 1 - rust * 0.6)
    c = nt.mix((0.42, 0.42, 0.43, 1), (0.25, 0.11, 0.05, 1), rm)
    c, bm_ = blood_layer(nt, co, c, 0.6, 18, 1.0)
    nt.link(c, b.inputs['Base Color'])
    nt.link(nt.math('SUBTRACT', 1.0, nt.math('MULTIPLY', nt.math('MAXIMUM', rm, bm_), 1.0)), b.inputs['Metallic'])
    nt.link(nt.math('ADD', 0.35, nt.math('MULTIPLY', rm, 0.5)), b.inputs['Roughness'])
    nt.link(nt.bump(rn.outputs['Fac'], 0.4, 0.001), b.inputs['Normal'])
    return m


body = join([body, head], 'Warden_Body')
assign(body, skin_mat())
assign(sack, sack_mat())
rope_m = cloth_mat('Warden_RopeProc', (0.36, 0.3, 0.2), (0.45, 0.38, 0.26), blood=0.75, weave_scale=900)
assign(rope, rope_m)
sack = join([sack, rope], 'Warden_Sack')
assign(shirt, cloth_mat('Warden_ShirtProc', (0.36, 0.33, 0.26), (0.28, 0.25, 0.19), blood=0.62))
assign(cuffs[0], shirt.data.materials[0]); assign(cuffs[1], shirt.data.materials[0])
shirt = join([shirt] + cuffs, 'Warden_Shirt')
assign(pants, cloth_mat('Warden_PantsProc', (0.16, 0.13, 0.10), (0.22, 0.18, 0.13), blood=0.7, weave_scale=350))
assign(boots, leather_mat('Warden_BootsProc', (0.07, 0.05, 0.04), blood=0.7))
assign(belt, leather_mat('Warden_BeltProc', (0.12, 0.07, 0.04), blood=0.8))
assign(straps[0], belt.data.materials[0])
assign(apron, leather_mat('Warden_ApronProc', (0.20, 0.12, 0.07), blood=0.12))
clothes = join([shirt, pants, boots, belt], 'Warden_Clothes')
apron = join([apron] + straps, 'Warden_Apron')
assign(cleaver, metal_mat('Warden_CleaverProc', 0.4))
cleaver.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.3
wood, ntw = new_mat('Warden_WoodProc', color=(0.14, 0.08, 0.04, 1), rough=0.6)
assign(chain, metal_mat('Warden_ChainProc', 0.8))
em, nte = new_mat('Warden_EyeMat', color=(0.2, 0.05, 0.02, 1), rough=0.3)
nte.bsdf().inputs['Emission Color'].default_value = (0.9, 0.22, 0.05, 1)
nte.bsdf().inputs['Emission Strength'].default_value = 1.4
assign(eyes, em)

result = {"body": len(body.data.vertices), "clothes": len(clothes.data.vertices), "apron": len(apron.data.vertices),
          "chain": len(chain.data.vertices)}
if CFG.get('preview', True):
    result['p1'] = preview('warden_front.png', target=(0, 0, 1.1), cam=(0.8, -3.8, 1.6), lens=40)
    result['p2'] = preview('warden_face.png', target=(0, 0, HC.z - 0.03), cam=(0.2, -0.9, HC.z + 0.05), lens=55,
                           res=(720, 720))

exec(open("D:/Web Based - Horror Game/tools/blender/warden_rig.py").read())
