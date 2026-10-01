# EVELYN HART - stage C: eyes (iris/sclera/cornea), eyelashes, eyebrows, mouth interior (teeth, tongue).
import bpy
bpy.ops.wm.open_mainfile(filepath=r"D:\Web Based - Horror Game\tools\blender\evelyn_stageB.blend")
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/props_lib.py").read())
import numpy as np
from mathutils.bvhtree import BVHTree

CFG = globals().get('CFG', {})
STAGE_C = r"D:\Web Based - Horror Game\tools\blender\evelyn_stageC.blend"
TEX = os.path.join(PROJECT, "tools", "blender", "_bake", "evelyn")
body = bpy.data.objects['Evelyn_Body']
eyeL, eyeR = bpy.data.objects['Evelyn_Eye.L'], bpy.data.objects['Evelyn_Eye.R']
for n in [o.name for o in bpy.data.objects if o.name.startswith(('Evelyn_Lash', 'Evelyn_Brow', 'Evelyn_Cornea', 'Evelyn_Teeth', 'Evelyn_Mouth', 'Evelyn_Tongue'))]:
    bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)

def centroid(o):
    return sum((o.matrix_world @ v.co for v in o.data.vertices), V((0, 0, 0))) / len(o.data.vertices)
EC = {'L': centroid(eyeL), 'R': centroid(eyeR)}
ER = max(eyeL.dimensions) / 2
result = {"eye_centers": {k: [round(x, 4) for x in v] for k, v in EC.items()}, "eye_r": round(ER, 4)}

# relaxed lids: the base mesh stares wide open; roll the upper lid down around the eyeball like a slight blink
from mathutils import Matrix as _M
for k in ('L', 'R'):
    c = EC[k]
    for v in body.data.vertices:
        d = v.co - c
        if d.length > ER * 2.0 or d.y > -ER * 0.15:
            continue
        w = math.exp(-((d.length - ER) / (ER * 0.55)) ** 2) * min(1.0, max(0.0, (-d.y - ER * 0.15) / (ER * 0.5)))
        if d.z > ER * 0.05:
            ang = -math.radians(5.0) * w         # upper lid down ~1 mm (relaxed: lid slightly over the iris)
        elif d.z < -ER * 0.25:
            ang = math.radians(1.5) * w          # lower lid slightly up
        else:
            continue
        R = _M.Rotation(-ang, 3, 'X')            # rotating -Y (front) toward -Z
        v.co = c + R @ d
body.data.update()

# head surface BVH (low mesh, world space)
tree, _bm = bvh_from([body])

# =========================================================================== EYES
def eye_material():
    m, nt = new_mat('Evelyn_Eye', rough=0.2)
    b = nt.bsdf()
    co = nt.tex_coord('Object')
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])
    # mirror-symmetric eye-local coordinates: (|x| - cx, y - cy, z - cz)
    ex = nt.math('SUBTRACT', nt.math('ABSOLUTE', sep.outputs['X']), abs(EC['L'].x))
    ey = nt.math('SUBTRACT', sep.outputs['Y'], EC['L'].y)
    ez = nt.math('SUBTRACT', sep.outputs['Z'], EC['L'].z)
    rr = nt.math('SQRT', nt.math('ADD', nt.math('MULTIPLY', ex, ex), nt.math('MULTIPLY', ez, ez)))
    front = nt.math('LESS_THAN', ey, -ER * 0.35)
    IR, PR = ER * 0.48, ER * 0.17
    ang = nt.math('ARCTAN2', ez, ex)
    comb = nt.node('ShaderNodeCombineXYZ')
    nt.link(nt.math('MULTIPLY', ang, 6.0), comb.inputs[0]); nt.link(nt.math('MULTIPLY', rr, 900.0), comb.inputs[1])
    fib = nt.noise(comb.outputs['Vector'], scale=4.0, detail=8, rough=0.6)
    fib2 = nt.noise(comb.outputs['Vector'], scale=11.0, detail=4)
    t = nt.math('DIVIDE', rr, IR)                       # 0 centre .. 1 limbus
    # hazel: amber/brown around the pupil fading to moss green, dark limbal ring
    inner = nt.ramp(fib.outputs['Fac'], [(0.3, (0.22, 0.12, 0.04, 1)), (0.7, (0.42, 0.25, 0.08, 1))]).outputs['Color']
    outer = nt.ramp(fib2.outputs['Fac'], [(0.3, (0.12, 0.17, 0.08, 1)), (0.7, (0.24, 0.30, 0.14, 1))]).outputs['Color']
    iris = nt.mix(inner, outer, nt.math('POWER', nt.math('MINIMUM', nt.math('MAXIMUM', nt.math('SUBTRACT', t, 0.35), 0.0), 1.0), 0.8))
    iris = nt.mix(iris, (0.02, 0.025, 0.02, 1), nt.math('POWER', nt.math('MINIMUM', nt.math('MAXIMUM', nt.math('SUBTRACT', t, 0.82), 0.0), 1.0), 0.5))  # limbal ring
    iris = nt.mix(iris, (0.45, 0.33, 0.18, 1), nt.math('MULTIPLY', nt.math('GREATER_THAN', fib2.outputs['Fac'], 0.68), 0.35))           # crypts/flecks
    # sclera: warm off-white, pinker toward the corners, faint veins
    vn = nt.noise(co, scale=420, detail=4, distortion=1.6)
    veins = nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', vn.outputs['Fac'], 0.5)), 0.01)
    side = nt.math('MINIMUM', nt.math('DIVIDE', rr, ER), 1.0)
    scl = nt.mix((0.78, 0.74, 0.70, 1), (0.74, 0.55, 0.52, 1), nt.math('POWER', side, 3.0))
    scl = nt.mix(scl, (0.55, 0.12, 0.10, 1), nt.math('MULTIPLY', veins, nt.math('MULTIPLY', side, 0.55)))
    isIris = nt.math('MULTIPLY', nt.math('LESS_THAN', rr, IR), front)
    col = nt.mix(scl, iris, isIris)
    isPupil = nt.math('MULTIPLY', nt.math('LESS_THAN', rr, PR), front)
    col = nt.mix(col, (0.005, 0.005, 0.006, 1), isPupil)
    nt.link(col, b.inputs['Base Color'])
    nt.link(nt.bump(nt.math('MULTIPLY', fib.outputs['Fac'], isIris), 0.15, 0.0003), b.inputs['Normal'])
    return m

em = eye_material()
for e in (eyeL, eyeR):
    e.data.materials.clear(); e.data.materials.append(em)
    shade_smooth(e)

# cornea: a slightly larger clear shell with a bulge over the iris (wet highlight + refraction look)
corneas = []
for k, e in (('L', eyeL), ('R', eyeR)):
    c = EC[k]
    s_ = prim('uvsphere', f'Evelyn_Cornea.{k}', u=40, v=24, r=ER * 1.025)
    for v in s_.data.vertices:
        d = v.co.normalized()
        f = max(0.0, -d.y - 0.75) / 0.25                 # cap facing -Y
        v.co += d * ER * 0.08 * f * f
    s_.data.update()
    bm = bmesh.new(); bm.from_mesh(s_.data)
    bmesh.ops.delete(bm, geom=[vv for vv in bm.verts if vv.co.normalized().y > -0.2], context='VERTS')
    bm.to_mesh(s_.data); bm.free()
    s_.location = c; apply_transform(s_); shade_smooth(s_)
    corneas.append(s_)
cm, cnt = new_mat('Evelyn_Cornea', color=(1, 1, 1, 1), rough=0.02)
cnt.bsdf().inputs['Transmission Weight'].default_value = 1.0
cnt.bsdf().inputs['IOR'].default_value = 1.376
for s_ in corneas:
    assign(s_, cm)

# =========================================================================== EYELID MARGINS
def margin_points(k):
    c = EC[k]
    pts = []
    for v in body.data.vertices:
        p = body.matrix_world @ v.co
        d = (p - c).length
        if ER * 0.97 < d < ER * 1.10 and (p.y - c.y) < -ER * 0.40:
            pts.append(p)
    upper = [p for p in pts if p.z - c.z > -ER * 0.05]
    lower = [p for p in pts if p.z - c.z <= -ER * 0.05]
    sgn = 1 if k == 'L' else -1
    key = lambda p: (p.x - c.x) * sgn            # inner corner (toward nose) -> outer corner
    # keep the outermost ring (closest to the eyeball surface) per angular bucket
    def ring(lst):
        buckets = {}
        for p in lst:
            a = round(math.atan2(p.z - c.z, (p.x - c.x) * sgn) / 0.12)
            if a not in buckets or (p - c).length < (buckets[a] - c).length:
                buckets[a] = p
        return sorted(buckets.values(), key=key)
    return ring(upper), ring(lower)

def smooth_resample(pts, n):
    if len(pts) < 2:
        return pts
    # chordal resample to n points
    L = [0.0]
    for i in range(1, len(pts)):
        L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    out = []
    for j in range(n):
        t = L[-1] * j / (n - 1)
        i = max(1, next((q for q in range(1, len(L)) if L[q] >= t), len(L) - 1))
        f = (t - L[i - 1]) / max(L[i] - L[i - 1], 1e-9)
        out.append(pts[i - 1].lerp(pts[i], f))
    return out

def lash_strip(name, pts, c, upper, lengths):
    verts, faces, uvs = [], [], []
    n = len(pts)
    SEG = 4
    for i, p in enumerate(pts):
        out = (p - c).normalized()
        up = V((0, 0, 1)) if upper else V((0, 0, -1))
        fwd = V((0, -1, 0))
        L = lengths(i / (n - 1))
        base = p + out * 0.00025 + V((0, -0.0002, 0))
        d0 = (out * 0.35 + fwd * 0.55 + up * 0.25).normalized()
        d1 = (out * 0.2 + fwd * 0.25 + up * 0.85).normalized()      # curl upward/outward
        for s in range(SEG + 1):
            f = s / SEG
            dirv = d0.lerp(d1, f).normalized()
            q = base + (d0 * 0.5 + dirv * 0.5) * L * f
            verts.append(q)
            uvs.append((i / (n - 1), f))
    for i in range(n - 1):
        for s in range(SEG):
            a = i * (SEG + 1) + s
            faces.append((a, a + SEG + 1, a + SEG + 2, a + 1))
    o = mesh_obj(name, verts, faces)
    uvl = o.data.uv_layers.new(name='UVMap')
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[o.data.loops[li].vertex_index]
    shade_smooth(o)
    return o

def lash_image():
    W, H = 1024, 128
    g = np.random.default_rng(3)
    cov = np.zeros((H, W), np.float32)
    ys = np.arange(H, dtype=np.float32)
    X = np.arange(W, dtype=np.float32)[None, :]
    clumps = g.uniform(0, W, 70)
    for i in range(230):
        x0 = g.choice(clumps) + g.normal(0, 5)
        length = g.uniform(0.55, 1.0) * H
        bend = g.uniform(-14, 14)
        w = g.uniform(0.9, 1.8)
        xs = (x0 + bend * (ys / H) ** 2)[:, None]
        taper = np.clip(1 - ys / length, 0, 1)[:, None] ** 0.7
        a = np.clip(1 - np.abs(X - xs) / (w * (0.4 + 0.6 * taper)), 0, 1) * (ys[:, None] < length)
        cov = np.maximum(cov, a * taper ** 0.3 * g.uniform(0.75, 1.0))
    arr = np.zeros((H, W, 4), np.float32)
    arr[..., 0] = 0.02; arr[..., 1] = 0.015; arr[..., 2] = 0.012; arr[..., 3] = cov
    return np_image('evelyn_lash_tex', arr)

lash_img = lash_image()
lash_mat = image_mat('Evelyn_Lash', lash_img, alpha=True, rough=0.4)
lashes = []
for k in ('L', 'R'):
    up, lo = margin_points(k)
    result[f'margin_{k}'] = [len(up), len(lo)]
    if len(up) >= 3:
        up = smooth_resample(up, 28)
        lashes.append(lash_strip(f'Evelyn_LashUp.{k}', up, EC[k], True,
                                 lambda t: 0.0045 + 0.0062 * math.sin(min(1.0, t * 1.15) * math.pi * 0.55 + 0.35) * (1 - 0.35 * max(0, t - 0.85) / 0.15)))
    if len(lo) >= 3:
        lo = smooth_resample(lo, 20)
        lashes.append(lash_strip(f'Evelyn_LashLo.{k}', lo, EC[k], False, lambda t: 0.0018 + 0.0022 * math.sin(t * math.pi)))
for o in lashes:
    assign(o, lash_mat)

# =========================================================================== EYEBROWS
def surface_point(x, z, front_y=-0.3):
    hit = tree.ray_cast(V((x, front_y, z)), V((0, 1, 0)), 0.5)
    return (hit[0], hit[1]) if hit[0] is not None else (None, None)

def brow_image():
    W, H = 1024, 256
    g = np.random.default_rng(9)
    cov = np.zeros((H, W), np.float32)
    shade = np.zeros((H, W), np.float32)
    for i in range(2600):
        u = g.uniform(0, 1)
        x0, y0 = u * W, g.uniform(0.15, 0.85) * H
        # strokes point up/outward near the head of the brow, flatten toward the tail
        ang = math.radians(70 - 55 * u + g.uniform(-10, 10))
        L = g.uniform(14, 34) * (1.1 - 0.4 * u)
        for s_ in np.linspace(0, 1, 18):
            x = int(x0 + math.cos(ang) * L * s_); y = int(y0 + math.sin(ang) * L * s_ * 0.6)
            if 0 <= x < W and 0 <= y < H:
                a = 1 - 0.6 * s_
                cov[y, x] = max(cov[y, x], a)
                if x + 1 < W: cov[y, x + 1] = max(cov[y, x + 1], a * 0.5)
                shade[y, x] = g.uniform(0.6, 1.0)
    # density falloff: fuller in the body, thin at the edges and tail
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    env = np.exp(-((yy / H - 0.5) / 0.3) ** 2) * np.clip(1.25 - xx / W * 0.6, 0, 1) * np.clip(xx / W / 0.08, 0, 1)
    cov = np.clip(cov * env * 1.3, 0, 1)
    arr = np.zeros((H, W, 4), np.float32)
    base = np.array([0.045, 0.026, 0.015], np.float32)
    arr[..., :3] = base * (0.7 + 0.5 * shade[..., None])
    arr[..., 3] = cov
    return np_image('evelyn_brow_tex', arr)

brow_mat = image_mat('Evelyn_Brow', brow_image(), alpha=True, rough=0.5)
brows = []
for k, sgn in (('L', 1), ('R', -1)):
    c = EC[k]
    ctrl = [(0.013, 0.012), (0.023, 0.0175), (0.037, 0.0205), (0.051, 0.018), (0.062, 0.010)]   # (|x| from midline, z above eye centre)
    for layer in range(3):
        verts, faces, uvs = [], [], []
        N = 16
        for j in range(N):
            t = j / (N - 1)
            # catmull-ish interpolation through control points
            fpos = t * (len(ctrl) - 1); i0 = min(int(fpos), len(ctrl) - 2); f = fpos - i0
            x = ctrl[i0][0] + (ctrl[i0 + 1][0] - ctrl[i0][0]) * f
            z = ctrl[i0][1] + (ctrl[i0 + 1][1] - ctrl[i0][1]) * f
            width = (0.0105 - 0.0062 * t) * (1 - 0.12 * layer)
            for side in (-0.5, 0.5):
                wx = sgn * x
                wz = c.z + z + side * width + (layer - 1) * 0.0006
                p, n = surface_point(wx, wz)
                if p is None:
                    p, n = V((wx, c.y - 0.02, wz)), V((0, -1, 0))
                verts.append(p + n * (0.0006 + 0.00035 * layer))
                uvs.append((t, side + 0.5))
        for j in range(N - 1):
            a = j * 2
            faces.append((a, a + 2, a + 3, a + 1))
        o = mesh_obj(f'Evelyn_Brow.{k}{layer}', verts, faces)
        uvl = o.data.uv_layers.new(name='UVMap')
        for poly in o.data.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uvs[o.data.loops[li].vertex_index]
        recalc_normals(o); shade_smooth(o)
        assign(o, brow_mat)
        brows.append(o)

# =========================================================================== MOUTH INTERIOR
MOUTH = V((0.0, -0.148, 1.4891))
mouth_m, mnt = new_mat('Evelyn_Mouth', color=(0.16, 0.035, 0.035, 1), rough=0.35)
bag = prim('uvsphere', 'Evelyn_MouthBag', u=24, v=16, r=1.0)
bag.scale = (0.026, 0.034, 0.016); bag.location = MOUTH + V((0, 0.03, 0.0)); apply_transform(bag)
recalc_normals(bag)
assign(bag, mouth_m)
teeth = []
tm, _ = new_mat('Evelyn_Teeth', color=(0.86, 0.83, 0.76, 1), rough=0.25)
for row, dz in (('U', 0.0045), ('L', -0.0045)):
    for i in range(12):
        a = (i - 5.5) / 5.5 * 1.15
        w = 0.0042 if abs(i - 5.5) < 1 else 0.0036 if abs(i - 5.5) < 2 else 0.0032
        x = math.sin(a) * 0.021
        y = MOUTH.y + 0.0085 + (1 - math.cos(a)) * 0.016
        t_ = rbox(f'tooth{row}{i}', (w, 0.0045, 0.0085 if row == 'U' else 0.0075), (x, y, MOUTH.z + dz + (0.0018 if row == 'U' else -0.0018)),
                  bevel=0.0012, segs=2, rot=(0, 0, -a))
        teeth.append(t_)
teeth_o = join(teeth, 'Evelyn_Teeth'); assign(teeth_o, tm); shade_smooth(teeth_o)
tongue = prim('uvsphere', 'Evelyn_Tongue', u=20, v=12, r=1.0)
tongue.scale = (0.017, 0.026, 0.006); tongue.location = MOUTH + V((0, 0.024, -0.009)); apply_transform(tongue)
tg, _ = new_mat('Evelyn_TongueMat', color=(0.45, 0.13, 0.13, 1), rough=0.35)
assign(tongue, tg); shade_smooth(tongue)

result['lashes'] = [o.name for o in lashes]
result['brows'] = len(brows)
result['p_face'] = preview('ev_face_c.png', target=(0, -0.1, 1.55), cam=(0.12, -0.55, 1.57), lens=75, res=(900, 900), engine='CYCLES',
                           lights=[((0.6, -0.9, 1.9), 40, (1, 0.95, 0.9)), ((-0.8, -0.4, 1.6), 10, (0.7, 0.8, 1.0)), ((0, 0.8, 1.9), 25, (1, 1, 1))])
result['p_eye'] = preview('ev_eye_c.png', target=EC['L'], cam=EC['L'] + V((0.03, -0.14, 0.01)), lens=90, res=(800, 600), engine='CYCLES',
                          lights=[((0.6, -0.9, 1.9), 40, (1, 0.95, 0.9)), ((-0.8, -0.4, 1.6), 10, (0.7, 0.8, 1.0))])
bpy.ops.wm.save_as_mainfile(filepath=STAGE_C)
result['saved'] = STAGE_C
