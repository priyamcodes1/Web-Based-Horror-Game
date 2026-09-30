# Mansion furniture & fixtures -> public/models/furniture.glb (origin on the floor, front = -Y)
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/props_lib.py").read())
reset_scene()
CFG = globals().get('CFG', {})
TAU = math.tau
rnd = random.Random(99)
R90 = math.radians(90)

# ============================================================== BED (four-poster)
r = root('Bed')
W_, L_ = 1.6, 2.1
for (x, y, h) in ((-W_ / 2, -L_ / 2, 1.35), (W_ / 2, -L_ / 2, 1.35), (-W_ / 2, L_ / 2, 2.1), (W_ / 2, L_ / 2, 2.1)):
    p = turned('post', leg_profile(h, 0.05, 0) + [(0.03, h + 0.02), (0.045, h + 0.07), (0.0, h + 0.13)], seg=20)
    p.location = (x, y, 0); apply_transform(p)
    part(p, 'wood_dark', r, 0.5)
for y in (-L_ / 2, L_ / 2):
    rail = rbox('rail', (W_, 0.06, 0.22), (0, y, 0.38), bevel=0.01)
    part(rail, 'wood_dark', r, 0.5)
for x in (-W_ / 2, W_ / 2):
    rail = rbox('siderail', (0.06, L_, 0.2), (x, 0, 0.37), bevel=0.01)
    part(rail, 'wood_dark', r, 0.5)
hb = raised_panel('headboard', W_ - 0.1, 0.9, 0.04, 0.08, loc=(0, L_ / 2, 0.95))
part(hb, 'wood_dark', r, 0.5)
crest = molding('hb_crest', [(-W_ / 2 + 0.05, L_ / 2, 1.42), (W_ / 2 - 0.05, L_ / 2, 1.42)],
                [(-0.05, 0), (0.05, 0), (0.04, 0.03), (0.0, 0.08), (-0.04, 0.03)])
part(crest, 'wood_dark', r, 0.5)
fb = raised_panel('footboard', W_ - 0.1, 0.42, 0.04, 0.06, loc=(0, -L_ / 2, 0.6))
part(fb, 'wood_dark', r, 0.5)
canopy = []
for (a, b) in (((-W_ / 2, -L_ / 2), (W_ / 2, -L_ / 2)), ((W_ / 2, -L_ / 2), (W_ / 2, L_ / 2)),
               ((W_ / 2, L_ / 2), (-W_ / 2, L_ / 2)), ((-W_ / 2, L_ / 2), (-W_ / 2, -L_ / 2))):
    pass
mat_ = rbox('mattress', (W_ - 0.06, L_ - 0.08, 0.24), (0, 0, 0.6), bevel=0.06, segs=4)
part(mat_, 'fabric_linen', r, 0.5)
blanket = prim('grid', 'blanket', x=30, y=34, size=0.5)
blanket.scale = (W_ + 0.35, L_ * 0.72, 1); apply_transform(blanket)
for v in blanket.data.vertices:
    x, y = v.co.x, v.co.y
    over = max(0.0, abs(x) - (W_ / 2 - 0.02))
    v.co.z = 0.735 - min(over * 1.6, 0.36) + 0.008 * math.sin(y * 18 + x * 7) + 0.012 * noise.noise(V((x * 3, y * 3, 0)))
    v.co.x = math.copysign(min(abs(x), W_ / 2 + 0.03 + over * 0.15), x)
    v.co.y = y - L_ * 0.14
blanket.data.update()
add_solidify(blanket, 0.012); add_subsurf(blanket, 1)
part(blanket, 'velvet_red', r, 0.5)
for s in (-0.38, 0.38):
    pil = prim('uvsphere', 'pillow', u=24, v=12, r=0.5)
    pil.scale = (0.34, 0.2, 0.07); pil.location = (s, L_ / 2 - 0.3, 0.8)
    pil.rotation_euler = (math.radians(-18), 0, 0)
    apply_transform(pil); displace_noise(pil, 0.01, 0.1)
    part(pil, 'fabric_linen', r, 0.4)

# ============================================================== WARDROBE (hide spot, doors hinge)
r = root('Wardrobe')
WW, WD, WH = 1.2, 0.62, 2.2
th = 0.03
for x in (-WW / 2 + th / 2, WW / 2 - th / 2):
    part(rbox('ws', (th, WD, WH - 0.12), (x, 0, 0.06 + (WH - 0.12) / 2), bevel=0.004), 'wood_dark', r, 0.6)
part(rbox('wback', (WW, th, WH - 0.12), (0, WD / 2 - th / 2, 0.06 + (WH - 0.12) / 2), bevel=0.004), 'wood_dark', r, 0.6)
part(rbox('wtop', (WW + 0.06, WD + 0.05, 0.05), (0, 0, WH - 0.05), bevel=0.01), 'wood_dark', r, 0.6)
part(rbox('wbot', (WW, WD, 0.05), (0, 0, 0.1), bevel=0.004), 'wood_dark', r, 0.6)
crown = molding('wcrown', [(-WW / 2 - 0.05, -WD / 2 - 0.04, WH), (WW / 2 + 0.05, -WD / 2 - 0.04, WH),
                           (WW / 2 + 0.05, WD / 2, WH), (-WW / 2 - 0.05, WD / 2, WH)],
                [(0, 0), (0.03, 0.02), (0.035, 0.06), (0.05, 0.1), (0.0, 0.1)], closed=False)
part(crown, 'wood_dark', r, 0.6)
for (x, y) in ((-WW / 2 + 0.06, -WD / 2 + 0.06), (WW / 2 - 0.06, -WD / 2 + 0.06), (-WW / 2 + 0.06, WD / 2 - 0.06),
               (WW / 2 - 0.06, WD / 2 - 0.06)):
    ft = turned('wfoot', [(0.04, 0), (0.05, 0.02), (0.035, 0.05), (0.045, 0.08), (0.05, 0.1)], seg=16)
    ft.location = (x, y, 0); apply_transform(ft)
    part(ft, 'wood_dark', r, 0.6)
rod = cyl('wrod', 0.012, WW - 0.08, (0, 0.05, 1.85), seg=12, rot=(0, R90, 0))
part(rod, 'brass', r, 0.3)
for sgn, nm in ((-1, 'Wardrobe_DoorL'), (1, 'Wardrobe_DoorR')):
    dw = WW / 2 - 0.005
    x0 = sgn * (WW / 2)
    cx = x0 - sgn * dw / 2
    pan1 = raised_panel('dp1', dw - 0.1, 0.9, 0.022, 0.05, loc=(cx, -WD / 2 - 0.012, 1.45))
    pan2 = raised_panel('dp2', dw - 0.1, 0.8, 0.022, 0.05, loc=(cx, -WD / 2 - 0.012, 0.55))
    frame = rbox('df', (dw, 0.028, WH - 0.2), (cx, -WD / 2 - 0.006, 0.12 + (WH - 0.2) / 2), bevel=0.006)
    handle = knob('dk', (x0 - sgn * (dw - 0.06), -WD / 2 - 0.02, 1.05), 0.016)
    handle.rotation_euler = (math.radians(180), 0, 0)
    door = join([frame, pan1, pan2], nm)
    pivot(door, (x0, -WD / 2 - 0.006, 0))
    part(door, 'wood_dark', r, 0.6)
    handle.parent = door
    handle.location -= door.location
    assign(handle, M('brass'))
    # peek gap marker (camera spot when hiding)
spot = bpy.data.objects.new('Wardrobe_HideCam', None); link(spot); spot.location = (0, 0.05, 1.55); spot.parent = r

# ============================================================== DRESSER + mirror
r = root('Dresser')
DW, DD, DH = 1.2, 0.5, 0.92
part(rbox('dcase', (DW, DD, DH - 0.1), (0, 0, 0.1 + (DH - 0.1) / 2), bevel=0.01), 'wood_dark', r, 0.6)
part(rbox('dtop', (DW + 0.04, DD + 0.04, 0.035), (0, 0, DH + 0.0175), bevel=0.012), 'wood_dark', r, 0.6)
for x in (-DW / 2 + 0.05, DW / 2 - 0.05):
    for y in (-DD / 2 + 0.05, DD / 2 - 0.05):
        ft = turned('dfoot', [(0.03, 0), (0.04, 0.03), (0.03, 0.07), (0.045, 0.1)], seg=14)
        ft.location = (x, y, 0); apply_transform(ft)
        part(ft, 'wood_dark', r, 0.6)
rows = [(0.78, 2), (0.56, 1), (0.33, 1)]
di = 0
for (z, n) in rows:
    for k in range(n):
        w = (DW - 0.06) / n - 0.02
        x = -DW / 2 + 0.03 + (k + 0.5) * (DW - 0.06) / n
        h = 0.18
        front = raised_panel('dfront', w, h, 0.022, 0.025, loc=(x, -DD / 2 - 0.01, z))
        box = rbox('dbox', (w - 0.03, DD - 0.06, h - 0.04), (x, -0.01, z - 0.005), bevel=0.003)
        bm = bmesh.new(); bm.from_mesh(box.data)
        top = [f for f in bm.faces if f.normal.z > 0.9]
        bmesh.ops.delete(bm, geom=top, context='FACES'); bm.to_mesh(box.data); bm.free()
        dr = join([front, box], f'Dresser_Drawer{di}')
        pivot(dr, (x, -DD / 2, z))
        part(dr, 'wood_dark', r, 0.6)
        for s in ((-1, 1) if n == 1 else (0,)):
            hx = x + s * w * 0.28
            kb = knob('dknob', (hx, -DD / 2 - 0.02, z), 0.013)
            assign(kb, M('brass')); kb.parent = dr; kb.location -= dr.location
        di += 1
mframe = molding('mframe', [(-0.38, DD / 2 - 0.05, DH + 0.1), (0.38, DD / 2 - 0.05, DH + 0.1),
                            (0.38, DD / 2 - 0.05, DH + 1.0), (-0.38, DD / 2 - 0.05, DH + 1.0)],
                 [(-0.035, 0.0), (0.035, 0.0), (0.03, 0.025), (-0.03, 0.025)], closed=True)
part(mframe, 'wood_dark', r, 0.5)
mirr = rbox('Dresser_Mirror', (0.72, 0.01, 0.86), (0, DD / 2 - 0.045, DH + 0.55), bevel=0.0)
part(mirr, 'mirror', r, 1.0)

# ============================================================== NIGHTSTAND + TABLE LAMP
r = root('Nightstand')
part(rbox('ncase', (0.5, 0.4, 0.5), (0, 0, 0.4), bevel=0.01), 'wood_dark', r, 0.5)
part(rbox('ntop', (0.54, 0.44, 0.03), (0, 0, 0.665), bevel=0.01), 'wood_dark', r, 0.5)
for x in (-0.21, 0.21):
    for y in (-0.16, 0.16):
        lg = turned('nleg', leg_profile(0.16, 0.022, 1), seg=12); lg.location = (x, y, 0); apply_transform(lg)
        part(lg, 'wood_dark', r, 0.5)
nd = raised_panel('ndfront', 0.44, 0.14, 0.02, 0.02, loc=(0, -0.21, 0.55))
nd = join([nd], 'Nightstand_Drawer'); pivot(nd, (0, -0.2, 0.55)); part(nd, 'wood_dark', r, 0.5)
kb = knob('nk', (0, -0.225, 0.55), 0.012); assign(kb, M('brass')); kb.parent = nd; kb.location -= nd.location

r = root('TableLamp')
base = turned('lbase', [(0.0, 0), (0.09, 0), (0.095, 0.01), (0.07, 0.03), (0.03, 0.05), (0.045, 0.15), (0.06, 0.24),
                        (0.03, 0.3), (0.012, 0.33), (0.012, 0.42), (0.0, 0.42)], seg=24)
part(base, 'brass', r, 0.2)
shade = lathe('lshade', [(0.19, 0.36), (0.18, 0.37), (0.1, 0.55), (0.095, 0.56)], seg=32)
add_solidify(shade, 0.004)
part(shade, 'fabric_linen', r, 0.3)
bulb = prim('uvsphere', 'lbulb', u=14, v=10, r=0.035, loc=(0, 0, 0.45)); apply_transform(bulb)
part(bulb, 'bulb', r, 0.2)
tag = bpy.data.objects.new('TableLamp_Light', None); link(tag); tag.location = (0, 0, 0.45); tag.parent = r

# ============================================================== DINING TABLE + CHAIR
r = root('DiningTable')
part(rbox('ttop', (2.8, 1.1, 0.05), (0, 0, 0.76), bevel=0.02, segs=3), 'wood_dark', r, 1.0)
part(rbox('tapron', (2.6, 0.95, 0.1), (0, 0, 0.68), bevel=0.01), 'wood_dark', r, 1.0)
for x in (-1.25, 0, 1.25):
    for y in (-0.4, 0.4):
        lg = turned('tleg', leg_profile(0.73, 0.055, 0), seg=18); lg.location = (x, y, 0); apply_transform(lg)
        part(lg, 'wood_dark', r, 0.5)
# place settings: plates, goblets, candelabra, rotten food
for i, x in enumerate((-0.9, -0.3, 0.3, 0.9)):
    for y in (-0.33, 0.33):
        pl = turned('plate', [(0.0, 0), (0.1, 0), (0.12, 0.012), (0.125, 0.015), (0.0, 0.006)], seg=24)
        pl.location = (x, y, 0.785); apply_transform(pl); part(pl, 'porcelain', r, 0.2)
        gb = turned('goblet', [(0.0, 0), (0.035, 0), (0.008, 0.01), (0.006, 0.08), (0.03, 0.1), (0.038, 0.16),
                               (0.036, 0.162), (0.0, 0.11)], seg=16)
        gb.location = (x + 0.15, y * 0.6, 0.785); apply_transform(gb); part(gb, 'brass', r, 0.2)
for x in (-0.6, 0.6):
    cb = turned('cndl_base', [(0.0, 0), (0.08, 0), (0.06, 0.02), (0.02, 0.05), (0.025, 0.2), (0.015, 0.28), (0.0, 0.28)], seg=18)
    cb.location = (x, 0, 0.785); apply_transform(cb); part(cb, 'brass', r, 0.2)
    for k in range(3):
        a = k / 3 * TAU
        arm_ = tube_along('carm', [V((x, 0, 1.0)), V((x + 0.08 * math.cos(a), 0.08 * math.sin(a), 1.02)),
                                   V((x + 0.12 * math.cos(a), 0.12 * math.sin(a), 1.08))], 0.006, seg=6)
        part(arm_, 'brass', r, 0.2)
        wx, wi, fl = candle('tc', (x + 0.12 * math.cos(a), 0.12 * math.sin(a), 1.08), 0.1, 0.01)
        part(wx, 'wax', r, 0.1); part(wi, 'black', r, 0.1); part(fl, 'flame', r, 0.1)

r = root('Chair')
part(rbox('cseat', (0.46, 0.46, 0.06), (0, 0, 0.46), bevel=0.025, segs=3), 'velvet_red', r, 0.5)
part(rbox('cframe', (0.48, 0.48, 0.05), (0, 0, 0.415), bevel=0.01), 'wood_dark', r, 0.5)
for (x, y) in ((-0.2, -0.2), (0.2, -0.2)):
    lg = turned('cleg', leg_profile(0.4, 0.028, 0), seg=14); lg.location = (x, y, 0); apply_transform(lg)
    part(lg, 'wood_dark', r, 0.5)
for x in (-0.2, 0.2):
    bp = turned('cback', leg_profile(1.02, 0.026, 2), seg=14); bp.location = (x, 0.21, 0); apply_transform(bp)
    part(bp, 'wood_dark', r, 0.5)
part(rbox('crest', (0.46, 0.04, 0.1), (0, 0.21, 0.97), bevel=0.015), 'wood_dark', r, 0.5)
for k in range(5):
    sp = turned('spindle', [(0.008, 0), (0.012, 0.1), (0.008, 0.2), (0.012, 0.35), (0.008, 0.45)], seg=10)
    sp.location = (-0.14 + k * 0.07, 0.21, 0.48); apply_transform(sp)
    part(sp, 'wood_dark', r, 0.5)

# ============================================================== ARMCHAIR (wingback) & SOFA (chesterfield)
def upholstered(name, width, mat, wings=True, depth=0.85):
    rr = root(name)
    seat = rbox('seat', (width, depth - 0.2, 0.18), (0, -0.05, 0.42), bevel=0.06, segs=4)
    back = rbox('back', (width, 0.22, 0.75 if wings else 0.5), (0, depth / 2 - 0.12, 0.8 if wings else 0.68), bevel=0.08, segs=4)
    arms = [rbox('arm', (0.18, depth - 0.1, 0.28), (s * (width / 2 + 0.07), 0, 0.56), bevel=0.08, segs=4) for s in (-1, 1)]
    base = rbox('base', (width + 0.3, depth, 0.25), (0, 0, 0.26), bevel=0.04, segs=3)
    pieces = [seat, back, base] + arms
    if wings:
        for s in (-1, 1):
            wg = rbox('wing', (0.1, 0.35, 0.45), (s * (width / 2 + 0.02), depth / 2 - 0.25, 1.0), bevel=0.05, segs=3)
            wg.rotation_euler = (0, 0, s * math.radians(-15)); apply_transform(wg)
            pieces.append(wg)
    body = join(pieces, name + '_body')
    add_subsurf(body, 1)
    # tufting dimples on the back
    for i in range(int(width / 0.14)):
        for j in range(3):
            push(body, (-width / 2 + 0.1 + i * 0.14 + (j % 2) * 0.07, depth / 2 - 0.235, 0.62 + j * 0.13), 0.012, -0.012,
                 (1, 1, 1), (0, 1, 0))
    part(body, mat, rr, 0.5)
    for x in (-(width / 2 + 0.1), width / 2 + 0.1):
        for y in (-depth / 2 + 0.08, depth / 2 - 0.08):
            ft = turned('ft', [(0.02, 0), (0.03, 0.04), (0.035, 0.12), (0.04, 0.14)], seg=12)
            ft.location = (x, y, 0); apply_transform(ft)
            part(ft, 'wood_dark', rr, 0.3)
    return rr


upholstered('Armchair', 0.62, 'velvet_green', True)
upholstered('Sofa', 1.7, 'leather', False, 0.9)

# ============================================================== BOOKSHELF with books
r = root('Bookshelf')
BW, BD, BH = 1.2, 0.38, 2.2
for x in (-BW / 2 + 0.015, BW / 2 - 0.015):
    part(rbox('bs', (0.03, BD, BH), (x, 0, BH / 2), bevel=0.004), 'wood_dark', r, 0.6)
part(rbox('bb', (BW, 0.02, BH), (0, BD / 2 - 0.01, BH / 2), bevel=0.002), 'wood_dark', r, 0.6)
shelf_z = [0.08, 0.5, 0.92, 1.34, 1.76, 2.18]
for z in shelf_z:
    part(rbox('shelf', (BW, BD, 0.03), (0, 0, z), bevel=0.004), 'wood_dark', r, 0.6)
part(molding('bcrown', [(-BW / 2 - 0.03, -BD / 2 - 0.03, BH), (BW / 2 + 0.03, -BD / 2 - 0.03, BH)],
             [(0, 0), (0.03, 0.02), (0.04, 0.07), (0.0, 0.07)]), 'wood_dark', r, 0.6)
books_by_mat = {}
for zi, z in enumerate(shelf_z[:-1]):
    x = -BW / 2 + 0.04
    while x < BW / 2 - 0.08:
        if rnd.random() < 0.08:
            x += rnd.uniform(0.06, 0.15); continue
        w = rnd.uniform(0.025, 0.06); h = rnd.uniform(0.22, 0.36); d = rnd.uniform(0.2, 0.28)
        lean = 0.0
        if rnd.random() < 0.06:
            lean = rnd.uniform(0.2, 0.4)
        b = rbox('book', (w, d, h), (x + w / 2, -BD / 2 + d / 2 + 0.02, z + 0.015 + h / 2), bevel=0.004,
                 rot=(0, lean, 0))
        m = rnd.choice(['book_a', 'book_b', 'book_c', 'book_d', 'leather'])
        books_by_mat.setdefault(m, []).append(b)
        x += w + 0.002 + (h * math.sin(lean) if lean else 0)
for m, bl in books_by_mat.items():
    part(join(bl, 'books_' + m), m, r, 0.3, auto=20)

# ============================================================== DESK
r = root('Desk')
part(rbox('dtop', (1.4, 0.7, 0.04), (0, 0, 0.76), bevel=0.012), 'wood_dark', r, 0.6)
for x in (-0.5, 0.5):
    part(rbox('dped', (0.38, 0.62, 0.7), (x, 0, 0.39), bevel=0.01), 'wood_dark', r, 0.6)
    for k, z in enumerate((0.62, 0.42, 0.2)):
        dp = raised_panel('ddr', 0.32, 0.16, 0.018, 0.02, loc=(x, -0.32, z)); part(dp, 'wood_dark', r, 0.6)
        kb = knob('dk', (x, -0.335, z), 0.011); part(kb, 'brass', r, 0.2)
leather_top = rbox('dleather', (0.9, 0.45, 0.004), (0, -0.02, 0.782), bevel=0.001)
part(leather_top, 'leather', r, 0.4)
ink = turned('ink', [(0.0, 0), (0.035, 0), (0.035, 0.04), (0.015, 0.05), (0.012, 0.06), (0.0, 0.06)], seg=16)
ink.location = (0.35, 0.1, 0.78); apply_transform(ink); part(ink, 'glass', r, 0.1)
quill = tube_along('quill', [V((0.35, 0.1, 0.83)), V((0.38, 0.12, 0.95)), V((0.43, 0.15, 1.05))], [0.002, 0.012, 0.004], seg=6)
part(quill, 'fabric_linen', r, 0.1)
for k in range(4):
    pp = rbox('paper', (0.21, 0.29, 0.0015), (-0.25 + rnd.uniform(-0.1, 0.1), -0.05 + rnd.uniform(-0.05, 0.05), 0.782 + k * 0.0016),
              bevel=0.0, rot=(0, 0, rnd.uniform(-0.4, 0.4)))
    part(pp, 'paper', r, 0.3)

# ============================================================== GRAND PIANO
r = root('Piano')
outline = []
for i in range(40):
    t = i / 39
    # bent side curve of a grand piano (keyboard at -Y)
    y = -0.75 + t * 1.9
    xr = 0.72
    xl = -0.72 + 0.55 * max(0.0, (t - 0.45) / 0.55) ** 1.3 if t > 0.45 else -0.72
    outline.append((xl, y))
right = [(0.72, -0.75 + t * 1.9) for t in [i / 20 for i in range(21)]]
tip = [(0.72 - 0.9 * (1 - math.cos(a)) / 2, 1.15 + 0.22 * math.sin(a)) for a in [k / 12 * math.pi for k in range(13)]]
poly = [(x, y) for (x, y) in outline] + [(xx, yy) for (xx, yy) in reversed(tip)] + list(reversed(right))
# build a prism from the outline (case)
verts, faces = [], []
n = len(poly)
for (x, y) in poly:
    verts.append((x, y, 0.62))
for (x, y) in poly:
    verts.append((x, y, 1.0))
for i in range(n):
    j = (i + 1) % n
    faces.append((i, j, n + j, n + i))
faces.append(tuple(range(n - 1, -1, -1)))
faces.append(tuple(range(n, 2 * n)))
case = mesh_obj('pcase', verts, faces)
recalc_normals(case)
m = case.modifiers.new('bev', 'BEVEL'); m.width = 0.01; m.segments = 2; m.limit_method = 'ANGLE'
apply_modifiers(case)
part(case, 'lacquer', r, 1.0, auto=30)
lid = mesh_obj('lidm', [(x, y, 0.0) for (x, y) in poly] + [(x, y, 0.02) for (x, y) in poly],
               [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))])
recalc_normals(lid)
lid.location = (0, 0, 1.0); apply_transform(lid)
lid_o = join([lid], 'Piano_Lid'); pivot(lid_o, (-0.72, 0, 1.0)); lid_o.rotation_euler = (0, math.radians(-40), 0)
part(lid_o, 'lacquer', r, 1.0, auto=30)
prop_stick = cyl('pstick', 0.008, 0.72, (0.3, 0.2, 1.3), seg=8, rot=(0, math.radians(-38), 0))
part(prop_stick, 'lacquer', r, 0.5)
for (x, y) in ((-0.6, -0.6), (0.6, -0.6), (0.2, 1.0)):
    lg = turned('pleg', leg_profile(0.62, 0.06, 2), seg=16); lg.location = (x, y, 0); apply_transform(lg)
    part(lg, 'lacquer', r, 0.5)
kb = rbox('kbed', (1.44, 0.3, 0.1), (0, -0.88, 0.7), bevel=0.01); part(kb, 'lacquer', r, 0.6)
whites = []
for k in range(52):
    x = -0.66 + k * (1.32 / 52)
    whites.append(rbox('wk', (1.32 / 52 - 0.002, 0.15, 0.02), (x + 0.0127, -0.92, 0.76), bevel=0.001))
part(join(whites, 'white_keys'), 'ivory', r, 0.2, auto=20)
blacks = []
for k in range(51):
    if k % 7 in (2, 6):
        continue
    x = -0.66 + (k + 1) * (1.32 / 52)
    blacks.append(rbox('bk', (0.012, 0.09, 0.02), (x, -0.89, 0.78), bevel=0.001))
part(join(blacks, 'black_keys'), 'lacquer', r, 0.2, auto=20)
music = rbox('pdesk', (0.6, 0.02, 0.3), (0, -0.66, 1.12), bevel=0.005, rot=(math.radians(-12), 0, 0))
part(music, 'lacquer', r, 0.5)
bench = rbox('pbench', (0.8, 0.36, 0.06), (0, -1.35, 0.5), bevel=0.02); part(bench, 'leather', r, 0.5)
for x in (-0.34, 0.34):
    for y in (-1.5, -1.2):
        lg = turned('bl', leg_profile(0.47, 0.024, 0), seg=12); lg.location = (x, y, 0); apply_transform(lg)
        part(lg, 'lacquer', r, 0.5)

# ============================================================== GRANDFATHER CLOCK
r = root('Clock')
part(rbox('cbase', (0.55, 0.32, 0.5), (0, 0, 0.25), bevel=0.012), 'wood_dark', r, 0.6)
part(rbox('ctrunk', (0.44, 0.26, 1.0), (0, 0, 1.0), bevel=0.01), 'wood_dark', r, 0.6)
part(rbox('chood', (0.56, 0.32, 0.55), (0, 0, 1.78), bevel=0.012), 'wood_dark', r, 0.6)
part(molding('ccrest', [(-0.3, -0.17, 2.06), (0.3, -0.17, 2.06)], [(0, 0), (0.03, 0.02), (0.0, 0.14), (-0.03, 0.02)]),
     'wood_dark', r, 0.6)
glass = rbox('cglass', (0.28, 0.01, 0.7), (0, -0.131, 1.0), bevel=0.0); part(glass, 'glass', r, 1)
face = cyl('cface', 0.19, 0.01, (0, -0.162, 1.8), seg=40, rot=(R90, 0, 0)); part(face, 'clockface', r, 0.5)
ring = prim('torus', 'cring', R=0.195, r=0.012, u=40, v=8); ring.rotation_euler = (R90, 0, 0); ring.location = (0, -0.165, 1.8)
apply_transform(ring); part(ring, 'brass', r, 0.2)
ticks = []
for k in range(12):
    a = k / 12 * TAU
    ticks.append(rbox('tick', (0.012, 0.004, 0.035 if k % 3 == 0 else 0.022),
                      (0.155 * math.sin(a), -0.169, 1.8 + 0.155 * math.cos(a)), bevel=0.0, rot=(0, -a, 0)))
part(join(ticks, 'cticks'), 'black', r, 0.2)
for nm, L_, w_ in (('Clock_HandH', 0.1, 0.012), ('Clock_HandM', 0.15, 0.008)):
    hnd = rbox(nm, (w_, 0.003, L_), (0, -0.172, 1.8 + L_ / 2 - 0.02), bevel=0.0)
    hnd = join([hnd], nm); pivot(hnd, (0, -0.172, 1.8)); part(hnd, 'black', r, 0.2)
pend_rod = cyl('prod', 0.004, 0.55, (0, -0.02, 1.3), seg=6)
pend_bob = cyl('pbob', 0.07, 0.012, (0, -0.02, 1.0), seg=24, rot=(R90, 0, 0))
pend = join([pend_rod, pend_bob], 'Clock_Pendulum'); pivot(pend, (0, -0.02, 1.58)); part(pend, 'brass', r, 0.2)

# ============================================================== CHANDELIER (hangs from ceiling: origin at top)
r = root('Chandelier')
stem = turned('chstem', [(0.0, -0.9), (0.02, -0.9), (0.06, -0.85), (0.1, -0.78), (0.08, -0.7), (0.03, -0.6),
                         (0.02, -0.3), (0.035, -0.28), (0.02, -0.25), (0.02, 0.0), (0.06, 0.0), (0.0, 0.0)], seg=24)
part(stem, 'brass', r, 0.3)
chain_l = []
for k in range(8):
    lk = prim('torus', 'lk', R=0.02, r=0.004, u=12, v=6)
    lk.rotation_euler = (R90 * (k % 2), 0, 0); lk.location = (0, 0, -0.03 - k * 0.032); apply_transform(lk); chain_l.append(lk)
part(join(chain_l, 'chchain'), 'brass', r, 0.2)
for k in range(8):
    a = k / 8 * TAU
    c, s = math.cos(a), math.sin(a)
    arm_ = tube_along('charm', [V((0.07 * c, 0.07 * s, -0.8)), V((0.25 * c, 0.25 * s, -0.9)), V((0.42 * c, 0.42 * s, -0.86)),
                                V((0.5 * c, 0.5 * s, -0.78))], 0.009, seg=8)
    part(arm_, 'brass', r, 0.2)
    cup = turned('chcup', [(0.0, 0), (0.035, 0.0), (0.04, 0.02), (0.02, 0.03), (0.0, 0.03)], seg=14)
    cup.location = (0.5 * c, 0.5 * s, -0.8); apply_transform(cup); part(cup, 'brass', r, 0.2)
    sleeve = cyl('chsleeve', 0.013, 0.08, (0.5 * c, 0.5 * s, -0.73), seg=10); part(sleeve, 'wax', r, 0.1)
    bl = prim('uvsphere', 'chbulb', u=10, v=8, r=0.018, loc=(0.5 * c, 0.5 * s, -0.67)); bl.scale = (1, 1, 1.5)
    apply_transform(bl); part(bl, 'bulb', r, 0.1)
    for j in range(3):
        cr = prim('icosphere', 'crystal', sub=1, r=0.015); cr.scale = (0.6, 0.6, 1.6)
        cr.location = ((0.3 + j * 0.06) * c, (0.3 + j * 0.06) * s, -0.95 - 0.02 * j); apply_transform(cr)
        part(cr, 'glass', r, 0.1, smooth=False)
tag = bpy.data.objects.new('Chandelier_Light', None); link(tag); tag.location = (0, 0, -0.75); tag.parent = r

r = root('Sconce')
plate = turned('scplate', [(0.0, 0), (0.06, 0), (0.07, 0.01), (0.05, 0.025), (0.0, 0.03)], seg=20, rot=(-R90, 0, 0))
part(plate, 'brass', r, 0.2)
sarm = tube_along('scarm', [V((0, -0.02, 0)), V((0, -0.12, -0.02)), V((0, -0.18, 0.06))], 0.008, seg=8)
part(sarm, 'brass', r, 0.2)
sh = lathe('scshade', [(0.03, 0.0), (0.06, 0.1), (0.065, 0.11)], seg=20); add_solidify(sh, 0.003)
sh.location = (0, -0.18, 0.06); apply_transform(sh); part(sh, 'glass', r, 0.1)
bl = prim('uvsphere', 'scbulb', u=10, v=8, r=0.02, loc=(0, -0.18, 0.1)); apply_transform(bl); part(bl, 'bulb', r, 0.1)
tag = bpy.data.objects.new('Sconce_Light', None); link(tag); tag.location = (0, -0.18, 0.1); tag.parent = r

# ============================================================== FIREPLACE
r = root('Fireplace')
FW = 1.9
for s in (-1, 1):
    part(rbox('fpcol', (0.35, 0.3, 1.25), (s * (FW / 2 - 0.175), 0, 0.625), bevel=0.02), 'marble', r, 0.5)
part(rbox('fplintel', (FW, 0.3, 0.3), (0, 0, 1.1), bevel=0.02), 'marble', r, 0.5)
part(rbox('fpshelf', (FW + 0.2, 0.42, 0.07), (0, -0.04, 1.3), bevel=0.02), 'marble', r, 0.5)
part(molding('fpmold', [(-FW / 2 - 0.08, -0.25, 1.265), (FW / 2 + 0.08, -0.25, 1.265)],
             [(0, 0), (0.02, -0.03), (0.05, -0.02), (0.06, 0.0)]), 'marble', r, 0.5)
part(rbox('fphearth', (FW + 0.3, 0.6, 0.06), (0, -0.2, 0.03), bevel=0.01), 'stone_floor', r, 0.5)
box = rbox('fpbox', (FW - 0.7, 0.05, 0.95), (0, 0.13, 0.5), bevel=0.0); part(box, 'brick', r, 0.5)
for s in (-1, 1):
    side = rbox('fpside', (0.05, 0.3, 0.95), (s * (FW / 2 - 0.37), 0.0, 0.5), bevel=0.0); part(side, 'brick', r, 0.5)
grate = []
for k in range(7):
    grate.append(cyl('gbar', 0.008, 0.3, (-0.3 + k * 0.1, -0.02, 0.18), seg=6, rot=(R90, 0, 0)))
grate.append(cyl('gfront', 0.01, 0.7, (0, -0.17, 0.2), seg=6, rot=(0, R90, 0)))
part(join(grate, 'fpgrate'), 'iron', r, 0.3)
logs = []
for k in range(4):
    lg = cyl('log', rnd.uniform(0.05, 0.07), 0.6, (rnd.uniform(-0.1, 0.1), -0.02 + rnd.uniform(-0.05, 0.05), 0.24 + (k // 2) * 0.09),
             seg=10, rot=(rnd.uniform(-0.2, 0.2), R90, rnd.uniform(-0.4, 0.4)))
    displace_noise(lg, 0.01, 0.05); logs.append(lg)
part(join(logs, 'fplogs'), 'bark', r, 0.3)
embers = rbox('Fireplace_Embers', (0.6, 0.3, 0.02), (0, -0.02, 0.2), bevel=0.0); displace_noise(embers, 0.01, 0.03)
part(embers, 'ember', r, 0.3)
tag = bpy.data.objects.new('Fireplace_Light', None); link(tag); tag.location = (0, -0.3, 0.45); tag.parent = r
for s in (-1, 1):
    cb = turned('mcndl', [(0.0, 0), (0.05, 0), (0.02, 0.03), (0.015, 0.15), (0.03, 0.17), (0.0, 0.17)], seg=16)
    cb.location = (s * 0.7, -0.05, 1.335); apply_transform(cb); part(cb, 'brass', r, 0.2)
    wx, wi, fl = candle('mc', (s * 0.7, -0.05, 1.5), 0.12, 0.012)
    part(wx, 'wax', r, 0.1); part(wi, 'black', r, 0.1); part(fl, 'flame', r, 0.1)

# ============================================================== BATHROOM: clawfoot tub, toilet, pedestal sink, mirror
r = root('Bathtub')
tub = lathe('tubm', [(0.0, 0.18), (0.4, 0.2), (0.62, 0.3), (0.72, 0.55), (0.76, 0.66), (0.74, 0.7), (0.66, 0.68),
                     (0.62, 0.4), (0.4, 0.26), (0.0, 0.25)], seg=48)
tub.scale = (1.0, 0.48, 1); apply_transform(tub)
part(tub, 'porcelain', r, 0.6)
water = cyl('tubwater', 0.6, 0.01, (0, 0, 0.5), seg=40); water.scale = (1, 0.46, 1); apply_transform(water)
part(water, 'glass', r, 0.5)
for (x, y) in ((-0.5, -0.2), (0.5, -0.2), (-0.5, 0.2), (0.5, 0.2)):
    ft = turned('claw', [(0.05, 0), (0.035, 0.05), (0.025, 0.12), (0.04, 0.2)], seg=10); ft.location = (x, y, 0)
    apply_transform(ft); part(ft, 'brass', r, 0.2)
fau = tube_along('faucet', [V((0.72, 0, 0.62)), V((0.72, 0, 0.82)), V((0.62, 0, 0.86)), V((0.58, 0, 0.8))], 0.015, seg=10)
part(fau, 'brass', r, 0.2)

r = root('Toilet')
bowl = lathe('bowl', [(0.0, 0.0), (0.14, 0.0), (0.12, 0.2), (0.16, 0.36), (0.2, 0.42), (0.17, 0.43), (0.1, 0.3), (0.0, 0.26)], seg=32)
bowl.scale = (0.85, 1.1, 1); apply_transform(bowl); part(bowl, 'porcelain', r, 0.5)
seat = prim('torus', 'seat', R=0.15, r=0.02, u=32, v=8); seat.scale = (0.9, 1.15, 0.5); seat.location = (0, -0.02, 0.44)
apply_transform(seat); part(seat, 'wood_dark', r, 0.3)
tank = rbox('tank', (0.45, 0.2, 0.32), (0, 0.25, 1.9), bevel=0.02); part(tank, 'wood_dark', r, 0.4)
pipe = cyl('tpipe', 0.02, 1.45, (0, 0.24, 1.08), seg=10); part(pipe, 'brass', r, 0.2)
chn = [prim('torus', 'lk', R=0.008, r=0.0018, u=8, v=5) for _ in range(20)]
for k, lk in enumerate(chn):
    lk.rotation_euler = (R90 * (k % 2), 0, 0); lk.location = (0.18, 0.2, 1.72 - k * 0.028); apply_transform(lk)
hnd = turned('thandle', [(0.0, 0), (0.015, 0.01), (0.012, 0.06), (0.0, 0.07)], seg=10); hnd.location = (0.18, 0.2, 1.1)
apply_transform(hnd)
part(join(chn + [hnd], 'tchain'), 'brass', r, 0.2)

r = root('Sink')
ped = turned('sped', [(0.0, 0), (0.12, 0), (0.1, 0.05), (0.06, 0.2), (0.07, 0.6), (0.1, 0.72), (0.0, 0.72)], seg=24)
part(ped, 'porcelain', r, 0.5)
basin = lathe('sbasin', [(0.0, 0.72), (0.12, 0.73), (0.25, 0.8), (0.27, 0.86), (0.25, 0.87), (0.2, 0.82), (0.0, 0.78)], seg=32)
basin.scale = (1.1, 0.8, 1); apply_transform(basin); part(basin, 'porcelain', r, 0.5)
for s in (-1, 1):
    tp = turned('stap', [(0.0, 0), (0.012, 0), (0.012, 0.06), (0.025, 0.07), (0.0, 0.075)], seg=10)
    tp.location = (s * 0.08, 0.15, 0.86); apply_transform(tp); part(tp, 'brass', r, 0.2)
spout = tube_along('sspout', [V((0, 0.16, 0.86)), V((0, 0.16, 0.96)), V((0, 0.08, 0.97))], 0.01, seg=8)
part(spout, 'brass', r, 0.2)

r = root('WallMirror')
part(molding('wmframe', rect_path(0.7, 1.0, 0.0), [(-0.05, 0.0), (0.05, 0.0), (0.04, -0.03), (-0.04, -0.03)], closed=True),
     'brass', r, 0.3)
part(rbox('wmglass', (0.62, 0.005, 0.92), (0, 0.002, 0.5), bevel=0.0), 'mirror', r, 1.0)

# ============================================================== NURSERY: crib, rocking horse
r = root('Crib')
part(rbox('crbase', (1.3, 0.72, 0.06), (0, 0, 0.35), bevel=0.01), 'wood_light', r, 0.5)
part(rbox('crmat', (1.24, 0.66, 0.1), (0, 0, 0.42), bevel=0.04, segs=3), 'fabric_linen', r, 0.5)
for x in (-0.64, 0.64):
    for y in (-0.34, 0.34):
        p = turned('crpost', leg_profile(1.05, 0.025, 2) + [(0.03, 1.07), (0.0, 1.1)], seg=12); p.location = (x, y, 0)
        apply_transform(p); part(p, 'wood_light', r, 0.5)
for y in (-0.34, 0.34):
    part(rbox('crrail', (1.28, 0.04, 0.04), (0, y, 1.0), bevel=0.01), 'wood_light', r, 0.5)
    slats = [cyl('slat', 0.012, 0.55, (-0.58 + k * 0.083, y, 0.7), seg=8) for k in range(15)]
    part(join(slats, 'slats'), 'wood_light', r, 0.5)
for x in (-0.64, 0.64):
    part(raised_panel('crend', 0.64, 0.5, 0.025, 0.04, loc=(x, 0, 0.72), rot=(0, 0, R90)), 'wood_light', r, 0.5)

r = root('RockingHorse')
horse = []
b1 = prim('uvsphere', 'hb', u=20, v=12, r=0.5); b1.scale = (0.14, 0.34, 0.14); b1.location = (0, 0, 0.62); apply_transform(b1)
b2 = cyl('hneck', 0.07, 0.3, (0, -0.32, 0.8), seg=14, r2=0.05, rot=(math.radians(-35), 0, 0))
b3 = prim('uvsphere', 'hhead', u=16, v=10, r=0.5); b3.scale = (0.08, 0.18, 0.09); b3.location = (0, -0.48, 0.92)
b3.rotation_euler = (math.radians(30), 0, 0); apply_transform(b3)
horse += [b1, b2, b3]
for x in (-0.09, 0.09):
    for y in (-0.22, 0.22):
        horse.append(cyl('hleg', 0.028, 0.4, (x, y, 0.4), seg=10, rot=(math.radians(18 if y < 0 else -18), 0, 0)))
part(join(horse, 'hbody'), 'wood_light', r, 0.4)
for x in (-0.1, 0.1):
    rk = prim('torus', 'rocker', R=0.9, r=0.015, u=64, v=6); rk.rotation_euler = (0, R90, 0)
    rk.location = (x, 0, 0.93); apply_transform(rk)
    bm = bmesh.new(); bm.from_mesh(rk.data)
    bmesh.ops.delete(bm, geom=[vv for vv in bm.verts if vv.co.z > 0.2 or abs(vv.co.y) > 0.55], context='VERTS')
    bm.to_mesh(rk.data); bm.free()
    part(rk, 'wood_dark', r, 0.4)
mane = [cyl('mane', 0.01, 0.12, (0, -0.3 + k * 0.03, 0.97 - k * 0.02), seg=5) for k in range(8)]
part(join(mane, 'hmane'), 'leather', r, 0.3)

# ============================================================== FUSE BOX (utility) + BOILER
r = root('FuseBox')
part(rbox('fbcab', (0.6, 0.18, 0.8), (0, 0, 1.4), bevel=0.01), 'metal_rust', r, 0.4)
inner = rbox('fbin', (0.54, 0.02, 0.74), (0, -0.07, 1.4), bevel=0.0); part(inner, 'black', r, 0.4)
for k in range(4):
    x = -0.18 + k * 0.12
    hold = rbox('fbhold', (0.06, 0.04, 0.12), (x, -0.08, 1.52), bevel=0.004); part(hold, 'porcelain', r, 0.2)
    if k != 2:
        fz = cyl('fbfuse', 0.011, 0.07, (x, -0.1, 1.52), seg=12)
        part(fz, 'glass', r, 0.1)
slot = bpy.data.objects.new('FuseBox_Slot', None); link(slot); slot.location = (0.06, -0.1, 1.52); slot.parent = r
lever_base = rbox('fblb', (0.08, 0.05, 0.14), (0.3 + 0.05, -0.04, 1.25), bevel=0.005); part(lever_base, 'iron', r, 0.3)
lev = cyl('fblev', 0.008, 0.16, (0.35, -0.08, 1.33), seg=8)
lk = cyl('fblevk', 0.016, 0.04, (0.35, -0.08, 1.42), seg=10)
lever = join([lev, lk], 'FuseBox_Lever'); pivot(lever, (0.35, -0.08, 1.25)); lever.rotation_euler = (math.radians(35), 0, 0)
part(lever, 'iron', r, 0.3)
door = rbox('fbdoor', (0.6, 0.02, 0.8), (0.3, -0.1, 1.4), bevel=0.006)
door = join([door], 'FuseBox_Door'); pivot(door, (-0.3, -0.1, 1.4)); door.location.x = -0.3
part(door, 'metal_rust', r, 0.4)
sign = rbox('fbsign', (0.2, 0.004, 0.1), (0.0, -0.113, 1.65), bevel=0.0); sign.parent = door; assign(sign, M('emissive_red'))
sign.location -= door.location
for k in range(3):
    cnd = cyl('conduit', 0.02, 1.2, (-0.2 + k * 0.2, 0.0, 2.4), seg=10); part(cnd, 'metal_rust', r, 0.4)

r = root('Boiler')
part(turned('bbody', [(0.0, 0), (0.42, 0), (0.45, 0.05), (0.45, 1.6), (0.42, 1.7), (0.3, 1.8), (0.0, 1.82)], seg=36), 'metal_rust', r, 0.5)
rv = []
for zz in (0.3, 0.9, 1.5):
    for k in range(24):
        a = k / 24 * TAU
        rv.append(prim('uvsphere', 'rv', u=6, v=4, r=0.012, loc=(0.455 * math.cos(a), 0.455 * math.sin(a), zz)))
for o in rv:
    apply_transform(o)
part(join(rv, 'brivets'), 'iron', r, 0.3)
pp = tube_along('bpipe', [V((0.3, 0, 1.75)), V((0.3, 0, 2.2)), V((0.8, 0, 2.5)), V((1.5, 0, 2.5))], 0.05, seg=12)
part(pp, 'metal_rust', r, 0.4)
gauge = cyl('bgauge', 0.07, 0.03, (0, -0.47, 1.2), seg=24, rot=(R90, 0, 0)); part(gauge, 'brass', r, 0.2)
gf = cyl('bgface', 0.06, 0.005, (0, -0.487, 1.2), seg=24, rot=(R90, 0, 0)); part(gf, 'gauge', r, 0.2)
wheel = prim('torus', 'bwheel', R=0.12, r=0.012, u=24, v=6); wheel.rotation_euler = (R90, 0, 0); wheel.location = (0.25, -0.5, 0.8)
apply_transform(wheel); part(wheel, 'iron', r, 0.2)
door2 = rbox('bdoor', (0.3, 0.04, 0.25), (0, -0.44, 0.35), bevel=0.01); part(door2, 'iron', r, 0.3)
glow = rbox('Boiler_Glow', (0.2, 0.01, 0.04), (0, -0.465, 0.35), bevel=0.0); part(glow, 'ember', r, 0.2)

# ============================================================== LAUNDRY: washtub, hanging sheet
r = root('Washtub')
wt = lathe('wtub', [(0.0, 0.3), (0.28, 0.3), (0.33, 0.62), (0.34, 0.64), (0.31, 0.62), (0.26, 0.34), (0.0, 0.34)], seg=36)
part(wt, 'metal_rust', r, 0.4)
for k in range(3):
    a = k / 3 * TAU
    lg = cyl('wleg', 0.015, 0.32, (0.2 * math.cos(a), 0.2 * math.sin(a), 0.16), seg=8); part(lg, 'iron', r, 0.3)
wb = rbox('washboard', (0.3, 0.02, 0.55), (0.1, 0.1, 0.62), bevel=0.01, rot=(math.radians(-20), 0, 0.3))
part(wb, 'wood_old', r, 0.4)

r = root('HangingSheet')
sh = prim('grid', 'sheet', x=20, y=28, size=0.5); sh.scale = (1.6, 1.4, 1); sh.rotation_euler = (R90, 0, 0)
sh.location = (0, 0, 1.3); apply_transform(sh)
for v in sh.data.vertices:
    d = (2.0 - v.co.z) / 1.4
    v.co.y += 0.05 * math.sin(v.co.x * 6) * max(0, d) + 0.03 * noise.noise(v.co * 3)
    v.co.z -= 0.08 * (1 - (v.co.x / 0.8) ** 2)
sh.data.update(); add_solidify(sh, 0.004)
part(sh, 'fabric_linen', r, 0.6)
line = cyl('line', 0.004, 2.4, (0, 0, 2.02), seg=6, rot=(0, R90, 0)); part(line, 'fabric_linen', r, 0.3)

# ============================================================== CHAPEL: pew, altar
r = root('Pew')
part(rbox('pseat', (2.2, 0.42, 0.05), (0, 0, 0.45), bevel=0.01), 'wood_dark', r, 0.7)
part(rbox('pback', (2.2, 0.05, 0.5), (0, 0.2, 0.75), bevel=0.01, rot=(math.radians(8), 0, 0)), 'wood_dark', r, 0.7)
for x in (-1.08, 1.08):
    end = raised_panel('pend', 0.5, 0.95, 0.05, 0.05, loc=(x, 0.05, 0.48), rot=(0, 0, R90)); part(end, 'wood_dark', r, 0.7)
part(rbox('pkneel', (2.1, 0.12, 0.06), (0, -0.35, 0.12), bevel=0.01), 'velvet_red', r, 0.5)

r = root('Altar')
part(rbox('abody', (1.8, 0.7, 1.0), (0, 0, 0.5), bevel=0.02), 'marble', r, 0.8)
cloth = prim('grid', 'acloth', x=30, y=10, size=0.5); cloth.scale = (1.9, 0.8, 1); cloth.location = (0, 0, 1.005)
apply_transform(cloth)
for v in cloth.data.vertices:
    if abs(v.co.y) > 0.34:
        v.co.z -= (abs(v.co.y) - 0.34) * 3
        v.co.y = math.copysign(0.36, v.co.y)
cloth.data.update(); add_solidify(cloth, 0.004); part(cloth, 'velvet_red', r, 0.5)
crs = join([rbox('acv', (0.05, 0.05, 0.7), (0, 0.2, 1.36), bevel=0.01),
            rbox('ach', (0.35, 0.05, 0.05), (0, 0.2, 1.52), bevel=0.01)], 'across')
crs.rotation_euler = (0, math.radians(180), 0)  # inverted cross
crs.location = (0, 0, 2.02 + 0.33); apply_transform(crs)
part(crs, 'brass', r, 0.2)
for x in (-0.7, -0.5, 0.5, 0.7):
    wx, wi, fl = candle('ac', (x, 0.1, 1.01), rnd.uniform(0.15, 0.3), 0.018)
    part(wx, 'wax', r, 0.1); part(wi, 'black', r, 0.1); part(fl, 'flame', r, 0.1)

# ============================================================== CELLAR: barrel, wine rack
r = root('Barrel')
prof = [(0.0, 0), (0.26, 0.0)] + [(0.26 + 0.05 * math.sin(k / 12 * math.pi), k / 12 * 0.9) for k in range(13)] + [(0.0, 0.9)]
br = lathe('brl', prof, seg=28); part(br, 'wood_old', r, 0.4)
for zz in (0.08, 0.28, 0.62, 0.82):
    rr_ = 0.26 + 0.05 * math.sin(zz / 0.9 * math.pi) + 0.004
    hp = prim('torus', 'hoop', R=rr_, r=0.008, u=40, v=4); hp.scale = (1, 1, 2.5); hp.location = (0, 0, zz); apply_transform(hp)
    part(hp, 'iron', r, 0.2)

r = root('WineRack')
part(rbox('wrframe', (1.2, 0.35, 1.8), (0, 0, 0.9), bevel=0.01), 'wood_old', r, 0.6)
cells = []
bottles = []
for i in range(6):
    for j in range(8):
        x = -0.5 + i * 0.2; z = 0.15 + j * 0.21
        cells.append(rbox('wcell', (0.17, 0.4, 0.17), (x, 0, z), bevel=0.0))
        if rnd.random() < 0.7:
            bt = turned('bottle', [(0.0, 0), (0.037, 0), (0.037, 0.2), (0.012, 0.25), (0.012, 0.31), (0.0, 0.31)], seg=12,
                        rot=(-R90, 0, 0))
            bt.location = (x, 0.15, z); apply_transform(bt); bottles.append(bt)
fr = bpy.data.objects['wrframe']
for c in cells:
    bmod = fr.modifiers.new('bool', 'BOOLEAN'); bmod.object = c; bmod.operation = 'DIFFERENCE'
apply_modifiers(fr)
for c in cells:
    bpy.data.objects.remove(c, do_unlink=True)
part(join(bottles, 'bottles'), 'glass', r, 0.2)

# ============================================================== BILLIARD TABLE
r = root('BilliardTable')
part(rbox('bfelt', (2.5, 1.35, 0.06), (0, 0, 0.8), bevel=0.005), 'felt', r, 1.0)
for (sx, sy, w, d) in ((0, -0.72, 2.7, 0.12), (0, 0.72, 2.7, 0.12), (-1.3, 0, 0.12, 1.35), (1.3, 0, 0.12, 1.35)):
    part(rbox('brail', (w, d, 0.1), (sx, sy, 0.85), bevel=0.02), 'wood_dark', r, 0.7)
part(rbox('bbody', (2.6, 1.45, 0.2), (0, 0, 0.68), bevel=0.02), 'wood_dark', r, 0.7)
for x in (-1.1, 0, 1.1):
    for y in (-0.55, 0.55):
        lg = turned('bleg', leg_profile(0.58, 0.07, 0), seg=16); lg.location = (x, y, 0); apply_transform(lg)
        part(lg, 'wood_dark', r, 0.5)
balls = []
for k in range(10):
    b = prim('uvsphere', 'ball', u=16, v=10, r=0.028, loc=(rnd.uniform(-1.0, 1.0), rnd.uniform(-0.5, 0.5), 0.858))
    apply_transform(b); balls.append(b)
part(join(balls, 'balls'), 'ivory', r, 0.1)
cue = cyl('cue', 0.012, 1.45, (0.3, 0.2, 0.9), seg=10, r2=0.006, rot=(R90, 0, 0.3)); part(cue, 'wood_light', r, 0.3)

# ============================================================== KITCHEN: counter run, stove, shelf with jars
r = root('KitchenCounter')
part(rbox('kbody', (2.0, 0.6, 0.86), (0, 0, 0.43), bevel=0.01), 'wood_old', r, 0.6)
part(rbox('ktop', (2.04, 0.64, 0.05), (0, 0, 0.885), bevel=0.01), 'marble', r, 0.8)
for k in range(4):
    x = -0.75 + k * 0.5
    part(raised_panel('kdoor', 0.44, 0.62, 0.02, 0.04, loc=(x, -0.31, 0.42)), 'wood_old', r, 0.6)
    part(knob('kk', (x + 0.16, -0.33, 0.6), 0.012), 'brass', r, 0.2)
sinkb = rbox('ksink', (0.6, 0.45, 0.2), (0.55, 0, 0.82), bevel=0.02); part(sinkb, 'porcelain', r, 0.5)
pots = []
for k in range(3):
    pt = turned('pot', [(0.0, 0), (0.1, 0), (0.11, 0.12), (0.115, 0.13), (0.0, 0.02)], seg=20)
    pt.location = (-0.7 + k * 0.28, 0.1, 0.91); apply_transform(pt); pots.append(pt)
part(join(pots, 'pots'), 'iron', r, 0.3)
knife = rbox('knife', (0.02, 0.25, 0.003), (-0.2, -0.1, 0.912), bevel=0.0, rot=(0, 0, 0.5)); part(knife, 'chrome', r, 0.2)
cb = rbox('cboard', (0.45, 0.3, 0.03), (-0.1, -0.05, 0.925), bevel=0.01); part(cb, 'wood_light', r, 0.3)

r = root('Stove')
part(rbox('sbody', (1.1, 0.7, 0.8), (0, 0, 0.45), bevel=0.02), 'iron', r, 0.5)
part(rbox('stop', (1.16, 0.74, 0.05), (0, 0, 0.87), bevel=0.01), 'iron', r, 0.5)
for x in (-0.3, 0.1):
    part(rbox('soven', (0.35, 0.03, 0.35), (x, -0.36, 0.45), bevel=0.01), 'iron', r, 0.5)
    part(cyl('shandle', 0.012, 0.25, (x, -0.4, 0.62), seg=10, rot=(0, R90, 0)), 'chrome', r, 0.2)
for (x, y) in ((-0.3, -0.12), (0.1, -0.12), (-0.3, 0.15), (0.1, 0.15)):
    bn = cyl('sburn', 0.1, 0.01, (x, y, 0.9), seg=24); part(bn, 'black', r, 0.3)
part(cyl('spipe', 0.08, 1.8, (0.4, 0.25, 1.8), seg=16), 'iron', r, 0.4)
for x in (-0.48, 0.48):
    for y in (-0.3, 0.3):
        part(turned('sfoot', [(0.04, 0), (0.05, 0.03), (0.03, 0.06)], seg=10, rot=(0, 0, 0)), 'iron', r, 0.3)
        bpy.data.objects[-1] if False else None

r = root('KitchenShelf')
for z in (0.0, 0.4, 0.8):
    part(rbox('ksh', (1.2, 0.3, 0.03), (0, 0, 1.3 + z), bevel=0.005), 'wood_old', r, 0.5)
for x in (-0.58, 0.58):
    part(rbox('kbr', (0.03, 0.3, 0.85), (x, 0, 1.72), bevel=0.004), 'wood_old', r, 0.5)
jars = []
for z in (1.315, 1.715, 2.115):
    x = -0.5
    while x < 0.5:
        h = rnd.uniform(0.12, 0.25); rr_ = rnd.uniform(0.04, 0.07)
        jr = turned('jar', [(0.0, 0), (rr_, 0), (rr_, h), (rr_ * 0.7, h + 0.02), (rr_ * 0.7, h + 0.04), (0.0, h + 0.04)], seg=14)
        jr.location = (x + rr_, 0, z); apply_transform(jr); jars.append(jr)
        x += rr_ * 2 + 0.02
part(join(jars, 'jars'), 'glass', r, 0.2)

# ============================================================== STORAGE: crate, dust-sheet furniture
r = root('Crate')
slats_ = []
for z in range(4):
    for (a, b, w, d) in ((0, -0.3, 0.64, 0.025), (0, 0.3, 0.64, 0.025), (-0.3, 0, 0.025, 0.64), (0.3, 0, 0.025, 0.64)):
        slats_.append(rbox('cslat', (w, d, 0.13), (a, b, 0.08 + z * 0.15), bevel=0.004))
for (x, y) in ((-0.3, -0.3), (0.3, -0.3), (-0.3, 0.3), (0.3, 0.3)):
    slats_.append(rbox('cpost', (0.05, 0.05, 0.62), (x, y, 0.31), bevel=0.004))
lidc = rbox('clid', (0.64, 0.64, 0.03), (0, 0, 0.635), bevel=0.004)
part(join(slats_ + [lidc], 'crate'), 'wood_light', r, 0.4, auto=25)

r = root('SheetCovered')
core = rbox('scc', (0.9, 0.8, 0.9), (0, 0, 0.45), bevel=0.1, segs=3)
back_ = rbox('scb', (0.9, 0.2, 0.5), (0, 0.3, 1.1), bevel=0.08, segs=3)
tree, _ = bvh_from([core, back_])
sheet = prim('grid', 'dsheet', x=40, y=40, size=0.5); sheet.scale = (1.6, 1.6, 1); sheet.location = (0, 0, 1.5)
apply_transform(sheet)
for v in sheet.data.vertices:
    p = V((v.co.x, v.co.y, 1.6))
    hit = tree.ray_cast(p, V((0, 0, -1)))
    if hit[0] is not None:
        v.co = hit[0] + V((0, 0, 0.02))
    else:
        dx = max(0.0, abs(v.co.x) - 0.48); dy = max(0.0, abs(v.co.y) - 0.44)
        d = math.sqrt(dx * dx + dy * dy)
        v.co.z = max(0.0, 0.92 - d * 2.8)
        sc_ = min(1.0, 0.5 / max(d, 0.001)) if d > 0 else 1
        v.co.x = math.copysign(min(abs(v.co.x), 0.49 + dx * 0.25), v.co.x)
        v.co.y = math.copysign(min(abs(v.co.y), 0.45 + dy * 0.25), v.co.y)
    v.co += V((0, 0, 0.012 * noise.noise(v.co * 6)))
sheet.data.update()
bpy.data.objects.remove(core, do_unlink=True); bpy.data.objects.remove(back_, do_unlink=True)
add_subsurf(sheet, 1); add_solidify(sheet, 0.005)
part(sheet, 'cloth_dust', r, 0.6)

# ============================================================== MUSEUM: statues (humanoid poses in marble), bust, case, armor
exec(open("D:/Web Based - Horror Game/tools/blender/char.py").read())


def statue(name, pose, pedestal=True, stone='marble'):
    rr = root(name)
    P_ = params(sz=1.0, sx=0.95, bulk=0.95)
    b_, J_ = humanoid(name + '_body', P_, legs=True, subsurf=1)
    hd = sculpt_head(name + '_head', (0, -0.006, P_['head_c']), P_['head'], noise_amt=0.0)
    robe, _pf = lathe_garment(name + '_robe', [(P_['neckb'], 0.07, 0.06), (P_['sh_z'], 0.2, 0.12), (P_['chest'], 0.17, 0.12),
                                               (P_['pelvis'], 0.2, 0.15), (0.3, 0.3, 0.26), (0.02, 0.36, 0.3)],
                              rows_step=0.03, seg=48, folds=0.03, fold_start=1.3)
    add_solidify(robe, 0.01)
    bones_ = humanoid_bones(J_, P_, legs=True)
    arm_ = make_armature(name + '_rig', bones_)
    bind_weights(b_, arm_, allowed=bone_sets(bones_)['body'], power=4.0, smooth_iters=1)
    bind_rigid(hd, arm_, 'head')
    bind_weights(robe, arm_, allowed={'hips', 'spine', 'chest', 'neck', 'thigh.L', 'thigh.R'}, power=3.0, smooth_iters=2)
    rots = pose(arm_, P_)
    key_world(arm_, 1, rots, {})
    bpy.context.scene.frame_set(1)
    parts_ = []
    for o in (b_, hd, robe):
        apply_modifiers(o)
        o.parent = None
        parts_.append(o)
    bpy.data.objects.remove(arm_, do_unlink=True)
    body_ = join(parts_, name + '_stone')
    body_.matrix_world = Matrix.Identity(4)
    if pedestal:
        body_.location = (0, 0, 0.6); apply_transform(body_)
        pd = turned('pedestal', [(0.0, 0), (0.42, 0), (0.42, 0.06), (0.36, 0.1), (0.32, 0.12), (0.3, 0.48), (0.34, 0.52),
                                 (0.4, 0.56), (0.4, 0.6), (0.0, 0.6)], seg=6)
        part(pd, 'marble', rr, 0.5, smooth=False)
    displace_noise(body_, 0.002, 0.02)
    part(body_, stone, rr, 0.5)
    return rr


def pose_weeping(arm_, P_):
    r_ = aim_chain(arm_, {'spine': (14, 0, 0), 'chest': (10, 0, 0), 'neck': (20, 0, 0), 'head': (18, 0, 0)},
                   [('upper_arm.L', (0.15, -0.7, 0.3)), ('forearm.L', (-0.4, -0.3, 0.85)), ('hand.L', (-0.3, -0.2, 0.9))])
    r_ = aim_chain(arm_, r_, [('upper_arm.R', (-0.15, -0.7, 0.3)), ('forearm.R', (0.4, -0.3, 0.85)), ('hand.R', (0.3, -0.2, 0.9))])
    return r_


def pose_praying(arm_, P_):
    r_ = aim_chain(arm_, {'neck': (-10, 0, 0), 'head': (-20, 0, 0), 'thigh.L': (-80, 0, 0), 'shin.L': (90, 0, 0),
                          'thigh.R': (-10, 0, 0), 'shin.R': (85, 0, 0)},
                   [('upper_arm.L', (0.1, -0.35, -0.9)), ('forearm.L', (-0.4, -0.6, 0.7))])
    r_ = aim_chain(arm_, r_, [('upper_arm.R', (-0.1, -0.35, -0.9)), ('forearm.R', (0.4, -0.6, 0.7))])
    return r_


def pose_reaching(arm_, P_):
    r_ = aim_chain(arm_, {'spine': (8, 0, 10), 'head': (-10, 15, 0), 'thigh.R': (-25, 0, 0), 'shin.R': (20, 0, 0)},
                   [('upper_arm.R', (-0.3, -0.9, 0.35)), ('forearm.R', (-0.2, -0.9, 0.3))])
    r_ = aim_chain(arm_, r_, [('upper_arm.L', (0.4, 0.2, -0.9)), ('forearm.L', (0.2, 0.0, -1.0))])
    r_.update(fingers(-10, 15, 0, 0, 'R'))
    return r_


statue('Statue_Weeping', pose_weeping)
statue('Statue_Praying', pose_praying)
statue('Statue_Reaching', pose_reaching)

r = root('DisplayCase')
part(rbox('dcbase', (0.9, 0.6, 0.9), (0, 0, 0.45), bevel=0.01), 'wood_dark', r, 0.6)
part(molding('dcmold', [(-0.47, -0.32, 0.9), (0.47, -0.32, 0.9), (0.47, 0.32, 0.9), (-0.47, 0.32, 0.9)],
             [(0, 0), (0.02, 0.0), (0.02, 0.03), (0.0, 0.03)], closed=True), 'brass', r, 0.3)
gl = join([rbox('dcg', (0.86, 0.56, 0.5), (0, 0, 1.18), bevel=0.0)], 'DisplayCase_Glass')
bm = bmesh.new(); bm.from_mesh(gl.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context='FACES'); bm.to_mesh(gl.data); bm.free()
part(gl, 'glass', r, 1.0, smooth=False)
edges = []
for (x, y) in ((-0.43, -0.28), (0.43, -0.28), (-0.43, 0.28), (0.43, 0.28)):
    edges.append(rbox('dce', (0.015, 0.015, 0.5), (x, y, 1.18), bevel=0.0))
part(join(edges, 'dcedges'), 'brass', r, 0.3)
cush = rbox('dccush', (0.5, 0.3, 0.04), (0, 0, 0.93), bevel=0.015); part(cush, 'velvet_red', r, 0.3)
slot = bpy.data.objects.new('DisplayCase_Item', None); link(slot); slot.location = (0, 0, 0.96); slot.parent = r

r = root('SuitOfArmor')
P_ = params(sz=1.02, sx=1.05, bulk=1.1)
ab, AJ = humanoid('armor_body', P_, legs=True, subsurf=1)
plates = shell(ab, 'armor_plates', lambda c: True, offset=0.02, thick=0.004, wrinkle=0.0)
bpy.data.objects.remove(ab, do_unlink=True)
helm = prim('uvsphere', 'helm', u=24, v=16, r=0.5); helm.scale = (0.12, 0.14, 0.16); helm.location = (0, -0.005, P_['head_c'] + 0.01)
apply_transform(helm)
visor = []
for k in range(5):
    visor.append(rbox('vslit', (0.14, 0.02, 0.006), (0, -0.14, P_['head_c'] + 0.02 - k * 0.018), bevel=0.0))
plume = tube_along('plume', [V((0, 0.0, P_['head_c'] + 0.16)), V((0, 0.08, P_['head_c'] + 0.22)), V((0, 0.2, P_['head_c'] + 0.12))],
                   [0.01, 0.03, 0.005], seg=8)
part(join([plates, helm], 'armor'), 'chrome', r, 0.4)
part(join(visor, 'visor'), 'black', r, 0.2)
part(plume, 'velvet_red', r, 0.2)
halb = cyl('halberd', 0.015, 2.3, (0.45, -0.1, 1.15), seg=10); part(halb, 'wood_dark', r, 0.5)
axe = rbox('haxe', (0.02, 0.25, 0.3), (0.45, -0.2, 2.1), bevel=0.01); part(axe, 'iron', r, 0.3)
stand = cyl('astand', 0.3, 0.04, (0, 0, 0.02), seg=24); part(stand, 'wood_dark', r, 0.4)

r = root('Bust')
part(turned('bped', [(0.0, 0), (0.2, 0), (0.18, 0.05), (0.14, 0.1), (0.13, 1.0), (0.18, 1.05), (0.2, 1.1), (0.0, 1.1)], seg=8),
     'marble', r, 0.5, smooth=False)
bh = sculpt_head('bhead', (0, 0, 1.5), (0.08, 0.1, 0.12), noise_amt=0.0)
bs = lathe('bshoulder', [(0.0, 1.1), (0.2, 1.12), (0.22, 1.25), (0.18, 1.33), (0.07, 1.4), (0.05, 1.44), (0.0, 1.44)], seg=32)
bs.scale = (1.3, 0.7, 1); apply_transform(bs)
part(join([bh, bs], 'bstone'), 'marble', r, 0.5)

# ============================================================== DECOR: painting frames, candelabra, coat rack, standing lamp, radiator
def painting(name, w, h, mat):
    rr = root(name)
    part(molding(name + '_frame', rect_path(w, h, 0.0),
                 [(-0.07, 0.0), (0.0, 0.0), (0.01, -0.03), (0.03, -0.035), (0.05, -0.02), (0.07, -0.04), (0.07, 0.0)],
                 closed=True), 'brass', rr, 0.3)
    cv = prim('grid', name + '_canvas', x=2, y=2, size=0.5); cv.rotation_euler = (R90, 0, 0)
    cv.scale = (w, h, 1); cv.location = (0, 0.002, h / 2); apply_transform(cv)
    me = cv.data
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co.x / w + 0.5, co.z / h)
    assign(cv, M(mat)); cv.parent = rr
    return rr


painting('Painting_Portrait', 0.7, 0.95, 'painting_0')
painting('Painting_Tall', 0.9, 1.4, 'painting_1')
painting('Painting_Wide', 1.5, 0.9, 'painting_2')
painting('Painting_Small', 0.45, 0.55, 'painting_3')

r = root('Candelabra')
part(turned('cabase', [(0.0, 0), (0.2, 0), (0.18, 0.03), (0.06, 0.1), (0.03, 0.2), (0.025, 1.3), (0.05, 1.35), (0.0, 1.36)], seg=16),
     'iron', r, 0.3)
for k in range(5):
    a = k / 5 * TAU
    ex = 0.0 if k == 0 else 0.18
    if k:
        part(tube_along('caarm', [V((0, 0, 1.3)), V((ex * math.cos(a), ex * math.sin(a), 1.32)), V((ex * math.cos(a), ex * math.sin(a), 1.42))],
                        0.008, seg=6), 'iron', r, 0.3)
    wx, wi, fl = candle('ca', (ex * math.cos(a), ex * math.sin(a), 1.42 if k else 1.36), rnd.uniform(0.1, 0.18), 0.012)
    part(wx, 'wax', r, 0.1); part(wi, 'black', r, 0.1); part(fl, 'flame', r, 0.1)
tag = bpy.data.objects.new('Candelabra_Light', None); link(tag); tag.location = (0, 0, 1.55); tag.parent = r

r = root('CoatRack')
part(turned('crbase', [(0.0, 0), (0.25, 0), (0.2, 0.04), (0.04, 0.08), (0.03, 1.75), (0.05, 1.8), (0.0, 1.85)], seg=16), 'wood_dark', r, 0.3)
for k in range(4):
    a = k / 4 * TAU
    part(tube_along('hook', [V((0, 0, 1.6)), V((0.12 * math.cos(a), 0.12 * math.sin(a), 1.68)), V((0.15 * math.cos(a), 0.15 * math.sin(a), 1.75))],
                    0.008, seg=6), 'brass', r, 0.2)
coat = lathe('coat', [(0.05, 1.62), (0.2, 1.5), (0.22, 1.2), (0.24, 0.8), (0.26, 0.6)], seg=24)
coat.scale = (1, 0.5, 1); coat.location = (0.1, 0, 0); apply_transform(coat); displace_noise(coat, 0.01, 0.1)
add_solidify(coat, 0.01); part(coat, 'leather', r, 0.5)

r = root('Radiator')
fins = [rbox('fin', (0.05, 0.16, 0.7), (-0.4 + k * 0.08, 0, 0.45), bevel=0.02, segs=3) for k in range(11)]
part(join(fins + [cyl('rpipe', 0.02, 0.9, (0, 0, 0.12), seg=10, rot=(0, R90, 0)),
                  cyl('rpipe2', 0.02, 0.9, (0, 0, 0.78), seg=10, rot=(0, R90, 0))], 'rad'), 'iron', r, 0.3)

# ============================================================== DOORS, WINDOW, CURTAIN, VENT
r = root('DoorLeaf')           # 0.95 x 2.15, origin at hinge (x=0), extends +X, front -Y
DW_, DH_ = 0.95, 2.15
frame = rbox('dlf', (DW_, 0.045, DH_), (DW_ / 2, 0, DH_ / 2), bevel=0.004)
pans = []
for (cz, h) in ((0.35, 0.5), (1.0, 0.6), (1.7, 0.6)):
    for cx in (0.27, 0.68):
        pans.append(raised_panel('dlp', 0.32, h, 0.02, 0.04, loc=(cx, -0.022, cz)))
        pans.append(raised_panel('dlp', 0.32, h, 0.02, 0.04, loc=(cx, 0.022, cz), rot=(0, 0, math.pi)))
part(join([frame] + pans, 'DoorLeaf_Wood'), 'wood_dark', r, 0.6)
for sy in (-1, 1):
    plate = rbox('dlplate', (0.05, 0.006, 0.2), (DW_ - 0.08, sy * 0.026, 1.0), bevel=0.002)
    kb = knob('dlknob', (DW_ - 0.08, sy * 0.03, 1.0), 0.026)
    if sy > 0:
        kb.rotation_euler = (0, 0, math.pi); apply_transform(kb)
    kh = rbox('dlkey', (0.01, 0.008, 0.02), (DW_ - 0.08, sy * 0.03, 0.93), bevel=0.0)
    part(join([plate, kb, kh], 'dlhw'), 'brass', r, 0.2)
for z in (0.3, 1.85):
    part(cyl('hinge', 0.012, 0.1, (0.0, 0.0, z), seg=10), 'brass', r, 0.2)

r = root('GateDoor')             # grand double door leaf (one leaf; mirrored in-game), origin at hinge
GW, GH = 1.15, 2.9
part(join([rbox('gdf', (GW, 0.08, GH), (GW / 2, 0, GH / 2), bevel=0.01)] +
          [raised_panel('gdp', 0.38, 0.9, 0.03, 0.06, loc=(cx, -0.04, cz)) for cx in (0.3, 0.84) for cz in (0.6, 1.6)] +
          [raised_panel('gdp2', 0.92, 0.5, 0.03, 0.06, loc=(GW / 2, -0.04, 2.45))], 'GateDoor_Wood'), 'wood_dark', r, 0.8)
studs = []
for cx in (0.1, 0.57, 1.05):
    for cz in [0.15 + k * 0.28 for k in range(10)]:
        studs.append(prim('uvsphere', 'stud', u=8, v=6, r=0.014, loc=(cx, -0.045, cz)))
for o in studs:
    apply_transform(o)
part(join(studs, 'gdstuds'), 'iron', r, 0.2)
ringh = prim('torus', 'gring', R=0.08, r=0.012, u=24, v=8); ringh.rotation_euler = (R90, 0, 0); ringh.location = (GW - 0.15, -0.07, 1.25)
apply_transform(ringh); part(ringh, 'iron', r, 0.2)
for z in (0.4, 1.45, 2.5):
    part(rbox('gstrap', (0.7, 0.012, 0.08), (0.35, -0.046, z), bevel=0.004), 'iron', r, 0.3)

r = root('Padlock')
part(rbox('plbody', (0.07, 0.035, 0.08), (0, 0, 0.04), bevel=0.012, segs=3), 'brass', r, 0.1)
sh_ = prim('torus', 'plshackle', R=0.025, r=0.006, u=20, v=8); sh_.rotation_euler = (R90, 0, 0); sh_.location = (0, 0, 0.085)
apply_transform(sh_)
bm = bmesh.new(); bm.from_mesh(sh_.data)
bmesh.ops.delete(bm, geom=[vv for vv in bm.verts if vv.co.z < 0.078], context='VERTS'); bm.to_mesh(sh_.data); bm.free()
legs_ = [cyl('pll', 0.006, 0.02, (s * 0.025, 0, 0.08), seg=8) for s in (-1, 1)]
part(join([sh_] + legs_, 'Padlock_Shackle'), 'chrome', r, 0.1)
kh = rbox('plkh', (0.008, 0.004, 0.02), (0, -0.018, 0.03), bevel=0.0); part(kh, 'black', r, 0.1)

r = root('ChainDrape')
links = []
for k in range(40):
    t = k / 39
    x = -0.6 + t * 1.2
    z = 1.3 - 0.35 * math.sin(t * math.pi)
    lk = prim('torus', 'clk', R=0.022, r=0.006, u=12, v=6); lk.scale = (1, 0.6, 1)
    lk.rotation_euler = (R90 * (k % 2), 0, 0); lk.location = (x, -0.09, z); apply_transform(lk); links.append(lk)
part(join(links, 'chainj'), 'iron', r, 0.2)

r = root('WindowFrame')         # sits in a wall opening 1.2 x 1.9, sill at z=0.8, glass plane named for rain shader
WWn, WHn, SZ = 1.2, 1.9, 0.8
part(molding('wfr', rect_path(WWn, WHn, SZ), [(-0.06, -0.1), (0.0, -0.1), (0.0, 0.1), (-0.06, 0.1)], closed=True), 'wood_dark', r, 0.5)
part(rbox('wsill', (WWn + 0.2, 0.3, 0.05), (0, -0.1, SZ - 0.03), bevel=0.01), 'wood_dark', r, 0.5)
mull = [rbox('mul', (0.04, 0.06, WHn), (0, 0, SZ + WHn / 2), bevel=0.005),
        rbox('mul', (WWn, 0.06, 0.04), (0, 0, SZ + WHn * 0.62), bevel=0.005)]
for k in (1, 2):
    mull.append(rbox('mul', (WWn, 0.03, 0.02), (0, 0, SZ + WHn * 0.62 * k / 3), bevel=0.003))
part(join(mull, 'wmull'), 'wood_dark', r, 0.5)
gl = prim('grid', 'Window_Glass', x=2, y=2, size=0.5); gl.rotation_euler = (R90, 0, 0); gl.scale = (WWn, WHn, 1)
gl.location = (0, 0.0, SZ + WHn / 2); apply_transform(gl)
me = gl.data; uvl = me.uv_layers.new(name='UVMap')
for poly in me.polygons:
    for li in poly.loop_indices:
        co = me.vertices[me.loops[li].vertex_index].co
        uvl.data[li].uv = (co.x / WWn + 0.5, (co.z - SZ) / WHn)
gl = join([gl], 'Window_Glass'); assign(gl, M('glass')); gl.parent = r

r = root('Curtain')              # one panel 0.9 wide x 3.2 tall hanging from z=3.3, gathered folds
CW, CH = 0.9, 3.25
cv, cf = [], []
NX, NZ = 36, 50
for j in range(NZ + 1):
    z = 3.3 - j / NZ * CH
    tie = 1.0 - 0.55 * math.exp(-((z - 1.1) / 0.35) ** 2)          # tied back near 1.1 m
    for i in range(NX + 1):
        u = i / NX
        x = (u - 0.5) * CW * tie + 0.25 * CW * (1 - tie)
        y = 0.05 * math.sin(u * math.pi * 11) * (0.6 + 0.4 * tie) + 0.01 * noise.noise(V((u * 8, z * 2, 0)))
        cv.append((x, y, max(z, 0.02 + 0.03 * math.sin(u * 20))))
for j in range(NZ):
    for i in range(NX):
        a = j * (NX + 1) + i
        cf.append((a, a + 1, a + NX + 2, a + NX + 1))
cur = mesh_obj('curtain', cv, cf); add_solidify(cur, 0.006); shade_smooth(cur)
part(cur, 'velvet_red', r, 0.5)
tieb = prim('torus', 'tie', R=0.1, r=0.018, u=20, v=6); tieb.scale = (1.1, 0.6, 0.5); tieb.location = (0.12, 0.0, 1.1)
apply_transform(tieb); part(tieb, 'brass', r, 0.2)

r = root('CurtainRod')
part(cyl('rod', 0.018, 2.2, (0, -0.1, 3.32), seg=12, rot=(0, R90, 0)), 'brass', r, 0.3)
for s in (-1, 1):
    fin = turned('fin', [(0.0, 0), (0.03, 0.02), (0.04, 0.05), (0.0, 0.12)], seg=12, rot=(0, R90 * s, 0))
    fin.location = (s * 1.1, -0.1, 3.32); apply_transform(fin); part(fin, 'brass', r, 0.2)
    br_ = rbox('rbr', (0.03, 0.12, 0.03), (s * 0.95, -0.05, 3.32), bevel=0.005); part(br_, 'brass', r, 0.2)

r = root('VentGrate')            # 0.9 x 0.9 grate, origin bottom-centre
g = [rbox('vgf', (0.9, 0.04, 0.05), (0, 0, 0.025), bevel=0.005), rbox('vgf', (0.9, 0.04, 0.05), (0, 0, 0.875), bevel=0.005),
     rbox('vgf', (0.05, 0.04, 0.9), (-0.425, 0, 0.45), bevel=0.005), rbox('vgf', (0.05, 0.04, 0.9), (0.425, 0, 0.45), bevel=0.005)]
g += [rbox('vgs', (0.8, 0.012, 0.04), (0, 0, 0.1 + k * 0.08), bevel=0.002, rot=(math.radians(35), 0, 0)) for k in range(10)]
part(join(g, 'VentGrate_Metal'), 'metal_rust', r, 0.3)
r = root('VentBoards')
bds = [rbox('vb', (1.0, 0.03, 0.14), (0, -0.05, 0.15 + k * 0.22), bevel=0.01, rot=(0, rnd.uniform(-0.2, 0.2), 0)) for k in range(4)]
nails = [cyl('nail', 0.005, 0.01, (s * 0.45, -0.07, 0.15 + k * 0.22), seg=6, rot=(R90, 0, 0)) for k in range(4) for s in (-1, 1)]
part(join(bds, 'VentBoards_Wood'), 'wood_old', r, 0.4)
part(join(nails, 'vnails'), 'iron', r, 0.1)

r = root('Baluster')
part(turned('bal', [(0.03, 0), (0.035, 0.04), (0.02, 0.08), (0.028, 0.2), (0.045, 0.35), (0.022, 0.5), (0.03, 0.62),
                    (0.02, 0.72), (0.03, 0.8), (0.03, 0.85)], seg=12), 'wood_dark', r, 0.3)
r = root('NewelPost')
part(turned('np', [(0.08, 0), (0.09, 0.05), (0.07, 0.1), (0.07, 0.9), (0.09, 0.95), (0.1, 1.0), (0.05, 1.05), (0.07, 1.12),
                   (0.0, 1.2)], seg=8), 'wood_dark', r, 0.3, smooth=False)

result = {"roots": len(ROOTS), "names": [x.name for x in ROOTS]}
if CFG.get('preview', True):
    result['p'] = layout_preview('furniture.png', spacing=3.2, cam_h=9, lens=26)
if CFG.get('export', False):
    result['export'] = export_roots('furniture.glb')
