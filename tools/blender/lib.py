# Shared Blender toolkit for Blackwood Manor asset generation.
# Executed inside Blender via tools/blender-client.cjs: scripts do
#   exec(open(LIB).read())
# Sections: scene, mesh sculpting, skin bodies, rigging/weights, materials,
# texture baking (Cycles), animation, preview renders, glTF export.
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler, Quaternion, noise
from mathutils.bvhtree import BVHTree

PROJECT = r"D:\Web Based - Horror Game"
MODELS = os.path.join(PROJECT, "public", "models")
BAKE_DIR = os.path.join(PROJECT, "tools", "blender", "_bake")
PREVIEW_DIR = os.path.join(PROJECT, "tools", "blender", "_preview")
for _d in (MODELS, BAKE_DIR, PREVIEW_DIR):
    os.makedirs(_d, exist_ok=True)

V = Vector


# ----------------------------------------------------------------------------- scene
def reset_scene():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures,
                 bpy.data.actions, bpy.data.curves, bpy.data.node_groups, bpy.data.cameras,
                 bpy.data.lights, bpy.data.textures, bpy.data.worlds):
        for d in list(coll):
            try:
                coll.remove(d)
            except Exception:
                pass
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 60
    sc.render.fps = 30
    w = bpy.data.worlds.new("World")
    sc.world = w
    bpy.context.view_layer.update()
    return sc


def view3d_override():
    wm = bpy.context.window_manager
    for win in wm.windows:
        for area in win.screen.areas:
            if area.type == 'VIEW_3D':
                for region in area.regions:
                    if region.type == 'WINDOW':
                        return dict(window=win, area=area, region=region, screen=win.screen)
    win = wm.windows[0]
    return dict(window=win, screen=win.screen)


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def select_only(*objs):
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def apply_modifiers(obj):
    select_only(obj)
    with bpy.context.temp_override(**view3d_override(), active_object=obj, object=obj,
                                   selected_objects=[obj], selected_editable_objects=[obj]):
        for m in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    return obj


def apply_transform(obj, loc=True, rot=True, scale=True):
    select_only(obj)
    with bpy.context.temp_override(**view3d_override(), active_object=obj, object=obj,
                                   selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.transform_apply(location=loc, rotation=rot, scale=scale)
    return obj


def join(objs, name=None):
    objs = [o for o in objs if o]
    base = objs[0]
    if len(objs) > 1:
        select_only(*objs)
        with bpy.context.temp_override(**view3d_override(), active_object=base, object=base,
                                       selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    if name:
        base.name = name
        base.data.name = name
    return base


def shade_smooth(obj, auto_angle=None):
    for p in obj.data.polygons:
        p.use_smooth = True
    if auto_angle is not None:
        try:
            select_only(obj)
            with bpy.context.temp_override(**view3d_override(), active_object=obj, object=obj,
                                           selected_objects=[obj], selected_editable_objects=[obj]):
                bpy.ops.object.shade_auto_smooth(angle=math.radians(auto_angle))
            apply_modifiers(obj)
        except Exception:
            pass
    return obj


def mesh_obj(name, verts, faces, edges=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], list(edges), [tuple(f) for f in faces])
    me.update()
    return link(bpy.data.objects.new(name, me))


def prim(kind, name, **kw):
    """Create a primitive through bmesh (no operator context needed)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if kind == 'cube':
        bmesh.ops.create_cube(bm, size=1.0)
        s = kw.get('size', (1, 1, 1))
        bmesh.ops.scale(bm, vec=V(s), verts=bm.verts)
    elif kind == 'uvsphere':
        bmesh.ops.create_uvsphere(bm, u_segments=kw.get('u', 32), v_segments=kw.get('v', 16),
                                  radius=kw.get('r', 0.5))
    elif kind == 'icosphere':
        bmesh.ops.create_icosphere(bm, subdivisions=kw.get('sub', 3), radius=kw.get('r', 0.5))
    elif kind == 'cylinder':
        bmesh.ops.create_cone(bm, cap_ends=kw.get('caps', True), cap_tris=False,
                              segments=kw.get('seg', 24), radius1=kw.get('r', 0.5),
                              radius2=kw.get('r2', kw.get('r', 0.5)), depth=kw.get('h', 1.0))
    elif kind == 'torus':
        R, r = kw.get('R', 0.5), kw.get('r', 0.1)
        su, sv = kw.get('u', 24), kw.get('v', 12)
        verts = []
        for i in range(su):
            a = i / su * math.tau
            for j in range(sv):
                b = j / sv * math.tau
                verts.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a),
                                           (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        for i in range(su):
            for j in range(sv):
                a, b = i * sv + j, ((i + 1) % su) * sv + j
                c, d = ((i + 1) % su) * sv + (j + 1) % sv, i * sv + (j + 1) % sv
                bm.faces.new((verts[a], verts[b], verts[c], verts[d]))
    elif kind == 'grid':
        bmesh.ops.create_grid(bm, x_segments=kw.get('x', 10), y_segments=kw.get('y', 10),
                              size=kw.get('size', 0.5))
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    if 'loc' in kw:
        obj.location = V(kw['loc'])
    if 'rot' in kw:
        obj.rotation_euler = Euler(kw['rot'])
    return obj


def lathe(name, profile, seg=32, cap_top=False, cap_bottom=False, axis='Z'):
    """Revolve a list of (radius, height) points around Z."""
    verts, faces = [], []
    n = len(profile)
    for i in range(seg):
        a = i / seg * math.tau
        ca, sa = math.cos(a), math.sin(a)
        for (r, h) in profile:
            verts.append((r * ca, r * sa, h))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n - 1):
            faces.append((i * n + j, i2 * n + j, i2 * n + j + 1, i * n + j + 1))
    if cap_bottom:
        c = len(verts); verts.append((0, 0, profile[0][1]))
        for i in range(seg):
            faces.append((((i + 1) % seg) * n, i * n, c))
    if cap_top:
        c = len(verts); verts.append((0, 0, profile[-1][1]))
        for i in range(seg):
            faces.append((i * n + n - 1, ((i + 1) % seg) * n + n - 1, c))
    obj = mesh_obj(name, verts, faces)
    return obj


def tube_along(name, points, radii, seg=10, cap=True):
    """Generalized tube through a polyline of points with per-point radius."""
    pts = [V(p) for p in points]
    n = len(pts)
    verts, faces = [], []
    prev_side = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_side is None:
            up = V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0))
            side = t.cross(up).normalized()
        else:
            side = (prev_side - t * prev_side.dot(t)).normalized()
        prev_side = side
        up2 = side.cross(t).normalized()
        per_point = isinstance(radii, list) or (isinstance(radii, tuple) and len(radii) == n and not all(isinstance(x, (int, float)) for x in radii[:2]) ) or (isinstance(radii, tuple) and len(radii) == n and n != 2)
        r = radii[i] if per_point else radii
        rx, ry = (r if isinstance(r, (list, tuple)) else (r, r))
        for k in range(seg):
            a = k / seg * math.tau
            verts.append(p + side * (math.cos(a) * rx) + up2 * (math.sin(a) * ry))
    for i in range(n - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((i * seg + k, i * seg + k2, (i + 1) * seg + k2, (i + 1) * seg + k))
    if cap:
        c0 = len(verts); verts.append(pts[0])
        c1 = len(verts); verts.append(pts[-1])
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((k2, k, c0))
            faces.append(((n - 1) * seg + k, (n - 1) * seg + k2, c1))
    return mesh_obj(name, verts, faces)


def deform(obj, fn):
    """fn(co: Vector) -> Vector, applied to every vertex in object space."""
    for v in obj.data.vertices:
        v.co = fn(v.co.copy())
    obj.data.update()
    return obj


def recalc_normals(obj):
    me = obj.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()


def gauss(d, r):
    return math.exp(-(d * d) / (2 * r * r))


def push(obj, center, radius, amount, scale=(1, 1, 1), direction=None):
    """Displace verts near `center` along their normal (or `direction`) with a gaussian falloff.
    `scale` makes the falloff elliptical (divides the offset per-axis)."""
    c = V(center)
    sx, sy, sz = scale
    me = obj.data
    me.update()
    for v in me.vertices:
        d = v.co - c
        dd = math.sqrt((d.x / sx) ** 2 + (d.y / sy) ** 2 + (d.z / sz) ** 2)
        if dd > radius * 3.5:
            continue
        w = gauss(dd, radius) * amount
        n = V(direction) if direction is not None else v.normal
        v.co += n * w
    me.update()


def add_subsurf(obj, levels=1, apply=True):
    m = obj.modifiers.new("sub", 'SUBSURF')
    m.levels = levels; m.render_levels = levels
    if apply:
        apply_modifiers(obj)
    return obj


def add_solidify(obj, thick, offset=0.0, apply=True, even=False):
    m = obj.modifiers.new("solid", 'SOLIDIFY')
    m.thickness = thick; m.offset = offset
    m.use_even_offset = even  # even offset spikes at sphere poles
    if apply:
        apply_modifiers(obj)
    return obj


def displace_noise(obj, strength=0.01, scale=0.2, apply=True, seed=0):
    tex = bpy.data.textures.new(obj.name + "_dtex", 'CLOUDS')
    tex.noise_scale = scale
    tex.noise_depth = 3
    m = obj.modifiers.new("disp", 'DISPLACE')
    m.texture = tex; m.strength = strength; m.mid_level = 0.5
    m.texture_coords = 'LOCAL'
    if apply:
        apply_modifiers(obj)
    return obj


# ----------------------------------------------------------------------------- skin bodies
def skin_body(name, verts, edges, radii, root=0, subsurf=2, branch_smooth=0.3):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], list(edges), [])
    obj = link(bpy.data.objects.new(name, me))
    sk = obj.modifiers.new("skin", 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = branch_smooth
    sv = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = r if isinstance(r, (list, tuple)) else (r, r)
        sv[i].use_root = (i == root)
    if subsurf:
        s = obj.modifiers.new("sub", 'SUBSURF')
        s.levels = subsurf; s.render_levels = subsurf
    apply_modifiers(obj)
    shade_smooth(obj)
    return obj


class Skel:
    """Helper to author a vertex skeleton for the skin modifier by name."""
    def __init__(self):
        self.v, self.r, self.e, self.idx = [], [], [], {}

    def add(self, key, co, r, parent=None):
        self.idx[key] = len(self.v)
        self.v.append(tuple(co)); self.r.append(r)
        if parent is not None:
            self.e.append((self.idx[parent], self.idx[key]))
        return key

    def chain(self, keys, cos, rs, parent):
        p = parent
        for k, c, r in zip(keys, cos, rs):
            self.add(k, c, r, p); p = k
        return p

    def build(self, name, subsurf=2, root='hips', branch_smooth=0.3):
        return skin_body(name, self.v, self.e, self.r, root=self.idx[root], subsurf=subsurf,
                         branch_smooth=branch_smooth)


# ----------------------------------------------------------------------------- rigging
def make_armature(name, bones):
    """bones: list of dict(name, head, tail, parent=None, roll=0, deform=True, connect=False)."""
    arm = bpy.data.armatures.new(name)
    obj = link(bpy.data.objects.new(name, arm))
    arm.display_type = 'STICK'
    select_only(obj)
    with bpy.context.temp_override(**view3d_override(), active_object=obj, object=obj,
                                   selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.mode_set(mode='EDIT')
        eb = arm.edit_bones
        for b in bones:
            e = eb.new(b['name'])
            e.head = V(b['head']); e.tail = V(b['tail'])
            e.roll = b.get('roll', 0.0)
            e.use_deform = b.get('deform', True)
        for b in bones:
            if b.get('parent'):
                e = eb[b['name']]
                e.parent = eb[b['parent']]
                e.use_connect = b.get('connect', False)
        bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length, t


def bind_weights(mesh, arm, allowed=None, power=4.0, max_inf=3, bias=None, smooth_iters=2):
    """Distance-to-bone-segment weighting with falloff `power`. `allowed` limits bones for this mesh.
    `bias` = {bone: multiplier} (larger = stronger claim). Adds Armature modifier + parents."""
    bones = [b for b in arm.data.bones if b.use_deform and (allowed is None or b.name in allowed)]
    mw = arm.matrix_world
    segs = [(b.name, mw @ b.head_local, mw @ b.tail_local) for b in bones]
    inv = mesh.matrix_world
    groups = {n: (mesh.vertex_groups.get(n) or mesh.vertex_groups.new(name=n)) for n, _, _ in segs}
    me = mesh.data
    W = []
    for v in me.vertices:
        p = inv @ v.co
        ws = []
        for n, a, b in segs:
            d, _ = _seg_dist(p, a, b)
            w = 1.0 / max(d, 0.004) ** power
            if bias and n in bias:
                w *= bias[n]
            ws.append((w, n))
        ws.sort(reverse=True)
        ws = ws[:max_inf]
        s = sum(w for w, _ in ws)
        W.append({n: w / s for w, n in ws})
    # Laplacian smoothing of weights over mesh edges -> no hard creases at joints.
    if smooth_iters:
        nbr = [[] for _ in me.vertices]
        for e in me.edges:
            a, b = e.vertices
            nbr[a].append(b); nbr[b].append(a)
        for _ in range(smooth_iters):
            NW = []
            for i, w in enumerate(W):
                acc = dict(w)
                for j in nbr[i]:
                    for k, x in W[j].items():
                        acc[k] = acc.get(k, 0.0) + x
                tot = 1 + len(nbr[i])
                items = sorted(((x / tot, k) for k, x in acc.items()), reverse=True)[:max_inf]
                s = sum(x for x, _ in items)
                NW.append({k: x / s for x, k in items})
            W = NW
    for i, w in enumerate(W):
        for n, x in w.items():
            if x > 0.002:
                groups[n].add([i], x, 'REPLACE')
    mod = mesh.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm
    mesh.parent = arm
    mesh.matrix_parent_inverse = arm.matrix_world.inverted()
    return mesh


def bind_rigid(mesh, arm, bone):
    return bind_weights(mesh, arm, allowed={bone}, smooth_iters=0, max_inf=1)


def bind_auto(mesh, arm):
    select_only(mesh, arm)
    bpy.context.view_layer.objects.active = arm
    with bpy.context.temp_override(**view3d_override(), active_object=arm, object=arm,
                                   selected_objects=[mesh, arm], selected_editable_objects=[mesh, arm]):
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    return mesh


# ----------------------------------------------------------------------------- UVs
def smart_uv(obj, angle=66, margin=0.004):
    select_only(obj)
    with bpy.context.temp_override(**view3d_override(), active_object=obj, object=obj,
                                   selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin,
                                 area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def cyl_uv(obj, axis_center=(0, 0), zmin=None, zmax=None, u_scale=1.0):
    """Cylindrical projection around Z (good for skirts, trunks, limbs)."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    zs = [v.co.z for v in me.vertices]
    z0 = min(zs) if zmin is None else zmin
    z1 = max(zs) if zmax is None else zmax
    cx, cy = axis_center
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = (math.atan2(co.y - cy, co.x - cx) / math.tau + 0.5) * u_scale
            us.append(u)
        # fix seam wrap
        if max(us) - min(us) > 0.5 * u_scale:
            us = [u + u_scale if u < 0.5 * u_scale else u for u in us]
        for li, u in zip(poly.loop_indices, us):
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (u, (co.z - z0) / max(z1 - z0, 1e-6))
    return obj


# ----------------------------------------------------------------------------- materials
class NT:
    """Tiny fluent helper for building shader node trees."""
    def __init__(self, mat):
        self.m = mat
        self.t = mat.node_tree
        self.n = self.t.nodes
        self.l = self.t.links
        self.x = -300

    def node(self, kind, **props):
        nd = self.n.new(kind)
        nd.location = (self.x, random.randint(-400, 400))
        self.x -= 40
        for k, v in props.items():
            if k.startswith('in_'):
                key = k[3:].replace('_', ' ')
                nd.inputs[key].default_value = v
            else:
                setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.l.new(a, b)
        return b

    def tex_coord(self, kind='Object'):
        return self.node('ShaderNodeTexCoord').outputs[kind]

    def mapping(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        m = self.node('ShaderNodeMapping')
        m.inputs['Scale'].default_value = scale
        m.inputs['Location'].default_value = loc
        m.inputs['Rotation'].default_value = rot
        self.link(vec, m.inputs['Vector'])
        return m.outputs['Vector']

    def noise(self, vec=None, scale=5.0, detail=6.0, rough=0.55, distortion=0.0, dims='3D'):
        n = self.node('ShaderNodeTexNoise')
        n.noise_dimensions = dims
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distortion
        if vec is not None:
            self.link(vec, n.inputs['Vector'])
        return n

    def voronoi(self, vec=None, scale=5.0, feature='F1', metric='EUCLIDEAN', rand=1.0):
        n = self.node('ShaderNodeTexVoronoi')
        n.feature = feature; n.distance = metric
        n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = rand
        if vec is not None:
            self.link(vec, n.inputs['Vector'])
        return n

    def wave(self, vec=None, scale=5.0, distortion=4.0, detail=4.0, kind='BANDS', direction='X',
             profile='SIN'):
        n = self.node('ShaderNodeTexWave')
        n.wave_type = kind
        if kind == 'BANDS':
            n.bands_direction = direction
        else:
            n.rings_direction = direction if direction in ('X', 'Y', 'Z', 'SPHERICAL') else 'SPHERICAL'
        n.wave_profile = profile
        n.inputs['Scale'].default_value = scale
        n.inputs['Distortion'].default_value = distortion
        n.inputs['Detail'].default_value = detail
        if vec is not None:
            self.link(vec, n.inputs['Vector'])
        return n

    def ramp(self, fac, stops):
        """stops: list of (pos, (r,g,b,a))"""
        r = self.node('ShaderNodeValToRGB')
        cr = r.color_ramp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = stops[0][1]
        for pos, col in stops[1:]:
            e = cr.elements.new(pos)
            e.color = col
        self.link(fac, r.inputs['Fac'])
        return r

    def mix(self, a, b, fac, blend='MIX'):
        m = self.node('ShaderNodeMix')
        m.data_type = 'RGBA'
        m.blend_type = blend
        if isinstance(fac, (int, float)):
            m.inputs[0].default_value = fac
        else:
            self.link(fac, m.inputs[0])
        for sock, val in ((m.inputs[6], a), (m.inputs[7], b)):
            if isinstance(val, (tuple, list)):
                sock.default_value = tuple(val) if len(val) == 4 else (*val, 1)
            else:
                self.link(val, sock)
        return m.outputs[2]

    def math(self, op, a, b=None, clamp=False):
        m = self.node('ShaderNodeMath')
        m.operation = op
        m.use_clamp = clamp
        for i, val in enumerate((a, b)):
            if val is None:
                continue
            if isinstance(val, (int, float)):
                m.inputs[i].default_value = val
            else:
                self.link(val, m.inputs[i])
        return m.outputs[0]

    def ao(self, distance=0.1, samples=16):
        a = self.node('ShaderNodeAmbientOcclusion')
        a.samples = samples
        a.inputs['Distance'].default_value = distance
        return a

    def bump(self, height, strength=0.3, distance=0.01, normal=None):
        b = self.node('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = distance
        self.link(height, b.inputs['Height'])
        if normal is not None:
            self.link(normal, b.inputs['Normal'])
        return b.outputs['Normal']

    def geometry(self):
        return self.node('ShaderNodeNewGeometry')

    def bsdf(self):
        return self.n.get('Principled BSDF')


def new_mat(name, color=(0.5, 0.5, 0.5, 1), rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = color if len(color) == 4 else (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m, NT(m)


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


# ----------------------------------------------------------------------------- baking
def use_cycles(samples=8):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for t in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = t
                prefs.get_devices()
                ok = False
                for d in prefs.devices:
                    d.use = d.type == t
                    ok = ok or d.use
                if ok:
                    break
            except Exception:
                continue
        sc.cycles.device = 'GPU'
    except Exception:
        sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    return sc


def bake_maps(obj, name, size=1024, maps=('color', 'rough', 'normal'), samples=8, margin=6,
              metal=0.0, extra=None, alpha_from=None):
    """Bake all procedural materials on `obj` into one texture set and replace them with a
    single image-based Principled material named `name`. Returns the new material."""
    sc = use_cycles(samples)
    sc.render.bake.margin = margin
    sc.render.bake.use_clear = True
    sc.render.bake.target = 'IMAGE_TEXTURES'
    select_only(obj)
    imgs = {}
    for mp in maps:
        img = bpy.data.images.new(f"{name}_{mp}", size, size, alpha=(mp == 'color' and alpha_from is not None))
        if mp != 'color' and mp != 'emit':
            img.colorspace_settings.name = 'Non-Color'
        imgs[mp] = img
    mats = [s.material for s in obj.material_slots if s.material]
    for mp in maps:
        for m in mats:
            nodes = m.node_tree.nodes
            tn = nodes.get('__bake__') or nodes.new('ShaderNodeTexImage')
            tn.name = '__bake__'
            tn.image = imgs[mp]
            for nd in nodes:
                nd.select = False
            tn.select = True
            nodes.active = tn
        kw = {}
        if mp == 'color':
            kw = dict(type='DIFFUSE', pass_filter={'COLOR'})
        elif mp == 'rough':
            kw = dict(type='ROUGHNESS')
        elif mp == 'normal':
            kw = dict(type='NORMAL', normal_space='TANGENT')
        elif mp == 'emit':
            kw = dict(type='EMIT')
        elif mp == 'ao':
            kw = dict(type='AO')
        with bpy.context.temp_override(**view3d_override(), active_object=obj, object=obj,
                                       selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.bake(margin=margin, use_clear=True, **kw)
        path = os.path.join(BAKE_DIR, f"{name}_{mp}.png")
        imgs[mp].filepath_raw = path
        imgs[mp].file_format = 'PNG'
        imgs[mp].save()
    # Rebuild a clean image-based material (this is what glTF exports).
    m, nt = new_mat(name)
    b = nt.bsdf()
    tc = nt.node('ShaderNodeTexImage'); tc.image = imgs['color']
    nt.link(tc.outputs['Color'], b.inputs['Base Color'])
    if 'rough' in imgs:
        tr = nt.node('ShaderNodeTexImage'); tr.image = imgs['rough']
        nt.link(tr.outputs['Color'], b.inputs['Roughness'])
    if 'normal' in imgs:
        tn = nt.node('ShaderNodeTexImage'); tn.image = imgs['normal']
        nm = nt.node('ShaderNodeNormalMap')
        nt.link(tn.outputs['Color'], nm.inputs['Color'])
        nt.link(nm.outputs['Normal'], b.inputs['Normal'])
    if 'emit' in imgs:
        te = nt.node('ShaderNodeTexImage'); te.image = imgs['emit']
        nt.link(te.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 1.0
    b.inputs['Metallic'].default_value = metal
    if extra:
        extra(nt, b)
    for s in obj.material_slots:
        s.material = None
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return m


# ----------------------------------------------------------------------------- animation
def new_action(arm, name):
    if arm.animation_data is None:
        arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    try:
        if hasattr(act, 'slots') and len(act.slots) == 0:
            slot = act.slots.new(id_type='OBJECT', name=arm.name)
            arm.animation_data.action_slot = slot
    except Exception:
        pass
    return act


def pose_reset(arm):
    # Keep QUATERNION mode: authored actions animate rotation_quaternion.
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def key_pose(arm, frame, pose, loc=None):
    """pose: {bone: (rx, ry, rz) degrees}; loc: {bone: (x, y, z)}. Unlisted bones keyed at rest."""
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        r = pose.get(pb.name, (0, 0, 0))
        pb.rotation_euler = tuple(math.radians(a) for a in r)
        pb.keyframe_insert('rotation_euler', frame=frame)
        if loc is not None:
            pb.location = loc.get(pb.name, (0, 0, 0))
            pb.keyframe_insert('location', frame=frame)


def bake_action(arm, name, frames, pose_fn, loc_fn=None, cyclic=True):
    """Author an action by sampling a procedural pose function pose_fn(t in 0..1) -> {bone: deg}."""
    act = new_action(arm, name)
    for f in range(frames + 1):
        t = f / frames
        key_pose(arm, f + 1, pose_fn(t), loc_fn(t) if loc_fn else {})
    try:
        for fc in _fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
            if cyclic:
                fc.modifiers.new('CYCLES')
    except Exception:
        pass
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, act)
    strip.name = name
    track.mute = True
    arm.animation_data.action = None
    return act


def _fcurves(act):
    if hasattr(act, 'fcurves') and len(getattr(act, 'fcurves', [])):
        return list(act.fcurves)
    out = []
    try:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
    except Exception:
        pass
    return out


# ----------------------------------------------------------------------------- preview
def preview(path_name, target=(0, 0, 1), cam=(0, -3, 1.5), lens=50, res=(720, 900), world=0.04,
            lights=None, engine='EEVEE', hide=()):
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.name.startswith('__pv_'):
            bpy.data.objects.remove(o, do_unlink=True)
    cd = bpy.data.cameras.new('__pv_cam'); cd.lens = lens; cd.clip_start = 0.01
    co = link(bpy.data.objects.new('__pv_cam', cd))
    co.location = V(cam)
    direction = V(target) - co.location
    co.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    lights = lights or [((2.5, -2.5, 3.0), 400, (1, 0.95, 0.9)), ((-3, -1, 2), 120, (0.6, 0.7, 1.0)),
                        ((0, 3, 2.5), 250, (0.8, 0.85, 1.0))]
    for i, (pos, power, col) in enumerate(lights):
        ld = bpy.data.lights.new(f'__pv_l{i}', 'AREA'); ld.energy = power; ld.color = col; ld.size = 1.5
        lo = link(bpy.data.objects.new(f'__pv_l{i}', ld))
        lo.location = V(pos)
        lo.rotation_euler = (V(target) - lo.location).to_track_quat('-Z', 'Y').to_euler()
    w = sc.world or bpy.data.worlds.new('World'); sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (world, world, world * 1.1, 1)
        bg.inputs['Strength'].default_value = 1.0
    sc.render.engine = 'BLENDER_EEVEE' if engine == 'EEVEE' else 'CYCLES'
    if engine != 'EEVEE':
        use_cycles(32)
        sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    hidden = []
    for o in bpy.data.objects:
        if o.name in hide:
            hidden.append((o, o.hide_render)); o.hide_render = True
    path = os.path.join(PREVIEW_DIR, path_name)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o, h in hidden:
        o.hide_render = h
    for o in list(bpy.data.objects):
        if o.name.startswith('__pv_'):
            bpy.data.objects.remove(o, do_unlink=True)
    return path


# ----------------------------------------------------------------------------- export
def export_glb(filename, objs, animations=True, image_format='WEBP', quality=88):
    select_only(*objs)
    for o in objs:
        for c in o.children_recursive:
            c.select_set(True)
    path = os.path.join(MODELS, filename)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
              export_apply=False, export_animations=animations, export_image_format=image_format,
              export_image_quality=quality, export_extras=True, export_tangents=False,
              export_meshopt_compression_enable=True)
    if animations:
        kw.update(export_animation_mode='NLA_TRACKS', export_force_sampling=True,
                  export_optimize_animation_size=True)
    with bpy.context.temp_override(**view3d_override()):
        bpy.ops.export_scene.gltf(**kw)
    return path, os.path.getsize(path)


# ----------------------------------------------------------------------------- collision / draping
def bvh_from(objs):
    """World-space BVH over several mesh objects (used to drape cloth/hair without clipping)."""
    bm = bmesh.new()
    for o in objs:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me = bpy.data.meshes.new('__tmp')
        tmp.to_mesh(me); tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    return tree, bm


def resolve(tree, p, clearance=0.01, maxd=0.25):
    """Push point p outside the collider surface by `clearance`."""
    hit = tree.find_nearest(p, maxd)
    if hit[0] is None:
        return p, False
    loc, nrm = hit[0], hit[1]
    d = (p - loc).dot(nrm)
    if d < clearance:
        return loc + nrm * clearance, True
    return p, False


def drape_path(tree, start, n, step, pull=(0, 0, -1), outward=None, clearance=0.01, stiff=0.55,
               init_dir=None, jitter=0.0, rnd=None):
    """Simulate a hanging strand/cloth column: each point follows gravity blended with the previous
    direction (stiffness), then collision-resolves and keeps segment length."""
    pts = [V(start)]
    d = V(init_dir).normalized() if init_dir is not None else V(pull).normalized()
    g = V(pull).normalized()
    for i in range(n):
        want = (d * stiff + g * (1 - stiff))
        if outward is not None:
            want += V(outward) * 0.08
        if jitter and rnd:
            want += V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * jitter
        want.normalize()
        p = pts[-1] + want * step
        for _ in range(3):
            p, _hit = resolve(tree, p, clearance)
        seg = p - pts[-1]
        if seg.length > 1e-6:
            p = pts[-1] + seg.normalized() * step
            p, _hit = resolve(tree, p, clearance * 0.8)
        d = (p - pts[-1]).normalized() if (p - pts[-1]).length > 1e-6 else d
        pts.append(p)
    return pts


# ----------------------------------------------------------------------------- numpy images
def np_image(name, arr, alpha=True, noncolor=False, save=True):
    """arr: float32 HxWx4 in 0..1 (row 0 = bottom). Returns bpy image (packed + saved as PNG)."""
    import numpy as np
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    if save:
        path = os.path.join(BAKE_DIR, name + ".png")
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
    return img


def image_mat(name, img, alpha=False, rough=0.6, normal_img=None, emission=None, metal=0.0):
    m, nt = new_mat(name, rough=rough, metal=metal)
    b = nt.bsdf()
    t = nt.node('ShaderNodeTexImage'); t.image = img
    nt.link(t.outputs['Color'], b.inputs['Base Color'])
    if alpha:
        nt.link(t.outputs['Alpha'], b.inputs['Alpha'])
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
    if normal_img is not None:
        tn = nt.node('ShaderNodeTexImage'); tn.image = normal_img
        nm = nt.node('ShaderNodeNormalMap')
        nt.link(tn.outputs['Color'], nm.inputs['Color'])
        nt.link(nm.outputs['Normal'], b.inputs['Normal'])
    if emission is not None:
        b.inputs['Emission Color'].default_value = (*emission[:3], 1)
        b.inputs['Emission Strength'].default_value = emission[3] if len(emission) > 3 else 1.0
    return m


# ----------------------------------------------------------------------------- world-axis posing
def key_world(arm, frame, rots, locs=None, prev=None):
    """Key a pose where each rotation is given as XYZ euler degrees about ARMATURE axes
    (X: +bend forward for upright bones, Y: +lean to character's left, Z: +turn left),
    applied relative to the parent. locs: armature-space offsets in metres."""
    prev = prev if prev is not None else {}
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        M = pb.bone.matrix_local.to_3x3()
        Mi = M.inverted()
        r = rots.get(pb.name)
        if r:
            R = Euler([math.radians(a) for a in r], 'XYZ').to_matrix()
            q = (Mi @ R @ M).to_quaternion()
        else:
            q = Quaternion()
        pq = prev.get(pb.name)
        if pq is not None and pq.dot(q) < 0:
            q = -q
        prev[pb.name] = q.copy()
        pb.rotation_quaternion = q
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        l = (locs or {}).get(pb.name)
        pb.location = (Mi @ V(l)) if l else V((0, 0, 0))
        pb.keyframe_insert('location', frame=frame)
    return prev


def action_world(arm, name, frames, fn, step=2, cyclic=True):
    """fn(t) -> (rots, locs). Samples every `step` frames, stores as an NLA track (one glTF clip)."""
    act = new_action(arm, name)
    prev = {}
    f = 0
    while True:
        t = min(f / frames, 1.0)
        rots, locs = fn(t)
        prev = key_world(arm, f + 1, rots, locs, prev)
        if f >= frames:
            break
        f = min(f + step, frames)
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    st = track.strips.new(name, 1, act)
    st.name = name
    track.mute = True
    arm.animation_data.action = None
    pose_reset(arm)
    return act


def sym(d):
    """Mirror a dict of '.L' bone rotations onto '.R' bones (negate Y/Z)."""
    out = dict(d)
    for k, v in d.items():
        if k.endswith('.L'):
            out[k[:-2] + '.R'] = (v[0], -v[1], -v[2])
    return out


def blend_pose(a, b, t):
    keys = set(a) | set(b)
    z = (0, 0, 0)
    return {k: tuple(x + (y - x) * t for x, y in zip(a.get(k, z), b.get(k, z))) for k in keys}


def keyframes_pose(t, keys):
    """keys: list of (time, rots, locs); smoothstep-interpolated piecewise."""
    for i in range(len(keys) - 1):
        t0, r0, l0 = keys[i]
        t1, r1, l1 = keys[i + 1]
        if t0 <= t <= t1:
            u = (t - t0) / max(t1 - t0, 1e-6)
            u = u * u * (3 - 2 * u)
            return blend_pose(r0, r1, u), blend_pose(l0, l1, u)
    return keys[-1][1], keys[-1][2]
