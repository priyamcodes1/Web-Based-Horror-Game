# Oil-painting portraits of the ghosts (and the manor) for the gallery walls -> public/textures/painting_N.webp
exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
import numpy as np
OUT = r"D:\Web Based - Horror Game\public\textures"


def import_glb(name):
    before = set(bpy.data.objects)
    with bpy.context.temp_override(**view3d_override()):
        bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, name))
    return [o for o in bpy.data.objects if o not in before]


def pose(objs, action_hint):
    for o in objs:
        if o.type == 'ARMATURE' and o.animation_data:
            for tr in o.animation_data.nla_tracks:
                tr.mute = action_hint not in tr.name
            break
    bpy.context.scene.frame_set(8)


def paint(path_in, name, w=640, h=820):
    img = bpy.data.images.load(path_in)
    W_, H_ = img.size
    px = np.array(img.pixels[:], np.float32).reshape(H_, W_, 4)[..., :3]
    bpy.data.images.remove(img)
    # resample to canvas size (nearest) then painterly: brush smear, palette warmth, craquelure, varnish, vignette
    ys = (np.arange(h) * H_ / h).astype(int); xs = (np.arange(w) * W_ / w).astype(int)
    a = px[ys][:, xs]
    rng = np.random.default_rng(len(name))
    for _ in range(3):  # directional brush smear
        dx = rng.integers(-3, 4); dy = rng.integers(-3, 4)
        a = a * 0.55 + np.roll(np.roll(a, dx, 1), dy, 0) * 0.45
    lum = a.mean(-1, keepdims=True)
    a = a * 0.6 + lum * 0.4                     # desaturate
    a = a * np.array([1.08, 0.96, 0.74])         # yellowed varnish
    a = np.clip((a - 0.03) * 1.25, 0, 1) ** 1.1
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    vig = 1 - 0.75 * (((xx / w - 0.5) ** 2 + (yy / h - 0.45) ** 2) * 2.6)
    a *= np.clip(vig, 0.1, 1)[..., None]
    # canvas weave + craquelure
    weave = (np.sin(xx * 1.9) * np.sin(yy * 1.9)) * 0.02
    n = rng.random((h // 6 + 1, w // 6 + 1)).repeat(6, 0).repeat(6, 1)[:h, :w]
    edges = (np.abs(np.roll(n, 1, 0) - n) + np.abs(np.roll(n, 1, 1) - n)) > 0.9
    a = a + weave[..., None]
    a = a * np.where(edges, 0.75, 1.0)[..., None]
    rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = np.clip(a, 0, 1)
    out = bpy.data.images.new(name, w, h)
    out.pixels.foreach_set(rgba.ravel())
    p = os.path.join(OUT, name + '.webp')
    out.filepath_raw = p; out.file_format = 'WEBP'
    try:
        out.save(filepath=p, quality=85)
    except TypeError:
        out.save()
    bpy.data.images.remove(out)
    return p


done = []
SUBJECTS = [('ghost_widow.glb', 'Stare', 'painting_0', (0, 0, 1.75), (0.35, -1.35, 1.8)),
            ('ghost_child.glb', 'Idle', 'painting_1', (0, 0, 0.95), (0.25, -1.1, 1.0)),
            ('ghost_warden.glb', 'Idle', 'painting_2', (0, 0, 1.7), (0.4, -1.8, 1.75))]
for glb, act, name, target, cam in SUBJECTS:
    reset_scene()
    objs = import_glb(glb)
    pose(objs, act)
    raw = preview('_raw_' + name + '.png', target=target, cam=cam, lens=50, res=(640, 820), world=0.02,
                  lights=[((1.2, -1.5, 2.6), 180, (1.0, 0.8, 0.55)), ((-1.8, -0.6, 1.6), 25, (0.4, 0.5, 0.8))])
    done.append(paint(raw, name))
# the manor at dusk
reset_scene()
import_glb('exterior.glb')
raw = preview('_raw_painting_3.png', target=(0, 10, 5), cam=(10, -34, 7), lens=40, res=(820, 640), world=0.05,
              lights=[((25, -25, 25), 40000, (1.0, 0.55, 0.35)), ((-20, -20, 8), 8000, (0.4, 0.5, 0.9))])
done.append(paint(raw, 'painting_3', 820, 640))
done.append(paint(os.path.join(PREVIEW_DIR, '_raw_painting_0.png'), 'painting_4', 480, 600))
result = {"done": done}
