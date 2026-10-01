# Shared survivor animation library: CMU mocap retargeted (mocap.py) onto a representative cast rig,
# exported as an armature-only GLB of NLA clips. Every cast member uses the same game_engine bone
# names, so the runtime plays these clips on any survivor (root motion rescaled by hip height).
# Run: blender -b --factory-startup --python anims.py -- <cast_id> <out_name>   (needs _bake/cast/<id>.blend)
import bpy, sys, os, json, importlib
sys.path.append(r"D:\Web Based - Horror Game\tools\blender")
import mocap; importlib.reload(mocap)
import fingers; importlib.reload(fingers)
from mathutils import Quaternion as Q, Vector as V

ARGS = sys.argv[sys.argv.index('--') + 1:]
CID, OUTN = ARGS[0], ARGS[1]
PROJECT = r"D:\Web Based - Horror Game"
bpy.ops.wm.open_mainfile(filepath=os.path.join(PROJECT, 'tools', 'blender', '_bake', 'cast', CID + '.blend'))
rig = bpy.data.objects['Rig']
B = rig.data.bones
# sole clearance below the foot bones (shoes)
feet_z = min(B['foot_l'].head_local.z, B['ball_l'].head_local.z, B['ball_l'].tail_local.z)
sole = min((o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == 'MESH' and any(k in o.name.lower() for k in ('shoe', 'boot', 'sneaker')) for v in o.data.vertices) \
    if any(o.type == 'MESH' and any(k in o.name.lower() for k in ('shoe', 'boot', 'sneaker')) for o in bpy.data.objects) else 0.0
mocap.GROUND_CLEAR = feet_z - sole

# women's library: hands hang a little wider so they rest on a flared skirt instead of sinking into it
ARM_OUT = 14.0 if OUTN == 'anim_f' else 9.0
# natural finger poses (rest-pose derived curl axes): relaxed for most clips, a firm grip when hanging
RELAX, GRIP = fingers.curl_dict(rig, 1.0), fingers.curl_dict(rig, 2.3, thumb=0.8)

CLIPS = [  # name, clip, kwargs
    ('Idle', '139_02', dict(loop=(90, 240), upright=1.0)),
    ('IdleScared', '79_73', dict(loop=(90, 200))),
    ('LookAround', '77_05', dict(loop=(60, 120), upright=0.85)),
    ('Walk', '143_32', dict(loop=(28, 44), in_place=True, min_speed=0.6, upright=0.8)),
    ('WalkScared', '105_32', dict(loop=(28, 60), in_place=True, min_speed=0.3)),
    ('Sneak', '77_14', dict(loop=(28, 60), in_place=True, min_speed=0.5)),
    ('Run', '16_35', dict(loop=(12, 24), in_place=True, min_speed=1.5, upright=0.4)),
    ('CrouchIdle', '136_09', dict(frames_range=(180, 330), loop=(15, 30))),
    ('CrouchWalk', '136_09', dict(frames_range=(420, 1110), loop=(25, 55), in_place=True, min_speed=0.4)),
    ('Crawl', '133_01', dict(frames_range=(510, 900), loop=(25, 60), in_place=True, min_speed=0.25)),
    ('LieDown', '113_08', dict(frames_range=(60, 500))),
    ('ProneIdle', '113_08', dict(frames_range=(600, 1100), loop=(30, 90))),
    ('GetUp', '113_08', dict(frames_range=(1230, 1660))),
    ('Fall', '90_16', dict(frames_range=(270, 724))),
    ('Pickup', '111_17', dict(frames_range=(30, 420))),
    ('Duck', '77_09', dict(frames_range=(210, 520))),
    ('Slide', '77_09', dict(frames_range=(262, 330), loop=(10, 16))),
    ('Stumble', '91_59', dict(frames_range=(60, 260))),
    ('Hang', '01_09', dict(frames_range=(1110, 1500), loop=(30, 90), finger=GRIP)),
    ('Struggle', '43_02', dict(frames_range=(30, 720), loop=(20, 50), finger=GRIP)),
    ('Avoid', '76_03', dict(frames_range=(120, 900))),
]
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'
if rig.animation_data:
    for tr in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(tr)
bpy.context.scene.render.fps = 30
info = {}
for name, clip, kw in CLIPS:
    kw = dict(kw)
    fin = kw.pop('finger', RELAX)
    try:
        act, inf = mocap.retarget(rig, clip, name=name, fps=30, face_motion=True, finger_curl=fin, smooth=3, hand_follow=0.65, arm_out=ARM_OUT, **kw)
        info[name] = inf
    except Exception as e:
        print('CLIP FAIL', name, e)
if rig.animation_data: rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)

# armature only
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True); bpy.context.view_layer.objects.active = rig
hip = B['pelvis'].head_local.z
rig['anim'] = json.dumps({'hip': round(hip, 4), 'clips': list(info.keys())})
out = os.path.join(PROJECT, 'public', 'models', OUTN + '.glb')
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_optimize_animation_size=True, export_extras=True, export_skins=True, export_def_bones=True,
    export_leaf_bone=False, export_meshopt_compression_enable=True)
print('RESULT', json.dumps({'out': out, 'mb': round(os.path.getsize(out) / 1e6, 2), 'hip': hip,
                            'clips': {k: (v.get('frames'), v.get('loop')) for k, v in info.items()}}, default=str))
