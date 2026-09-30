# Humanoid character framework (exec'd after lib.py). Used by child.py, warden.py, player.py.
# Coordinates: Z up, character faces -Y, left side = +X. Baseline adult = 1.78 m.
from mathutils.kdtree import KDTree

BASE = dict(
    pelvis=1.00, belly=1.14, chest=1.30, upchest=1.42, neckb=1.49, neckt=1.585, head_c=1.675,
    sh_x=0.185, sh_z=1.445, ua=0.295, fa=0.255, abduct=46.0,
    hip_x=0.092, hip_z=0.93, knee_z=0.505, ankle_z=0.085,
    r_hips=(0.155, 0.112), r_belly=(0.14, 0.10), r_chest=(0.158, 0.108), r_upchest=(0.16, 0.098),
    r_neck=0.056, r_ua=(0.050, 0.040), r_fa=(0.041, 0.029), r_thigh=(0.088, 0.061), r_calf=(0.060, 0.040),
    head=(0.076, 0.098, 0.118), finger=1.0, hand=1.0, foot=1.0,
)


def params(**over):
    P = dict(BASE)
    sz, sx, bulk = over.pop('sz', 1.0), over.pop('sx', 1.0), over.pop('bulk', 1.0)
    limb = over.pop('limb', 1.0)
    for k in ('pelvis', 'belly', 'chest', 'upchest', 'neckb', 'neckt', 'head_c', 'sh_z', 'hip_z', 'knee_z',
              'ankle_z'):
        P[k] = BASE[k] * sz
    P['ua'] = BASE['ua'] * sz * limb
    P['fa'] = BASE['fa'] * sz * limb
    P['sh_x'] = BASE['sh_x'] * sx
    P['hip_x'] = BASE['hip_x'] * sx
    for k in ('r_hips', 'r_belly', 'r_chest', 'r_upchest'):
        P[k] = (BASE[k][0] * sx * bulk, BASE[k][1] * sx * bulk)
    for k in ('r_ua', 'r_fa', 'r_thigh', 'r_calf'):
        P[k] = (BASE[k][0] * sx * bulk ** 0.8, BASE[k][1] * sx * bulk ** 0.8)
    P['r_neck'] = BASE['r_neck'] * sx * bulk ** 0.7
    P['scale'] = sz
    P.update(over)
    return P


def humanoid(name, P, legs=True, subsurf=2):
    """Skin-modifier body with detailed hands (+feet). Returns (body_obj, J joints dict)."""
    sk = Skel()
    J = {}
    sz = P['scale']
    sk.add('hips', (0, 0.0, P['pelvis']), P['r_hips'])
    sk.add('belly', (0, -0.004, P['belly']), P['r_belly'], 'hips')
    sk.add('chest', (0, 0.0, P['chest']), P['r_chest'], 'belly')
    sk.add('upchest', (0, 0.008, P['upchest']), P['r_upchest'], 'chest')
    sk.add('neckb', (0, 0.014, P['neckb']), P['r_neck'] * 1.08, 'upchest')
    sk.add('neckt', (0, 0.012, P['neckt']), P['r_neck'], 'neckb')
    sk.add('neckin', (0, 0.008, P['neckt'] + 0.04 * sz), P['r_neck'] * 0.9, 'neckt')
    J.update(hips=V((0, 0, P['pelvis'])), spine=V((0, 0, P['belly'])), chest=V((0, 0, P['chest'])),
             upchest=V((0, 0.008, P['upchest'])), neck=V((0, 0.014, P['neckb'])), neckt=V((0, 0.012, P['neckt'])),
             head=V((0, 0.0, P['head_c'])))
    ab = math.radians(P['abduct'])
    for s in (1, -1):
        t = 'L' if s > 0 else 'R'
        sh = V((P['sh_x'] * s, 0.018, P['sh_z']))
        el = sh + V((math.sin(ab) * P['ua'] * s, 0.012, -math.cos(ab) * P['ua']))
        wr = el + V((math.sin(ab + 0.03) * P['fa'] * s, -0.012, -math.cos(ab + 0.03) * P['fa']))
        d = (wr - el).normalized()
        n = V((-abs(d.z) * s, 0, -abs(d.x))).normalized()
        clav = V((P['sh_x'] * 0.45 * s, 0.016, P['sh_z'] + 0.012 * sz))
        sk.add('clav' + t, clav, P['r_upchest'][1] * 0.55, 'upchest')
        sk.add('sh' + t, sh, P['r_ua'][0] * 1.05, 'clav' + t)
        sk.add('ua' + t, sh.lerp(el, 0.5), (P['r_ua'][0] + P['r_ua'][1]) / 2, 'sh' + t)
        sk.add('el' + t, el, P['r_ua'][1], 'ua' + t)
        sk.add('fa' + t, el.lerp(wr, 0.45), P['r_fa'][0], 'el' + t)
        sk.add('wr' + t, wr, P['r_fa'][1], 'fa' + t)
        hs = P['hand'] * sz
        palm = wr + d * 0.045 * hs
        kn = wr + d * 0.092 * hs
        sk.add('pm' + t, palm, (0.034 * hs, 0.014 * hs), 'wr' + t)
        sk.add('kn' + t, kn, (0.036 * hs, 0.013 * hs), 'pm' + t)
        J['sh' + t], J['el' + t], J['wr' + t], J['kn' + t] = sh, el, wr, kn
        J['clav' + t] = V((0.02 * s, 0.014, P['sh_z'] + 0.005))
        fing = []
        for fi, (off, L) in enumerate(((-0.026, 0.085), (-0.009, 0.094), (0.009, 0.088), (0.025, 0.07))):
            L *= P['finger'] * hs
            base = kn + V((0, off * hs, 0)) + d * 0.004
            p1 = base + d * L * 0.46 + n * 0.004 * hs
            p2 = p1 + d * L * 0.31 + n * 0.008 * hs
            p3 = p2 + d * L * 0.23 + n * 0.009 * hs
            fr = 0.0098 * hs * P.get('finger_thick', 1.0)
            sk.chain([f'f{fi}a{t}', f'f{fi}b{t}', f'f{fi}c{t}', f'f{fi}d{t}'], [base, p1, p2, p3],
                     [fr, fr * 0.9, fr * 0.8, fr * 0.62], 'kn' + t)
            fing.append([base, p1, p2, p3])
        tb = wr + d * 0.03 * hs + V((0, -0.024 * hs, 0)) + n * 0.008 * hs
        tdir = (d * 0.55 + V((0, -0.75, 0)) + n * 0.35).normalized()
        th = [tb, tb + tdir * 0.036 * hs, tb + tdir * 0.064 * hs, tb + tdir * 0.086 * hs]
        tr_ = 0.012 * hs * P.get('finger_thick', 1.0)
        sk.chain(['t0' + t, 't1' + t, 't2' + t, 't3' + t], th, [tr_, tr_ * 0.85, tr_ * 0.75, tr_ * 0.6], 'pm' + t)
        J['fing' + t], J['thumb' + t] = fing, th
        if legs:
            hp = V((P['hip_x'] * s, 0.0, P['hip_z']))
            kz = V((P['hip_x'] * 1.03 * s, -0.012, P['knee_z']))
            an = V((P['hip_x'] * 1.08 * s, 0.018, P['ankle_z']))
            fs = P['foot'] * sz
            ball = an + V((0.006 * s, -0.125 * fs, -0.055 * sz))
            toe = an + V((0.01 * s, -0.19 * fs, -0.065 * sz))
            heel = an + V((0, 0.035 * fs, -0.055 * sz))
            sk.add('hp' + t, hp, P['r_thigh'][0], 'hips')
            sk.add('th' + t, hp.lerp(kz, 0.45), (P['r_thigh'][0] + P['r_thigh'][1]) / 2 * 1.02, 'hp' + t)
            sk.add('kn_' + t, kz, P['r_thigh'][1], 'th' + t)
            sk.add('cf' + t, kz.lerp(an, 0.32), P['r_calf'][0], 'kn_' + t)
            sk.add('an' + t, an, P['r_calf'][1], 'cf' + t)
            sk.add('hl' + t, heel, (0.03 * fs, 0.028 * fs), 'an' + t)
            sk.add('ba' + t, ball, (0.043 * fs, 0.02 * fs), 'an' + t)
            sk.add('to' + t, toe, (0.036 * fs, 0.016 * fs), 'ba' + t)
            J['hp' + t], J['knee' + t], J['ankle' + t], J['ball' + t], J['toe' + t] = hp, kz, an, ball, toe
    body = sk.build(name, subsurf=subsurf, root='hips', branch_smooth=0.2)
    return body, J


FACE_HUMAN = [
    # (x, z, radius, amount, scale, direction) - symmetric entries use x>0 and are mirrored
    (0.033, 0.018, 0.015, 0.010, (1.4, 1, 0.9), (0, 1, 0)),     # eye sockets
    (0.035, 0.043, 0.015, 0.005, (1.6, 1, 0.7), (0, -1, 0)),    # brow
    (0.052, -0.004, 0.016, 0.004, (1, 1, 0.9), (1, -0.5, 0)),   # cheekbones
    (0.071, 0.004, 0.012, 0.009, (0.5, 1.2, 1.9), (1, 0, 0)),   # ears
    (0.018, -0.068, 0.012, 0.003, (1.5, 1, 1), (0, -1, 0)),     # mouth corners/jaw
]
FACE_CENTER = [
    (0, 0.018, 0.007, 0.007, (1, 1, 2.3), (0, -1, 0)),          # nose bridge
    (0, -0.022, 0.011, 0.015, (1.1, 1, 1.1), (0, -1, 0)),       # nose tip
    (0, -0.044, 0.012, 0.004, (1.6, 1, 0.5), (0, -1, 0)),       # upper lip
    (0, -0.056, 0.012, 0.004, (1.5, 1, 0.5), (0, -1, 0)),       # lower lip
    (0, -0.050, 0.014, -0.002, (2.0, 1, 0.25), (0, -1, 0)),     # lip line
    (0, -0.090, 0.014, 0.005, (1.6, 1, 1), (0, -1, 0)),         # chin
]


def sculpt_head(name, center, dims, sym_feats=None, center_feats=None, taper=0.35, flatten=0.6, subsurf=1,
                noise_amt=0.0012):
    AX, AY, AZ = dims
    head = prim('uvsphere', name, u=64, v=44, r=1.0)

    def shape(c):
        x, y, z = c.x * AX, c.y * AY, c.z * AZ
        f = max(0.0, -z / AZ)
        x *= 1 - taper * f ** 1.5
        if y < 0:
            y *= 1 - 0.10 * f
        else:
            y *= 1 - 0.45 * f ** 1.15
        if y > 0 and z > -0.02:
            y *= 1.07
        lim = -AY * 0.6
        if y < lim:
            y = lim + (y - lim) * flatten
        return V((x, y, z))

    deform(head, shape)

    def fy(x, z, r=0.009):
        ys = [v.co.y for v in head.data.vertices if abs(v.co.x - x) < r and abs(v.co.z - z) < r and v.co.y < 0]
        return min(ys) if ys else -AY * 0.8

    sf = FACE_HUMAN if sym_feats is None else sym_feats
    cf = FACE_CENTER if center_feats is None else center_feats
    for (x, z, r, a, sc, d) in sf:
        for s in (1, -1):
            dd = (d[0] * s, d[1], d[2])
            push(head, (x * s, fy(x * s, z), z), r, a, sc, dd)
    for (x, z, r, a, sc, d) in cf:
        push(head, (x, fy(x, z), z), r, a, sc, d)
    recalc_normals(head)
    if subsurf:
        add_subsurf(head, subsurf)
    if noise_amt:
        displace_noise(head, strength=noise_amt, scale=0.012)
    head.location = V(center)
    apply_transform(head)
    shade_smooth(head)
    head['_fy'] = 0
    return head


def eyes_for(head, center, x=0.033, z=0.018, r=0.0122, inset=0.011, name='Eyes'):
    es = []
    for s in (1, -1):
        cand = [v.co.y for v in head.data.vertices
                if abs(v.co.x - x * s) < 0.006 and abs(v.co.z - (center[2] + z)) < 0.006]
        fy = min(cand) if cand else center[1] - 0.08
        es.append(prim('uvsphere', f'{name}{s}', u=24, v=16, r=r, loc=(x * s, fy + inset, center[2] + z)))
    e = join(es, name)
    apply_transform(e)
    shade_smooth(e)
    return e


# ----------------------------------------------------------------------------- clothing
def shell(body, name, keep, offset=0.012, thick=0.006, wrinkle=0.004, wrinkle_scale=0.05, seed=0):
    """Garment made from the body surface: keep(co)->bool selects region; offset along normals.
    Because it is derived from the body, copying weights keeps it glued -> no clipping."""
    me = body.data.copy()
    obj = link(bpy.data.objects.new(name, me))
    obj.matrix_world = body.matrix_world.copy()
    bm = bmesh.new(); bm.from_mesh(me)
    bm.normal_update()
    kill = [v for v in bm.verts if not keep(v.co)]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    for v in bm.verts:
        n = noise.noise(v.co / wrinkle_scale + V((seed, seed, seed)))
        v.co += v.normal * (offset + wrinkle * n)
    bm.to_mesh(me); bm.free()
    for vg in list(obj.vertex_groups):
        obj.vertex_groups.remove(vg)
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    if thick:
        add_solidify(obj, thick, offset=-1.0)
    shade_smooth(obj)
    return obj


def copy_weights(src, dst, k=3):
    """Transfer vertex weights from nearest source vertices (inverse-distance blended)."""
    kd = KDTree(len(src.data.vertices))
    for i, v in enumerate(src.data.vertices):
        kd.insert(src.matrix_world @ v.co, i)
    kd.balance()
    names = {g.index: g.name for g in src.vertex_groups}
    groups = {}
    for g in src.vertex_groups:
        groups[g.name] = dst.vertex_groups.get(g.name) or dst.vertex_groups.new(name=g.name)
    for v in dst.data.vertices:
        p = dst.matrix_world @ v.co
        acc = {}
        tot = 0
        for (co, idx, dist) in kd.find_n(p, k):
            w = 1.0 / max(dist, 1e-4) ** 2
            tot += w
            for g in src.data.vertices[idx].groups:
                acc[names[g.group]] = acc.get(names[g.group], 0) + g.weight * w
        for nme, x in acc.items():
            if x / tot > 0.003:
                groups[nme].add([v.index], x / tot, 'REPLACE')
    arm = next((m.object for m in src.modifiers if m.type == 'ARMATURE'), None)
    if arm:
        mod = dst.modifiers.new("Armature", 'ARMATURE'); mod.object = arm
        dst.parent = arm
        dst.matrix_parent_inverse = arm.matrix_world.inverted()
    return dst


# ----------------------------------------------------------------------------- rig
def humanoid_bones(J, P, legs=True, jaw=None, extra=()):
    sz = P['scale']
    b = [
        dict(name='root', head=(0, 0, 0), tail=(0, 0, 0.25 * sz), deform=False),
        dict(name='hips', head=tuple(J['hips']), tail=tuple(J['spine']), parent='root'),
        dict(name='spine', head=tuple(J['spine']), tail=tuple(J['chest']), parent='hips', connect=True),
        dict(name='chest', head=tuple(J['chest']), tail=tuple(J['upchest']), parent='spine', connect=True),
        dict(name='neck', head=tuple(J['neck']), tail=tuple(J['neckt']), parent='chest'),
        dict(name='head', head=tuple(J['neckt']), tail=tuple(J['head'] + V((0, 0, 0.14 * sz))), parent='neck',
             connect=True),
    ]
    if jaw:
        b.append(dict(name='jaw', head=tuple(jaw[0]), tail=tuple(jaw[1]), parent='head'))
    for s in (1, -1):
        t = 'L' if s > 0 else 'R'
        b += [
            dict(name=f'clav.{t}', head=tuple(J['clav' + t]), tail=tuple(J['sh' + t]), parent='chest'),
            dict(name=f'upper_arm.{t}', head=tuple(J['sh' + t]), tail=tuple(J['el' + t]), parent=f'clav.{t}',
                 connect=True),
            dict(name=f'forearm.{t}', head=tuple(J['el' + t]), tail=tuple(J['wr' + t]), parent=f'upper_arm.{t}',
                 connect=True),
            dict(name=f'hand.{t}', head=tuple(J['wr' + t]), tail=tuple(J['kn' + t]), parent=f'forearm.{t}',
                 connect=True),
        ]
        for fi, pts in enumerate(J['fing' + t]):
            par = f'hand.{t}'
            for k in range(3):
                nm = f'f{fi}.{k}.{t}'
                b.append(dict(name=nm, head=tuple(pts[k]), tail=tuple(pts[k + 1]), parent=par, connect=k > 0))
                par = nm
        par = f'hand.{t}'
        for k in range(3):
            nm = f'thumb.{k}.{t}'
            b.append(dict(name=nm, head=tuple(J['thumb' + t][k]), tail=tuple(J['thumb' + t][k + 1]), parent=par,
                          connect=k > 0))
            par = nm
        if legs:
            b += [
                dict(name=f'thigh.{t}', head=tuple(J['hp' + t]), tail=tuple(J['knee' + t]), parent='hips'),
                dict(name=f'shin.{t}', head=tuple(J['knee' + t]), tail=tuple(J['ankle' + t]), parent=f'thigh.{t}',
                     connect=True),
                dict(name=f'foot.{t}', head=tuple(J['ankle' + t]), tail=tuple(J['ball' + t]), parent=f'shin.{t}',
                     connect=True),
                dict(name=f'toe.{t}', head=tuple(J['ball' + t]), tail=tuple(J['toe' + t]), parent=f'foot.{t}',
                     connect=True),
            ]
    b += list(extra)
    return b


def bone_sets(bones):
    names = [x['name'] for x in bones]
    S = dict(
        fingers={n for n in names if n.startswith(('f0', 'f1', 'f2', 'f3', 'thumb'))},
        arms={n for n in names if n.split('.')[0] in ('clav', 'upper_arm', 'forearm', 'hand')},
        legs={n for n in names if n.split('.')[0] in ('thigh', 'shin', 'foot', 'toe')},
        core={'hips', 'spine', 'chest', 'neck', 'head'},
    )
    S['body'] = S['core'] | S['arms'] | S['fingers'] | S['legs']
    return S


def jaw_weights(obj, HC, zr=(-0.15, -0.03), yr=0.03, xr=0.075):
    jg = obj.vertex_groups.get('jaw') or obj.vertex_groups.new(name='jaw')
    hg = obj.vertex_groups.get('head')
    if hg is None:
        return
    for v in obj.data.vertices:
        c = v.co
        lz, ly = c.z - HC[2], c.y - HC[1]
        if zr[0] < lz < zr[1] and ly < yr and abs(c.x) < xr:
            w = min(1.0, (zr[1] - lz) / 0.035) * min(1.0, (yr - ly) / 0.04)
            w = max(0.0, min(1.0, w))
            try:
                hw = hg.weight(v.index)
            except RuntimeError:
                hw = 0.0
            if w > 0.01 and hw > 0:
                jg.add([v.index], w * hw, 'REPLACE')
                hg.add([v.index], (1 - w) * hw, 'REPLACE')


# ----------------------------------------------------------------------------- animation library
TAU = math.tau


def fingers(curl, spread=0.0, jitter=0.0, t=0.0, side='L', freq=3, thumb=None):
    out = {}
    sg = 1 if side == 'L' else -1
    for fi in range(4):
        for k in range(3):
            c = curl * (0.7 + 0.3 * k) + jitter * math.sin(TAU * t * freq + fi * 1.3 + k)
            sp = spread * (fi - 1.5) * (1 if k == 0 else 0)
            out[f'f{fi}.{k}.{side}'] = (0, c * sg, sp * sg)
    tc = curl * 0.5 if thumb is None else thumb
    for k in range(3):
        out[f'thumb.{k}.{side}'] = (0, tc * sg, 0)
    return out


def arms_down(P, fwdL=-4, fwdR=-4, out=8, elbow=12):
    a = P['abduct'] - out
    return {'upper_arm.L': (fwdL, a, 0), 'upper_arm.R': (fwdR, -a, 0),
            'forearm.L': (-elbow, 3, 0), 'forearm.R': (-elbow, -3, 0), 'hand.L': (0, 5, 0), 'hand.R': (0, -5, 0)}


def leg_cycle(phase, thigh_amp, knee_amp, knee_base=6, lift=0.0, foot_comp=0.8):
    """One leg at gait phase (radians): returns (thigh, shin, foot) X rotations in degrees."""
    th = -thigh_amp * math.sin(phase)
    swing = max(0.0, math.cos(phase))
    kn = knee_base + knee_amp * swing ** 1.5 + lift * swing
    ft = -(th + kn) * foot_comp - 12 * swing + 6 * max(0.0, -math.cos(phase)) * 0
    return th, kn, ft


def gait(t, P, thigh=24, knee=48, arm=16, bob=0.018, lean=4, twist=5, run=False, elbow=14, cycles=1):
    """Generic biped walk/run at normalized time t."""
    ph = TAU * t * cycles
    r = {}
    for side, off in (('L', 0.0), ('R', math.pi)):
        a, b, c = leg_cycle(ph + off, thigh, knee, lift=20 if run else 0)
        r[f'thigh.{side}'] = (a, 0, 0)
        r[f'shin.{side}'] = (b, 0, 0)
        r[f'foot.{side}'] = (c, 0, 0)
        r[f'toe.{side}'] = (8 * max(0.0, -math.cos(ph + off)), 0, 0)
    A = P['abduct'] - 8
    swingL = arm * math.sin(ph)
    r['upper_arm.L'] = (swingL - (10 if run else 2), A, 0)
    r['upper_arm.R'] = (-swingL - (10 if run else 2), -A, 0)
    eb = elbow + (60 if run else 0)
    r['forearm.L'] = (-eb - (10 * max(0, -math.sin(ph)) if run else 0), 3, 0)
    r['forearm.R'] = (-eb - (10 * max(0, math.sin(ph)) if run else 0), -3, 0)
    r['hips'] = (0, 2 * math.sin(ph), twist * math.sin(ph))
    r['spine'] = (lean, 0, -twist * 0.5 * math.sin(ph))
    r['chest'] = (lean * 0.5, 0, -twist * 0.6 * math.sin(ph))
    r['neck'] = (-lean * 0.5, 0, 0)
    r['head'] = (-lean * 0.3, 0, twist * 0.3 * math.sin(ph))
    locs = {'hips': (0, 0, bob * math.cos(2 * ph) - (0.03 if run else 0))}
    return r, locs


def merge(*ds):
    out = {}
    for d in ds:
        for k, v in d.items():
            if k in out:
                out[k] = tuple(a + b for a, b in zip(out[k], v))
            else:
                out[k] = v
    return out


def pose_preview(arm, action, frame, fname, cam=(0.6, -3.4, 1.6), target=(0, 0, 1.2), lens=40):
    act = bpy.data.actions[action]
    arm.animation_data.action = act
    try:
        if len(act.slots):
            arm.animation_data.action_slot = act.slots[0]
    except Exception:
        pass
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    bpy.context.scene.frame_set(frame)
    p = preview(fname, target=target, cam=cam, lens=lens)
    arm.animation_data.action = None
    pose_reset(arm)
    bpy.context.scene.frame_set(1)
    return p


def lathe_garment(name, profile, rows_step=0.012, seg=128, folds=0.0, fold_start=None, ruffle=0.0,
                  tatter=0.0, seed=0.0, ellipse=True):
    """Dress/nightgown/skirt from a (z, rx, ry) profile with folds and an optionally tattered hem."""
    ztop, zbot = profile[0][0], profile[-1][0]

    def prof_at(z):
        for i in range(len(profile) - 1):
            z0, a0, b0 = profile[i]
            z1, a1, b1 = profile[i + 1]
            if z1 <= z <= z0:
                u = (z0 - z) / max(z0 - z1, 1e-6)
                return a0 + (a1 - a0) * u, b0 + (b1 - b0) * u
        return profile[-1][1], profile[-1][2]

    fs = fold_start if fold_start is not None else ztop
    rows = []
    z = ztop
    while z > zbot:
        rows.append(z); z -= rows_step
    rows.append(zbot)
    verts, faces = [], []
    for z in rows:
        rx, ry = prof_at(z)
        below = max(0.0, (fs - z) / max(fs - zbot, 1e-6))
        for i in range(seg):
            th = i / seg * TAU
            amp = folds * below ** 1.2
            f = amp * (0.62 * math.sin(th * 13 + 0.9 * math.sin(th * 4 + seed) + z * 1.5) +
                       0.38 * noise.noise(V((math.cos(th) * 2.2 + seed, math.sin(th) * 2.2, z * 1.6))))
            verts.append(((rx + f) * math.cos(th), (ry + f) * math.sin(th), z))
    for zi in range(len(rows) - 1):
        for i in range(seg):
            a, b = zi * seg + i, zi * seg + (i + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    obj = mesh_obj(name, verts, faces)
    if tatter > 0:
        bm = bmesh.new(); bm.from_mesh(obj.data)
        kill = []
        for f in bm.faces:
            c = f.calc_center_median()
            th = math.atan2(c.y, c.x)
            jag = (0.5 + 0.5 * noise.noise(V((math.cos(th) * 3.1 + seed, math.sin(th) * 3.1, 0.5)))) ** 2.2 * tatter \
                + (0.5 + 0.5 * noise.noise(V((math.cos(th) * 13, math.sin(th) * 13, 2.0 + seed)))) * tatter * 0.25
            if c.z < zbot + jag:
                kill.append(f)
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(obj.data); bm.free()
    recalc_normals(obj)
    shade_smooth(obj)
    return obj, prof_at


# ----------------------------------------------------------------------------- direction-based posing
def _q_from_deg(r):
    return Euler([math.radians(a) for a in r], 'XYZ').to_quaternion()


def _deg_from_q(q):
    e = q.to_euler('XYZ')
    return (math.degrees(e.x), math.degrees(e.y), math.degrees(e.z))


def aim_chain(arm, rots, chain, parents=('hips', 'spine', 'chest')):
    """Solve rotations so each bone in `chain` [(bone, world_dir)] points along world_dir, given the
    already-chosen torso rotations in `rots` (armature axes, parent-relative). Returns updated rots."""
    acc = Quaternion()
    for p in parents:
        if p in rots:
            acc = acc @ _q_from_deg(rots[p])
    out = dict(rots)
    for bone, target in chain:
        b = arm.data.bones[bone]
        if b.parent and b.parent.name not in parents and b.parent.name in out and b.parent.name not in [c[0] for c in chain]:
            acc = acc @ _q_from_deg(out[b.parent.name])
        rest = (b.tail_local - b.head_local).normalized()
        cur = acc @ rest
        q_world = cur.rotation_difference(V(target).normalized())
        q_local = acc.inverted() @ q_world @ acc
        out[bone] = _deg_from_q(q_local)
        acc = acc @ q_local
    return out
