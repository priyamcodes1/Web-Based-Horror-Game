# Pickup items + flashlight -> public/models/items.glb
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
exec(open("D:/Web Based - Horror Game/tools/blender/props_lib.py").read())
reset_scene()
CFG = globals().get('CFG', {})
TAU = math.tau

# ------------------------------------------------------------------ Flashlight (points along -Y = forward)
r = root('Flashlight')
body = turned('fl_body', [(0.0, 0), (0.017, 0), (0.018, 0.004), (0.018, 0.12), (0.019, 0.125), (0.019, 0.135),
                          (0.024, 0.15), (0.029, 0.175), (0.030, 0.19), (0.028, 0.195), (0.0, 0.195)], seg=28,
              rot=(math.radians(90), 0, 0))
part(body, 'iron', r, 0.1)
# knurled grip rings
for i in range(9):
    ring = prim('torus', 'knurl', R=0.0183, r=0.0016, u=28, v=6)
    ring.rotation_euler = (math.radians(90), 0, 0); ring.location = (0, -0.03 - i * 0.008, 0)
    apply_transform(ring)
    part(ring, 'iron', r, 0.1)
lens = cyl('fl_lens', 0.026, 0.004, (0, -0.193, 0), seg=28, rot=(math.radians(90), 0, 0))
part(lens, 'glass', r, 0.1)
reflector = turned('fl_refl', [(0.006, 0), (0.024, 0.02), (0.0245, 0.021)], seg=24, rot=(math.radians(-90), 0, 0))
reflector.location = (0, -0.172, 0); apply_transform(reflector)
part(reflector, 'chrome', r, 0.1)
bulb = prim('uvsphere', 'fl_bulb', u=12, v=8, r=0.006, loc=(0, -0.178, 0)); apply_transform(bulb)
part(bulb, 'bulb', r, 0.1)
sw = rbox('fl_switch', (0.012, 0.022, 0.008), (0, -0.14, 0.0195), bevel=0.003)
part(sw, 'rubber', r, 0.1)
cap = cyl('fl_tailcap', 0.0185, 0.008, (0, 0.002, 0), seg=24, rot=(math.radians(90), 0, 0))
part(cap, 'rubber', r, 0.1)
lanyard = prim('torus', 'fl_ring', R=0.008, r=0.0014, u=16, v=6, loc=(0, 0.012, 0))
apply_transform(lanyard)
part(lanyard, 'chrome', r, 0.1)
tip = bpy.data.objects.new('Flashlight_Tip', None); link(tip); tip.location = (0, -0.2, 0); tip.parent = r

# ------------------------------------------------------------------ Skeleton keys (3 designs)
def skeleton_key(name, mat, bow_style, blade_len=0.075):
    rr = root(name)
    shaft = cyl(name + '_shaft', 0.0032, blade_len, (0, -blade_len / 2, 0), seg=12, rot=(math.radians(90), 0, 0))
    part(shaft, mat, rr, 0.05)
    collar = turned(name + '_collar', [(0.0035, 0), (0.0055, 0.002), (0.0055, 0.006), (0.004, 0.008), (0.0045, 0.011),
                                       (0.0035, 0.013)], seg=12, rot=(math.radians(-90), 0, 0))
    collar.location = (0, 0.002, 0); apply_transform(collar)
    part(collar, mat, rr, 0.05)
    # bit (teeth)
    bit = rbox(name + '_bit', (0.003, 0.016, 0.014), (0, -blade_len + 0.01, -0.009), bevel=0.0006)
    notch = rbox(name + '_bit2', (0.003, 0.005, 0.008), (0, -blade_len + 0.016, -0.018), bevel=0.0005)
    part(join([bit, notch], name + '_bitj'), mat, rr, 0.05)
    # ornate bow
    if bow_style == 0:      # trefoil
        pieces = []
        for k in range(3):
            a = k / 3 * TAU + math.pi / 2
            t = prim('torus', 'bow', R=0.0075, r=0.0017, u=20, v=6)
            t.rotation_euler = (0, math.radians(90), 0)
            t.location = (0, 0.02 + 0.008 * math.sin(a), 0.008 * math.cos(a))
            apply_transform(t); pieces.append(t)
        part(join(pieces, name + '_bow'), mat, rr, 0.05)
    elif bow_style == 1:    # ring with cross
        t = prim('torus', 'bow', R=0.014, r=0.0022, u=28, v=8)
        t.rotation_euler = (0, math.radians(90), 0); t.location = (0, 0.026, 0); apply_transform(t)
        c1 = rbox('c1', (0.003, 0.026, 0.003), (0, 0.026, 0), bevel=0.0008)
        c2 = rbox('c2', (0.003, 0.003, 0.026), (0, 0.026, 0), bevel=0.0008)
        part(join([t, c1, c2], name + '_bow'), mat, rr, 0.05)
    else:                   # heart/skull-like loop
        pts = []
        for k in range(41):
            a = k / 40 * TAU
            x = 16 * math.sin(a) ** 3
            y = 13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)
            pts.append(V((0, 0.024 - y * 0.0009, x * 0.0009)))
        part(tube_along(name + '_bow', pts, 0.0019, seg=6, cap=False), mat, rr, 0.05)
    return rr


skeleton_key('Key_Brass', 'brass', 0)
skeleton_key('Key_Silver', 'chrome', 1, 0.085)
skeleton_key('Key_Iron', 'iron', 2, 0.07)

# ------------------------------------------------------------------ Fuse (ceramic/glass cartridge)
r = root('Fuse')
g = cyl('fuse_glass', 0.011, 0.06, (0, 0, 0), seg=20, rot=(math.radians(90), 0, 0))
part(g, 'glass', r, 0.05)
wire = cyl('fuse_wire', 0.0008, 0.058, (0, 0, 0), seg=5, rot=(math.radians(90), 0, 0))
part(wire, 'chrome', r, 0.05)
for s in (1, -1):
    capf = turned('fuse_cap', [(0.0, 0), (0.0125, 0), (0.0125, 0.014), (0.011, 0.016), (0.0, 0.016)], seg=20,
                  rot=(math.radians(-90 * s), 0, 0))
    capf.location = (0, 0.03 * s, 0); apply_transform(capf)
    part(capf, 'brass', r, 0.05)
    blade = rbox('fuse_blade', (0.012, 0.018, 0.0025), (0, 0.052 * s, 0), bevel=0.0006)
    part(blade, 'brass', r, 0.05)
label = cyl('fuse_label', 0.0112, 0.018, (0, 0, 0), seg=20, rot=(math.radians(90), 0, 0))
part(label, 'paper', r, 0.05)

# ------------------------------------------------------------------ Medkit tin
r = root('Medkit')
box = rbox('mk_box', (0.24, 0.16, 0.08), (0, 0, 0.04), bevel=0.012, segs=3)
part(box, 'porcelain', r, 0.2)
lid_line = rbox('mk_seam', (0.242, 0.162, 0.004), (0, 0, 0.06), bevel=0.001)
part(lid_line, 'iron', r, 0.2)
cross1 = rbox('mk_c1', (0.07, 0.02, 0.003), (0, 0, 0.0805), bevel=0.001)
cross2 = rbox('mk_c2', (0.02, 0.07, 0.003), (0, 0, 0.0805), bevel=0.001)
part(join([cross1, cross2], 'mk_cross'), 'red_cross', r, 0.2)
latch = rbox('mk_latch', (0.03, 0.01, 0.02), (0, -0.083, 0.055), bevel=0.002)
part(latch, 'chrome', r, 0.2)
handle = tube_along('mk_handle', [V((-0.05, 0, 0.082)), V((-0.04, 0, 0.1)), V((0.04, 0, 0.1)), V((0.05, 0, 0.082))],
                    0.004, seg=8)
part(handle, 'rubber', r, 0.2)

# ------------------------------------------------------------------ Adrenaline syringe
r = root('Syringe')
barrel = cyl('sy_barrel', 0.007, 0.075, (0, 0, 0), seg=18, rot=(math.radians(90), 0, 0))
part(barrel, 'glass', r, 0.05)
liquid = cyl('sy_liquid', 0.0062, 0.05, (0, -0.01, 0), seg=16, rot=(math.radians(90), 0, 0))
part(liquid, 'emissive_red', r, 0.05)
plunger = cyl('sy_plunger', 0.0025, 0.05, (0, 0.055, 0), seg=10, rot=(math.radians(90), 0, 0))
thumb = cyl('sy_thumb', 0.009, 0.003, (0, 0.08, 0), seg=18, rot=(math.radians(90), 0, 0))
flange = rbox('sy_flange', (0.03, 0.003, 0.012), (0, 0.037, 0), bevel=0.001)
part(join([plunger, thumb, flange], 'sy_pl'), 'plastic', r, 0.05)
hub = cyl('sy_hub', 0.003, 0.01, (0, -0.042, 0), seg=10, r2=0.0018, rot=(math.radians(90), 0, 0))
needle = cyl('sy_needle', 0.0005, 0.03, (0, -0.062, 0), seg=6, rot=(math.radians(90), 0, 0))
part(join([hub, needle], 'sy_n'), 'chrome', r, 0.05)

# ------------------------------------------------------------------ Crowbar
r = root('Crowbar')
pts = [V((0, 0.33, 0.05)), V((0, 0.35, 0.03)), V((0, 0.345, 0.005)), V((0, 0.32, 0.0)), V((0, 0.2, 0)), V((0, 0.0, 0)),
       V((0, -0.3, 0)), V((0, -0.34, 0.006)), V((0, -0.36, 0.02))]
bar = tube_along('cb_bar', pts, [(0.011, 0.009)] * len(pts), seg=8)
part(bar, 'metal_rust', r, 0.2)
for s in (1, -1):
    claw = rbox('cb_claw', (0.004, 0.03, 0.01), (0.005 * s, 0.335, 0.055), bevel=0.001, rot=(math.radians(-40), 0, 0))
    part(claw, 'metal_rust', r, 0.2)
wrap = cyl('cb_grip', 0.013, 0.14, (0, -0.1, 0), seg=12, rot=(math.radians(90), 0, 0))
displace_noise(wrap, 0.0015, 0.004)
part(wrap, 'leather', r, 0.1)

# ------------------------------------------------------------------ Battery (D cell)
r = root('Battery')
bb = cyl('bat_body', 0.017, 0.06, (0, 0, 0.03), seg=24)
part(bb, 'lacquer', r, 0.05)
band = cyl('bat_band', 0.0172, 0.02, (0, 0, 0.05), seg=24)
part(band, 'brass', r, 0.05)
nub = cyl('bat_nub', 0.005, 0.004, (0, 0, 0.062), seg=12)
bot = cyl('bat_bottom', 0.014, 0.002, (0, 0, 0.0), seg=20)
part(join([nub, bot], 'bat_t'), 'chrome', r, 0.05)

# ------------------------------------------------------------------ Crucifix (wood + brass corpus plate)
r = root('Crucifix')
v_ = rbox('cr_v', (0.022, 0.012, 0.2), (0, 0, 0.1), bevel=0.003)
h_ = rbox('cr_h', (0.12, 0.012, 0.022), (0, 0, 0.14), bevel=0.003)
part(join([v_, h_], 'cr_wood'), 'wood_dark', r, 0.1)
for (x, z) in ((0, 0.2), (0, 0.0), (0.06, 0.14), (-0.06, 0.14)):
    tipc = turned('cr_tip', [(0.0, 0), (0.014, 0.0), (0.016, 0.004), (0.0, 0.008)], seg=12,
                  rot=(math.radians(90), 0, 0))
    tipc.location = (x, -0.004, z); apply_transform(tipc)
    part(tipc, 'brass', r, 0.1)
plate = rbox('cr_plate', (0.012, 0.004, 0.06), (0, -0.008, 0.12), bevel=0.002)
part(plate, 'brass', r, 0.1)

# ------------------------------------------------------------------ Pills bottle
r = root('Pills')
pb = turned('pb_body', [(0.0, 0), (0.018, 0), (0.019, 0.004), (0.019, 0.06), (0.013, 0.07), (0.011, 0.075), (0.0, 0.075)],
            seg=20)
part(pb, 'glass', r, 0.05)
lab = cyl('pb_label', 0.0195, 0.035, (0, 0, 0.032), seg=20)
part(lab, 'paper', r, 0.05)
cork = cyl('pb_cap', 0.0125, 0.016, (0, 0, 0.082), seg=16)
part(cork, 'wood_light', r, 0.05)

# ------------------------------------------------------------------ Note (curled paper)
r = root('Note')
nt_ = prim('grid', 'note', x=10, y=14, size=0.5)
bpy.context.view_layer.update()
d0 = nt_.dimensions
nt_.scale = (0.21 / max(d0.x, 1e-6), 0.29 / max(d0.y, 1e-6), 1)
apply_transform(nt_)
for v in nt_.data.vertices:
    v.co.z = 0.006 * math.sin(v.co.x * 20) + 0.01 * (v.co.y / 0.145) ** 2
nt_.data.update()
add_solidify(nt_, 0.0008)
part(nt_, 'paper', r, 0.3)

# ------------------------------------------------------------------ Music box (wind-up, with ballerina)
r = root('MusicBox')
mb = rbox('mb_box', (0.16, 0.11, 0.07), (0, 0, 0.035), bevel=0.006, segs=3)
part(mb, 'wood_dark', r, 0.2)
trim = molding('mb_trim', [(-0.08, -0.055, 0.07), (0.08, -0.055, 0.07), (0.08, 0.055, 0.07), (-0.08, 0.055, 0.07)],
               [(0.0, 0.0), (0.004, 0.0), (0.004, 0.004), (0.0, 0.006)], closed=True)
part(trim, 'brass', r, 0.2)
lid = rbox('mb_lid', (0.16, 0.11, 0.012), (0, 0.055, 0.0), bevel=0.004)
lid_o = join([lid], 'MusicBox_Lid')
pivot(lid_o, (0, 0.055, 0.07))
lid_o.rotation_euler = (math.radians(-100), 0, 0)
part(lid_o, 'wood_dark', r, 0.2)
mirror_ = rbox('mb_mirror', (0.12, 0.002, 0.08), (0, 0.062, 0.06), bevel=0.001)
lid_mirror = mirror_
lid_mirror.parent = lid_o
assign(lid_mirror, M('mirror'))
ped = cyl('mb_ped', 0.012, 0.01, (0, 0, 0.075), seg=16)
part(ped, 'brass', r, 0.2)
ballerina = []
bb1 = turned('bal_skirt', [(0.0, 0), (0.016, 0.0), (0.012, 0.006), (0.004, 0.01)], seg=16); bb1.location = (0, 0, 0.1); apply_transform(bb1)
bb2 = cyl('bal_body', 0.0035, 0.018, (0, 0, 0.118), seg=10, r2=0.0028)
bb3 = prim('uvsphere', 'bal_head', u=10, v=8, r=0.004, loc=(0, 0, 0.131)); apply_transform(bb3)
bb4 = cyl('bal_leg', 0.0015, 0.02, (0, 0, 0.088), seg=6)
bb5 = cyl('bal_arms', 0.0012, 0.028, (0, 0, 0.126), seg=6, rot=(0, math.radians(90), 0))
bal = join([bb1, bb2, bb3, bb4, bb5], 'MusicBox_Ballerina')
pivot(bal, (0, 0, 0.08))
part(bal, 'porcelain', r, 0.05)
crank = tube_along('mb_crank', [V((0.08, 0, 0.035)), V((0.1, 0, 0.035)), V((0.1, 0, 0.055)), V((0.115, 0, 0.055))], 0.0022, seg=6)
knb = cyl('mb_knob', 0.004, 0.012, (0.121, 0, 0.055), seg=10, rot=(0, math.radians(90), 0))
part(join([crank, knb], 'MusicBox_Crank'), 'brass', r, 0.2)

# ------------------------------------------------------------------ Candle stick (carryable light)
r = root('Candle')
holder = turned('cs_holder', [(0.0, 0), (0.05, 0), (0.052, 0.006), (0.045, 0.012), (0.012, 0.02), (0.014, 0.05),
                              (0.02, 0.06), (0.014, 0.065), (0.0, 0.065)], seg=24)
part(holder, 'brass', r, 0.1)
handle = prim('torus', 'cs_ring', R=0.018, r=0.0035, u=18, v=6)
handle.rotation_euler = (math.radians(90), 0, 0); handle.location = (0.058, 0, 0.012); apply_transform(handle)
part(handle, 'brass', r, 0.1)
w, wi, fl = candle('cs', (0, 0, 0.062), 0.12, 0.011)
part(w, 'wax', r, 0.1); part(wi, 'black', r, 0.1); part(fl, 'flame', r, 0.1)

result = {"roots": [x.name for x in ROOTS]}
if CFG.get('preview', True):
    result['p'] = layout_preview('items.png', spacing=0.35, cam_h=0.9, lens=35)
if CFG.get('export', False):
    result['export'] = export_roots('items.glb')
