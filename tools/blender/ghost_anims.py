# Ghost export: cast.py ghost body (g_<type>.blend) + its own retargeted mocap set -> public/models/ghost_<type>.glb
# Clip names match GHOST_PARAMS in src/entities/ghost.js.
# Run: blender -b --factory-startup --python ghost_anims.py -- widow|child|warden
import bpy, sys, os, json, importlib
sys.path.append(r"D:\Web Based - Horror Game\tools\blender")
import mocap; importlib.reload(mocap)
import fingers; importlib.reload(fingers)
from mathutils import Quaternion as Q

T = sys.argv[sys.argv.index('--') + 1:][0]
PROJECT = r"D:\Web Based - Horror Game"
bpy.ops.wm.open_mainfile(filepath=os.path.join(PROJECT, 'tools', 'blender', '_bake', 'cast', f'g_{T}.blend'))
rig = bpy.data.objects['Rig']
B = rig.data.bones
feet_z = min(B['foot_l'].head_local.z, B['ball_l'].head_local.z, B['ball_l'].tail_local.z)
soles = [(o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == 'MESH' and ('boot' in o.name.lower() or 'shoe' in o.name.lower()) for v in o.data.vertices]
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_Body'))
mocap.GROUND_CLEAR = feet_z - (min(soles) if soles else min((body.matrix_world @ v.co).z for v in body.data.vertices))

CLAW, GRIP, LIMP = fingers.curl_dict(rig, 1.6, thumb=0.6), fingers.curl_dict(rig, 2.3, thumb=0.8), fingers.curl_dict(rig, 0.8)

COMMON = [
    ('Search', '77_05', dict(loop=(60, 120))),
    ('Stare', '139_02', dict(frames_range=(200, 500), loop=(40, 90))),
    ('Attack', '56_02', dict(frames_range=(1040, 1270), finger=CLAW)),
    ('Grab', '56_02', dict(frames_range=(390, 700), finger=CLAW)),
    ('Lift', '56_03', dict(frames_range=(1080, 1500), loop=(30, 80), finger=GRIP)),
    ('Flinch', '77_09', dict(frames_range=(210, 520), finger=CLAW)),
    ('Crouch', '136_09', dict(frames_range=(180, 330), loop=(15, 30))),
]
SETS = {
    'widow': [
        ('Idle', '79_73', dict(loop=(90, 200), finger=LIMP)),
        ('Glide', '77_29', dict(loop=(30, 70), in_place=True, min_speed=0.3, finger=LIMP)),
        ('Chase', '104_41', dict(frames_range=(300, 1380), loop=(25, 60), in_place=True, min_speed=0.3, finger=CLAW)),
        ('Run', '16_35', dict(loop=(12, 24), in_place=True, min_speed=1.5, finger=CLAW)),
        ('Scream', '76_03', dict(frames_range=(120, 430), finger=CLAW)),
    ],
    'child': [
        ('Idle', '139_02', dict(loop=(90, 240), finger=LIMP)),
        ('Walk', '120_09', dict(loop=(28, 60), in_place=True, min_speed=0.4, finger=LIMP)),
        ('Run', '16_35', dict(loop=(12, 24), in_place=True, min_speed=1.5, finger=CLAW)),
        ('Crawl', '133_01', dict(frames_range=(510, 900), loop=(25, 60), in_place=True, min_speed=0.25, finger=CLAW)),
        ('Giggle', '91_59', dict(frames_range=(60, 260), finger=LIMP)),
    ],
    'warden': [
        ('Idle', '139_02', dict(loop=(90, 240), finger=GRIP)),
        ('Walk', '91_25', dict(loop=(30, 80), in_place=True, min_speed=0.2, finger=GRIP)),
        ('Run', '104_13', dict(loop=(20, 50), in_place=True, min_speed=0.5, finger=CLAW)),
        ('Roar', '76_03', dict(frames_range=(120, 430), finger=CLAW)),
        ('Smash', '56_02', dict(frames_range=(1040, 1270), finger=GRIP)),
    ],
}
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'
if rig.animation_data:
    for tr in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(tr)
bpy.context.scene.render.fps = 30
info = {}
for name, clip, kw in SETS[T] + COMMON:
    kw = dict(kw); fin = kw.pop('finger', LIMP)
    try:
        act, inf = mocap.retarget(rig, clip, name=name, fps=30, face_motion=True, finger_curl=fin, arm_out=4.0, smooth=3, hand_follow=0.55, hand_rel=True, **kw)
        info[name] = (inf['frames'], inf['loop'])
    except Exception as e:
        print('CLIP FAIL', name, e)
if rig.animation_data: rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for o in bpy.data.objects:
    if o.type == 'MESH' and (o.parent == rig or o.find_armature() == rig):
        o.select_set(True)
bpy.context.view_layer.objects.active = rig
out = os.path.join(PROJECT, 'public', 'models', f'ghost_{T}.glb')
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_optimize_animation_size=True, export_extras=True, export_morph=True, export_morph_normal=False,
    export_image_format='WEBP', export_image_quality=86, export_tangents=False,
    export_meshopt_compression_enable=False, export_skins=True, export_all_influences=False,   # meshopt quantizes rotation keys -> choppy motion
    export_def_bones=True, export_leaf_bone=False)
print('RESULT', json.dumps({'out': out, 'mb': round(os.path.getsize(out) / 1e6, 2), 'clips': info}, default=str))
