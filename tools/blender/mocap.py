# Mocap retargeting: CMU "MotionBuilder-friendly" BVH (cgspeed 2010 release, frame 1 = T-pose) -> any rig.
#   * world-space rotation transfer: R_tgt(t) = A . R_src(t) . R_src(T)^-1 . A^-1 . R_tgtT
#     where R_tgtT is the target bone rotated (minimal arc) onto the source T-pose bone direction and A is the
#     yaw that turns the actor's facing onto the character's facing (-Y, left = +X)
#   * root translation scaled by hip-height ratio, optional in-place (drift removal) and yaw normalisation
#   * loop finder (pose-distance search) + end->start cross-fade so cycles are seamless
#   * resampled to FPS keys written straight into F-curves (fast), stored as muted NLA tracks for glTF export
import bpy, math
import numpy as np
from mathutils import Vector as V, Quaternion as Q, Matrix as M

CMU_DIR = r"D:\Web Based - Horror Game\tools\blender\assets\cmu"
SRC_FPS = 120

# CMU (MotionBuilder names) -> MPFB game_engine rig
CMU_TO_GAME = {
    'Hips': 'pelvis', 'LowerBack': 'spine_01', 'Spine': 'spine_02', 'Spine1': 'spine_03',
    'Neck1': 'neck_01', 'Head': 'head',
    'LeftShoulder': 'clavicle_l', 'LeftArm': 'upperarm_l', 'LeftForeArm': 'lowerarm_l', 'LeftHand': 'hand_l',
    'RightShoulder': 'clavicle_r', 'RightArm': 'upperarm_r', 'RightForeArm': 'lowerarm_r', 'RightHand': 'hand_r',
    'LeftUpLeg': 'thigh_l', 'LeftLeg': 'calf_l', 'LeftFoot': 'foot_l', 'LeftToeBase': 'ball_l',
    'RightUpLeg': 'thigh_r', 'RightLeg': 'calf_r', 'RightFoot': 'foot_r', 'RightToeBase': 'ball_r',
}
# bones whose T-pose is taken from their own rest (direction of the BVH bone is meaningless / zero length)
KEEP_REST_DIR = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r'}


def _qarr(qs):
    return np.array([[q.w, q.x, q.y, q.z] for q in qs])


def _rot(axis, deg):
    a = np.radians(deg); c, s_ = np.cos(a), np.sin(a)
    n = len(a); R = np.zeros((n, 3, 3)); R[:, 0, 0] = R[:, 1, 1] = R[:, 2, 2] = 1
    i, j = {'X': (1, 2), 'Y': (2, 0), 'Z': (0, 1)}[axis]
    R[:, i, i] = c; R[:, j, j] = c; R[:, i, j] = -s_; R[:, j, i] = s_
    return R


class BVH:
    """Minimal BVH reader + forward kinematics, converted to Blender space (Z up, actor facing -Y at T-pose)."""
    def __init__(self, name):
        txt = open(f"{CMU_DIR}\{name}.bvh").read().split()
        self.names, self.parent, self.offset, self.chans = [], [], [], []
        stack, i, cur = [], 0, None
        while txt[i] != 'MOTION':
            t = txt[i]
            if t in ('ROOT', 'JOINT'):
                self.names.append(txt[i + 1]); self.parent.append(stack[-1] if stack else -1)
                cur = len(self.names) - 1; i += 2; continue
            if t == 'End':
                self.names.append(None); self.parent.append(stack[-1]); cur = len(self.names) - 1; i += 2; continue
            if t == '{': stack.append(cur)
            elif t == '}': stack.pop()
            elif t == 'OFFSET':
                self.offset.append([float(x) for x in txt[i + 1:i + 4]]); i += 4; continue
            elif t == 'CHANNELS':
                n = int(txt[i + 1]); self.chans.append(txt[i + 2:i + 2 + n]); i += 2 + n; continue
            i += 1
            while len(self.chans) < len(self.names) and self.names[-1] is None:
                self.chans.append([])
        while len(self.chans) < len(self.names):
            self.chans.append([])
        nf = int(txt[txt.index('Frames:') + 1])
        k = txt.index('Time:') + 2
        self.data = np.array(txt[k:], dtype=np.float64).reshape(nf, -1)
        self.nf = nf

    def fk(self, frames):
        """world rotation matrices (F,3,3) and positions (F,3) per named joint, Blender space."""
        D = self.data[frames]; F = len(frames)
        C = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)      # BVH Y-up -> Blender Z-up
        Rw, Pw = {}, {}
        col = 0
        for j, nm in enumerate(self.names):
            ch = self.chans[j]
            R = np.broadcast_to(np.eye(3), (F, 3, 3)).copy(); pos = np.zeros((F, 3))
            for c in ch:
                v = D[:, col]; col += 1
                if c.endswith('position'):
                    pos[:, 'XYZ'.index(c[0])] = v
                else:
                    R = R @ _rot(c[0], v)
            p = self.parent[j]
            off = np.array(self.offset[j])
            if p < 0:
                Rw[j] = R; Pw[j] = off + pos
            else:
                Rw[j] = Rw[p] @ R; Pw[j] = Pw[p] + np.einsum('fij,j->fi', Rw[p], off)
        out_R, out_P = {}, {}
        for j, nm in enumerate(self.names):
            if nm is None:
                continue
            out_R[nm] = np.einsum('ij,fjk,kl->fil', C, Rw[j], C.T)
            out_P[nm] = Pw[j] @ C.T
        return out_R, out_P

    def children(self, nm):
        j = self.names.index(nm)
        return [self.names[c] for c in range(len(self.names)) if self.parent[c] == j and self.names[c]]


def _m2q(m):
    return M(m.tolist()).to_quaternion().normalized()


def yaw_quat(angle):
    return Q((0, 0, 1), angle)


def retarget(tgt, clip, frames_range=None, fps=30, in_place=False, loop=None, name=None, face_motion=False, min_speed=0.0, arm_out=9.0,
             yaw_extra=0.0, ground=True, finger_curl=None, extra_fn=None, speed=1.0, smooth=0, hand_follow=0.0, upright=0.0,
             calm=None, arm_hang=0.0, smooth_extra=None, hand_rel=False):
    """Retarget CMU clip onto armature `tgt` -> muted NLA track `name`. Returns (action, info)."""
    name = name or clip
    src = BVH(clip)
    a, b = frames_range if frames_range else (1, src.nf - 1)
    step = SRC_FPS / fps * speed
    frames = [0] + [int(round(f)) for f in np.arange(a, b + 1e-6, step)]
    Rm, P = src.fk(frames)
    used = set(CMU_TO_GAME) | {'LeftUpLeg', 'RightUpLeg'}
    R = {n: [_m2q(m) for m in Rm[n]] for n in Rm if n in used}
    T = {n: R[n][0] for n in R}
    Rs = {n: R[n][1:] for n in R}
    Ps = {n: P[n][1:] for n in P}
    PT = {n: P[n][0] for n in P}
    n_fr = len(frames) - 1

    # ---- facing: actor-left at T-pose -> +X, then optional yaw so the clip's mean facing is -Y
    left_T = V(PT['LeftUpLeg'] - PT['RightUpLeg']); left_T.z = 0; left_T.normalize()
    A = yaw_quat(math.atan2(left_T.y, left_T.x) * -1)          # rotate left_T onto +X
    def hips_left(i):
        d = Rs['Hips'][i] @ T['Hips'].inverted() @ left_T; d = V((d.x, d.y, 0)); return d.normalized()
    A = yaw_quat(math.radians(yaw_extra)) @ A
    Ai = A.inverted()

    # ---- target T-pose world rotations
    tb = tgt.data.bones
    rest = {bn.name: bn.matrix_local.to_quaternion() for bn in tb}
    TT = {}
    for s, t in CMU_TO_GAME.items():
        if t not in tb or s not in T:
            continue
        if t in KEEP_REST_DIR:
            TT[t] = rest[t]; continue
        # source bone direction at T-pose: towards its (first) child head
        ch = [c for c in src.children(s) if np.linalg.norm(PT[c] - PT[s]) > 1e-4]
        if not ch:
            TT[t] = rest[t]; continue
        ds = (A @ V(PT[ch[0]] - PT[s])).normalized()
        dt = (rest[t] @ V((0, 1, 0))).normalized()
        TT[t] = dt.rotation_difference(ds) @ rest[t]
    # hands keep their rest pose *relative to the forearm* at the source T-pose: taking the hand's world rest
    # (A-pose, already angled down) as the T-pose bends every wrist by the A->T arm angle ("clawed" hands)
    if hand_rel:
        for sd in ('l', 'r'):
            h, fa = 'hand_' + sd, 'lowerarm_' + sd
            if h in TT and fa in TT:
                TT[h] = TT[fa] @ rest[fa].inverted() @ rest[h]

    # ---- world rotations per frame
    W = {}
    for s, t in CMU_TO_GAME.items():
        if t not in TT:
            continue
        Tinv = T[s].inverted()
        W[t] = [A @ Rs[s][i] @ Tinv @ Ai @ TT[t] for i in range(n_fr)]

    # ---- root translation (hips), scaled by hip height
    toe_min = min(PT['LeftToeBase'][2], PT['RightToeBase'][2], PT['LeftFoot'][2], PT['RightFoot'][2])
    hip_src = PT['Hips'][2] - toe_min
    pelvis_rest_head = tb['pelvis'].head_local.copy()
    hip_tgt = pelvis_rest_head.z - min(tb['foot_l'].head_local.z, tb['ball_l'].tail_local.z)
    k = hip_tgt / max(hip_src, 1e-6)
    hp = np.array([np.array(A @ V(p - PT['Hips'])) for p in Ps['Hips']]) * k
    hraw = hp.copy()
    if in_place:
        # remove the linear horizontal travel (keeps the natural side-to-side / fore-aft sway)
        t_ = np.arange(n_fr)
        for ax in (0, 1):
            c = np.polyfit(t_, hp[:, ax], 1); hp[:, ax] -= np.polyval(c, t_)

    # ---- loop: find best (start, length) and cross-fade
    if loop:
        lo, hi = loop                                    # cycle length range in output frames
        keys = [t for t in ('thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'upperarm_l', 'upperarm_r', 'pelvis', 'spine_02') if t in W]
        F = np.concatenate([_qarr(W[t]) for t in keys], axis=1)
        def pd(i, j):
            d = 0
            for q in range(len(keys)):
                x, y = F[i, q * 4:q * 4 + 4], F[j, q * 4:q * 4 + 4]
                d += 1 - abs(np.dot(x, y))
            return d
        best = (1e9, 0, n_fr)
        for L in range(lo, min(hi, n_fr - 2) + 1):
            for i in range(0, n_fr - L, 2):
                if min_speed > 0:
                    v = np.linalg.norm(hraw[i + L, :2] - hraw[i, :2]) / (L / fps)
                    if v < min_speed:
                        continue
                d = pd(i, i + L) + 0.3 * pd(min(i + 2, n_fr - 1), min(i + L + 2, n_fr - 1))
                if d < best[0]:
                    best = (d, i, L)
        _, s0, L = best
        sel = list(range(s0, s0 + L + 1))
        for t in W:
            W[t] = [W[t][i] for i in sel]
        hp = hp[sel]
        if in_place:
            t_ = np.arange(len(hp))
            for ax in (0, 1):
                c = np.polyfit(t_, hp[:, ax], 1); hp[:, ax] -= np.polyval(c, t_)
        # cross-fade: distribute the end->start mismatch over the whole cycle (linear), so frame L == frame 0
        nF = len(sel)
        for t in W:
            q0, qL = W[t][0], W[t][-1]
            diff = q0 @ qL.inverted()                        # rotation that takes end onto start
            ang = diff.angle; ax = diff.axis
            for i in range(nF):
                w = i / (nF - 1)
                W[t][i] = Q(ax, ang * w) @ W[t][i]
        hp += np.outer(np.arange(nF) / (nF - 1), hp[0] - hp[-1])
        n_fr = nF
        info_loop = (s0, L, round(best[0], 4))
    else:
        info_loop = None

    # ---- facing: rotate the (selected) clip so the pelvis' mean facing is -Y (actor-left -> +X)
    if face_motion:
        acc = V((0, 0, 0))
        for i in range(n_fr):
            d = W['pelvis'][i] @ TT['pelvis'].inverted() @ V((1, 0, 0)); acc += V((d.x, d.y, 0)).normalized()
        Yq = yaw_quat(-math.atan2(acc.y, acc.x))
        for t in W:
            W[t] = [Yq @ q for q in W[t]]
        hp = np.array([np.array(Yq @ V(h)) for h in hp])

    # ---- optional posture correction (off by default): pull each torso/head bone's mean forward lean back to the
    #      rig's rest posture (CMU actors often stand hunched with the head hanging), keeping the motion around it
    if upright and face_motion:
        for t in ('spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'):
            if t not in W:
                continue
            pitch = lambda d: math.atan2(-d.y, d.z)
            mean = sum(pitch(q @ V((0, 1, 0))) for q in W[t]) / len(W[t])
            rq = Q(V((1, 0, 0)), (pitch(rest[t] @ V((0, 1, 0))) - mean) * upright)
            W[t] = [rq @ q for q in W[t]]

    # ---- optional calm (off by default): shrink each listed bone's motion around its mean pose
    #      ({bone-name prefix: kept fraction}) - an idle actor's restless head / fidgeting arms read as shaking
    def mean_q(qs):
        a = _qarr(qs)
        a[(a @ a[0]) < 0] *= -1
        m = a.mean(0); m /= np.linalg.norm(m)
        return Q(tuple(m))
    if calm:
        for t in W:
            keep = next((v for p, v in calm.items() if t.startswith(p)), None)
            if keep is None:
                continue
            m = mean_q(W[t])
            W[t] = [m.slerp(q, keep) for q in W[t]]

    # ---- optional arm hang (off by default): re-aim the mean direction of upper arm / forearm (and the hand with
    #      it) at a relaxed hang - straight down, slightly out, elbow softly bent - keeping the motion around it
    if arm_hang:
        for sd, sg in (('l', 1), ('r', -1)):
            prev = None
            for bn, tgt_dir in (('upperarm_', V((0.07 * sg, -0.02, -1))), ('lowerarm_', V((0.06 * sg, -0.2, -1)))):
                t = bn + sd
                if t not in W:
                    continue
                m = V((0, 0, 0))
                for q in W[t]:
                    m += q @ V((0, 1, 0))
                rq = Q().slerp(m.normalized().rotation_difference(tgt_dir.normalized()), arm_hang)
                W[t] = [rq @ q for q in W[t]]
                prev = rq
            if prev is not None and 'hand_' + sd in W:
                W['hand_' + sd] = [prev @ q for q in W['hand_' + sd]]

    # ---- optional clean-up (off by default): temporal smoothing of every joint (CMU capture jitter) and
    #      wrists that mostly follow the forearm (the raw single-marker wrist data flails)
    if smooth or smooth_extra:
        cyc = bool(loop)
        for t in W:
            passes = int(smooth) + next((v for p, v in (smooth_extra or {}).items() if t.startswith(p)), 0)
            if not passes:
                continue
            q = _qarr(W[t])
            for j in range(1, len(q)):
                if np.dot(q[j], q[j - 1]) < 0: q[j] = -q[j]
            for _ in range(passes):
                prev_ = np.roll(q, 1, 0) if cyc else np.vstack([q[:1], q[:-1]])
                next_ = np.roll(q, -1, 0) if cyc else np.vstack([q[1:], q[-1:]])
                for arr in (prev_, next_):
                    flip = (arr * q).sum(1) < 0; arr[flip] = -arr[flip]
                q = prev_ * 0.25 + q * 0.5 + next_ * 0.25
                q /= np.linalg.norm(q, axis=1, keepdims=True)
            W[t] = [Q(tuple(x)) for x in q]
    if hand_follow > 0:
        for sd in ('l', 'r'):
            h, fa = 'hand_' + sd, 'lowerarm_' + sd
            if h in W and fa in W and h in TT and fa in TT:
                rel = TT[fa].inverted() @ TT[h]
                W[h] = [W[h][i].slerp(W[fa][i] @ rel, hand_follow) for i in range(len(W[h]))]

    # ---- arm clearance: her hips are wider than the actors' -> swing each whole arm chain out about the chest's
    #      forward axis (world-space pre-rotation of upperarm / lowerarm / hand keeps the chain rigid)
    if arm_out and 'spine_03' in W:
        for side, sg in (('l', 1), ('r', -1)):
            chain = [c + side for c in ('upperarm_', 'lowerarm_', 'hand_')]
            for i in range(n_fr):
                f = W['spine_03'][i] @ TT['spine_03'].inverted() @ V((0, -1, 0))
                rq = Q(f, math.radians(arm_out) * sg)
                for c in chain:
                    if c in W:
                        W[c][i] = rq @ W[c][i]

    # ---- local pose rotations
    order = [bn for bn in tb]                                # bones are listed parents-first
    world = {}
    local = {bn.name: [] for bn in tb}
    for i in range(n_fr):
        for bn in order:
            nmn = bn.name
            par = bn.parent
            rel = (rest[par.name].inverted() @ rest[nmn]) if par else rest[nmn]
            wp = world[par.name] if par else Q()
            if nmn in W:
                w = W[nmn][i]
                loc_q = rel.inverted() @ wp.inverted() @ w
            else:
                loc_q = Q()
                if finger_curl and nmn in finger_curl:
                    loc_q = finger_curl[nmn]
                if extra_fn:
                    e = extra_fn(nmn, i, n_fr)
                    if e is not None:
                        loc_q = e @ loc_q
                w = wp @ rel @ loc_q
            world[nmn] = w
            local[nmn].append(loc_q)

    # pelvis location in its rest frame (parent Root never moves)
    ploc = [rest['pelvis'].inverted() @ V(h) for h in hp]

    # ---- write action
    if tgt.animation_data is None:
        tgt.animation_data_create()
    act = bpy.data.actions.new(name); act.use_fake_user = True
    tgt.animation_data.action = act
    slot = None
    if hasattr(act, 'slots'):
        slot = act.slots.new(id_type='OBJECT', name=tgt.name)
        tgt.animation_data.action_slot = slot
    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    fr = np.arange(n_fr, dtype=np.float32) + 1
    def write(path, idx, vals, group):
        try:
            fc = act.fcurve_ensure_for_datablock(tgt, path, index=idx, group_name=group)
        except Exception:
            fc = act.fcurves.new(path, index=idx, action_group=group)
        fc.keyframe_points.add(len(vals))
        co = np.empty(len(vals) * 2, np.float32); co[0::2] = fr; co[1::2] = vals
        fc.keyframe_points.foreach_set('co', co)
        fc.keyframe_points.foreach_set('interpolation', [2] * len(vals))   # LINEAR (dense keys)
        fc.update()
    for nmn, qs in local.items():
        arr = _qarr(qs)
        for j in range(1, len(arr)):                          # hemisphere continuity
            if np.dot(arr[j], arr[j - 1]) < 0: arr[j] = -arr[j]
        if np.allclose(arr, [1, 0, 0, 0], atol=1e-5):
            continue
        for c in range(4):
            write(f'pose.bones["{nmn}"].rotation_quaternion', c, arr[:, c], nmn)
    L = np.array([tuple(v) for v in ploc])
    for c in range(3):
        write('pose.bones["pelvis"].location', c, L[:, c], 'pelvis')

    # ---- ground: FK the target ourselves (no depsgraph); lowest foot point over the clip sits on z = 0
    if ground:
        heads = {bn.name: bn.head_local.copy() for bn in tb}
        feet = ('foot_l', 'foot_r', 'ball_l', 'ball_r')
        mins = []
        for i in range(0, n_fr, 2):
            wq, hd = {}, {}
            for bn in order:
                nmn = bn.name; par = bn.parent
                rel = (rest[par.name].inverted() @ rest[nmn]) if par else rest[nmn]
                wq[nmn] = (wq[par.name] if par else Q()) @ rel @ local[nmn][i]
                if nmn == 'pelvis':
                    hd[nmn] = heads['pelvis'] + V(hp[i])
                elif par is None:
                    hd[nmn] = heads[nmn]
                else:
                    off = rest[par.name].inverted() @ (heads[nmn] - heads[par.name])
                    hd[nmn] = hd[par.name] + wq[par.name] @ off
                if nmn in feet and nmn.startswith('ball'):
                    tip = hd[nmn] + wq[nmn] @ V((0, tb[nmn].length, 0))
                    mins.append(tip.z)
                if nmn in feet:
                    mins.append(hd[nmn].z)
        off = -float(np.percentile(np.array(mins), 2)) + GROUND_CLEAR
        dz = rest['pelvis'].inverted() @ V((0, 0, off))
        for fc in _fcs(act):
            if fc.data_path == 'pose.bones["pelvis"].location':
                for kp in fc.keyframe_points:
                    kp.co[1] += dz[fc.array_index]
                fc.update()

    tr = tgt.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 1, act); st.name = name
    tr.mute = True
    tgt.animation_data.action = None
    return act, dict(clip=clip, frames=n_fr, k=round(k, 3), loop=info_loop)


GROUND_CLEAR = 0.0


def _fcs(act):
    if hasattr(act, 'fcurves'):
        try:
            if len(act.fcurves):
                return list(act.fcurves)
        except Exception:
            pass
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out
