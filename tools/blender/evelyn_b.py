# EVELYN HART - stage B: skin. High->low normal/AO bake + procedural skin detail (pores, freckles, flush,
# veins, lips) baked into Head (4K) and Body (2K/4K) texture sets, normals combined with RNM in numpy.
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
import numpy as np

CFG = globals().get('CFG', {})
STAGE_A = r"D:\Web Based - Horror Game\tools\blender\evelyn_stageA.blend"
STAGE_B = r"D:\Web Based - Horror Game\tools\blender\evelyn_stageB.blend"
TEX = os.path.join(PROJECT, "tools", "blender", "_bake", "evelyn")
os.makedirs(TEX, exist_ok=True)
RES = {0: CFG.get('head_res', 4096), 1: CFG.get('body_res', 4096)}
SAMPLES = CFG.get('samples', 16)

bpy.ops.wm.read_homefile(use_empty=True)   # the stage file may be the open file; start clean
reset_scene()
with bpy.data.libraries.load(STAGE_A, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n.startswith('Evelyn_')]
for o in dst.objects:
    link(o)
bpy.context.view_layer.update()
body = bpy.data.objects['Evelyn_Body']
eyeL, eyeR = bpy.data.objects['Evelyn_Eye.L'], bpy.data.objects['Evelyn_Eye.R']

# landmarks (from stage A, after scaling)
NOSE = V((0.0, -0.1715, 1.5376)); CHIN = V((0.0, -0.1466, 1.4657)); MOUTH = V((0.0, -0.148, 1.4891))
EYEL = V((0.0338, -0.125, 1.5704)); EYER = V((-0.0337, -0.1248, 1.5704))

# --------------------------------------------------------------------------- high + low
def dup(o, name):
    c = o.copy(); c.data = o.data.copy(); c.name = name; c.data.name = name
    link(c)
    return c
high = dup(body, 'Evelyn_High')
high.modifiers[0].levels = 3; high.modifiers[0].render_levels = 3
apply_modifiers(high)
low = body
low.modifiers[0].levels = 1; low.modifiers[0].render_levels = 1
apply_modifiers(low)
shade_smooth(low); shade_smooth(high)
result = {"low_verts": len(low.data.vertices), "high_verts": len(high.data.vertices)}

# --------------------------------------------------------------------------- procedural skin material
def skin_material(name, head):
    m, nt = new_mat(name, rough=0.45)
    b = nt.bsdf()
    co = nt.tex_coord('Object')
    sep = nt.node('ShaderNodeSeparateXYZ'); nt.link(co, sep.inputs[0])

    def near(pt, r, sc=(1, 1, 1)):
        mp = nt.mapping(co, scale=(1 / sc[0], 1 / sc[1], 1 / sc[2]), loc=(-pt[0] / sc[0], -pt[1] / sc[1], -pt[2] / sc[2]))
        d = nt.node('ShaderNodeVectorMath'); d.operation = 'LENGTH'; nt.link(mp, d.inputs[0])
        g = nt.math('DIVIDE', d.outputs['Value'], r)
        return nt.math('EXPONENT', nt.math('MULTIPLY', nt.math('MULTIPLY', g, g), -1.0))   # gaussian

    def maxf(*xs):
        a = xs[0]
        for x in xs[1:]:
            a = nt.math('MAXIMUM', a, x)
        return a

    def mixc(c, col, fac):
        return nt.mix(c, col, fac)

    # base tone: warm light skin with melanin / haemoglobin variation at several scales
    low_f = nt.noise(co, scale=6, detail=3, rough=0.5)
    mid_f = nt.noise(co, scale=40, detail=4, rough=0.55)
    c = nt.ramp(low_f.outputs['Fac'], [(0.3, (0.50, 0.31, 0.23, 1)), (0.7, (0.58, 0.38, 0.29, 1))]).outputs['Color']
    c = mixc(c, (0.56, 0.29, 0.23, 1), nt.math('MULTIPLY', mid_f.outputs['Fac'], 0.3))     # blotchy blood flush
    c = mixc(c, (0.56, 0.40, 0.27, 1), nt.math('MULTIPLY', nt.math('GREATER_THAN', mid_f.outputs['Fac'], 0.6), 0.12))
    # haemoglobin flush zones
    red = (0.52, 0.2, 0.17, 1)
    flush = maxf(near(NOSE + V((0, 0.006, 0.004)), 0.016), near(V((0.045, -0.13, 1.535)), 0.026, (1.2, 1, 0.8)),
                 near(V((-0.045, -0.13, 1.535)), 0.026, (1.2, 1, 0.8)), near(CHIN, 0.018))
    ears = maxf(near(V((0.074, -0.06, 1.555)), 0.022), near(V((-0.074, -0.06, 1.555)), 0.022))
    c = mixc(c, red, nt.math('MULTIPLY', maxf(flush, ears), 0.45))
    # lips: deeper rose with fine vertical lines
    lips = near(MOUTH + V((0, -0.004, 0.0)), 0.016, (1.55, 0.7, 0.55))
    lipline = nt.wave(nt.mapping(co, scale=(1, 1, 1)), scale=900, distortion=2, kind='BANDS', direction='X')
    lipcol = mixc((0.42, 0.14, 0.14, 1), (0.33, 0.1, 0.11, 1), nt.math('MULTIPLY', lipline.outputs['Fac'], 0.6))
    lipm = nt.math('POWER', nt.math('MULTIPLY', lips, 2.2), 1.4)
    c = mixc(c, lipcol, nt.math('MINIMUM', lipm, 1.0))
    # under-eye: slight blue-violet thin skin; eyelids pinker
    for E, sx in ((EYEL, 1), (EYER, -1)):
        under = near(E + V((0.004 * sx, -0.012, -0.016)), 0.011, (1.4, 1, 0.6))
        c = mixc(c, (0.36, 0.25, 0.27, 1), nt.math('MULTIPLY', under, 0.45))
        lid = near(E + V((0, -0.01, 0.009)), 0.013, (1.3, 1, 0.6))
        c = mixc(c, (0.47, 0.25, 0.22, 1), nt.math('MULTIPLY', lid, 0.35))
    # freckles: dense over nose bridge + upper cheeks, sparse on shoulders/forearms
    fv = nt.voronoi(co, scale=520, feature='F1', rand=1.0)
    fsz = nt.noise(co, scale=300, detail=1)
    fr = nt.math('LESS_THAN', fv.outputs['Distance'], nt.math('ADD', 0.12, nt.math('MULTIPLY', fsz.outputs['Fac'], 0.18)))
    fpick = nt.math('GREATER_THAN', nt.noise(co, scale=180, detail=0).outputs['Fac'], 0.45)
    fmask = maxf(near(V((0, -0.165, 1.548)), 0.034, (2.4, 1, 0.75)), near(V((0.0, -0.1, 1.33)), 0.12, (2.5, 2, 0.6)))
    if not head:
        fmask = maxf(fmask, nt.math('MULTIPLY', nt.math('GREATER_THAN', sep.outputs['Z'], 1.2), 0.35))
    fre = nt.math('MULTIPLY', nt.math('MULTIPLY', fr, fpick), fmask)
    c = mixc(c, (0.27, 0.13, 0.065, 1), nt.math('MULTIPLY', fre, 0.85))
    # a few moles
    mv = nt.voronoi(co, scale=45, feature='F1', rand=1.0)
    mole = nt.math('MULTIPLY', nt.math('LESS_THAN', mv.outputs['Distance'], 0.025), nt.math('GREATER_THAN', nt.noise(co, scale=30, detail=0).outputs['Fac'], 0.66))
    c = mixc(c, (0.28, 0.16, 0.11, 1), nt.math('MULTIPLY', mole, 0.85))
    # veins (temples, neck, inner arms): faint blue-green branching ridges
    vn = nt.noise(co, scale=55, detail=4, distortion=1.4)
    vr = nt.math('LESS_THAN', nt.math('ABSOLUTE', nt.math('SUBTRACT', vn.outputs['Fac'], 0.5)), 0.012)
    vmask = maxf(near(V((0.06, -0.08, 1.6)), 0.03), near(V((-0.06, -0.08, 1.6)), 0.03), near(V((0, -0.05, 1.4)), 0.06, (1.2, 1, 1.6)))
    if not head:
        vmask = maxf(vmask, near(V((0.42, -0.02, 1.05)), 0.12), near(V((-0.42, -0.02, 1.05)), 0.12))
    c = mixc(c, (0.28, 0.3, 0.36, 1), nt.math('MULTIPLY', nt.math('MULTIPLY', vr, vmask), 0.3))
    if not head:
        # knuckles / knees / elbows flush, palms + soles lighter and pinker
        joints = maxf(near(V((0.0, 0, 0.0)), 0.0001))
        for p_ in ((0.1, -0.06, 0.48), (-0.1, -0.06, 0.48), (0.31, 0.05, 1.08), (-0.31, 0.05, 1.08)):
            joints = maxf(joints, near(V(p_), 0.05))
        c = mixc(c, (0.53, 0.26, 0.22, 1), nt.math('MULTIPLY', joints, 0.35))
        hands = nt.math('GREATER_THAN', nt.math('ABSOLUTE', sep.outputs['X']), 0.5)
        c = mixc(c, (0.56, 0.3, 0.25, 1), nt.math('MULTIPLY', hands, 0.2))
    nt.link(c, b.inputs['Base Color'])
    # roughness: oily T-zone, glossy lips, matte elsewhere
    tz = maxf(near(V((0, -0.14, 1.62)), 0.04, (1.6, 1, 0.8)), near(NOSE, 0.022))
    rough = nt.math('SUBTRACT', 0.5, nt.math('MULTIPLY', tz, 0.14))
    rough = nt.math('SUBTRACT', rough, nt.math('MULTIPLY', nt.math('MINIMUM', lipm, 1.0), 0.18))
    rough = nt.math('ADD', rough, nt.math('MULTIPLY', mid_f.outputs['Fac'], 0.06))
    nt.link(rough, b.inputs['Roughness'])
    # micro surface for the DETAIL normal: pores (denser on nose/cheeks), fine wrinkles, lip lines
    pv = nt.voronoi(co, scale=2200 if head else 1500, feature='F1')
    pore = pv.outputs['Distance']
    pdense = nt.math('ADD', 0.35, nt.math('MULTIPLY', maxf(near(NOSE, 0.025), flush), 0.65))
    h = nt.math('MULTIPLY', pore, pdense)
    fine = nt.noise(co, scale=900, detail=2)
    h = nt.math('ADD', h, nt.math('MULTIPLY', fine.outputs['Fac'], 0.2))
    if head:
        # crow's feet + under-eye creases + faint forehead lines
        for E, sx in ((EYEL, 1), (EYER, -1)):
            cf = nt.wave(nt.mapping(co, rot=(0, 0.5 * sx, 0)), scale=420, distortion=1.5, kind='BANDS', direction='Z')
            cfm = near(E + V((0.022 * sx, 0.0, -0.002)), 0.008)
            h = nt.math('SUBTRACT', h, nt.math('MULTIPLY', nt.math('MULTIPLY', cf.outputs['Fac'], cfm), 0.25))
        fl = nt.wave(co, scale=170, distortion=2.5, kind='BANDS', direction='Z')
        flm = near(V((0, -0.13, 1.64)), 0.03, (1.8, 1, 0.6))
        h = nt.math('SUBTRACT', h, nt.math('MULTIPLY', nt.math('MULTIPLY', fl.outputs['Fac'], flm), 0.12))
        h = nt.math('SUBTRACT', h, nt.math('MULTIPLY', nt.math('MULTIPLY', lipline.outputs['Fac'], nt.math('MINIMUM', lipm, 1.0)), 0.5))
    nt.link(nt.bump(h, strength=0.5, distance=0.0006), b.inputs['Normal'])
    b.inputs['Subsurface Weight'].default_value = 0.0
    return m


def plain_mat(name):
    m, nt = new_mat(name, color=(0.75, 0.55, 0.45, 1), rough=0.5)
    return m


# --------------------------------------------------------------------------- bake helpers
def new_img(name, res, noncolor):
    img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=True)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    return img


def set_active_image(obj, slot_idx_to_img):
    for i, slot in enumerate(obj.material_slots):
        m = slot.material
        nodes = m.node_tree.nodes
        tn = nodes.get('__bake__') or nodes.new('ShaderNodeTexImage')
        tn.name = '__bake__'
        tn.image = slot_idx_to_img.get(i) or slot_idx_to_img.get('any')
        for nd in nodes:
            nd.select = False
        tn.select = True
        nodes.active = tn


def bake(obj, kind, imgs, selected=None, **kw):
    sc = use_cycles(SAMPLES)
    sc.render.bake.margin = 16
    sc.render.bake.use_clear = True
    set_active_image(obj, imgs)
    sel = [obj] + ([selected] if selected else [])
    select_only(*sel)
    bpy.context.view_layer.objects.active = obj
    if selected:
        sc.render.bake.use_selected_to_active = True
        sc.render.bake.cage_extrusion = 0.006
        sc.render.bake.max_ray_distance = 0.02
    else:
        sc.render.bake.use_selected_to_active = False
    with bpy.context.temp_override(**view3d_override(), active_object=obj, object=obj, selected_objects=sel, selected_editable_objects=sel):
        bpy.ops.object.bake(type=kind, use_selected_to_active=bool(selected), margin=16, use_clear=True, **kw)


def img_np(img):
    w, h = img.size
    return np.array(img.pixels[:], np.float32).reshape(h, w, 4)


def save_np(arr, path, noncolor=False):
    h, w = arr.shape[:2]
    rgba = np.ones((h, w, 4), np.float32); rgba[..., :arr.shape[2] if arr.ndim == 3 else 1] = arr if arr.ndim == 3 else arr[..., None]
    img = bpy.data.images.new('__save', w, h, alpha=False, float_buffer=False)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.ascontiguousarray(rgba).ravel())
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)


# --------------------------------------------------------------------------- 1) form normals + AO from the high sculpt
# NOTE: never materials.clear() here - it resets every face's material_index to 0 (head/body split)
def set_slots(o, mats):
    while len(o.data.materials) < len(mats):
        o.data.materials.append(mats[len(o.data.materials)])
    for i, m in enumerate(mats):
        o.data.materials[i] = m
mh, mb = plain_mat('Evelyn_HeadMat'), plain_mat('Evelyn_BodyMat')
for o in (low, high):
    set_slots(o, [mh, mb])
# high has the same material indices (multires keeps them)
imgs_n = {i: new_img(f'ev_n_form_{i}', RES[i], True) for i in (0, 1)}
bake(low, 'NORMAL', imgs_n, selected=high, normal_space='TANGENT')
imgs_ao = {i: new_img(f'ev_ao_{i}', RES[i] // 2, True) for i in (0, 1)}
use_cycles(64)
bake(low, 'AO', imgs_ao, selected=high)
# --------------------------------------------------------------------------- 2) procedural skin on low (self bake)
set_slots(low, [skin_material('Evelyn_HeadSkin', True), skin_material('Evelyn_BodySkin', False)])
imgs_c = {i: new_img(f'ev_c_{i}', RES[i], False) for i in (0, 1)}
bake(low, 'DIFFUSE', imgs_c, pass_filter={'COLOR'})
imgs_r = {i: new_img(f'ev_r_{i}', RES[i] // 2, True) for i in (0, 1)}
bake(low, 'ROUGHNESS', imgs_r)
imgs_d = {i: new_img(f'ev_n_det_{i}', RES[i], True) for i in (0, 1)}
bake(low, 'NORMAL', imgs_d, normal_space='TANGENT')

# --------------------------------------------------------------------------- 3) combine (numpy): RNM normals, ORM, AO-tinted albedo
def rnm(base, detail):
    t = base[..., :3] * np.array([2, 2, 2], np.float32) + np.array([-1, -1, 0], np.float32)
    u = detail[..., :3] * np.array([-2, -2, 2], np.float32) + np.array([1, 1, -1], np.float32)
    r = t * np.sum(t * u, axis=-1, keepdims=True) / np.maximum(t[..., 2:3], 1e-4) - u
    r /= np.maximum(np.linalg.norm(r, axis=-1, keepdims=True), 1e-6)
    return r * 0.5 + 0.5

def down2(a):
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4

def up2(a):
    return a.repeat(2, 0).repeat(2, 1)

outs = {}
for i, tag in ((0, 'head'), (1, 'body')):
    N = rnm(img_np(imgs_n[i]), img_np(imgs_d[i]))
    ao = img_np(imgs_ao[i])[..., 0]
    rough = img_np(imgs_r[i])[..., 0]
    col = img_np(imgs_c[i])[..., :3]
    ao_full = up2(ao)
    # cavity darkening + slight warm bounce in creases (subsurface look)
    col = col * (0.55 + 0.45 * ao_full[..., None]) + (1 - ao_full[..., None]) * np.array([0.04, 0.0, 0.0], np.float32)
    col = np.clip(col, 0, 1) ** (1 / 2.2)   # bake is linear float -> sRGB PNG
    orm = np.stack([ao, rough, np.zeros_like(ao)], -1)
    p = lambda k: os.path.join(TEX, f'evelyn_{tag}_{k}.png')
    save_np(col, p('c'))
    save_np(N, p('n'), True)
    save_np(orm, p('orm'), True)
    outs[tag] = [p('c'), p('n'), p('orm')]
result['textures'] = outs

# --------------------------------------------------------------------------- 4) clean material for preview/export
def tex_mat(name, tag):
    m, nt = new_mat(name, rough=0.5)
    b = nt.bsdf()
    paths = outs[tag]
    tc = nt.node('ShaderNodeTexImage'); tc.image = bpy.data.images.load(paths[0], check_existing=True)
    nt.link(tc.outputs['Color'], b.inputs['Base Color'])
    tn = nt.node('ShaderNodeTexImage'); tn.image = bpy.data.images.load(paths[1], check_existing=True); tn.image.colorspace_settings.name = 'Non-Color'
    nm = nt.node('ShaderNodeNormalMap'); nt.link(tn.outputs['Color'], nm.inputs['Color']); nt.link(nm.outputs['Normal'], b.inputs['Normal'])
    to = nt.node('ShaderNodeTexImage'); to.image = bpy.data.images.load(paths[2], check_existing=True); to.image.colorspace_settings.name = 'Non-Color'
    sp = nt.node('ShaderNodeSeparateColor'); nt.link(to.outputs['Color'], sp.inputs[0]); nt.link(sp.outputs[1], b.inputs['Roughness'])
    b.inputs['Subsurface Weight'].default_value = 0.25
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
    b.inputs['Subsurface Scale'].default_value = 0.012
    return m

set_slots(low, [tex_mat('Evelyn_Head', 'head'), tex_mat('Evelyn_Body', 'body')])
bpy.data.objects.remove(high, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=STAGE_B)
result['saved'] = STAGE_B
