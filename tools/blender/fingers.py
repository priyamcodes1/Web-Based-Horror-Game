# Natural finger poses for mocap clips (CMU has no finger data). The curl axis is derived per bone from the
# rig's rest pose - perpendicular to the bone and the palm normal - so fingers fold toward the palm instead of
# twisting sideways or bending backwards (the "claw" look of a fixed-axis curl).
from mathutils import Quaternion as Q

SEG = (('01', 0.30), ('02', 0.42), ('03', 0.28))


def curl_dict(rig, amount=1.0, thumb=0.35, spread=0.0):
    B = rig.data.bones
    out = {}
    for s in ('l', 'r'):
        need = [f'{n}_{s}' for n in ('hand', 'index_01', 'pinky_01', 'thumb_03')]
        if not all(n in B for n in need):
            continue
        hand = B['hand_' + s]
        across = (B['index_01_' + s].head_local - B['pinky_01_' + s].head_local).normalized()
        hdir = (hand.tail_local - hand.head_local).normalized()
        n = hdir.cross(across).normalized()
        if n.dot(B['thumb_03_' + s].tail_local - B['index_01_' + s].head_local) < 0:   # palm side = thumb side
            n = -n
        for f, fk in (('index', 0.85), ('middle', 1.0), ('ring', 1.08), ('pinky', 1.15)):
            for k, a in SEG:
                nm = f'{f}_{k}_{s}'
                if nm not in B: continue
                b = B[nm]
                d = (b.tail_local - b.head_local).normalized()
                ax = d.cross(n)
                if ax.length < 1e-6: continue
                local = (b.matrix_local.to_3x3().inverted() @ ax.normalized()).normalized()
                out[nm] = Q(local, amount * a * fk)
        for k, a in SEG:
            nm = f'thumb_{k}_{s}'
            if nm not in B: continue
            b = B[nm]
            d = (b.tail_local - b.head_local).normalized()
            ax = d.cross(n)
            if ax.length < 1e-6: continue
            out[nm] = Q((b.matrix_local.to_3x3().inverted() @ ax.normalized()).normalized(), thumb * a * amount)
    return out
