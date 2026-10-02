// The [J] gag emote, shared by the third-person avatar (what everyone else sees) and the first-person body (what
// you see): knees a little bent and hips back, right elbow bent and tucked out to the side, the hand closed in a
// fist in front of the hips (knuckle line along the stroke, palm turned in), stroking with a slight wrist roll.
import * as THREE from 'three';
import { twoBoneIK } from './armIK.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export const basis = (yaw) => ({ fwd: V(-Math.sin(yaw), 0, -Math.cos(yaw)), right: V(Math.cos(yaw), 0, -Math.sin(yaw)) });

/** Rotation whose x axis is A and y axis is F (made orthogonal to A). */
export function frameQuat(A, F, out = new THREE.Quaternion()) {
  const x = A.clone().normalize();
  const y = F.clone().addScaledVector(x, -F.dot(x)).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, V().crossVectors(x, y)));
}

/** Where the right hand goes this frame (world space): wrist position and grip frame (A knuckle line, F fingers). */
export function emoteGrip(pelvis, yaw, phase, scale = 1) {
  const { fwd, right } = basis(yaw);
  const pel = pelvis.getWorldPosition(V());
  const shaft = fwd.clone().multiplyScalar(0.8).addScaledVector(UP, 0.3).normalize();      // out and a little up
  const base = pel.clone().addScaledVector(fwd, 0.12 * scale).addScaledVector(UP, -0.11 * scale);
  const s = Math.sin(phase) * 0.5 + 0.5;                                                     // 0..1 along the stroke
  const center = base.addScaledVector(shaft, (0.05 + 0.065 * s) * scale)
    .addScaledVector(right, 0.008 * Math.cos(phase) * scale).addScaledVector(UP, 0.006 * Math.sin(phase * 2) * scale);
  // knuckle line along the stroke toward its tip, fingers wrapping down and under, palm facing in (right hand: N = A x F)
  const A = shaft.clone();
  const F = V(0, -1, 0).addScaledVector(right, -0.35);
  F.addScaledVector(A, -F.dot(A)).normalize();
  F.applyAxisAngle(A, 0.22 * Math.sin(phase + 0.7));                                        // the wrist rolls with the stroke
  const N = A.clone().cross(F).normalize();
  const wrist = center.clone().addScaledVector(F, -0.072 * scale).addScaledVector(N, -0.032 * scale);
  // elbow: bent, out to the side and back by the hip
  const pole = pel.clone().addScaledVector(right, 0.45 * scale).addScaledVector(fwd, -0.25 * scale).addScaledVector(UP, 0.1 * scale);
  return { wrist, A, F, N, pole };
}

/** Bend the knees: hips down and a touch back, feet stay planted (two-bone IK per leg, knees forward). */
export function bendKnees(bones, root, drop, yaw) {
  const pel = bones.pelvis;
  if (!pel || drop < 1e-4) return;
  const { fwd } = basis(yaw);
  root.updateMatrixWorld(true);
  const legs = ['l', 'r'].map((s) => ({ th: bones['thigh_' + s], ca: bones['calf_' + s], ft: bones['foot_' + s] })).filter((L) => L.th && L.ca && L.ft);
  for (const L of legs) { L.at = L.ft.getWorldPosition(V()); L.q = L.ft.getWorldQuaternion(new THREE.Quaternion()); }
  const p = pel.getWorldPosition(V()); p.y -= drop; p.addScaledVector(fwd, -drop * 0.3);
  pel.position.copy(pel.parent.worldToLocal(p));
  pel.updateMatrixWorld(true);
  for (const L of legs) {
    const knee = L.ca.getWorldPosition(V()).addScaledVector(fwd, 0.6);
    twoBoneIK(L.th, L.ca, L.ft, L.at, knee);
    // keep the foot flat where it was
    L.ft.quaternion.copy(L.ft.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(L.q));
    L.ft.updateMatrixWorld(true);
  }
}

/** Turn a hand so its grip frame (from its own finger bones) matches A / F, blended by w. */
export function orientHand(bones, s, A, F, w) {
  const hand = bones['hand_' + s], idx = bones['index_01_' + s], pky = bones['pinky_01_' + s], mid = bones['middle_01_' + s];
  if (!hand || !idx || !pky || !mid) return;
  const wp = hand.getWorldPosition(V());
  const cF = mid.getWorldPosition(V()).sub(wp).normalize();
  const cA = idx.getWorldPosition(V()).sub(pky.getWorldPosition(V()));
  const R = frameQuat(A, F).multiply(frameQuat(cA, cF).invert());
  if (w < 0.999) R.slerp(new THREE.Quaternion(), 1 - w);
  const hw = hand.getWorldQuaternion(new THREE.Quaternion()).premultiply(R);
  hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hw));
  hand.updateMatrixWorld(true);
}

/** Pose a whole (third-person) character for the emote at weight w. */
export function poseEmote(char, root, yaw, phase, w) {
  const B = char.bones;
  if (!B.upperarm_r || !B.pelvis || w < 0.01) return;
  bendKnees(B, root, 0.075 * w, yaw);
  root.updateMatrixWorld(true);
  const G = emoteGrip(B.pelvis, yaw, phase);
  const T = B.hand_r.getWorldPosition(V()).lerp(G.wrist, w);
  twoBoneIK(B.upperarm_r, B.lowerarm_r, B.hand_r, T, G.pole);
  root.updateMatrixWorld(true);
  orientHand(B, 'r', G.A, G.F, w);
  root.updateMatrixWorld(true);
}
