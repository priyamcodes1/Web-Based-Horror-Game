# Hollow Child: bake, rig, animations, export (exec'd from child.py)
if BAKE:
    for o, nm in ((body, 'Child_Body'), (gown, 'Child_Gown'), (bear, 'Child_Bear')):
        smart_uv(o, angle=60, margin=0.003)
        bake_maps(o, nm, size=(TEX if nm != 'Child_Bear' else 512), maps=('color', 'rough', 'normal'),
                  samples=12)

sz = P['scale']
jaw = (V((0, 0.0, HC.z - 0.02)), V((0, HC.y - 0.07, HC.z - 0.085)))
bones = humanoid_bones(J, P, legs=True, jaw=jaw)
arm = make_armature('Child_Rig', bones)
S = bone_sets(bones)
bind_weights(body, arm, allowed=S['body'], power=4.0, smooth_iters=2)
jaw_weights(body, HC, zr=(-0.13, -0.035))
bind_rigid(eyes, arm, 'head')
bind_weights(hair, arm, allowed={'head', 'neck'}, power=3.0, smooth_iters=1, bias={'head': 3})
bind_weights(gown, arm, allowed=S['core'] | S['arms'] | {'thigh.L', 'thigh.R', 'shin.L', 'shin.R'} - {'head'},
             power=3.0, smooth_iters=3, bias={'hips': 1.6, 'spine': 1.3})
bind_rigid(bear, arm, 'hand.L')

W = TAU


def hug(t=0.0):
    # left arm dangling the bear, right arm limp
    return {'upper_arm.L': (-8, P['abduct'] - 12, 0), 'forearm.L': (-20, 0, 0), 'hand.L': (0, 0, 0),
            'upper_arm.R': (-3, -(P['abduct'] - 6), 0), 'forearm.R': (-8, -3, 0)}


def idle(t):
    w = W * t
    r = merge(hug(t), fingers(30, 0, 0, t, 'L'), fingers(8, 0, 6, t, 'R'))
    r.update({'hips': (0, 4 * math.sin(w), 0), 'spine': (0, -3 * math.sin(w), 0), 'chest': (2, -2 * math.sin(w), 0),
              'neck': (6, 0, 0), 'head': (4, 28 + 5 * math.sin(w), 6 * math.sin(w)), 'jaw': (3, 0, 0),
              'thigh.L': (0, -2 * math.sin(w), 0), 'thigh.R': (0, -2 * math.sin(w), 0)})
    return r, {'hips': (0.012 * math.sin(w), 0, 0)}


def walk(t):
    r, l = gait(t, P, thigh=20, knee=40, arm=6, bob=0.012, lean=6, twist=4)
    w = W * t
    # limp: right leg drags
    r['thigh.R'] = (r['thigh.R'][0] * 0.6, 0, 0)
    r['shin.R'] = (r['shin.R'][0] * 0.5, 0, 0)
    r.update({k: v for k, v in hug(t).items() if k.endswith('.L')})
    r.update(fingers(30, 0, 0, t, 'L')); r.update(fingers(8, 0, 4, t, 'R'))
    r['head'] = (6, 26 + 6 * math.sin(2 * w), 0)
    r['neck'] = (4, 0, 0)
    return r, {'hips': (0, 0, l['hips'][2] - 0.012 * max(0, math.sin(w)))}


def run(t):
    r, l = gait(t, P, thigh=46, knee=85, arm=0, bob=0.03, lean=16, twist=8, run=True, cycles=1)
    w = W * t
    # arms flung back, jerky head
    r['upper_arm.L'] = (40, P['abduct'] - 20, 0); r['upper_arm.R'] = (40, -(P['abduct'] - 20), 0)
    r['forearm.L'] = (-10, 0, 0); r['forearm.R'] = (-10, 0, 0)
    r.update(fingers(35, 0, 0, t, 'L')); r.update(fingers(-10, 10, 10, t, 'R', 6))
    r['head'] = (-10, 20 + 10 * math.sin(3 * w), 8 * math.sin(5 * w))
    r['jaw'] = (14, 0, 0)
    return r, l


def crawl(t):
    """Fast spider-crawl on all fours (chase): torso horizontal, hands and feet planted."""
    w = W * t
    r = {'hips': (28, 4 * math.sin(w), 0), 'spine': (38, 0, 5 * math.sin(w)), 'chest': (20, 0, 4 * math.sin(w)),
         'neck': (-50, 0, 0), 'head': (-38, 18 + 6 * math.sin(2 * w), 0), 'jaw': (18, 0, 0)}
    for side, off, sg in (('L', 0, 1), ('R', math.pi, -1)):
        ph = w + off
        r[f'thigh.{side}'] = (-72 - 24 * math.sin(ph), 16 * sg, 0)
        r[f'shin.{side}'] = (118 + 18 * max(0, math.cos(ph)), 0, 0)
        r[f'foot.{side}'] = (-50, 0, 0)
        ph2 = ph + math.pi
        r[f'upper_arm.{side}'] = (-100 - 24 * math.sin(ph2), (P['abduct'] - 30) * sg, 0)
        r[f'forearm.{side}'] = (-4 - 18 * max(0, math.cos(ph2)), 0, 0)
        r[f'hand.{side}'] = (55, 0, 0)
    r.update(fingers(-4, 14, 0, t, 'L')); r.update(fingers(-6, 14, 12, t, 'R', 4))
    return r, {'hips': (0, 0.05, -0.34 + 0.015 * math.sin(2 * w))}


def giggle(t):
    w = W * t
    r = merge(hug(t), fingers(30, 0, 0, t, 'L'))
    # right hand covering the mouth, shoulders shaking
    r.update({'upper_arm.R': (-40, -30, 45), 'forearm.R': (-120, 0, 0), 'hand.R': (0, 0, 0)})
    r.update(fingers(15, 0, 0, t, 'R'))
    shake = 4 * math.sin(w * 14)
    r.update({'chest': (6 + shake, 0, 0), 'spine': (4, 0, 0), 'neck': (8, 0, 0), 'head': (10 - shake, 22, 0),
              'clav.L': (0, shake * 0.6, 0), 'clav.R': (0, -shake * 0.6, 0)})
    return r, {'hips': (0, 0, 0.004 * math.sin(w * 14))}


def stare(t):
    w = W * t
    tw = 16 * math.exp(-((t - 0.35) / 0.02) ** 2) - 12 * math.exp(-((t - 0.8) / 0.02) ** 2)
    r = merge(hug(t), fingers(30, 0, 0, t, 'L'), fingers(12, 0, 6, t, 'R', 5))
    r.update({'head': (0, 78 + tw, 2 * math.sin(w)), 'neck': (6, 14, 0), 'jaw': (6, 0, 0)})
    return r, {}


def search(t):
    w = W * t
    r = merge(hug(t), fingers(30, 0, 0, t, 'L'), fingers(10, 0, 6, t, 'R'))
    r.update({'head': (8, 20 * math.sin(2 * w), 50 * math.sin(w)), 'neck': (6, 0, 18 * math.sin(w)),
              'spine': (8, 0, 12 * math.sin(w)), 'thigh.L': (-4, 0, 0), 'shin.L': (8, 0, 0)})
    return r, {'hips': (0, 0, 0.006 * math.sin(2 * w))}


def attack(t):
    c0 = run(0)[0]
    wind = dict(c0); wind.update({'spine': (-6, 0, 0), 'head': (-20, 0, 0), 'jaw': (30, 0, 0),
                                  'upper_arm.R': (-150, 10, 20), 'forearm.R': (-20, 0, 0),
                                  'thigh.L': (-30, 0, 0), 'shin.L': (60, 0, 0), 'thigh.R': (10, 0, 0), 'shin.R': (40, 0, 0)})
    strike = dict(c0); strike.update({'spine': (30, 0, 0), 'head': (10, 0, 0), 'jaw': (38, 0, 0),
                                      'upper_arm.R': (-50, 0, 30), 'forearm.R': (-10, 0, 0)})
    strike.update(fingers(45, 6, 0, 0, 'R'))
    return keyframes_pose(t, [(0, c0, {}), (0.3, wind, {'hips': (0, 0.1, -0.05)}),
                              (0.5, strike, {'hips': (0, -0.35, 0.05)}), (1.0, c0, {})])


def grab(t):
    """Leaps onto the victim's chest and claws at their face (victim ~0.9 m in front, eyes ~1.6 m)."""
    c0 = run(0)[0]
    crouch = dict(c0); crouch.update({'thigh.L': (-80, 0, 0), 'shin.L': (120, 0, 0), 'foot.L': (-40, 0, 0),
                                      'thigh.R': (-80, 0, 0), 'shin.R': (120, 0, 0), 'foot.R': (-40, 0, 0),
                                      'spine': (30, 0, 0), 'head': (-30, 30, 0), 'jaw': (10, 0, 0)})
    leap = dict(c0); leap.update({'thigh.L': (-20, 10, 0), 'shin.L': (30, 0, 0), 'thigh.R': (-10, -10, 0),
                                  'shin.R': (20, 0, 0), 'spine': (-10, 0, 0), 'head': (-10, 20, 0), 'jaw': (36, 0, 0),
                                  'upper_arm.L': (-120, -20, -20), 'upper_arm.R': (-120, 20, 20),
                                  'forearm.L': (-20, 0, 0), 'forearm.R': (-20, 0, 0)})
    leap.update(fingers(-12, 14, 0, 0, 'L')); leap.update(fingers(-12, 14, 0, 0, 'R'))
    cling = dict(leap); cling.update({'thigh.L': (-95, 25, 0), 'shin.L': (110, 0, 0), 'thigh.R': (-95, -25, 0),
                                      'shin.R': (110, 0, 0), 'spine': (10, 0, 0), 'head': (20, 35, 0), 'jaw': (44, 0, 0),
                                      'upper_arm.L': (-100, -10, -40), 'upper_arm.R': (-100, 10, 40),
                                      'forearm.L': (-50, 0, 0), 'forearm.R': (-50, 0, 0)})
    cling.update(fingers(50, 4, 0, 0, 'L')); cling.update(fingers(50, 4, 0, 0, 'R'))
    rots, locs = keyframes_pose(t, [(0, c0, {'hips': (0, 0, 0)}), (0.14, crouch, {'hips': (0, -0.05, -0.28)}),
                                    (0.3, leap, {'hips': (0, -0.45, 0.45)}), (0.42, cling, {'hips': (0, -0.62, 0.62)}),
                                    (1.0, cling, {'hips': (0, -0.64, 0.6)})])
    if t > 0.42:
        sh = min(1.0, (t - 0.42) / 0.08)
        rots = dict(rots)
        x, y, z = rots['head']
        rots['head'] = (x + 7 * sh * math.sin(t * 210), y + 5 * sh * math.sin(t * 170), z + 6 * sh * math.sin(t * 250))
    return rots, locs


if ANIM:
    action_world(arm, 'Idle', 90, idle)
    action_world(arm, 'Walk', 40, walk)
    action_world(arm, 'Run', 18, run)
    action_world(arm, 'Crawl', 22, crawl)
    action_world(arm, 'Giggle', 40, giggle)
    action_world(arm, 'Stare', 72, stare)
    action_world(arm, 'Search', 80, search)
    action_world(arm, 'Attack', 30, attack, cyclic=False)
    action_world(arm, 'Grab', 72, grab, cyclic=False)
    result['actions'] = sorted(a.name for a in bpy.data.actions)
    if CFG.get('pose_preview', True):
        result['pc'] = pose_preview(arm, 'Crawl', 6, 'child_pose_crawl.png', cam=(2.0, -1.8, 0.9), target=(0, 0, 0.45))
        result['pw'] = pose_preview(arm, 'Walk', 10, 'child_pose_walk.png', cam=(1.6, -2.2, 1.0), target=(0, 0, 0.7))
        result['pg'] = pose_preview(arm, 'Grab', 40, 'child_pose_grab.png', cam=(1.8, -2.4, 1.3), target=(0, -0.5, 1.1))

if EXPORT:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = False
    result['export'] = export_glb('ghost_child.glb', [arm, body, gown, hair, eyes, bear])
