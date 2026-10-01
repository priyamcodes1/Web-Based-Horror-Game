# EVELYN HART - stage A: base body (CC0 Blender Studio realistic female base mesh) -> game-ready layout.
#  * centre + scale to 1.68 m
#  * sculpt her own facial identity on the base level (multires detail rides on top)
#  * split into Head / Body materials by UV island and repack each into its own 0-1 space (UDIM -> game)
#  * save stage blend
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
import bmesh
from mathutils import kdtree

CFG = globals().get('CFG', {})
SRC = r"D:\Web Based - Horror Game\tools\blender\assets\hbm\human-base-meshes-bundle-v1.4.1\human_base_meshes_bundle.blend"
STAGE = r"D:\Web Based - Horror Game\tools\blender\evelyn_stageA.blend"
HEIGHT = 1.68

reset_scene()
want = ("GEO-body_female_realistic", "GEO-body_female_realistic.eye.L", "GEO-body_female_realistic.eye.R")
with bpy.data.libraries.load(SRC, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n in want]
for o in dst.objects:
    link(o)
bpy.context.view_layer.update()   # evaluate parent transforms before reading matrix_world
body = bpy.data.objects["GEO-body_female_realistic"]
eyeL = bpy.data.objects["GEO-body_female_realistic.eye.L"]
eyeR = bpy.data.objects["GEO-body_female_realistic.eye.R"]
for o in (body, eyeL, eyeR):
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
bpy.context.view_layer.update()
# centre on x, feet on floor
bb = [body.matrix_world @ V(c) for c in body.bound_box]
cx = (min(p.x for p in bb) + max(p.x for p in bb)) / 2
z0, z1 = min(p.z for p in bb), max(p.z for p in bb)
s = HEIGHT / (z1 - z0)
for o in (body, eyeL, eyeR):
    o.location.x -= cx
    o.location.z -= z0
bpy.context.view_layer.update()
# scale everything about the floor origin
for o in (body, eyeL, eyeR):
    o.location *= s
    o.scale *= s
bpy.context.view_layer.update()
for o in (body, eyeL, eyeR):
    apply_transform(o)
body.name = 'Evelyn_Body'; body.data.name = 'Evelyn_Body'
eyeL.name = 'Evelyn_Eye.L'; eyeR.name = 'Evelyn_Eye.R'

# --------------------------------------------------------------------------- landmarks (base level)
me = body.data
co = [v.co.copy() for v in me.vertices]
def pick(pred, key):
    c = [i for i, p in enumerate(co) if pred(p)]
    return min(c, key=key) if c else None
HEAD_Z = 1.40 * s
L = {}
L['nose_tip'] = co[pick(lambda p: abs(p.x) < 0.006 and p.z > 1.45 * s, lambda i: co[i].y)]
L['chin'] = co[pick(lambda p: abs(p.x) < 0.006 and HEAD_Z < p.z < L['nose_tip'].z - 0.05, lambda i: co[i].y + abs(co[i].z - (L['nose_tip'].z - 0.085)) * 0.4)]
eyeC = (eyeL.matrix_world @ V((0, 0, 0)))
for v in eyeL.data.vertices[:1]:
    pass
eyeCL = sum((eyeL.matrix_world @ v.co for v in eyeL.data.vertices), V((0, 0, 0))) / len(eyeL.data.vertices)
eyeCR = sum((eyeR.matrix_world @ v.co for v in eyeR.data.vertices), V((0, 0, 0))) / len(eyeR.data.vertices)
L['eyeL'] = eyeCL; L['eyeR'] = eyeCR
# mouth: front-most midline points between nose and chin; lips are local y-minima
mid = [i for i, p in enumerate(co) if abs(p.x) < 0.004 and L['chin'].z + 0.01 < p.z < L['nose_tip'].z - 0.015]
mid.sort(key=lambda i: co[i].z)
front = [i for i in mid if co[i].y < L['nose_tip'].y + 0.05]
# the lip line is the deepest notch between the two front-most lip bulges
L['mouth_line'] = co[max(front, key=lambda i: co[i].y if L['chin'].z + 0.02 < co[i].z < L['nose_tip'].z - 0.025 else -9)] if front else L['nose_tip']
result = {"scale": round(s, 4), "landmarks": {k: [round(x, 4) for x in v] for k, v in L.items()}}

# --------------------------------------------------------------------------- identity sculpt (subtle, base level)
def soft(center, r, offset, falloff=2.0, mask=None):
    c = V(center)
    for i, v in enumerate(me.vertices):
        d = (v.co - c).length
        if d > r * 2.2:
            continue
        if mask and not mask(v.co):
            continue
        w = math.exp(-(d / r) ** falloff)
        v.co += V(offset) * w

nt = L['nose_tip']; ch = L['chin']
face_front = lambda p: p.y < nt.y + 0.06
if CFG.get('sculpt', True):
    # slightly refined, gently upturned nose tip and narrower bridge
    soft((0, nt.y, nt.z), 0.012, (0, 0.0015, 0.0025), mask=face_front)
    for sx in (1, -1):
        soft((0.009 * sx, nt.y + 0.012, nt.z + 0.025), 0.01, (-0.0012 * sx, 0, 0), mask=face_front)
    # fuller lips (upper + lower) and soft cupid's bow
    ml = L['mouth_line']
    soft((0, ml.y, ml.z + 0.007), 0.012, (0, -0.0022, 0.0005), mask=face_front)
    soft((0, ml.y, ml.z - 0.008), 0.013, (0, -0.0026, -0.0004), mask=face_front)
    # defined cheekbones, slight hollow beneath
    for sx in (1, -1):
        soft((0.048 * sx, ml.y + 0.03, L['eyeL'].z - 0.028), 0.016, (0.0016 * sx, -0.0012, 0.0006), mask=face_front)
        soft((0.042 * sx, ml.y + 0.025, ml.z + 0.002), 0.016, (-0.0012 * sx, 0.0006, 0), mask=face_front)
    # softer, slightly narrower jaw / chin
    soft((0, ch.y, ch.z), 0.02, (0, -0.0008, -0.0012), mask=face_front)
    for sx in (1, -1):
        soft((0.05 * sx, ch.y + 0.04, ch.z + 0.015), 0.02, (-0.0018 * sx, 0, 0))
    me.update()

# --------------------------------------------------------------------------- material split + UV repack
mh, _ = new_mat('Evelyn_HeadMat', color=(0.8, 0.62, 0.52, 1))
mb, _ = new_mat('Evelyn_BodyMat', color=(0.8, 0.62, 0.52, 1))
me.materials.clear(); me.materials.append(mh); me.materials.append(mb)
bm = bmesh.new(); bm.from_mesh(me)
uvl = bm.loops.layers.uv.active
bm.faces.ensure_lookup_table()
# UV islands via union-find on shared UV coordinates of connected faces
parent = list(range(len(bm.faces)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
for e in bm.edges:
    if len(e.link_faces) != 2:
        continue
    f1, f2 = e.link_faces
    same = True
    for v in e.verts:
        u1 = next(l[uvl].uv for l in f1.loops if l.vert == v)
        u2 = next(l[uvl].uv for l in f2.loops if l.vert == v)
        if (u1 - u2).length > 1e-5:
            same = False; break
    if same:
        a, b = find(f1.index), find(f2.index)
        if a != b: parent[a] = b
islands = {}
for f in bm.faces:
    islands.setdefault(find(f.index), []).append(f)
head_islands = 0
for root, faces in islands.items():
    zc = sum(f.calc_center_median().z for f in faces) / len(faces)
    isHead = zc > HEAD_Z - 0.04 * s and all(f.calc_center_median().z > 1.28 * s for f in faces)
    for f in faces:
        f.material_index = 0 if isHead else 1
    head_islands += isHead
bm.to_mesh(me); bm.free()
result['islands'] = len(islands); result['head_islands'] = head_islands

def pack_material(idx, margin=0.004):
    select_only(body)
    with bpy.context.temp_override(**view3d_override(), active_object=body, object=body, selected_objects=[body], selected_editable_objects=[body]):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        body.active_material_index = idx
        bpy.ops.object.material_slot_select()
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin=margin, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')
try:
    pack_material(0); pack_material(1)
    result['packed'] = True
except Exception as e:
    result['pack_error'] = repr(e)
# verify both sets are in 0..1
uvd = me.uv_layers.active.data
rng = {0: [9, 9, -9, -9], 1: [9, 9, -9, -9]}
for p in me.polygons:
    r = rng[p.material_index]
    for li in p.loop_indices:
        u, v = uvd[li].uv
        r[0] = min(r[0], u); r[1] = min(r[1], v); r[2] = max(r[2], u); r[3] = max(r[3], v)
# normalise each material's UVs to fill the 0..1 square (uniform scale keeps texel aspect)
for p in me.polygons:
    pass
for idx, r in rng.items():
    w, h = r[2] - r[0], r[3] - r[1]
    sc = 0.994 / max(w, h)
    for p in me.polygons:
        if p.material_index != idx:
            continue
        for li in p.loop_indices:
            u, v = uvd[li].uv
            uvd[li].uv = (0.003 + (u - r[0]) * sc, 0.003 + (v - r[1]) * sc)
result['uv_ranges'] = {k: [round(x, 3) for x in v] for k, v in rng.items()}
result['verts_base'] = len(me.vertices)
bpy.ops.wm.save_as_mainfile(filepath=STAGE)
result['saved'] = STAGE
