// Double-precision 3-vector and quaternion helpers for the simulation (no three.js dependency,
// so the sim/AI run headless in Node). Vectors are plain [x,y,z] arrays; quaternions [w,x,y,z].
// Functions allocate by default; hot paths can pass an `out` array.

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const copy = (a, out = [0, 0, 0]) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; };
export const add = (a, b, out = [0, 0, 0]) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; };
export const sub = (a, b, out = [0, 0, 0]) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; };
export const scale = (a, s, out = [0, 0, 0]) => { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; };
/** out = a + b*s */
export const addScaled = (a, b, s, out = [0, 0, 0]) => { out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; out[2] = a[2] + b[2] * s; return out; };
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b, out = [0, 0, 0]) => {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z; return out;
};
export const len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const len2 = (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
export const norm = (a, out = [0, 0, 0]) => { const l = len(a) || 1; return scale(a, 1 / l, out); };
export const neg = (a, out = [0, 0, 0]) => scale(a, -1, out);
export const lerp = (a, b, t, out = [0, 0, 0]) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };
/** Angle between two vectors (rad). */
export const angle = (a, b) => { const d = dot(a, b) / ((len(a) * len(b)) || 1); return Math.acos(Math.max(-1, Math.min(1, d))); };
/** Component of a perpendicular to unit vector n. */
export const reject = (a, n, out = [0, 0, 0]) => addScaled(a, n, -dot(a, n), out);
/** Any unit vector perpendicular to a. */
export const anyPerp = (a) => {
  const n = norm(a);
  const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(n, t));
};

// ---------------------------------------------------------------- quaternions [w,x,y,z]
export const qIdentity = () => [1, 0, 0, 0];
export const qMul = (a, b, out = [0, 0, 0, 0]) => {
  const w = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3];
  const x = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2];
  const y = a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1];
  const z = a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0];
  out[0] = w; out[1] = x; out[2] = y; out[3] = z; return out;
};
export const qConj = (q) => [q[0], -q[1], -q[2], -q[3]];
export const qNorm = (q, out = [0, 0, 0, 0]) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  out[0] = q[0] / l; out[1] = q[1] / l; out[2] = q[2] / l; out[3] = q[3] / l; return out;
};
export const qFromAxisAngle = (axis, ang) => {
  const n = norm(axis), s = Math.sin(ang / 2);
  return [Math.cos(ang / 2), n[0] * s, n[1] * s, n[2] * s];
};
/** Rotate vector v by quaternion q (body → world if q is body→world). */
export const qRotate = (q, v, out = [0, 0, 0]) => {
  const [w, x, y, z] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  out[0] = v[0] + w * tx + (y * tz - z * ty);
  out[1] = v[1] + w * ty + (z * tx - x * tz);
  out[2] = v[2] + w * tz + (x * ty - y * tx);
  return out;
};
/** Rotate world vector into body frame. */
export const qRotateInv = (q, v, out = [0, 0, 0]) => qRotate([q[0], -q[1], -q[2], -q[3]], v, out);
/** Shortest-arc rotation taking unit vector a onto unit vector b. */
export const qFromTo = (a, b) => {
  const na = norm(a), nb = norm(b);
  const d = dot(na, nb);
  if (d < -0.999999) { const ax = anyPerp(na); return [0, ax[0], ax[1], ax[2]]; }
  const c = cross(na, nb);
  return qNorm([1 + d, c[0], c[1], c[2]]);
};
/** Rotation angle (rad) and axis of quaternion. */
export const qToAxisAngle = (q) => {
  const qq = q[0] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
  const s = Math.hypot(qq[1], qq[2], qq[3]);
  const ang = 2 * Math.atan2(s, qq[0]);
  return { angle: ang, axis: s > 1e-12 ? [qq[1] / s, qq[2] / s, qq[3] / s] : [1, 0, 0] };
};
/** Build quaternion from orthonormal basis columns (body x,y,z expressed in world). */
export const qFromBasis = (bx, by, bz) => {
  const m00 = bx[0], m01 = by[0], m02 = bz[0];
  const m10 = bx[1], m11 = by[1], m12 = bz[1];
  const m20 = bx[2], m21 = by[2], m22 = bz[2];
  const tr = m00 + m11 + m22;
  let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return qNorm([w, x, y, z]);
};
/** Attitude that points body +Y (nose) along `fwd` with body +Z as close as possible to `up`. */
export const qLookNose = (fwd, up = [0, 0, 1]) => {
  const y = norm(fwd);
  let x = cross(y, up);
  if (len(x) < 1e-6) x = anyPerp(y);
  norm(x, x);
  const z = cross(x, y);
  return qFromBasis(x, y, z);
};
/** Integrate attitude by body angular velocity ω over dt (exact exponential map). */
export const qIntegrate = (q, omegaBody, dt, out = [0, 0, 0, 0]) => {
  const w = len(omegaBody);
  if (w * dt < 1e-12) return copyQ(q, out);
  const half = 0.5 * w * dt, s = Math.sin(half) / w;
  const dq = [Math.cos(half), omegaBody[0] * s, omegaBody[1] * s, omegaBody[2] * s];
  return qNorm(qMul(q, dq, out), out);
};
export const copyQ = (q, out = [0, 0, 0, 0]) => { out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; out[3] = q[3]; return out; };
export const qSlerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return qNorm(a.map((x, i) => x + (bb[i] - x) * t));
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
};

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const DEG = Math.PI / 180;
