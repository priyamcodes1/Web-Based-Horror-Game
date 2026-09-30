# Widow: texture bake, rig, weights, animations, export. Exec'd at the end of widow.py (shares its globals).

# ============================================================================ BAKE procedural -> textures
if BAKE:
    smart_uv(body, angle=60, margin=0.003)
    bake_maps(body, 'Widow_Body', size=TEX, maps=('color', 'rough', 'normal'), samples=12)
    smart_uv(dress, angle=60, margin=0.003)
    bake_maps(dress, 'Widow_Dress', size=TEX, maps=('color', 'rough', 'normal'), samples=12)

# ============================================================================ RIG
bones = [
    dict(name='root', head=(0, 0, 0), tail=(0, 0, 0.25), deform=False),
    dict(name='hips', head=(0, 0, 1.0), tail=(0, 0.006, 1.2), parent='root'),
    dict(name='spine', head=(0, 0.006, 1.2), tail=(0, 0, 1.40), parent='hips', connect=True),
    dict(name='chest', head=(0, 0, 1.40), tail=(0, 0.006, 1.60), parent='spine', connect=True),
    dict(name='neck', head=(0, 0.012, 1.645), tail=(0, 0.012, 1.80), parent='chest'),
    dict(name='head', head=(0, 0.012, 1.80), tail=(0, 0.0, 2.05), parent='neck', connect=True),
    dict(name='jaw', head=(0, 0.0, HC.z - 0.02), tail=(0, HC.y - 0.075, HC.z - 0.095), parent='head'),
    dict(name='hair.1', head=(0, 0.10, 1.95), tail=(0, 0.12, 1.72), parent='head'),
    dict(name='hair.2', head=(0, 0.12, 1.72), tail=(0, 0.14, 1.45), parent='hair.1', connect=True),
    dict(name='hair.3', head=(0, 0.14, 1.45), tail=(0, 0.16, 1.12), parent='hair.2', connect=True),
]
for s in (1, -1):
    t = 'L' if s > 0 else 'R'
    bones += [
        dict(name=f'clav.{t}', head=(0.02 * s, 0.012, 1.60), tail=(0.165 * s, 0.016, 1.598), parent='chest'),
        dict(name=f'upper_arm.{t}', head=(0.165 * s, 0.016, 1.598), tail=tuple(ELBOW[t]), parent=f'clav.{t}',
             connect=True),
        dict(name=f'forearm.{t}', head=tuple(ELBOW[t]), tail=tuple(WRIST[t]), parent=f'upper_arm.{t}', connect=True),
        dict(name=f'hand.{t}', head=tuple(WRIST[t]), tail=tuple(KNUCK[t]), parent=f'forearm.{t}', connect=True),
    ]
    for fi, pts in enumerate(FING[t]):
        par = f'hand.{t}'
        for k in range(3):
            nm = f'f{fi}.{k}.{t}'
            bones.append(dict(name=nm, head=tuple(pts[k]), tail=tuple(pts[k + 1]), parent=par, connect=k > 0))
            par = nm
    par = f'hand.{t}'
    for k in range(3):
        nm = f'thumb.{k}.{t}'
        bones.append(dict(name=nm, head=tuple(THUMB[t][k]), tail=tuple(THUMB[t][k + 1]), parent=par, connect=k > 0))
        par = nm
SKIRT_TH = [-90, -30, 30, 90, 150, 210]
SKIRT_Z = [1.05, 0.72, 0.38, 0.03]
for ki, deg in enumerate(SKIRT_TH):
    th = math.radians(deg)
    pts = []
    for z in SKIRT_Z:
        rx, ry = prof(z)
        pts.append((rx * 0.82 * math.cos(th), ry * 0.82 * math.sin(th), z))
    par = 'hips'
    for k in range(3):
        nm = f'skirt{ki}.{k}'
        bones.append(dict(name=nm, head=pts[k], tail=pts[k + 1], parent=par, connect=k > 0))
        par = nm

arm = make_armature('Widow_Rig', bones)
FINGERS = {b['name'] for b in bones if b['name'].startswith(('f0', 'f1', 'f2', 'f3', 'thumb'))}
ARMS = {b['name'] for b in bones if b['name'].split('.')[0] in ('clav', 'upper_arm', 'forearm', 'hand')}
SK = {b['name'] for b in bones if b['name'].startswith('skirt')}
HAIR = {'hair.1', 'hair.2', 'hair.3'}

bind_weights(body, arm, allowed={'hips', 'spine', 'chest', 'neck', 'head'} | ARMS | FINGERS, power=4.0,
             smooth_iters=2)
# jaw: lower face and lower teeth follow the jaw bone
jg = body.vertex_groups.get('jaw') or body.vertex_groups.new(name='jaw')
hg = body.vertex_groups['head']
for v in body.data.vertices:
    c = v.co
    lz, ly = c.z - HC.z, c.y - HC.y
    if -0.15 < lz < -0.03 and ly < 0.03 and abs(c.x) < 0.075:
        w = min(1.0, (-0.03 - lz) / 0.035) * min(1.0, (0.03 - ly) / 0.04)
        w = max(0.0, min(1.0, w))
        if w > 0.01:
            try:
                hw = hg.weight(v.index)
            except RuntimeError:
                hw = 0.0
            if hw > 0:
                jg.add([v.index], w * hw, 'REPLACE')
                hg.add([v.index], (1 - w) * hw, 'REPLACE')
bind_rigid(eye_obj, arm, 'head')
bind_weights(dress, arm, allowed={'hips', 'spine', 'chest', 'neck'} | ARMS | SK, power=3.2, smooth_iters=3)
bind_weights(hair, arm, allowed={'head', 'neck', 'chest'} | HAIR | {'clav.L', 'clav.R'}, power=3.0,
             smooth_iters=2, bias={'head': 2.5})
bind_weights(veil, arm, allowed={'head', 'neck', 'chest'} | HAIR | {'clav.L', 'clav.R'}, power=3.0,
             smooth_iters=3, bias={'head': 2.0})

# ============================================================================ ANIMATIONS
W = math.tau


def fingers(curl, spread=0.0, jitter=0.0, t=0.0, side='L', freq=3):
    out = {}
    for fi in range(4):
        for k in range(3):
            c = curl * (0.7 + 0.3 * k) + jitter * math.sin(W * t * freq + fi * 1.3 + k)
            sp = spread * (fi - 1.5) * (1 if k == 0 else 0)
            out[f'f{fi}.{k}.{side}'] = (0, c if side == 'L' else -c, sp if side == 'L' else -sp)
    for k in range(3):
        c = curl * 0.5
        out[f'thumb.{k}.{side}'] = (0, c if side == 'L' else -c, 0)
    return out


def hang(fwdL=-4.0, fwdR=-4.0):
    return {'upper_arm.L': (fwdL, 36, 0), 'upper_arm.R': (fwdR, -36, 0),
            'forearm.L': (-12, 4, 0), 'forearm.R': (-12, -4, 0), 'hand.L': (0, 6, 0), 'hand.R': (0, -6, 0)}


def skirt(base, amp, t, speed=1, trail=0.0):
    out = {}
    for ki in range(6):
        for k in range(3):
            out[f'skirt{ki}.{k}'] = (base * (1 + k * 0.3) + trail + amp * (1 + k * 0.5) *
                                     math.sin(W * t * speed + ki * 1.1 + k * 0.9), 0, 0)
    return out


def hair_sway(base, amp, t, speed=1):
    return {f'hair.{k + 1}': (base * (1 - k * 0.3) + amp * math.sin(W * t * speed + k), 0, 0) for k in range(3)}


def idle(t):
    w = W * t
    r = hang(-4 + 2 * math.sin(w), -4 - 2 * math.sin(w))
    r.update(fingers(10, 0, 7, t, 'L')); r.update(fingers(10, 0, 7, t + 0.3, 'R'))
    r.update({'hips': (0, 2 * math.sin(w), 0), 'spine': (2 + 1.5 * math.sin(w), 0, 0),
              'chest': (2 * math.sin(w + 0.5), 0, 0), 'neck': (10, 0, 3 * math.sin(w)),
              'head': (4 + 3 * math.sin(w), 16 + 4 * math.sin(w + 1), 5 * math.sin(w)),
              'jaw': (8 + 4 * math.sin(2 * w), 0, 0)})
    r.update(skirt(0, 2, t)); r.update(hair_sway(0, 2, t))
    return r, {'hips': (0, 0, 0.035 * math.sin(w))}


def glide(t):
    w = W * t
    r = hang(-4 + 10 * math.sin(w), -4 - 10 * math.sin(w))
    r.update(fingers(12, 0, 5, t, 'L')); r.update(fingers(12, 0, 5, t + 0.5, 'R'))
    r.update({'hips': (0, 3 * math.sin(w), 4 * math.sin(w)), 'spine': (7, 0, -2 * math.sin(w)),
              'chest': (4, 0, 0), 'neck': (8, 0, 0), 'head': (10, 12, 4 * math.sin(w)),
              'jaw': (6, 0, 0)})
    r.update(skirt(6, 3, t, 2)); r.update(hair_sway(10, 3, t, 2))
    return r, {'hips': (0, 0, 0.02 * math.sin(2 * w))}


def chase_pose(t, jit=1.0):
    w = W * t
    r = {'upper_arm.L': (-88 + 5 * jit * math.sin(2 * w), -14, -24),
         'upper_arm.R': (-88 - 5 * jit * math.sin(2 * w), 14, 24),
         'forearm.L': (-18, 0, 0), 'forearm.R': (-18, 0, 0), 'hand.L': (-15, 0, 0), 'hand.R': (-15, 0, 0),
         'hips': (0, 3 * math.sin(w), 0), 'spine': (18, 0, 0), 'chest': (10, 0, 0), 'neck': (-8, 0, 0),
         'head': (-14, 10, 8 * jit * math.sin(3 * w)), 'jaw': (16 + 6 * jit * math.sin(2 * w), 0, 0)}
    r.update(fingers(30, 6, 8 * jit, t, 'L', 4)); r.update(fingers(30, 6, 8 * jit, t + 0.25, 'R', 4))
    r.update(skirt(5, 3 * jit, t, 2, 2)); r.update(hair_sway(18, 4 * jit, t, 2))
    return r, {'hips': (0, 0, 0.04 * math.sin(2 * w))}


def attack(t):
    c0 = chase_pose(0, 0)
    wind = dict(c0[0])
    wind.update({'spine': (-8, 0, 0), 'chest': (-8, 0, 0), 'head': (-22, 0, 0), 'jaw': (30, 0, 0),
                 'upper_arm.L': (-140, -10, -20), 'upper_arm.R': (-140, 10, 20),
                 'forearm.L': (-30, 0, 0), 'forearm.R': (-30, 0, 0)})
    wind.update(fingers(-10, 10, 0, 0, 'L')); wind.update(fingers(-10, 10, 0, 0, 'R'))
    strike = dict(c0[0])
    strike.update({'spine': (32, 0, 0), 'chest': (16, 0, 0), 'head': (5, 0, 0), 'jaw': (38, 0, 0),
                   'upper_arm.L': (-40, 10, -45), 'upper_arm.R': (-40, -10, 45),
                   'forearm.L': (-10, 0, 0), 'forearm.R': (-10, 0, 0)})
    strike.update(fingers(42, 8, 0, 0, 'L')); strike.update(fingers(42, 8, 0, 0, 'R'))
    return keyframes_pose(t, [(0, c0[0], {'hips': (0, 0, 0)}), (0.3, wind, {'hips': (0, 0.12, 0.05)}),
                              (0.5, strike, {'hips': (0, -0.4, -0.05)}), (1.0, c0[0], {'hips': (0, 0, 0)})])


def grab(t):
    """Catch cutscene: victim stands ~0.9 m in front (-Y). Lunge, clutch the face, scream point-blank."""
    c0 = chase_pose(0, 0)[0]
    reach = dict(c0)
    reach.update({'upper_arm.L': (-100, -18, -16), 'upper_arm.R': (-100, 18, 16), 'forearm.L': (-12, 0, -6),
                  'forearm.R': (-12, 0, 6), 'spine': (12, 0, 0), 'head': (-6, 8, 0), 'jaw': (20, 0, 0)})
    reach.update(fingers(-8, 12, 0, 0, 'L')); reach.update(fingers(-8, 12, 0, 0, 'R'))
    clutch = dict(reach)
    clutch.update({'upper_arm.L': (-96, -14, -30), 'upper_arm.R': (-96, 14, 30), 'forearm.L': (-34, 0, -10),
                   'forearm.R': (-34, 0, 10), 'spine': (16, 0, 0), 'chest': (6, 0, 0), 'neck': (14, 0, 0),
                   'head': (10, 24, 0), 'jaw': (44, 0, 0)})
    clutch.update(fingers(48, 4, 0, 0, 'L')); clutch.update(fingers(48, 4, 0, 0, 'R'))
    rots, locs = keyframes_pose(t, [(0, c0, {'hips': (0, 0, 0)}), (0.18, reach, {'hips': (0, -0.25, 0.02)}),
                                    (0.34, clutch, {'hips': (0, -0.42, -0.02)}), (1.0, clutch, {'hips': (0, -0.46, -0.03)})])
    if t > 0.34:  # violent tremor while screaming into the victim's face
        sh = min(1.0, (t - 0.34) / 0.1)
        rots = dict(rots)
        for b, a in (('head', 5), ('neck', 3), ('chest', 2)):
            x, y, z = rots.get(b, (0, 0, 0))
            rots[b] = (x + a * sh * math.sin(t * 190), y + a * sh * math.sin(t * 150 + 1), z + a * sh * math.sin(t * 230))
    return rots, locs


def scream(t):
    w = W * t
    r = {'spine': (-6, 0, 0), 'chest': (-10, 0, 0), 'neck': (-10, 0, 0),
         'head': (-25 + 3 * math.sin(8 * w), 0, 4 * math.sin(6 * w)), 'jaw': (40 + 3 * math.sin(10 * w), 0, 0),
         'upper_arm.L': (0, -25, 0), 'upper_arm.R': (0, 25, 0), 'forearm.L': (-10, 0, 0), 'forearm.R': (-10, 0, 0)}
    r.update(fingers(-12, 12, 5, t, 'L', 6)); r.update(fingers(-12, 12, 5, t + 0.2, 'R', 6))
    r.update(skirt(4, 4, t, 3)); r.update(hair_sway(-6, 4, t, 3))
    return r, {'hips': (0, 0, 0.05 + 0.01 * math.sin(4 * w))}


def search(t):
    w = W * t
    r = hang(-4, -4)
    r.update({'upper_arm.R': (-55, 5, 25), 'forearm.R': (-20, 0, 0),
              'head': (6, 0, 45 * math.sin(w)), 'neck': (4, 0, 15 * math.sin(w)), 'spine': (4, 0, 10 * math.sin(w)),
              'jaw': (6, 0, 0)})
    r.update(fingers(10, 0, 4, t, 'L')); r.update(fingers(18, 4, 10, t, 'R', 5))
    r.update(skirt(0, 2, t)); r.update(hair_sway(0, 3, t))
    return r, {'hips': (0, 0, 0.03 * math.sin(2 * w))}


def stare(t):
    w = W * t
    tw = 12 * math.exp(-((t - 0.5) / 0.025) ** 2)
    r = hang(-2, -2)
    r.update({'head': (0, 38 + 2 * math.sin(w) + tw, 3 * math.sin(w)), 'neck': (12, 8, 0), 'jaw': (12, 0, 0),
              'chest': (2 * math.sin(w), 0, 0)})
    r.update(fingers(14, 0, 9, t, 'L', 5)); r.update(fingers(14, 0, 9, t + 0.4, 'R', 5))
    r.update(skirt(0, 1.5, t)); r.update(hair_sway(0, 1.5, t))
    return r, {'hips': (0, 0, 0.025 * math.sin(w))}


def pose_preview(action, frame, fname, cam=(0.6, -3.4, 1.6), target=(0, 0, 1.35)):
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
    p = preview(fname, target=target, cam=cam, lens=40)
    arm.animation_data.action = None
    pose_reset(arm)
    return p


if ANIM:
    action_world(arm, 'Idle', 90, idle)
    action_world(arm, 'Glide', 40, glide)
    action_world(arm, 'Chase', 24, lambda t: chase_pose(t))
    action_world(arm, 'Attack', 36, attack, cyclic=False)
    action_world(arm, 'Scream', 48, scream)
    action_world(arm, 'Grab', 72, grab, cyclic=False)
    action_world(arm, 'Search', 72, search)
    action_world(arm, 'Stare', 60, stare)
    result['actions'] = [a.name for a in bpy.data.actions]
    if CFG.get('pose_preview', True):
        result['pose_chase'] = pose_preview('Chase', 7, 'widow_pose_chase.png')
        result['pose_idle'] = pose_preview('Idle', 20, 'widow_pose_idle.png')
        result['pose_attack'] = pose_preview('Attack', 17, 'widow_pose_attack.png', cam=(2.2, -2.6, 1.6))
        result['pose_grab'] = pose_preview('Grab', 45, 'widow_pose_grab.png', cam=(1.2, -1.9, 1.7), target=(0, -0.3, 1.6))

if EXPORT:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = False
    result['export'] = export_glb('ghost_widow.glb', [arm, body, dress, hair, veil, eye_obj])
