# Exterior set for the escape cutscene -> public/models/exterior.glb
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/props_lib.py").read())
reset_scene()
CFG = globals().get('CFG', {})
TAU = math.tau
R90 = math.radians(90)
rnd = random.Random(404)

# ============================================================== MANSION SHELL (front facade at y=0 facing -Y, x in [-20,20], depth 30)
r = root('Mansion')
MW, MD, FH = 40.0, 30.0, 3.6
H2 = FH * 2 + 0.4
# walls with window & door openings cut via booleans
walls = rbox('mwalls', (MW, MD, H2), (0, MD / 2, H2 / 2), bevel=0.0)
cutters = []
WIN_W, WIN_H = 1.3, 2.1
win_slots = []
for fl in (0, 1):
    zc = fl * FH + 1.0 + WIN_H / 2 + 0.2
    for x in [-17 + k * 3.4 for k in range(11)]:
        if fl == 0 and abs(x) < 2.5:
            continue
        win_slots.append(('front', x, zc))
        cutters.append(rbox('cut', (WIN_W, 1.0, WIN_H), (x, 0, zc), bevel=0.0))
    for y in [4 + k * 3.6 for k in range(7)]:
        for side in (-1, 1):
            win_slots.append(('side', side, y, zc))
            cutters.append(rbox('cut', (1.0, WIN_W, WIN_H), (side * MW / 2, y, zc), bevel=0.0))
door_cut = rbox('dcut', (2.4, 1.0, 3.0), (0, 0, 1.5 + 0.6), bevel=0.0)
cutters.append(door_cut)
for c in cutters:
    bm_ = walls.modifiers.new('b', 'BOOLEAN'); bm_.object = c; bm_.operation = 'DIFFERENCE'; bm_.solver = 'FLOAT'
apply_modifiers(walls)
for c in cutters:
    bpy.data.objects.remove(c, do_unlink=True)
walls.location.z = 0.6; apply_transform(walls)
part(walls, 'brick', r, 2.0, smooth=False)
plinth = rbox('plinth', (MW + 0.3, MD + 0.3, 0.8), (0, MD / 2, 0.4), bevel=0.02); part(plinth, 'stone_floor', r, 1.0, smooth=False)
for z in (FH + 0.6, H2 + 0.6):
    corn = molding('cornice', [(-MW / 2 - 0.2, -0.2, z), (MW / 2 + 0.2, -0.2, z), (MW / 2 + 0.2, MD + 0.2, z),
                               (-MW / 2 - 0.2, MD + 0.2, z)],
                   [(0.0, -0.15), (0.15, -0.1), (0.2, 0.0), (0.3, 0.1), (0.3, 0.2), (0.0, 0.2)], closed=True)
    part(corn, 'stone_floor', r, 1.0)
# windows: frames, sills, pediments, shutters, glass (some lit)
fr_parts, glow_parts, dark_parts, sh_parts = [], [], [], []
for slot in win_slots:
    if slot[0] == 'front':
        _, x, zc = slot
        z = zc + 0.6
        fr_parts.append(molding('wf', [(x - WIN_W / 2, -0.05, z - WIN_H / 2), (x + WIN_W / 2, -0.05, z - WIN_H / 2),
                                       (x + WIN_W / 2, -0.05, z + WIN_H / 2), (x - WIN_W / 2, -0.05, z + WIN_H / 2)],
                                [(-0.12, 0.0), (0.0, 0.0), (0.0, 0.08), (-0.12, 0.08)], closed=True))
        fr_parts.append(rbox('sill', (WIN_W + 0.3, 0.25, 0.1), (x, -0.12, z - WIN_H / 2 - 0.05), bevel=0.01))
        fr_parts.append(rbox('ped', (WIN_W + 0.4, 0.2, 0.18), (x, -0.1, z + WIN_H / 2 + 0.12), bevel=0.02))
        fr_parts.append(rbox('mul', (0.05, 0.05, WIN_H), (x, -0.02, z), bevel=0.0))
        fr_parts.append(rbox('mul', (WIN_W, 0.05, 0.05), (x, -0.02, z + 0.25), bevel=0.0))
        gp = rbox('glass', (WIN_W, 0.02, WIN_H), (x, 0.08, z), bevel=0.0)
        (glow_parts if rnd.random() < 0.18 else dark_parts).append(gp)
        for s in (-1, 1):
            sh = rbox('shutter', (0.6, 0.04, WIN_H + 0.1), (x + s * (WIN_W / 2 + 0.34), -0.06, z), bevel=0.01,
                      rot=(0, 0, s * rnd.uniform(0, 0.25)))
            sh_parts.append(sh)
    else:
        _, side, y, zc = slot
        z = zc + 0.6
        xw = side * MW / 2
        fr_parts.append(rbox('sill', (0.25, WIN_W + 0.3, 0.1), (xw + side * 0.12, y, z - WIN_H / 2 - 0.05), bevel=0.01))
        fr_parts.append(rbox('ped', (0.2, WIN_W + 0.4, 0.18), (xw + side * 0.1, y, z + WIN_H / 2 + 0.12), bevel=0.02))
        gp = rbox('glass', (0.02, WIN_W, WIN_H), (xw - side * 0.08, y, z), bevel=0.0)
        (glow_parts if rnd.random() < 0.12 else dark_parts).append(gp)
part(join(fr_parts, 'mframes'), 'stone_floor', r, 1.0, smooth=False)
part(join(sh_parts, 'mshutters'), 'wood_old', r, 1.0, smooth=False)
part(join(glow_parts, 'Mansion_LitWindows'), 'window_glow', r, 1.0, smooth=False)
part(join(dark_parts, 'mdark'), 'glass', r, 1.0, smooth=False)
# portico: steps, columns, entablature, pediment
steps = [rbox('step', (7.0 - k * 0.5, 0.45, 0.2), (0, -4.2 + k * 0.45, 0.1 + k * 0.2), bevel=0.01) for k in range(4)]
steps.append(rbox('porch', (7.0, 3.4, 0.2), (0, -1.7, 0.7), bevel=0.01))
part(join(steps, 'msteps'), 'stone_floor', r, 1.0, smooth=False)
cols = []
for x in (-3.0, -1.4, 1.4, 3.0):
    c_ = turned('col', [(0.34, 0), (0.34, 0.2), (0.28, 0.3), (0.26, 0.4), (0.22, 5.4), (0.28, 5.6), (0.36, 5.75), (0.36, 5.9)],
                seg=20)
    c_.location = (x, -3.0, 0.8); apply_transform(c_); cols.append(c_)
part(join(cols, 'mcols'), 'marble', r, 1.0)
ent = rbox('entab', (7.4, 3.8, 0.6), (0, -1.6, 7.0), bevel=0.02)
ped_v = [(-3.9, -3.5, 7.3), (3.9, -3.5, 7.3), (0, -3.5, 8.8), (-3.9, 0.2, 7.3), (3.9, 0.2, 7.3), (0, 0.2, 8.8)]
pedm = mesh_obj('pediment', ped_v, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
recalc_normals(pedm)
part(join([ent, pedm], 'mportico'), 'stone_floor', r, 1.0, smooth=False)
# hipped roof
RB = H2 + 0.6
rv = [(-MW / 2 - 0.5, -0.5, RB), (MW / 2 + 0.5, -0.5, RB), (MW / 2 + 0.5, MD + 0.5, RB), (-MW / 2 - 0.5, MD + 0.5, RB),
      (-MW / 2 + 12, MD / 2, RB + 6), (MW / 2 - 12, MD / 2, RB + 6)]
roof = mesh_obj('roof', rv, [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4), (3, 2, 1, 0)])
recalc_normals(roof)
part(roof, 'roof_slate', r, 2.0, smooth=False)
chim = []
for (x, y) in ((-12, 6), (12, 6), (-12, 24), (12, 24)):
    chim.append(rbox('chim', (1.2, 1.0, 5.0), (x, y, RB + 3.5), bevel=0.02))
    chim.append(rbox('chimcap', (1.5, 1.3, 0.2), (x, y, RB + 6.05), bevel=0.02))
part(join(chim, 'mchim'), 'brick', r, 1.0, smooth=False)
dormers = []
for x in (-8, 0, 8):
    dormers.append(rbox('dorm', (1.6, 2.0, 1.8), (x, 1.8, RB + 1.3), bevel=0.02))
part(join(dormers, 'mdorm'), 'roof_slate', r, 1.0, smooth=False)
dg = [rbox('dglass', (1.0, 0.02, 1.1), (x, 0.79, RB + 1.3), bevel=0.0) for x in (-8, 0, 8)]
part(join(dg, 'Mansion_DormerGlass'), 'window_glow', r, 1.0, smooth=False)
tag = bpy.data.objects.new('Mansion_Door', None); link(tag); tag.location = (0, 0.0, 0.8); tag.parent = r

# ============================================================== DEAD TREES (recursive branching)
def branch(pts_out, start, direction, length, radius, depth, rng):
    pts = [start]
    d = direction.normalized()
    n = 6
    for i in range(n):
        d = (d + V((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), rng.uniform(-0.1, 0.25)))).normalized()
        pts.append(pts[-1] + d * (length / n))
    radii = [radius * (1 - 0.75 * i / n) for i in range(n + 1)]
    pts_out.append(tube_along('br', pts, radii, seg=max(4, int(8 * radius / 0.2) + 4), cap=True))
    if depth <= 0 or radius < 0.015:
        return
    for k in range(rng.randint(2, 3)):
        idx = rng.randint(2, n)
        nd = (d + V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.0, 0.8)))).normalized()
        branch(pts_out, pts[idx], nd, length * rng.uniform(0.5, 0.75), radii[idx] * 0.75, depth - 1, rng)


for ti in range(3):
    r = root(f'DeadTree{ti}')
    rng = random.Random(10 + ti)
    parts_ = []
    branch(parts_, V((0, 0, -0.2)), V((0, 0, 1)), rng.uniform(4.5, 6.5), rng.uniform(0.28, 0.4), 4, rng)
    for k in range(5):
        a = k / 5 * TAU
        root_ = tube_along('root', [V((0, 0, 0.3)), V((0.5 * math.cos(a), 0.5 * math.sin(a), 0.05)),
                                    V((1.1 * math.cos(a), 1.1 * math.sin(a), -0.15))], [0.2, 0.1, 0.03], seg=6)
        parts_.append(root_)
    tr = join(parts_, f'DeadTree{ti}_Wood')
    displace_noise(tr, 0.02, 0.15)
    part(tr, 'bark', r, 1.0)

# ============================================================== FENCE, GATE PILLAR, IRON GATE, LAMP POST
r = root('FenceSection')      # 2.5 m section along X
rails = [cyl('rail', 0.018, 2.5, (0, 0, z), seg=8, rot=(0, R90, 0)) for z in (0.25, 1.6)]
pick = []
for k in range(12):
    x = -1.15 + k * 0.21
    pick.append(cyl('pk', 0.012, 1.9, (x, 0, 0.95), seg=6))
    tip = turned('tip', [(0.0, 0), (0.035, 0.03), (0.02, 0.07), (0.0, 0.14)], seg=6); tip.location = (x, 0, 1.9)
    apply_transform(tip); pick.append(tip)
post = turned('fpost', [(0.05, 0), (0.05, 2.0), (0.07, 2.05), (0.0, 2.2)], seg=8); post.location = (1.25, 0, 0); apply_transform(post)
part(join(rails + pick + [post], 'fence'), 'iron', r, 0.5)

r = root('GatePillar')
part(rbox('gpbody', (0.8, 0.8, 2.8), (0, 0, 1.4), bevel=0.02), 'stone_floor', r, 1.0, smooth=False)
part(rbox('gpcap', (1.0, 1.0, 0.2), (0, 0, 2.9), bevel=0.03), 'stone_floor', r, 1.0, smooth=False)
orb = turned('gporb', [(0.0, 0), (0.2, 0), (0.12, 0.08), (0.25, 0.35), (0.12, 0.6), (0.0, 0.62)], seg=20)
orb.location = (0, 0, 3.0); apply_transform(orb); part(orb, 'stone_floor', r, 1.0)

r = root('IronGateLeaf')       # 2.0 wide, hinge at x=0
g = [cyl('gbar', 0.02, 2.0, (1.0, 0, z), seg=8, rot=(0, R90, 0)) for z in (0.3, 1.2)]
for k in range(10):
    x = 0.1 + k * 0.2
    top = 2.4 + 0.4 * math.sin(x / 2.0 * math.pi)
    g.append(cyl('gp', 0.015, top, (x, 0, top / 2), seg=6))
    tip = turned('gtip', [(0.0, 0), (0.04, 0.03), (0.025, 0.08), (0.0, 0.16)], seg=6); tip.location = (x, 0, top); apply_transform(tip)
    g.append(tip)
for k in range(4):
    sc_ = prim('torus', 'scroll', R=0.16, r=0.012, u=20, v=6); sc_.rotation_euler = (R90, 0, 0)
    sc_.location = (0.3 + k * 0.45, 0, 0.75); apply_transform(sc_); g.append(sc_)
g.append(cyl('ghinge', 0.04, 2.6, (0, 0, 1.3), seg=10))
part(join(g, 'IronGateLeaf_Metal'), 'iron', r, 0.5)

r = root('LampPost')
part(turned('lp', [(0.0, 0), (0.2, 0), (0.18, 0.1), (0.08, 0.3), (0.06, 0.4), (0.05, 3.0), (0.08, 3.05), (0.1, 3.1), (0.0, 3.1)],
            seg=12), 'iron', r, 0.5)
cage = [rbox('lpc', (0.04, 0.04, 0.5), (sx * 0.16, sy * 0.16, 3.4), bevel=0.0) for sx in (-1, 1) for sy in (-1, 1)]
cage.append(turned('lptop', [(0.25, 0), (0.12, 0.2), (0.0, 0.35)], seg=4, rot=(0, 0, math.radians(45))))
cage[-1].location = (0, 0, 3.65); apply_transform(cage[-1])
cage.append(rbox('lpb', (0.36, 0.36, 0.06), (0, 0, 3.15), bevel=0.01))
part(join(cage, 'lpcage'), 'iron', r, 0.5)
lg = rbox('lpglass', (0.3, 0.3, 0.45), (0, 0, 3.4), bevel=0.0); part(lg, 'glass', r, 0.5, smooth=False)
bl = prim('uvsphere', 'lpbulb', u=12, v=8, r=0.06, loc=(0, 0, 3.4)); apply_transform(bl); part(bl, 'bulb', r, 0.2)
tag = bpy.data.objects.new('LampPost_Light', None); link(tag); tag.location = (0, 0, 3.4); tag.parent = r

# ============================================================== GRAVESTONES, FOUNTAIN
for gi in range(3):
    r = root(f'Gravestone{gi}')
    if gi == 0:
        s_ = rbox('gs', (0.6, 0.15, 0.9), (0, 0, 0.45), bevel=0.02)
        top = cyl('gst', 0.3, 0.15, (0, 0, 0.9), seg=24, rot=(R90, 0, 0))
        g_ = join([s_, top], 'gstone')
    elif gi == 1:
        g_ = join([rbox('gcv', (0.14, 0.14, 1.2), (0, 0, 0.6), bevel=0.01), rbox('gch', (0.6, 0.14, 0.14), (0, 0, 0.9), bevel=0.01),
                   rbox('gcb', (0.5, 0.4, 0.15), (0, 0, 0.07), bevel=0.01)], 'gstone')
    else:
        g_ = join([turned('ob', [(0.25, 0), (0.25, 0.3), (0.14, 0.35), (0.12, 1.6), (0.0, 1.8)], seg=4)], 'gstone')
    displace_noise(g_, 0.006, 0.05)
    g_.rotation_euler = (rnd.uniform(-0.08, 0.08), rnd.uniform(-0.1, 0.1), 0); apply_transform(g_)
    part(g_, 'concrete', r, 0.6, smooth=False)

r = root('Fountain')
part(lathe('fbasin', [(0.0, 0.0), (2.2, 0.0), (2.3, 0.5), (2.1, 0.55), (2.0, 0.2), (0.0, 0.2)], seg=48), 'stone_floor', r, 1.0)
part(turned('fped', [(0.0, 0), (0.35, 0), (0.25, 0.3), (0.2, 1.2), (0.3, 1.3), (0.0, 1.3)], seg=20), 'stone_floor', r, 1.0)
part(lathe('fbowl', [(0.0, 1.3), (0.9, 1.35), (1.0, 1.55), (0.9, 1.56), (0.8, 1.42), (0.0, 1.4)], seg=36), 'stone_floor', r, 1.0)
wat = cyl('fwater', 2.0, 0.02, (0, 0, 0.3), seg=48); part(wat, 'glass', r, 1.0)

# ============================================================== CAR (dark sedan, lofted body)
r = root('Car')


def loft(name, stations, M=24, n=4.0, taper_top=1.0):
    """stations: [(x, width, z_bottom, z_top)] along X; superellipse rings in YZ."""
    verts, faces = [], []
    for (x, w, zb, zt) in stations:
        cz, hz = (zb + zt) / 2, (zt - zb) / 2
        for k in range(M):
            a = k / M * TAU
            c, s = math.cos(a), math.sin(a)
            yy = math.copysign(abs(c) ** (2 / n), c) * w / 2
            zz = math.copysign(abs(s) ** (2 / n), s) * hz
            if zz > 0:
                yy *= 1 - (1 - taper_top) * (zz / hz)
            verts.append((x, yy, cz + zz))
    ns = len(stations)
    for i in range(ns - 1):
        for k in range(M):
            k2 = (k + 1) % M
            faces.append((i * M + k, i * M + k2, (i + 1) * M + k2, (i + 1) * M + k))
    faces.append(tuple(range(M - 1, -1, -1)))
    faces.append(tuple((ns - 1) * M + k for k in range(M)))
    o = mesh_obj(name, verts, faces)
    recalc_normals(o)
    return o


body_st = [(-2.35, 1.5, 0.35, 0.72), (-2.25, 1.72, 0.3, 0.86), (-1.9, 1.8, 0.28, 0.93), (-0.9, 1.82, 0.28, 0.98),
           (0.5, 1.82, 0.28, 1.0), (1.7, 1.8, 0.28, 0.98), (2.2, 1.74, 0.32, 0.95), (2.35, 1.5, 0.4, 0.85)]
body = loft('carbody', body_st, M=32, n=5.0)
add_subsurf(body, 1)
# wheel arches
for x in (-1.45, 1.45):
    for s in (-1, 1):
        push(body, (x, s * 0.92, 0.38), 0.18, -0.12, (1.3, 1, 1.1), (0, s, 0))
part(body, 'carpaint', r, 1.0)
cabin_st = [(-0.95, 1.6, 0.95, 1.0), (-0.55, 1.52, 0.95, 1.43), (0.9, 1.5, 0.95, 1.44), (1.45, 1.52, 0.95, 1.0)]
cabin = loft('carcabin', cabin_st, M=24, n=6.0, taper_top=0.86)
part(cabin, 'glass', r, 1.0)
roof_ = loft('carroof', [(-0.55, 1.3, 1.415, 1.46), (0.92, 1.28, 1.42, 1.465)], M=20, n=8)
pillars = [rbox('pil', (0.07, 0.07, 0.52), (x, sy * 0.71, 1.19), bevel=0.02, rot=(0, ang, 0)) for (x, ang) in ((-0.76, 0.75), (0.2, 0.0), (1.18, -0.6)) for sy in (-1, 1)]
part(join([roof_] + pillars, 'carroofj'), 'carpaint', r, 1.0)
wheels = []
for x in (-1.45, 1.45):
    for s in (-1, 1):
        tire = lathe('tire', [(0.2, -0.11), (0.32, -0.11), (0.35, -0.07), (0.35, 0.07), (0.32, 0.11), (0.2, 0.11)], seg=28)
        tire.rotation_euler = (R90, 0, 0); tire.location = (x, s * 0.8, 0.35); apply_transform(tire); wheels.append(tire)
part(join(wheels, 'Car_Tires'), 'rubber', r, 0.5)
rims = []
for x in (-1.45, 1.45):
    for s in (-1, 1):
        rim = turned('rim', [(0.0, 0), (0.21, 0), (0.2, 0.03), (0.08, 0.05), (0.0, 0.06)], seg=24, rot=(-R90 * s, 0, 0))
        rim.location = (x, s * 0.9, 0.35); apply_transform(rim); rims.append(rim)
chrome = rims + [rbox('bumpF', (0.12, 1.75, 0.14), (-2.38, 0, 0.42), bevel=0.05), rbox('bumpR', (0.12, 1.75, 0.14), (2.4, 0, 0.45), bevel=0.05)]
grille = [rbox('grille', (0.04, 0.9, 0.25), (-2.34, 0, 0.66), bevel=0.01)]
grille += [rbox('gbar', (0.05, 0.9, 0.015), (-2.35, 0, 0.56 + k * 0.04), bevel=0.0) for k in range(6)]
for s in (-1, 1):
    chrome.append(rbox('mirror', (0.1, 0.16, 0.1), (-0.8, s * 0.95, 1.05), bevel=0.02))
part(join(chrome + grille, 'Car_Chrome'), 'chrome', r, 0.5)
hl = []
for s in (-1, 1):
    h_ = cyl('hl', 0.1, 0.05, (-2.33, s * 0.62, 0.72), seg=20, rot=(0, R90, 0)); hl.append(h_)
part(join(hl, 'Car_Headlights'), 'headlight', r, 0.5)
tl = [rbox('tl', (0.05, 0.25, 0.12), (2.38, s * 0.65, 0.78), bevel=0.01) for s in (-1, 1)]
part(join(tl, 'Car_Taillights'), 'taillight', r, 0.5)
for s in (-1, 1):
    tag = bpy.data.objects.new(f'Car_HeadlightL' if s > 0 else 'Car_HeadlightR', None); link(tag)
    tag.location = (-2.4, s * 0.62, 0.72); tag.parent = r
plate = rbox('plate', (0.02, 0.5, 0.12), (2.46, 0, 0.55), bevel=0.0); part(plate, 'paper', r, 0.3)
# driver door (left side, +Y is left in this frame since front is -X) hinged at the front edge
door = loft('cardoor', [(-0.55, 0.06, 0.4, 1.0), (0.45, 0.06, 0.4, 1.0)], M=12, n=6)
door.location = (0, 0.9, 0); apply_transform(door)
door = join([door], 'Car_Door'); pivot(door, (-0.55, 0.93, 0.7)); part(door, 'carpaint', r, 1.0)
seats = [rbox('seat', (0.55, 0.55, 0.18), (x, s * 0.38, 0.55), bevel=0.05) for x in (-0.2, 0.7) for s in (-1, 1)]
seats += [rbox('seatb', (0.12, 0.55, 0.6), (x + 0.3, s * 0.38, 0.85), bevel=0.05) for x in (-0.2,) for s in (-1, 1)]
part(join(seats, 'carseats'), 'leather', r, 0.5)
wheel_ = prim('torus', 'steer', R=0.18, r=0.018, u=24, v=6); wheel_.rotation_euler = (0, math.radians(60), 0)
wheel_.location = (-0.55, 0.38, 1.0); apply_transform(wheel_); part(wheel_, 'rubber', r, 0.3)
seat_tag = bpy.data.objects.new('Car_DriverSeat', None); link(seat_tag); seat_tag.location = (-0.2, 0.38, 0.6); seat_tag.parent = r

result = {"roots": [x.name for x in ROOTS]}
if CFG.get('preview', True):
    # show only small props in the layout preview (mansion is huge)
    mans = bpy.data.objects['Mansion']
    ROOTS.remove(mans)
    result['p'] = layout_preview('exterior.png', spacing=6.0, cam_h=10, lens=28)
    ROOTS.append(mans)
    result['p2'] = preview('mansion.png', target=(0, 10, 5), cam=(14, -34, 10), lens=35, res=(1280, 720), world=0.08,
                           lights=[((20, -30, 30), 60000, (0.7, 0.8, 1.0)), ((-20, -20, 10), 20000, (1, 0.9, 0.8))])
if CFG.get('export', False):
    result['export'] = export_roots('exterior.glb')
