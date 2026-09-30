# Warden: bake, rig, animations, export (exec'd from warden.py)
if BAKE:
    for o, nm, sz_ in ((body, 'Warden_Body', TEX), (clothes, 'Warden_Clothes', TEX), (apron, 'Warden_Apron', 1024),
                       (sack, 'Warden_Sack', 1024), (cleaver, 'Warden_Cleaver', 512), (chain, 'Warden_Chain', 512)):
        smart_uv(o, angle=60, margin=0.004)
        bake_maps(o, nm, size=sz_, maps=('color', 'rough', 'normal'), samples=12,
                  metal=(0.8 if nm in ('Warden_Cleaver', 'Warden_Chain') else 0.0))

sz = P['scale']
ht = hang_top
chain_bones = []
prev = 'hand.L'
cz = [ht.z, ht.z - 0.3, ht.z - 0.6, ht.z - 0.9, 0.02]
for k in range(4):
    chain_bones.append(dict(name=f'chain.{k}', head=(ht.x, ht.y, cz[k]), tail=(ht.x, ht.y, max(cz[k + 1], 0.02)),
                            parent=prev, connect=k > 0))
    prev = f'chain.{k}'
bones = humanoid_bones(J, P, legs=True, jaw=None, extra=chain_bones)
arm = make_armature('Warden_Rig', bones)
S = bone_sets(bones)
bind_weights(body, arm, allowed=S['body'], power=4.0, smooth_iters=2)
copy_weights(body, clothes)
bind_weights(sack, arm, allowed={'head', 'neck'}, power=3.0, smooth_iters=1, bias={'head': 4})
bind_rigid(eyes, arm, 'head')
bind_weights(apron, arm, allowed={'hips', 'spine', 'chest', 'neck', 'thigh.L', 'thigh.R'}, power=2.6,
             smooth_iters=4, bias={'hips': 2.2, 'spine': 1.6, 'chest': 1.4})
bind_rigid(cleaver, arm, 'hand.R')
bind_weights(chain, arm, allowed={'forearm.L', 'hand.L', 'chain.0', 'chain.1', 'chain.2', 'chain.3'}, power=5.0,
             smooth_iters=0, max_inf=2)

W = TAU
A = P['abduct']


def hunch(extra=0.0):
    return {'spine': (14 + extra, 0, 0), 'chest': (8, 0, 0), 'neck': (-8, 0, 0), 'head': (6, 0, 0)}


def cleaver_hold(fwd=-18, elbow=35):
    return {'upper_arm.R': (fwd, -(A - 14), 0), 'forearm.R': (-elbow, -8, 0), 'hand.R': (0, 0, 0)}


def chain_sway(t, amp=6, base=0.0, speed=1):
    return {f'chain.{k}': (base * (1 - k * 0.2) + amp * math.sin(W * t * speed + k * 0.8), 0, 0) for k in range(4)}


def idle(t):
    w = W * t
    br = math.sin(w * 2)          # heavy breathing (2 breaths per loop)
    r = merge(hunch(), cleaver_hold(-10 + 2 * br, 30), {'upper_arm.L': (-4, A - 8, 0), 'forearm.L': (-14, 3, 0)},
              fingers(55, 0, 0, t, 'R', thumb=40), fingers(20, 0, 3, t, 'L'))
    r['chest'] = (8 + 3 * br, 0, 0)
    r['clav.L'] = (0, -2 * br, 0); r['clav.R'] = (0, 2 * br, 0)
    r['head'] = (6 - 2 * br, 8 * math.sin(w), 10 * math.sin(w))
    r['hips'] = (0, 2 * math.sin(w), 0)
    r.update(chain_sway(t, 3))
    return r, {'hips': (0, 0, -0.01 * br)}


def walk(t):
    r, l = gait(t, P, thigh=18, knee=34, arm=8, bob=0.03, lean=18, twist=7)
    w = W * t
    r['thigh.L'] = (r['thigh.L'][0] * 0.75, 0, 0)          # dragging left leg
    r['shin.L'] = (r['shin.L'][0] * 0.6, 0, 0)
    r = merge(r, {'hips': (0, 4 * math.sin(w), 0), 'neck': (-4, 0, 0)}, fingers(20, 0, 0, t, 'L'),
              fingers(55, 0, 0, t, 'R', thumb=40))
    r.update(cleaver_hold(-14 - 10 * math.sin(w), 35))
    r.update(chain_sway(t, 12, 4, 1))
    return r, {'hips': (0, 0, l['hips'][2] - 0.02 * max(0, math.sin(w + 0.5)))}


def run(t):
    r, l = gait(t, P, thigh=36, knee=68, arm=18, bob=0.045, lean=26, twist=10, run=True)
    w = W * t
    r = merge(r, fingers(20, 0, 0, t, 'L'), fingers(55, 0, 0, t, 'R', thumb=40))
    r['upper_arm.R'] = (-50 + 12 * math.sin(w), -(A - 20), 0)
    r['forearm.R'] = (-70, -8, 0)
    r['neck'] = (-14, 0, 0); r['head'] = (-6, 0, 4 * math.sin(2 * w))
    r.update(chain_sway(t, 22, 26, 2))
    return r, l


def attack(t):
    base = run(0)[0]
    wind = dict(base); wind.update({'upper_arm.R': (-165, -10, 10), 'forearm.R': (-60, 0, 0), 'spine': (-6, 0, 0),
                                    'chest': (-8, 0, -12), 'head': (-10, 0, 0), 'hips': (0, 0, -10)})
    chop = dict(base); chop.update({'upper_arm.R': (-35, -(A - 20), 20), 'forearm.R': (-10, 0, 0),
                                    'spine': (34, 0, 0), 'chest': (14, 0, 12), 'head': (12, 0, 0), 'hips': (0, 0, 10)})
    return keyframes_pose(t, [(0, base, {}), (0.36, wind, {'hips': (0, 0.08, 0.03)}),
                              (0.5, chop, {'hips': (0, -0.3, -0.08)}), (1.0, base, {})])


def grab(t):
    """Seizes the victim by the throat with the left hand, lifts them, cleaver drawn back."""
    base = merge(hunch(), cleaver_hold())
    reach = dict(base); reach.update({'upper_arm.L': (-85, -12, -24), 'forearm.L': (-14, 0, 0), 'hand.L': (-10, 0, 0),
                                      'spine': (22, 0, 0)})
    reach.update(fingers(-10, 12, 0, 0, 'L'))
    lift = dict(base); lift.update({'upper_arm.L': (-100, -8, -18), 'forearm.L': (-24, 0, 0), 'hand.L': (-20, 0, 0),
                                    'spine': (-4, 0, 0), 'chest': (-6, 0, 0), 'neck': (-10, 0, 0), 'head': (-6, 22, 0),
                                    'upper_arm.R': (-150, -20, -20), 'forearm.R': (-80, 0, 0)})
    lift.update(fingers(55, 2, 0, 0, 'L'))
    rots, locs = keyframes_pose(t, [(0, base, {}), (0.2, reach, {'hips': (0, -0.3, -0.03)}),
                                    (0.4, lift, {'hips': (0, -0.36, 0.0)}), (1.0, lift, {'hips': (0, -0.36, 0.0)})])
    rots = dict(rots)
    rots.update(fingers(55, 0, 0, 0, 'R', thumb=40))
    if t > 0.4:
        sh = min(1.0, (t - 0.4) / 0.1)
        x, y, z = rots['head']
        rots['head'] = (x + 4 * sh * math.sin(t * 160), y + 3 * sh * math.sin(t * 120), z)
    rots.update(chain_sway(t, 8, 0, 3))
    k = min(1.0, t / 0.3)
    rots['chain.0'] = (rots['chain.0'][0] + 92 * k, 0, 0)
    return rots, locs


def search(t):
    w = W * t
    sniff = 5 * max(0, math.sin(w * 6)) ** 4
    r = merge(hunch(6), cleaver_hold(), {'upper_arm.L': (-4, A - 8, 0), 'forearm.L': (-14, 3, 0)},
              fingers(20, 0, 3, t, 'L'), fingers(55, 0, 0, t, 'R', thumb=40))
    r['head'] = (6 - sniff, 10 * math.sin(2 * w), 55 * math.sin(w))
    r['neck'] = (-8, 0, 15 * math.sin(w))
    r['spine'] = (20, 0, 18 * math.sin(w))
    r.update(chain_sway(t, 4))
    return r, {'hips': (0, 0, -0.01 * sniff / 5)}


def roar(t):
    w = W * t
    k = min(1.0, t / 0.2) * (1 - max(0.0, (t - 0.85) / 0.15))
    r = merge(hunch(-10 * k), fingers(-10 * k, 12 * k, 0, t, 'L'), fingers(55, 0, 0, t, 'R', thumb=40))
    r['upper_arm.L'] = (-10, (A - 8) - 50 * k, 0)
    r['upper_arm.R'] = (-10, -(A - 8) + 40 * k, 0)
    r['forearm.L'] = (-20 * k, 0, 0); r['forearm.R'] = (-30, 0, 0)
    r['chest'] = (8 - 22 * k, 0, 0)
    r['head'] = (6 - 30 * k + 3 * k * math.sin(w * 20), 0, 3 * k * math.sin(w * 16))
    r.update(chain_sway(t, 10 * k, 0, 4))
    return r, {'hips': (0, 0.05 * k, 0)}


if ANIM:
    action_world(arm, 'Idle', 96, idle)
    action_world(arm, 'Walk', 48, walk)
    action_world(arm, 'Run', 26, run)
    action_world(arm, 'Attack', 40, attack, cyclic=False)
    action_world(arm, 'Grab', 72, grab, cyclic=False)
    action_world(arm, 'Search', 90, search)
    action_world(arm, 'Roar', 60, roar, cyclic=False)
    result['actions'] = sorted(a.name for a in bpy.data.actions)
    if CFG.get('pose_preview', True):
        result['pw'] = pose_preview(arm, 'Walk', 12, 'warden_pose_walk.png', cam=(2.4, -3.2, 1.5), target=(0, 0, 1.05))
        result['pa'] = pose_preview(arm, 'Attack', 15, 'warden_pose_attack.png', cam=(2.6, -3.0, 1.6), target=(0, 0, 1.2))
        result['pg'] = pose_preview(arm, 'Grab', 50, 'warden_pose_grab.png', cam=(2.4, -2.8, 1.7), target=(0, -0.4, 1.3))

if EXPORT:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = False
    result['export'] = export_glb('ghost_warden.glb', [arm, body, clothes, apron, sack, eyes, cleaver, chain])
