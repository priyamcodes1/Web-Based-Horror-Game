# Player: bake, rig, animations, export (exec'd from player.py)
if BAKE:
    for o, nm, sz_ in ((body, 'Player_Body', 2048), (jacket, 'Cloth_Jacket', TEX), (hoodie, 'Cloth_Hoodie', TEX),
                       (flannel, 'Cloth_Flannel', TEX), (jeans, 'Pants_Jeans', TEX), (cargo, 'Pants_Cargo', TEX),
                       (boots, 'Shoes_Boots', 512), (sneakers, 'Shoes_Sneakers', 512), (cap, 'Hat_Cap', 512),
                       (beanie, 'Hat_Beanie', 512), (hair_short, 'Hair_Short', 512), (backpack, 'Acc_Backpack', 1024),
                       (eyes, 'Player_Eye', 256)):
        smart_uv(o, angle=60, margin=0.004)
        bake_maps(o, nm + 'Mat', size=sz_, maps=('color', 'rough', 'normal'), samples=10)

bones = humanoid_bones(J, P, legs=True)
arm = make_armature('Player_Rig', bones)
S = bone_sets(bones)
bind_weights(body, arm, allowed=S['body'], power=4.0, smooth_iters=2)
for g in GARMENTS:
    copy_weights(body, g)
bind_rigid(eyes, arm, 'head')
for h in (hair_short, cap, beanie, glasses):
    bind_rigid(h, arm, 'head')
bind_weights(hair_long, arm, allowed={'head', 'neck', 'chest'}, power=3.0, smooth_iters=2, bias={'head': 3})
bind_weights(backpack, arm, allowed={'chest', 'spine'}, power=2.0, smooth_iters=0, bias={'chest': 3})

A = P['abduct']


HOLD_ARM = None


def hold(t=0.0, sway=0.0, rots=None):
    """Right hand holds a flashlight forward at chest height (direction-solved, torso-aware)."""
    base = dict(rots or {})
    sw = math.radians(sway)
    chain = [('clav.R', (-1, 0.1, -0.05)), ('upper_arm.R', (-0.28, -0.42 - 0.2 * math.sin(sw), -0.86)),
             ('forearm.R', (0.12, -0.99, 0.06 + 0.3 * math.sin(sw))), ('hand.R', (0.0, -1.0, 0.1))]
    r = aim_chain(arm, base, chain)
    r = {k: v for k, v in r.items() if k in ('clav.R', 'upper_arm.R', 'forearm.R', 'hand.R')}
    r.update(fingers(62, 0, 0, t, 'R', thumb=40))
    return r


def left_relaxed(fwd=-4, t=0.0):
    return merge({'upper_arm.L': (fwd, A - 10, 0), 'forearm.L': (-14, 3, 0)}, fingers(18, 0, 3, t, 'L'))


def idle(t):
    w = TAU * t
    br = math.sin(w * 2)
    r = merge(hold(t, br), left_relaxed(-3 + br, t))
    r.update({'chest': (2 + 1.5 * br, 0, 0), 'spine': (2, 0, 0), 'head': (-2 + br, 0, 4 * math.sin(w)),
              'neck': (2, 0, 0), 'thigh.L': (0, 2, 0), 'thigh.R': (-2, -2, 0), 'shin.R': (4, 0, 0)})
    return r, {'hips': (0.008 * math.sin(w), 0, -0.003 * br)}


def walk(t):
    r, l = gait(t, P, thigh=24, knee=46, arm=14, bob=0.02, lean=3, twist=5)
    r.update(hold(t, 3 * math.sin(TAU * t), r))
    r.update(fingers(18, 0, 0, t, 'L'))
    return r, l


def run(t):
    r, l = gait(t, P, thigh=44, knee=86, arm=34, bob=0.045, lean=14, twist=8, run=True)
    w = TAU * t
    r.update(hold(t, -6 + 10 * math.sin(w), r))
    r.update(fingers(40, 0, 0, t, 'L'))
    return r, l


def crouch_base():
    return {'thigh.L': (-72, 6, 0), 'shin.L': (118, 0, 0), 'foot.L': (-42, 0, 0),
            'thigh.R': (-60, -6, 0), 'shin.R': (122, 0, 0), 'foot.R': (-58, 0, 0), 'toe.R': (30, 0, 0),
            'spine': (24, 0, 0), 'chest': (8, 0, 0), 'neck': (-18, 0, 0), 'head': (-10, 0, 0)}


def crouch_idle(t):
    w = TAU * t
    cb = crouch_base()
    r = merge(cb, hold(t, 0, cb), left_relaxed(-30, t))
    r['head'] = (-10, 0, 10 * math.sin(w))
    return r, {'hips': (0, 0.05, -0.42 + 0.004 * math.sin(2 * w))}


def crouch_walk(t):
    w = TAU * t
    r = merge(hold(t), left_relaxed(-30, t))
    for side, off in (('L', 0.0), ('R', math.pi)):
        ph = w + off
        r[f'thigh.{side}'] = (-66 - 16 * math.sin(ph), 0, 0)
        r[f'shin.{side}'] = (112 + 14 * max(0, math.cos(ph)), 0, 0)
        r[f'foot.{side}'] = (-44 + 10 * math.sin(ph), 0, 0)
    r.update({'spine': (26, 0, 0), 'chest': (8, 0, 3 * math.sin(w)), 'neck': (-18, 0, 0), 'head': (-10, 0, 0),
              'hips': (0, 3 * math.sin(w), 4 * math.sin(w))})
    return r, {'hips': (0, 0.05, -0.43 + 0.012 * math.cos(2 * w))}


def slide(t):
    w = TAU * t
    r = merge(hold(t), {'upper_arm.L': (30, A - 40, 0), 'forearm.L': (-10, 0, 0)}, fingers(-5, 10, 0, t, 'L'))
    r.update({'thigh.R': (-86, -4, 0), 'shin.R': (8, 0, 0), 'foot.R': (-8, 0, 0),
              'thigh.L': (-58, 8, 0), 'shin.L': (96, 0, 0), 'foot.L': (-30, 0, 0),
              'spine': (-22, 0, 0), 'chest': (-8, 0, 0), 'neck': (22, 0, 0), 'head': (12, 0, 2 * math.sin(4 * w)),
              'hips': (-8, 0, 0)})
    return r, {'hips': (0, 0.1, -0.62 + 0.004 * math.sin(6 * w))}


def caught(t):
    """Victim reaction synced with every ghost 'Grab' clip (72 frames): startle, lifted, struggle, go limp."""
    base = merge(hold(0), left_relaxed(-3))
    startle = {'upper_arm.L': (-100, A - 40, -30), 'forearm.L': (-100, 0, 0), 'upper_arm.R': (-100, -(A - 40), 30),
               'forearm.R': (-100, 0, 0), 'spine': (-14, 0, 0), 'chest': (-8, 0, 0), 'head': (-12, 0, 0),
               'thigh.L': (-10, 0, 0), 'shin.L': (20, 0, 0)}
    startle.update(fingers(-10, 12, 0, 0, 'L')); startle.update(fingers(-10, 12, 0, 0, 'R'))
    lifted = {'upper_arm.L': (-80, A - 60, -40), 'forearm.L': (-70, 0, 0), 'upper_arm.R': (-80, -(A - 60), 40),
              'forearm.R': (-70, 0, 0), 'spine': (-6, 0, 0), 'chest': (-10, 0, 0), 'neck': (-16, 0, 0),
              'head': (-20, 0, 0), 'thigh.L': (-18, 4, 0), 'shin.L': (30, 0, 0), 'foot.L': (40, 0, 0),
              'thigh.R': (-6, -4, 0), 'shin.R': (14, 0, 0), 'foot.R': (40, 0, 0)}
    lifted.update(fingers(55, 0, 0, 0, 'L')); lifted.update(fingers(55, 0, 0, 0, 'R'))
    limp = merge(lifted, {'upper_arm.L': (60, 30, 30), 'upper_arm.R': (60, -30, -30), 'forearm.L': (60, 0, 0),
                          'forearm.R': (60, 0, 0), 'head': (50, 10, 0), 'neck': (30, 0, 0)})
    limp.update(fingers(10, 0, 0, 0, 'L')); limp.update(fingers(10, 0, 0, 0, 'R'))
    rots, locs = keyframes_pose(t, [(0, base, {}), (0.12, startle, {'hips': (0, 0.05, 0)}),
                                    (0.36, lifted, {'hips': (0, -0.08, 0.18)}), (0.82, lifted, {'hips': (0, -0.08, 0.22)}),
                                    (1.0, limp, {'hips': (0, -0.08, 0.2)})])
    if 0.36 < t < 0.85:  # frantic struggle
        rots = dict(rots)
        k = math.sin((t - 0.36) / 0.49 * math.pi)
        for b, a, f in (('upper_arm.L', 14, 70), ('upper_arm.R', 14, 83), ('forearm.L', 20, 90), ('forearm.R', 20, 77),
                        ('thigh.L', 18, 60), ('thigh.R', 18, 66), ('head', 8, 110), ('spine', 4, 50)):
            x, y, z = rots.get(b, (0, 0, 0))
            rots[b] = (x + a * k * math.sin(t * f), y, z + a * 0.5 * k * math.sin(t * f * 1.3))
    return rots, locs


def death(t):
    base = merge(hold(0), left_relaxed(-3))
    knees = {'thigh.L': (-60, 5, 0), 'shin.L': (110, 0, 0), 'thigh.R': (-50, -5, 0), 'shin.R': (100, 0, 0),
             'spine': (20, 0, 0), 'head': (30, 0, 0), 'upper_arm.L': (-10, A - 20, 0), 'upper_arm.R': (-10, -(A - 20), 0),
             'forearm.L': (-20, 0, 0), 'forearm.R': (-20, 0, 0)}
    down = {'thigh.L': (-20, 10, 0), 'shin.L': (30, 0, 0), 'thigh.R': (-10, -6, 0), 'shin.R': (14, 0, 0),
            'hips': (-80, 0, 12), 'spine': (-6, 0, 0), 'head': (-10, 30, 0), 'neck': (0, 0, 0),
            'upper_arm.L': (-60, A - 70, 0), 'upper_arm.R': (-20, -(A - 80), 0), 'forearm.L': (-20, 0, 0),
            'forearm.R': (-10, 0, 0)}
    return keyframes_pose(t, [(0, base, {}), (0.35, knees, {'hips': (0, 0.05, -0.45)}),
                              (0.7, down, {'hips': (0, 0.35, -0.82)}), (1.0, down, {'hips': (0, 0.38, -0.84)})])


if ANIM:
    action_world(arm, 'Idle', 90, idle)
    action_world(arm, 'Walk', 34, walk)
    action_world(arm, 'Run', 22, run)
    action_world(arm, 'CrouchIdle', 80, crouch_idle)
    action_world(arm, 'CrouchWalk', 40, crouch_walk)
    action_world(arm, 'Slide', 30, slide)
    action_world(arm, 'Caught', 72, caught, cyclic=False)
    action_world(arm, 'Death', 50, death, cyclic=False)
    result['actions'] = sorted(a.name for a in bpy.data.actions)
    if CFG.get('pose_preview', True):
        show = {'Player_Body', 'Player_Eyes', 'Cloth_Jacket', 'Pants_Jeans', 'Shoes_Boots', 'Hair_Short', 'Acc_Backpack', 'Player_Rig'}
        for o in bpy.data.objects:
            if o.type == 'MESH' and o.name not in show:
                o.hide_render = True
        result['pr'] = pose_preview(arm, 'Run', 6, 'player_pose_run.png', cam=(2.4, -2.6, 1.3), target=(0, 0, 0.95))
        result['ps'] = pose_preview(arm, 'Slide', 10, 'player_pose_slide.png', cam=(2.4, -2.2, 0.9), target=(0, 0, 0.5))
        result['pc'] = pose_preview(arm, 'Caught', 40, 'player_pose_caught.png', cam=(2.2, -2.4, 1.3), target=(0, 0, 1.1))
        result['pi'] = pose_preview(arm, 'Idle', 10, 'player_pose_idle.png', cam=(1.6, -2.8, 1.4), target=(0, 0, 1.0))
        for o in bpy.data.objects:
            o.hide_render = False

if EXPORT:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = False
    result['export'] = export_glb('player.glb', [arm, body, eyes] + GARMENTS + HEADWEAR + [backpack])
