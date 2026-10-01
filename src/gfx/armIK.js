// Analytic two-bone arm IK for skinned characters (upper arm -> forearm -> hand), world space.
import * as THREE from 'three';

const _p = new THREE.Quaternion();

function setWorldQuat(bone, wq) {
  bone.parent.getWorldQuaternion(_p);
  bone.quaternion.copy(_p.invert().multiply(wq));
}

function aim(bone, from, to) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  const r = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  setWorldQuat(bone, bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(r));
  bone.updateMatrixWorld(true);
}

/** Put the wrist of `up -> lo -> hand` on `target`, elbow bent toward `pole`. Bone lengths are measured live. */
export function twoBoneIK(up, lo, hand, target, pole) {
  up.updateMatrixWorld(true);
  const S = up.getWorldPosition(new THREE.Vector3());
  const B = lo.getWorldPosition(new THREE.Vector3());
  const C = hand.getWorldPosition(new THREE.Vector3());
  const l1 = S.distanceTo(B), l2 = B.distanceTo(C);
  const toT = target.clone().sub(S);
  const d = Math.min(Math.max(toT.length(), 0.05), (l1 + l2) * 0.999);
  const dir = toT.normalize();
  const pl = pole.clone().sub(S); pl.addScaledVector(dir, -pl.dot(dir)).normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const E = S.clone().addScaledVector(dir, a).addScaledVector(pl, h);
  const T = S.clone().addScaledVector(dir, d);
  aim(up, B.clone().sub(S), E.clone().sub(S));
  const B1 = lo.getWorldPosition(new THREE.Vector3());
  aim(lo, hand.getWorldPosition(new THREE.Vector3()).sub(B1), T.sub(B1));
}

/** The crotch-level loop of the [J] emote: a point in front of the pelvis that pumps back and forth. */
export function emoteTarget(pelvis, bodyYaw, phase, out = new THREE.Vector3()) {
  const fwd = new THREE.Vector3(-Math.sin(bodyYaw), 0, -Math.cos(bodyYaw));
  const right = new THREE.Vector3(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw));
  pelvis.getWorldPosition(out);
  const stroke = Math.sin(phase) * 0.045;
  return out.addScaledVector(fwd, 0.2 + stroke).addScaledVector(right, 0.02).add(new THREE.Vector3(0, -0.1 + Math.sin(phase * 2) * 0.004, 0));
}
