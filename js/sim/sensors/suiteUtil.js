// Small helpers shared by the sensor suite.
export { qRotate, norm, sub, len, dot, angle } from '../../core/vec.js';
import { norm, dot, cross, len, add, scale } from '../../core/vec.js';

/** Rotate unit vector a toward unit vector b by at most maxAngle (rad). */
export function slerpDir(a, b, maxAngle) {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const th = Math.acos(c);
  if (th <= maxAngle || th < 1e-9) return b.slice();
  let axis = cross(a, b);
  if (len(axis) < 1e-9) axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  axis = norm(axis);
  // Rodrigues rotation of a about axis by maxAngle
  const k = axis, s = Math.sin(maxAngle), co = Math.cos(maxAngle);
  const kxa = cross(k, a), kda = dot(k, a);
  return norm(add(add(scale(a, co), scale(kxa, s)), scale(k, kda * (1 - co))));
}
