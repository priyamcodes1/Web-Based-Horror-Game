# Survivor / ghost cast builder: MakeHuman (MPFB2) bodies with CC0/CC-BY skins, hair and garments,
# game_engine rig (same bone names for every character -> one shared mocap library), plus modelled
# extras that the asset library lacks:
#   * backpack: bevelled nylon pack with flap, front pocket, zipper and side pockets; shoulder straps are
#     ribbons projected onto the clothed torso and skinned from the body, so they hug the chest and never
#     float or sink in. The pack rides a 'backpack' bone (runtime spring) on spine_03.
#   * skirt / dress: built from body cross-sections (always outside the hips and thighs), pleated or
#     gathered, weights blended pelvis -> thighs so it follows the legs; a 'skirt' bone gets spring sway.
# Body vertices hidden under garments are deleted (no skin poking through clothes).
# Run:  blender -b --factory-startup --python cast.py -- <id>      -> public/models/chars/<id>.glb
import bpy, bmesh, sys, os, json, math, glob, re
import numpy as np
from mathutils import Vector as V, Matrix as M
from mathutils.bvhtree import BVHTree

PROJECT = r"D:\Web Based - Horror Game"
OUTDIR = os.path.join(PROJECT, "public", "models", "chars")
TEX = os.path.join(PROJECT, "tools", "blender", "_bake", "cast")
os.makedirs(OUTDIR, exist_ok=True); os.makedirs(TEX, exist_ok=True)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

import addon_utils
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.assetservice import AssetService

F = dict(gender=0.0, age=0.5, muscle=0.5, weight=0.5, proportions=1.0, height=0.62, cupsize=0.55, firmness=0.65)
Mm = dict(gender=1.0, age=0.5, muscle=0.6, weight=0.5, proportions=1.0, height=0.6, cupsize=0.5, firmness=0.5)
def mac(base, **kw):
    d = dict(base); race = kw.pop('race', None); d.update(kw)
    d['race'] = race or dict(caucasian=0.34, asian=0.33, african=0.33)
    return d

# eyes: brown/blue/green/... MPFB eye materials
SPECS = {
    # ---------------------------------------------------------------- survivors (4 female, 4 male)
    'ava':  dict(name='Ava', macro=mac(F, height=0.52, race=dict(caucasian=0.9, asian=0.05, african=0.05)), skin='young_caucasian_female',
                 hair='ponytail01', hair_col=(0.20, 0.12, 0.07), brows='eyebrow001',
                 clothes=['punkduck_sleeveless_crop_top', 'punkduck_female_short_jeans', 'punkduck_comfortable_sneakers'],
                 tint={'crop_top': (0.12, 0.12, 0.13)}, backpack=(0.32, 0.14, 0.12)),
    'maya': dict(name='Maya', macro=mac(F, height=0.5, race=dict(asian=0.9, caucasian=0.1, african=0.0)), skin='young_asian_female',
                 hair='long01', hair_col=(0.035, 0.028, 0.025), brows='eyebrow003',
                 clothes=['punkduck_tube_top', 'punkduck_female_knee_boots'],
                 tint={'tube': (0.06, 0.06, 0.065)}, skirt=dict(kind='pleated', col=(0.30, 0.05, 0.06), len=0.40, plaid=True)),
    'zoe':  dict(name='Zoe', macro=mac(F, height=0.5, muscle=0.6, race=dict(african=0.9, caucasian=0.1, asian=0.0)), skin='young_african_female',
                 hair='elvs_micky_afro', hair_col=(0.03, 0.02, 0.015), brows='eyebrow002',
                 clothes=['punkduck_high_neck_crop_top', 'punkduck_female_tight_jeans', 'punkduck_female_half-boots'],
                 tint={'crop': (0.42, 0.40, 0.36)}, backpack=(0.10, 0.18, 0.13)),
    'lena': dict(name='Lena', macro=mac(F, height=0.55, race=dict(caucasian=0.95, asian=0.05, african=0.0)), skin='toigo_light_skin_female_freckles',
                 hair='toigo_blunt_bob_with_bangs', hair_col=(0.42, 0.17, 0.07), brows='eyebrow004',
                 clothes=['punkduck_spaghetti_strap_tank_top', 'punkduck_comfortable_sneakers'],
                 tint={'tank': (0.80, 0.78, 0.72)}, skirt=dict(kind='denim', col=(0.13, 0.17, 0.26), len=0.36)),
    'jake': dict(name='Jake', macro=mac(Mm, height=0.5, race=dict(caucasian=0.95, asian=0.05, african=0.0)), skin='young_caucasian_male',
                 hair='short02', hair_col=(0.16, 0.10, 0.06), brows='eyebrow007',
                 clothes=['elvs_male_logo_tshirt1', 'elvs_male_trouser_short_1', 'punkduck_running_shoes_01'],
                 tint={}, backpack=(0.08, 0.09, 0.10)),
    'marcus': dict(name='Marcus', macro=mac(Mm, muscle=0.75, height=0.55, race=dict(african=0.95, caucasian=0.05, asian=0.0)), skin='young_african_male',
                 hair='short04', hair_col=(0.02, 0.015, 0.012), brows='eyebrow008',
                 clothes=['elvs_male_muscle_shirt1', 'elvs_male_trouser_short_2', 'culturalibre_sneakers'],
                 tint={'muscle': (0.55, 0.12, 0.10)}, backpack=(0.22, 0.24, 0.16)),
    'kenji': dict(name='Kenji', macro=mac(Mm, height=0.45, muscle=0.5, race=dict(asian=0.95, caucasian=0.05, african=0.0)), skin='young_asian_male',
                 hair='cortu_short_messy_hair', hair_col=(0.03, 0.025, 0.02), brows='eyebrow009',
                 clothes=['elvs_male_shirt_untucked_bd1', 'punkduck_male_classic_jeans', 'mindfront_shoes_biker_boots_male'],
                 tint={}, backpack=None),
    'cole': dict(name='Cole', macro=mac(Mm, height=0.52, weight=0.6, race=dict(caucasian=0.9, asian=0.0, african=0.1)), skin='toigo_light_skin_male_freckles',
                 hair='short01', hair_col=(0.30, 0.20, 0.11), brows='eyebrow010',
                 clothes=['elvs_male_tankshirt1', 'elvs_male_trouser_short_2', 'punkduck_running_shoes_01'],
                 tint={'tank': (0.20, 0.30, 0.22), 'short_2': (0.36, 0.32, 0.22)}, backpack=(0.30, 0.20, 0.10)),
    # ---------------------------------------------------------------- ghosts (same rig -> same mocap + grabs line up)
    'g_widow': dict(name='Widow', macro=mac(F, age=0.56, weight=0.28, muscle=0.3, height=0.78, cupsize=0.4, race=dict(caucasian=1.0, asian=0.0, african=0.0)),
                 skin='young_caucasian_female', skin_fx='corpse', hair='long01', hair_col=(0.012, 0.01, 0.01), brows='eyebrow001', eyes_fx='milky', face=True,
                 clothes=['elvs_ruffle_sleeve_peasant_blouse_1'], tint={'blouse': (0.80, 0.78, 0.73)}, gown=dict(col=(0.80, 0.78, 0.73), hem=0.03, flare=0.55)),
    'g_child': dict(name='HollowChild', macro=mac(F, age=0.16, weight=0.35, muscle=0.3, height=0.45, race=dict(caucasian=1.0, asian=0.0, african=0.0)),
                 skin='young_caucasian_female', skin_fx='corpse', hair='long01', hair_col=(0.01, 0.009, 0.008), brows='eyebrow001', eyes_fx='black', face=True,
                 clothes=['elvs_ruffle_sleeve_peasant_blouse_1'], tint={'blouse': (0.84, 0.82, 0.76)}, gown=dict(col=(0.84, 0.82, 0.76), hem=0.16, flare=0.35)),
    'g_warden': dict(name='Warden', macro=mac(Mm, age=0.62, weight=0.92, muscle=1.0, height=0.66, race=dict(caucasian=1.0, asian=0.0, african=0.0)),
                 skin='naim_abbassi_zombie_skin', skin_fx='bruised', hair=None, brows='eyebrow011', eyes_fx='bloodshot', face=True,
                 clothes=['male_worksuit01', 'mindfront_shoes_biker_boots_male'], tint={'worksuit': (0.18, 0.16, 0.13)}),
}

ID = ARGS[0] if ARGS else 'ava'
S = SPECS[ID]
result = {'id': ID}
bpy.ops.wm.read_homefile(use_empty=True)
U = AssetService.get_asset_roots('skins')[0].rsplit(os.sep + 'skins', 1)[0] if AssetService.get_asset_roots('skins') else ''


def first(sub, name, ext):
    d = AssetService.find_asset_absolute_path(name, sub)
    if d and d.endswith(ext): return d
    for root in AssetService.get_asset_roots(sub):
        g = glob.glob(os.path.join(root, name, '*' + ext))
        if g: return g[0]
    raise RuntimeError(f'asset not found {sub}/{name}')


licenses = []
def note_license(path):
    try:
        txt = open(path, encoding='utf8', errors='ignore').read()
        lic = re.search(r'^license\s+(.+)$', txt, re.M); au = re.search(r'^author\s+(.+)$', txt, re.M)
        nm = re.search(r'^name\s+(.+)$', txt, re.M)
        licenses.append({'asset': nm.group(1).strip() if nm else os.path.basename(path), 'author': au.group(1).strip() if au else 'MakeHuman',
                         'license': lic.group(1).strip() if lic else 'CC0'})
    except Exception:
        pass


# --------------------------------------------------------------------------- 1) body + assets
body = HumanService.create_human(macro_detail_dict=S['macro'], feet_on_ground=True, scale=0.1)
body.name = S['name'] + '_Body'
bpy.context.view_layer.update()
TargetService.bake_targets(body)
skin_mhmat = first('skins', S['skin'], '.mhmat'); note_license(skin_mhmat)
HumanService.set_character_skin(skin_mhmat, body, skin_type='MAKESKIN')
rig = HumanService.add_builtin_rig(body, 'game_engine')
rig.name = rig.data.name = 'Rig'
for sub, name, typ in [('eyes', 'high-poly', 'Eyes'), ('eyebrows', S.get('brows', 'eyebrow001'), 'Eyebrows'),
                       ('eyelashes', 'eyelashes02', 'Eyelashes'), ('teeth', 'teeth_base', 'Teeth')]:
    try:
        HumanService.add_mhclo_asset(first(sub, name, '.mhclo'), body, asset_type=typ, subdiv_levels=0)
    except Exception as e:
        print('ASSET FAIL', sub, name, e)
if S.get('hair'):
    p = first('hair', S['hair'], '.mhclo'); note_license(p)
    HumanService.add_mhclo_asset(p, body, asset_type='Hair', subdiv_levels=0)
for c in S['clothes']:
    try:
        p = first('clothes', c, '.mhclo'); note_license(p)
        HumanService.add_mhclo_asset(p, body, asset_type='Clothes', subdiv_levels=0)
    except Exception as e:
        print('CLOTH FAIL', c, e)
if S.get('face'):
    from bl_ext.user_default.mpfb.services.faceservice import FaceService
    if not body.data.shape_keys:
        body.shape_key_add(name='Basis', from_mix=False)
    for f in ['jawOpen', 'mouthStretchLeft', 'mouthStretchRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
              'eyeWideLeft', 'eyeWideRight', 'browInnerUp', 'browDownLeft', 'browDownRight', 'mouthFunnel', 'noseSneerLeft', 'noseSneerRight',
              'eyeBlinkLeft', 'eyeBlinkRight', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight']:
        tp = TargetService.target_full_path(f)
        if tp: TargetService.load_target(body, tp, weight=0.0, name=f)
        else: print('MISSING FACEUNIT', f)
    try: FaceService.interpolate_targets(body)
    except Exception as e: print('FACE INTERP FAIL', e)
bpy.context.view_layer.update()
O = bpy.data.objects
meshes = [o for o in O if o.type == 'MESH']
result['objects'] = [o.name for o in meshes]


def find(*keys):
    for o in meshes:
        n = o.name.lower()
        if any(k in n for k in keys) and o is not body:
            return o
    return None

# --------------------------------------------------------------------------- 2) delete body under garments
def wv(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        out.append({names[g.group]: g.weight for g in v.groups})
    return out
W = wv(body)
gi = {g.name for g in body.vertex_groups}
hide = [g for g in gi if g.startswith('Delete.') and not any(h in g.lower() for h in ('hair', 'alpha7', 'bob', 'afro', 'ponytail', 'short0', 'messy'))]
bm = bmesh.new(); bm.from_mesh(body.data)
# helper geometry (hair cap, tights, skirt helpers, joint cubes) is not in the 'body' group
kill = [v for v in bm.verts if W[v.index].get('body', 0.0) < 0.5 or any(W[v.index].get(g, 0) > 0.5 for g in hide)]
bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(body.data); bm.free(); body.data.update()
result['deleted_body_verts'] = len(kill)
for o in meshes:
    for m in [m for m in o.modifiers if m.type == 'MASK']:
        o.modifiers.remove(m)
    for m in [m for m in o.modifiers if m.type == 'SUBSURF']:
        o.modifiers.remove(m)

# --------------------------------------------------------------------------- 3) materials (glTF-safe, matte)
def img_np(im):
    w, h = im.size
    return np.array(im.pixels[:], np.float32).reshape(h, w, 4)
def new_img(name, a):
    h, w = a.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True); im.pixels = a.astype(np.float32).ravel()
    im.filepath_raw = os.path.join(TEX, f'{ID}_{name}.png'); im.file_format = 'PNG'; im.save(); im.pack()
    return im
def fit(im, size=1024):
    if im and max(im.size) > size:
        im.scale(size, size)
    return im
def tex_imgs(o):
    col = nrm = None
    for s in o.material_slots:
        if s.material and s.material.node_tree:
            for n_ in s.material.node_tree.nodes:
                if n_.type == 'TEX_IMAGE' and n_.image:
                    nm = n_.image.name.lower() + (n_.image.filepath or '').lower()
                    if 'normal' in nm or 'nrm' in nm or '_n.' in nm: nrm = nrm or n_.image
                    elif 'spec' in nm or 'rough' in nm or 'ao' in nm.split('.')[-2:-1]: pass
                    else: col = col or n_.image
    return col, nrm
def pbr(name, col_img=None, rough=0.8, alpha=False, nrm_img=None, color=(1, 1, 1, 1), spec=0.3, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bs.outputs[0], out.inputs[0])
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Base Color'].default_value = color
    bs.inputs['Metallic'].default_value = metal
    try: bs.inputs['Specular IOR Level'].default_value = spec
    except Exception: pass
    if col_img:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = col_img
        nt.links.new(t.outputs['Color'], bs.inputs['Base Color'])
        if alpha: nt.links.new(t.outputs['Alpha'], bs.inputs['Alpha'])
    if nrm_img:
        t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = nrm_img; t2.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(t2.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    if alpha:
        m.blend_method = 'HASHED' if hasattr(m, 'blend_method') else None
        try: m.surface_render_method = 'DITHERED'
        except Exception: pass
    return m
def set_mat(o, m):
    o.data.materials.clear(); o.data.materials.append(m)
    for p in o.data.polygons: p.material_index = 0

# skin: diffuse from the mhmat
txt = open(skin_mhmat, encoding='utf8', errors='ignore').read()
dif = re.search(r'^diffuseTexture\s+(.+)$', txt, re.M)
skin_img = None
if dif:
    pth = os.path.join(os.path.dirname(skin_mhmat), os.path.basename(dif.group(1).strip()))
    if os.path.exists(pth):
        skin_img = fit(bpy.data.images.load(pth, check_existing=True), 2048); skin_img.pack()
if skin_img is not None and S.get('skin_fx'):
    a = img_np(skin_img)
    lum = (a[..., :3] * [0.3, 0.55, 0.15]).sum(-1, keepdims=True)
    if S['skin_fx'] == 'corpse':
        # drained, grey-blue dead skin; keep the pore/detail contrast, mottle it
        rng = np.random.default_rng(3); h_, w_ = a.shape[:2]
        mott = np.kron(rng.random((h_ // 64 + 1, w_ // 64 + 1)), np.ones((64, 64)))[:h_, :w_][..., None]
        a[..., :3] = np.clip(lum * np.array([0.86, 0.9, 0.98]) * (0.9 + 0.12 * mott) + np.array([0.0, 0.01, 0.03]), 0, 1)
    elif S['skin_fx'] == 'bruised':
        a[..., :3] = np.clip(a[..., :3] * np.array([0.92, 0.85, 0.82]), 0, 1)
    skin_img = new_img('skin_fx', a)
set_mat(body, pbr(S['name'] + '_Skin', skin_img, rough=0.62, spec=0.32))

for o in meshes:
    if o is body: continue
    n = o.name.lower()
    col, nrm = tex_imgs(o)
    if col: fit(col, 1024); col.pack()
    if nrm: fit(nrm, 1024); nrm.pack()
    if 'eye' in n and 'brow' not in n and 'lash' not in n:
        fx = S.get('eyes_fx')
        if fx and col is not None:
            a = img_np(col); lum = a[..., :3].mean(-1, keepdims=True)
            if fx == 'milky': a[..., :3] = np.clip(0.55 + 0.35 * lum * np.array([0.95, 0.97, 1.0]), 0, 1)     # clouded, pupil-less
            elif fx == 'black': a[..., :3] = np.clip(lum * 0.06, 0, 1)                                      # all-black eyes
            elif fx == 'bloodshot': a[..., :3] = np.clip(a[..., :3] * np.array([1.0, 0.55, 0.5]) + np.array([0.15, 0, 0]), 0, 1)
            col = new_img('eyes_fx', a)
        set_mat(o, pbr(o.name + '_M', col, rough=0.12, spec=0.5)); continue
    if 'brow' in n or 'lash' in n:
        set_mat(o, pbr(o.name + '_M', col, rough=0.7, alpha=True)); continue
    if 'teeth' in n:
        set_mat(o, pbr(o.name + '_M', col, rough=0.3)); continue
    if o.name.lower().find((S.get('hair') or '###').lower()) >= 0 or 'hair' in n or 'ponytail' in n or 'bob' in n or 'afro' in n or 'short0' in n or 'alpha7' in n or 'messy' in n:
        a = img_np(col) if col else np.ones((64, 64, 4), np.float32)
        lum = a[..., :3].mean(-1, keepdims=True)
        m_ = lum[a[..., 3] > 0.5].mean() if (a[..., 3] > 0.5).any() else 0.5
        hc = np.array(S.get('hair_col', (0.1, 0.07, 0.05)))
        a[..., :3] = np.clip(hc * (0.45 + 0.9 * lum / max(m_, 1e-3)), 0, 1)
        set_mat(o, pbr(S['name'] + '_Hair', new_img('hair', a), rough=0.55, alpha=True, spec=0.3))
        result['hair_obj'] = o.name
        continue
    # garments: optional retint keeps the fabric detail (luminance) under a new colour
    tint = next((v for k, v in S.get('tint', {}).items() if k in n), None)
    if tint is not None and col is not None:
        a = img_np(col)
        lum = (a[..., :3] * [0.3, 0.5, 0.2]).sum(-1, keepdims=True)
        mean = max(lum[a[..., 3] > 0.1].mean() if (a[..., 3] > 0.1).any() else 0.5, 1e-3)
        a[..., :3] = np.clip(np.array(tint) * (0.35 + 0.65 * lum / mean), 0, 1)
        col = new_img(o.name.lower().replace('.', '_') + '_tint', a)
    set_mat(o, pbr(o.name + '_M', col, rough=0.86, nrm_img=nrm, spec=0.25))

# --------------------------------------------------------------------------- helpers for modelled extras
B = rig.data.bones
def bhead(n): return rig.matrix_world @ B[n].head_local
def btail(n): return rig.matrix_world @ B[n].tail_local
clothed = [o for o in meshes if o is not body and not any(k in o.name.lower() for k in ('eye', 'brow', 'lash', 'teeth', 'hair', 'ponytail', 'afro', 'bob', 'alpha7', 'messy', 'short0'))]
def bvh_of(objs):
    verts, polys, off = [], [], 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = o.evaluated_get(dg).to_mesh()
        mw = o.matrix_world
        verts += [mw @ v.co for v in me.vertices]
        polys += [[i + off for i in p.vertices] for p in me.polygons]
        off += len(me.vertices)
        o.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys), verts
surf_bvh, surf_v = bvh_of([body] + clothed)
SV = np.array([tuple(v) for v in surf_v])

def add_bone(name, parent, head, tail):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones.new(name)
    eb.head = rig.matrix_world.inverted() @ head; eb.tail = rig.matrix_world.inverted() @ tail
    eb.parent = rig.data.edit_bones[parent]; eb.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')

def skin_to(obj, groups):
    """groups: list (per vertex) of {bone: weight}. Adds vertex groups + armature modifier, parents to rig."""
    for vi, gw in enumerate(groups):
        tot = sum(gw.values()) or 1
        for g, w in gw.items():
            vg = obj.vertex_groups.get(g) or obj.vertex_groups.new(name=g)
            vg.add([vi], w / tot, 'REPLACE')
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    mod = obj.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

def body_weights_at(points, k=6, only=None):
    """Nearest-vertex blended skin weights from the (deformed-by-rig) body for arbitrary points."""
    BV = np.array([tuple(body.matrix_world @ v.co) for v in body.data.vertices])
    BW = wv(body)
    out = []
    for p in points:
        d = np.linalg.norm(BV - np.array(tuple(p)), axis=1)
        idx = np.argpartition(d, k)[:k]
        acc = {}
        for i in idx:
            w = 1.0 / (d[i] + 1e-3)
            for g, x in BW[i].items():
                if g in B and B[g].use_deform and (only is None or g in only):
                    acc[g] = acc.get(g, 0) + x * w
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top) or 1
        out.append({g: x / tot for g, x in top})
    return out

def fabric_tex(name, base, weave=0.06, scale=128, plaid=False, denim=False):
    n = 512
    y, x = np.mgrid[0:n, 0:n] / n
    a = np.ones((n, n, 4), np.float32)
    w = (np.sin(x * scale * math.pi) * np.sin(y * scale * math.pi))
    noise = np.random.default_rng(7).random((n, n)) * 0.08
    lum = 1 + weave * w - noise * 0.6
    col = np.array(base)[None, None, :] * lum[..., None]
    if plaid:
        bx = (np.sin(x * 16 * math.pi) > 0.82) | (np.sin(y * 16 * math.pi) > 0.82)
        tx = (np.abs(np.sin(x * 16 * math.pi + 1.2)) < 0.05) | (np.abs(np.sin(y * 16 * math.pi + 1.2)) < 0.05)
        col = np.where(bx[..., None], col * 0.35, col)
        col = np.where(tx[..., None], np.array([0.75, 0.62, 0.3]) * 0.6, col)
    if denim:
        diag = np.sin((x + y) * 300) * 0.07
        col = col * (1 + diag[..., None]) + noise[..., None] * 0.1
    a[..., :3] = np.clip(col, 0, 1)
    return new_img(name, a)

def nylon_normal(name):
    n = 256
    y, x = np.mgrid[0:n, 0:n] / n
    hx = np.cos(x * 220 * math.pi) * 0.12; hy = np.cos(y * 220 * math.pi) * 0.12
    a = np.ones((n, n, 4), np.float32)
    a[..., 0] = 0.5 + hx * 0.5; a[..., 1] = 0.5 + hy * 0.5; a[..., 2] = 1.0
    im = new_img(name, a); im.colorspace_settings.name = 'Non-Color'
    return im

# --------------------------------------------------------------------------- 4) backpack
if S.get('backpack'):
    colr = S['backpack']
    s3h, s3t = bhead('spine_03'), btail('spine_03')
    s2h = bhead('spine_02')
    zc = (s3h.z + s2h.z) / 2 + 0.03
    # back surface (+Y is the character's back) in the band of the pack
    band = SV[(SV[:, 2] > zc - 0.18) & (SV[:, 2] < zc + 0.2) & (np.abs(SV[:, 0]) < 0.14)]
    back_y = band[:, 1].max()
    PW, PH, PD = 0.30, 0.42, 0.15
    center = V((0, back_y + PD / 2 + 0.012, zc))
    def rbox(name, size, loc, bevel, segs=4):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        o = bpy.context.active_object; o.name = name; o.scale = size
        bpy.ops.object.transform_apply(scale=True)
        md = o.modifiers.new('bv', 'BEVEL'); md.width = bevel; md.segments = segs; md.limit_method = 'NONE'
        bpy.ops.object.modifier_apply(modifier='bv')
        return o
    parts = []
    main = rbox('Pack_Main', (PW, PD, PH), center, 0.045, 5)
    # slight pillow shape: bulge the back-facing side, flatten the side against the spine
    for v in main.data.vertices:
        ry = (v.co.y - center.y) / (PD / 2)
        rx = (v.co.x - center.x) / (PW / 2); rz = (v.co.z - center.z) / (PH / 2)
        if ry > 0: v.co.y += 0.025 * (1 - rx * rx) * (1 - rz * rz) * ry
    parts.append(main)
    flap = rbox('Pack_Flap', (PW + 0.012, PD * 0.85, 0.11), center + V((0, 0.012, PH / 2 - 0.035)), 0.035, 4)
    parts.append(flap)
    pocket = rbox('Pack_Pocket', (PW * 0.72, 0.06, PH * 0.42), center + V((0, PD / 2 + 0.035, -PH * 0.17)), 0.025, 4)
    parts.append(pocket)
    for sx in (-1, 1):
        sp = rbox('Pack_Side', (0.05, PD * 0.62, PH * 0.34), center + V((sx * (PW / 2 + 0.018), 0.01, -PH * 0.22)), 0.018, 3)
        parts.append(sp)
    zip_ = rbox('Pack_Zip', (PW * 0.66, 0.008, 0.012), center + V((0, PD / 2 + 0.066, -PH * 0.0)), 0.003, 1)
    parts.append(zip_)
    grab = rbox('Pack_Handle', (0.09, 0.025, 0.02), center + V((0, -0.01, PH / 2 + 0.012)), 0.008, 2)
    parts.append(grab)
    nylon = pbr(S['name'] + '_Nylon', fabric_tex('nylon', colr, weave=0.018, scale=420), rough=0.8, nrm_img=nylon_normal('nylon_n'), spec=0.3)
    trim = pbr(S['name'] + '_Webbing', fabric_tex('webbing', (0.03, 0.03, 0.035), weave=0.12, scale=90), rough=0.9, spec=0.2)
    metal = pbr(S['name'] + '_Zip', None, rough=0.35, color=(0.55, 0.55, 0.56, 1), metal=1.0)
    for p in parts:
        set_mat(p, metal if p.name.startswith('Pack_Zip') else trim if p.name.startswith(('Pack_Handle',)) else nylon)
        bpy.ops.object.select_all(action='DESELECT'); p.select_set(True); bpy.context.view_layer.objects.active = p
        bpy.ops.object.shade_smooth()
    # UVs: cube projection so the weave tiles at a sensible scale
    for p in parts:
        bpy.ops.object.select_all(action='DESELECT'); p.select_set(True); bpy.context.view_layer.objects.active = p
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.cube_project(cube_size=0.6); bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = main
    bpy.ops.object.join()
    pack = main; pack.name = S['name'] + '_Backpack'
    # pack bone: pivot at the top of the pack, near the spine (springs at runtime)
    add_bone('backpack', 'spine_03', center + V((0, -PD / 2, PH / 2 - 0.02)), center + V((0, -PD / 2, -PH / 2)))
    skin_to(pack, [{'backpack': 1.0} for _ in pack.data.vertices])

    # ---- straps: path over the shoulder, down the chest, back under the arm; projected on the clothed surface
    def surf(p, off=0.007):
        loc, nrm, idx, dist = surf_bvh.find_nearest(p)
        if loc is None: return p, V((0, 0, 1))
        out = (p - loc)
        n = nrm if nrm.dot(out) >= 0 or out.length < 1e-6 else -nrm
        # always sit outside: if the guide point was inside, push along the face normal
        return loc + nrm.normalized() * off, nrm.normalized()
    strap_objs = []
    for sx in (-1, 1):
        cl = bhead(f'clavicle_{"l" if sx > 0 else "r"}'); ua = bhead(f'upperarm_{"l" if sx > 0 else "r"}')
        sh = cl.lerp(ua, 0.55); sh.z += 0.06                                        # top of the shoulder
        guide = []
        top = center + V((sx * 0.075, -PD / 2 + 0.01, PH / 2 - 0.05))
        bot = center + V((sx * (PW / 2 - 0.03), -PD / 2 + 0.02, -PH / 2 + 0.05))
        # back segment -> over shoulder -> front chest -> armpit -> back to the bottom corner
        ctrl = [top, V((sh.x, sh.y + 0.07, sh.z + 0.01)), V((sh.x, sh.y, sh.z + 0.03)), V((sh.x * 0.95, sh.y - 0.08, sh.z - 0.02)),
                V((sx * abs(sh.x) * 0.85, sh.y - 0.12, sh.z - 0.16)), V((sx * abs(ua.x) * 0.95, ua.y - 0.05, ua.z - 0.2)),
                V((sx * abs(ua.x) * 0.95, ua.y + 0.06, ua.z - 0.25)), bot]
        # Catmull-Rom resample
        pts = []
        for i in range(len(ctrl) - 1):
            p0 = ctrl[max(0, i - 1)]; p1 = ctrl[i]; p2 = ctrl[i + 1]; p3 = ctrl[min(len(ctrl) - 1, i + 2)]
            for t in np.linspace(0, 1, 9, endpoint=False):
                t2, t3 = t * t, t * t * t
                pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
        pts.append(ctrl[-1])
        # project the middle of the path onto the torso; ends stay attached to the pack
        proj, nrms = [], []
        for i, p in enumerate(pts):
            f = i / (len(pts) - 1)
            if 0.08 < f < 0.94:
                q, n = surf(p, 0.008); proj.append(q); nrms.append(n)
            else:
                proj.append(p); nrms.append(V((0, -1, 0)))
        # smooth twice (keeps the ribbon fair)
        for _ in range(2):
            proj = [proj[0]] + [(proj[i - 1] + proj[i] * 2 + proj[i + 1]) / 4 for i in range(1, len(proj) - 1)] + [proj[-1]]
            proj = [surf(p, 0.008)[0] if 0.08 < i / (len(proj) - 1) < 0.94 else p for i, p in enumerate(proj)]
        # ribbon
        bmS = bmesh.new()
        wdt, th = 0.045, 0.006
        rows = []
        for i, p in enumerate(proj):
            tng = (proj[min(i + 1, len(proj) - 1)] - proj[max(i - 1, 0)]).normalized()
            n = nrms[i]
            side = tng.cross(n).normalized()
            n = side.cross(tng).normalized()
            r = [bmS.verts.new(p + side * wdt / 2), bmS.verts.new(p - side * wdt / 2),
                 bmS.verts.new(p - side * wdt / 2 + n * th), bmS.verts.new(p + side * wdt / 2 + n * th)]
            rows.append(r)
        for i in range(len(rows) - 1):
            a, b = rows[i], rows[i + 1]
            for k in range(4):
                bmS.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
        meS = bpy.data.meshes.new('strap'); bmS.to_mesh(meS); bmS.free()
        so = bpy.data.objects.new(f'{S["name"]}_Strap{"L" if sx > 0 else "R"}', meS); bpy.context.collection.objects.link(so)
        set_mat(so, trim)
        for p in so.data.polygons: p.use_smooth = True
        # weights: body skin along the torso, blending into the pack bone at both ends
        vpts = [v.co for v in so.data.vertices]
        bw = body_weights_at(vpts, only={'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'neck_01', 'spine_01'})
        groups = []
        n_rows = len(rows)
        for vi in range(len(vpts)):
            f = (vi // 4) / (n_rows - 1)
            pk = max(0.0, 1 - f / 0.12) + max(0.0, (f - 0.86) / 0.14)
            pk = min(1.0, pk)
            g_ = {k: v * (1 - pk) for k, v in bw[vi].items()}
            # the shoulder arc must not follow the upper arm too much (no strap tearing when arms swing)
            for k in list(g_):
                if k.startswith('upperarm'): g_[k] *= 0.35
            if pk > 0: g_['backpack'] = g_.get('backpack', 0) + pk
            groups.append(g_)
        skin_to(so, groups)
        # buckles / adjusters on the chest
        strap_objs.append(so)
    result['backpack'] = True

# --------------------------------------------------------------------------- 5) skirt / gown
if S.get('gown'):
    S['skirt'] = dict(kind='gown', col=S['gown']['col'], len=None, gown=S['gown'])
if S.get('skirt'):
    sk = S['skirt']
    pel = bhead('pelvis'); th_l = bhead('thigh_l'); ca_l = bhead('calf_l')
    gown = sk.get('gown')
    if gown:
        z_top = bhead('spine_01').z + 0.02                           # high waist, under the blouse hem
        z_hem = gown['hem']
    else:
        z_top = pel.z + 0.075                                        # waistband just above the hip bones
        z_hem = z_top - sk['len']
    NR, NA = (40, 64) if sk['kind'] == 'gown' else (18, 72 if sk['kind'] == 'pleated' else 56)
    cx, cy = 0.0, (pel.y + th_l.y) / 2
    # lower-body skin + lower garments only (the A-posed hands hang at hip height and must not count)
    BWs = wv(body)
    low = {'pelvis', 'thigh_l', 'thigh_r', 'spine_01', 'calf_l', 'calf_r'} | ({'spine_02', 'spine_03', 'foot_l', 'foot_r'} if sk['kind'] == 'gown' else set())
    LB = np.array([tuple(body.matrix_world @ v.co) for v in body.data.vertices
                   if sum(w for g, w in BWs[v.index].items() if g in low) > 0.5])
    rows = []
    for ri in range(NR + 1):
        f = ri / NR
        z = z_top + (z_hem - z_top) * f
        # body + garment extent at this height in each direction
        sl = LB[np.abs(LB[:, 2] - z) < 0.025]
        ring = []
        for ai in range(NA):
            a = ai / NA * math.pi * 2
            dx, dy = math.cos(a), math.sin(a)
            if len(sl):
                proj = (sl[:, 0] - cx) * dx + (sl[:, 1] - cy) * dy
                perp = np.abs(-(sl[:, 0] - cx) * dy + (sl[:, 1] - cy) * dx)
                cand = proj[perp < 0.03]
                r = (cand.max() if len(cand) else 0.15) + 0.012
            else:
                r = 0.16
            ring.append(r)
        ring = np.maximum.accumulate(np.array(ring)) * 0 + np.array(ring)
        rows.append(ring)
    rows = np.array(rows)
    # monotonic flare downward + extra room for the stride
    if sk['kind'] == 'gown':
        # bodice hugs the torso; from the hips down it falls straight, then flares to the floor
        zs = np.array([z_top + (z_hem - z_top) * (ri / NR) for ri in range(NR + 1)])
        hip_row = int(np.argmin(np.abs(zs - (pel.z - 0.05))))
        for ri in range(hip_row + 1, NR + 1):
            f = (ri - hip_row) / max(1, NR - hip_row)
            rows[ri] = np.maximum(rows[ri], rows[ri - 1] + 0.0008 + 0.006 * sk['gown'].get('flare', 0.5) * f)
    else:
        for ri in range(1, NR + 1):
            f = ri / NR
            rows[ri] = np.maximum(rows[ri], rows[ri - 1] + 0.0012 + 0.0045 * f)
    # smooth around the ring (no dents between the legs)
    for _ in range(4):
        rows = (np.roll(rows, 1, 1) + rows * 2 + np.roll(rows, -1, 1)) / 4
    bmK = bmesh.new()
    vrows = []
    for ri in range(NR + 1):
        f = ri / NR
        z = z_top + (z_hem - z_top) * f
        vr = []
        for ai in range(NA):
            a = ai / NA * math.pi * 2
            r = rows[ri, ai]
            if sk['kind'] == 'pleated':
                r += 0.009 * f * (1 if (ai // 2) % 2 == 0 else -0.6)          # knife pleats open toward the hem
            elif sk['kind'] == 'gown':
                r += (0.004 + 0.016 * max(0.0, f - 0.35)) * math.sin(a * 11 + f * 2.0)   # soft folds deepening to the hem
            else:
                r += 0.003 * math.sin(a * 9) * f                                 # soft A-line drape
            vr.append(bmK.verts.new(V((cx + math.cos(a) * r, cy + math.sin(a) * r, z))))
        vrows.append(vr)
    uv_rows = []
    for ri in range(NR):
        for ai in range(NA):
            a0, a1 = vrows[ri][ai], vrows[ri][(ai + 1) % NA]
            b0, b1 = vrows[ri + 1][ai], vrows[ri + 1][(ai + 1) % NA]
            bmK.faces.new((a0, b0, b1, a1))
    # waistband thickness: inner ring
    uvl = bmK.loops.layers.uv.new('UVMap')
    for fc in bmK.faces:
        for lp in fc.loops:
            v = lp.vert.co
            ang = (math.atan2(v.y - cy, v.x - cx) / (2 * math.pi)) % 1.0
            lp[uvl].uv = (ang * 4.0, (z_top - v.z) * 4.0)
    meK = bpy.data.meshes.new('skirt'); bmK.to_mesh(meK); bmK.free()
    so = bpy.data.objects.new(S['name'] + '_Skirt', meK); bpy.context.collection.objects.link(so)
    sol = so.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 0.004; sol.offset = 1
    bpy.context.view_layer.objects.active = so; bpy.ops.object.select_all(action='DESELECT'); so.select_set(True)
    bpy.ops.object.modifier_apply(modifier='solid')
    for p in so.data.polygons: p.use_smooth = True
    mat = pbr(S['name'] + '_SkirtM', fabric_tex('skirt', sk['col'], weave=0.03 if sk['kind'] == 'gown' else 0.07, scale=260, plaid=sk.get('plaid', False), denim=sk['kind'] == 'denim'),
              rough=0.92, spec=0.2)
    mat.use_backface_culling = False
    set_mat(so, mat)
    sz = min(z_top, pel.z + 0.075)
    add_bone('skirt_f', 'pelvis', V((0, pel.y - 0.12, sz - 0.05)), V((0, pel.y - 0.16, z_hem)))
    add_bone('skirt_b', 'pelvis', V((0, pel.y + 0.1, sz - 0.05)), V((0, pel.y + 0.16, z_hem)))
    groups = []
    if sk['kind'] == 'gown':
        # bodice: the body's own weights; skirt part: pelvis -> thighs -> a touch of calf, plus the sway bones
        vpts = [v.co for v in so.data.vertices]
        bw = body_weights_at(vpts, only={'spine_01', 'spine_02', 'spine_03', 'pelvis', 'clavicle_l', 'clavicle_r'})
        for vi, v in enumerate(so.data.vertices):
            if v.co.z > pel.z + 0.02:
                groups.append(bw[vi]); continue
            f = min(1, max(0, (pel.z + 0.02 - v.co.z) / (pel.z + 0.02 - z_hem)))
            lt = max(0.0, min(1.0, 0.5 + (v.co.x - cx) * 5))
            leg = 0.5 * f
            fb = 'skirt_f' if v.co.y < cy else 'skirt_b'
            g_ = {'pelvis': max(0.05, 1 - leg - 0.4 * f), fb: 0.4 * f, 'thigh_l': leg * lt * 0.8, 'thigh_r': leg * (1 - lt) * 0.8}
            if f > 0.6:
                g_['calf_l'] = (f - 0.6) * 0.5 * lt; g_['calf_r'] = (f - 0.6) * 0.5 * (1 - lt)
            groups.append({k: x for k, x in g_.items() if x > 1e-4})
    else:
        def seg_d(p, a, b):
            ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / ab.dot(ab))); return (a + ab * t - p).length
        TL = (bhead('thigh_l'), bhead('calf_l')); TR = (bhead('thigh_r'), bhead('calf_r'))
        for v in so.data.vertices:
            f = min(1, max(0, (z_top - v.co.z) / (z_top - z_hem)))
            dl, dr = seg_d(v.co, *TL), seg_d(v.co, *TR)
            el, er = math.exp(-dl / 0.06), math.exp(-dr / 0.06)
            lt = el / (el + er)                                            # 1 = rides on the left thigh
            leg = min(0.92, 0.15 + 0.85 * f ** 1.2)                        # waistband on the hips, hem on the legs
            frontback = 'skirt_f' if v.co.y < cy else 'skirt_b'
            g_ = {'pelvis': max(0.02, 1 - leg), frontback: 0.12 * f}
            g_['thigh_l'] = leg * lt; g_['thigh_r'] = leg * (1 - lt)
            groups.append({k: x for k, x in g_.items() if x > 1e-4})
    skin_to(so, groups)
    result['skirt'] = True
    if gown:
        # legs under a gown are never seen: remove them so no stride can push skin through the cloth
        BW2 = wv(body)
        legs = {'thigh_l', 'thigh_r', 'calf_l', 'calf_r'}
        bm = bmesh.new(); bm.from_mesh(body.data)
        kill = [v for v in bm.verts if (body.matrix_world @ v.co).z > z_hem + 0.06 and (body.matrix_world @ v.co).z < pel.z - 0.02
                and sum(w for g, w in BW2[v.index].items() if g in legs) > 0.5]
        bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(body.data); bm.free(); body.data.update()
        result['gown_leg_verts_removed'] = len(kill)

# --------------------------------------------------------------------------- 6) export
KEEP_KEYS = {body.name} if S.get('face') else set()
for o in O:
    if o.type == 'MESH':
        o.data.update()
        if o.data.shape_keys and o.name not in KEEP_KEYS: o.shape_key_clear()
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for c in O:
    if c.type == 'MESH' and (c.parent == rig or c.find_armature() == rig):
        c.select_set(True)
bpy.context.view_layer.objects.active = rig
out = os.path.join(OUTDIR, ID + '.glb') if not ID.startswith('g_') else os.path.join(TEX, ID + '_mesh.glb')
H = max((rig.matrix_world @ v.co).z for o in O if o.type == 'MESH' and o is body for v in o.data.vertices)
rig['cast'] = json.dumps({'id': ID, 'name': S['name'], 'height': round(H, 3), 'backpack': bool(S.get('backpack')), 'skirt': bool(S.get('skirt')),
                          'licenses': licenses})
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_animations=False, export_extras=True, export_morph=False,
    export_image_format='WEBP', export_image_quality=86, export_tangents=False,
    export_meshopt_compression_enable=True, export_skins=True, export_all_influences=False,
    export_def_bones=True, export_leaf_bone=False)
result['glb_mb'] = round(os.path.getsize(out) / 1e6, 2)
result['height'] = round(H, 3)
result['licenses'] = len(licenses)
tris = sum(len(o.data.polygons) for o in O if o.type == 'MESH')
result['polys'] = tris
if 'render' in ARGS or ID.startswith('g_'):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(TEX, ID + '.blend'))
print('RESULT', json.dumps(result, default=str))
