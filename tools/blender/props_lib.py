# Prop-building helpers (exec'd after lib.py). Materials are named M_<library> and swapped in-game
# for the shared PBR texture library, so prop GLBs carry geometry only.
MATS = {}
MAT_COLORS = {
    'wood_dark': (0.12, 0.05, 0.03), 'wood_light': (0.45, 0.32, 0.18), 'wood_old': (0.22, 0.18, 0.14),
    'velvet_red': (0.25, 0.03, 0.04), 'velvet_green': (0.05, 0.14, 0.08), 'leather': (0.2, 0.09, 0.05),
    'fabric_linen': (0.62, 0.59, 0.52), 'brass': (0.65, 0.48, 0.2), 'iron': (0.08, 0.08, 0.085),
    'metal_rust': (0.35, 0.25, 0.2), 'marble': (0.85, 0.84, 0.8), 'stone_floor': (0.4, 0.38, 0.34),
    'brick': (0.35, 0.15, 0.1), 'plaster': (0.66, 0.64, 0.58), 'paper': (0.7, 0.64, 0.48),
    'glass': (0.6, 0.7, 0.7), 'mirror': (0.5, 0.5, 0.52), 'bulb': (1.0, 0.8, 0.5), 'flame': (1.0, 0.6, 0.2),
    'ember': (1.0, 0.3, 0.05), 'porcelain': (0.86, 0.85, 0.82), 'felt': (0.05, 0.22, 0.1), 'lacquer': (0.02, 0.02, 0.02),
    'ivory': (0.85, 0.82, 0.72), 'wax': (0.85, 0.8, 0.68), 'rubber': (0.03, 0.03, 0.03), 'chrome': (0.8, 0.8, 0.82),
    'carpaint': (0.06, 0.07, 0.08), 'headlight': (1, 1, 0.9), 'taillight': (0.8, 0.05, 0.03), 'concrete': (0.35, 0.34, 0.32),
    'roof_slate': (0.1, 0.1, 0.12), 'bark': (0.1, 0.08, 0.07), 'book_a': (0.3, 0.05, 0.04), 'book_b': (0.05, 0.12, 0.08),
    'book_c': (0.06, 0.07, 0.16), 'book_d': (0.3, 0.2, 0.1), 'clockface': (0.8, 0.76, 0.66), 'window_glow': (1, 0.7, 0.35),
    'black': (0.01, 0.01, 0.01), 'cloth_dust': (0.62, 0.6, 0.56), 'red_cross': (0.6, 0.05, 0.05),
    'painting_0': (0.2, 0.15, 0.1), 'painting_1': (0.2, 0.15, 0.1), 'painting_2': (0.2, 0.15, 0.1),
    'painting_3': (0.2, 0.15, 0.1), 'painting_4': (0.2, 0.15, 0.1), 'tile_wall': (0.7, 0.7, 0.66),
    'gauge': (0.9, 0.88, 0.8), 'emissive_red': (1, 0.1, 0.05), 'plastic': (0.1, 0.1, 0.1),
}


def M(name):
    key = 'M_' + name
    if key in MATS:
        return MATS[key]
    m, nt = new_mat(key, color=(*MAT_COLORS.get(name, (0.5, 0.5, 0.5)), 1),
                    rough=0.2 if name in ('glass', 'mirror', 'lacquer', 'chrome', 'porcelain') else 0.6,
                    metal=1.0 if name in ('brass', 'iron', 'chrome', 'mirror') else 0.0)
    MATS[key] = m
    return m


ROOTS = []


def root(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = V(loc)
    ROOTS.append(e)
    return e


def part(obj, mat, parent, uv=1.0, smooth=True, auto=None):
    """Assign material, box-project UVs (1 tile per `uv` metres), parent to prop root."""
    assign(obj, M(mat))
    if uv:
        cube_uv(obj, uv)
    if smooth:
        shade_smooth(obj, auto_angle=auto if auto else 35)
    obj.parent = parent
    return obj


def cube_uv(obj, size=1.0):
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    mw = obj.matrix_world
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                uv[li].uv = (co.y / size, co.z / size)
            elif ax == 1:
                uv[li].uv = (co.x / size, co.z / size)
            else:
                uv[li].uv = (co.x / size, co.y / size)
    return obj


def rbox(name, size, loc=(0, 0, 0), bevel=0.01, segs=2, rot=(0, 0, 0)):
    o = prim('cube', name, size=size)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = segs; m.limit_method = 'ANGLE'
        apply_modifiers(o)
    o.location = V(loc); o.rotation_euler = Euler(rot)
    apply_transform(o)
    return o


def cyl(name, r, h, loc=(0, 0, 0), seg=24, r2=None, rot=(0, 0, 0)):
    o = prim('cylinder', name, seg=seg, r=r, r2=(r if r2 is None else r2), h=h)
    o.location = V(loc); o.rotation_euler = Euler(rot)
    apply_transform(o)
    return o


def turned(name, profile, loc=(0, 0, 0), seg=20, rot=(0, 0, 0), scale=(1, 1, 1)):
    """Lathe-turned part (legs, posts, finials). profile = [(radius, z), ...] from bottom."""
    o = lathe(name, profile, seg=seg, cap_top=True, cap_bottom=True)
    o.scale = scale
    o.location = V(loc); o.rotation_euler = Euler(rot)
    apply_transform(o)
    return o


def leg_profile(h, r=0.03, style=0):
    if style == 0:   # classic turned leg with bulb + rings
        return [(r * 0.6, 0), (r * 0.7, h * 0.04), (r * 0.9, h * 0.08), (r * 0.55, h * 0.14), (r * 0.6, h * 0.3),
                (r * 1.15, h * 0.45), (r * 0.6, h * 0.58), (r * 0.85, h * 0.66), (r * 0.6, h * 0.72),
                (r * 0.75, h * 0.8), (r, h * 0.84), (r, h)]
    if style == 1:   # tapered square-ish
        return [(r * 0.55, 0), (r * 0.6, h * 0.05), (r * 0.7, h * 0.5), (r, h * 0.9), (r, h)]
    return [(r * 0.7, 0), (r * 1.2, h * 0.1), (r * 0.8, h * 0.2), (r * 0.8, h * 0.8), (r * 1.1, h * 0.9), (r, h)]


def molding(name, path, profile, closed=False):
    """Sweep a 2D profile [(across, up)] along a polyline path (crown/base moldings, frames)."""
    pts = [V(p) for p in path]
    n = len(pts)
    verts, faces = [], []
    m = len(profile)
    for i, p in enumerate(pts):
        if closed:
            a, b = pts[i - 1], pts[(i + 1) % n]
        else:
            a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        t = (b - a).normalized()
        up = V((0, 0, 1)) if abs(t.z) < 0.9 else V((0, 1, 0))
        side = t.cross(up).normalized()
        up2 = side.cross(t).normalized()
        # miter scale at corners
        sc = 1.0
        if 0 < i < n - 1 or closed:
            t1 = (p - a).normalized(); t2 = (b - p).normalized()
            c = max(0.3, math.cos(t1.angle(t2) / 2)) if t1.length and t2.length else 1
            sc = 1 / c
        for (u, v) in profile:
            verts.append(p + side * u * sc + up2 * v)
    rng = n if closed else n - 1
    for i in range(rng):
        i2 = (i + 1) % n
        for k in range(m - 1):
            faces.append((i * m + k, i2 * m + k, i2 * m + k + 1, i * m + k + 1))
    return mesh_obj(name, verts, faces)


def rect_path(w, h, z=0.0):
    return [(-w / 2, 0, z), (w / 2, 0, z), (w / 2, 0, z + h), (-w / 2, 0, z + h)]


def raised_panel(name, w, h, depth=0.02, inset=0.03, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Door/cabinet raised panel: flat field + beveled raised center."""
    base = rbox(name + '_f', (w, depth, h), (0, 0, 0), bevel=0.003)
    rp = rbox(name + '_r', (w - inset * 2, depth * 0.6, h - inset * 2), (0, -depth * 0.55, 0), bevel=inset * 0.6, segs=2)
    o = join([base, rp], name)
    o.location = V(loc); o.rotation_euler = Euler(rot)
    apply_transform(o)
    return o


def knob(name, loc, r=0.018, mat='brass'):
    o = turned(name, [(r * 0.35, 0), (r * 0.45, r * 0.4), (r * 0.8, r * 1.0), (r, r * 1.5), (r * 0.7, r * 2.0),
                      (0.001, r * 2.1)], seg=16, rot=(math.radians(90), 0, 0))
    o.location = V(loc)
    apply_transform(o)
    return o


def pivot(obj, point):
    """Move object origin to `point` (world) without moving geometry (hinges, drawer fronts)."""
    p = V(point)
    for v in obj.data.vertices:
        v.co -= p
    obj.location = p
    obj.data.update()
    return obj


def flame(name, loc, h=0.035):
    o = turned(name, [(0.0, 0), (h * 0.22, h * 0.25), (h * 0.18, h * 0.6), (0.0, h)], seg=10)
    o.location = V(loc); apply_transform(o)
    return o


def candle(name, loc, h=0.14, r=0.012):
    body = turned(name + '_wax', [(r, 0), (r, h), (r * 0.8, h + 0.004), (0.001, h + 0.004)], seg=14)
    drip = displace_noise(body, 0.0015, 0.006)
    wick = cyl(name + '_wick', 0.0012, 0.012, (0, 0, h + 0.008), seg=5)
    fl = flame(name + '_flame', (0, 0, h + 0.012))
    for o in (body, wick, fl):
        o.location += V(loc)
        apply_transform(o)
    return body, wick, fl


def export_roots(filename, roots=None):
    roots = roots or ROOTS
    objs = []
    for r in roots:
        objs.append(r)
        objs.extend(r.children_recursive)
    select_only(*objs)
    path = os.path.join(MODELS, filename)
    with bpy.context.temp_override(**view3d_override()):
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_animations=False, export_image_format='NONE',
                                  export_extras=True, export_meshopt_compression_enable=True)
    return path, os.path.getsize(path)


def layout_preview(fname, spacing=3.0, cam_h=6, lens=24):
    n = len(ROOTS)
    cols = max(1, int(math.ceil(math.sqrt(n))))
    for i, r in enumerate(ROOTS):
        r['_home'] = list(r.location)
        r.location = V(((i % cols) * spacing, (i // cols) * spacing, 0))
    cx = (cols - 1) * spacing / 2
    cy = ((n - 1) // cols) * spacing / 2
    p = preview(fname, target=(cx, cy, 0.6), cam=(cx + 2, cy - cols * spacing * 0.95, cam_h), lens=lens,
                res=(1280, 900), world=0.12,
                lights=[((cx + 4, cy - 6, 8), 3000, (1, 0.95, 0.9)), ((cx - 6, cy - 2, 6), 1500, (0.7, 0.8, 1)),
                        ((cx, cy + 8, 6), 1500, (1, 1, 1))])
    for r in ROOTS:
        r.location = V(r['_home'])
    return p
