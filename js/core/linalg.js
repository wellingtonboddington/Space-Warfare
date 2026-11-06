// Small dense linear algebra for the tracker (UKF on 6-state) and fire control.
// Matrices are arrays of row arrays (Number[][]); sizes here are ≤ 9 so clarity beats speed.

export const zeros = (n, m = n) => Array.from({ length: n }, () => new Array(m).fill(0));
export const eye = (n, s = 1) => { const M = zeros(n); for (let i = 0; i < n; i++) M[i][i] = s; return M; };
export const clone = (A) => A.map((r) => r.slice());
export const transpose = (A) => A[0].map((_, j) => A.map((r) => r[j]));
export const matAdd = (A, B) => A.map((r, i) => r.map((x, j) => x + B[i][j]));
export const matSub = (A, B) => A.map((r, i) => r.map((x, j) => x - B[i][j]));
export const matScale = (A, s) => A.map((r) => r.map((x) => x * s));
export const matMul = (A, B) => {
  const n = A.length, m = B[0].length, k = B.length, C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) { const a = A[i][p]; if (a === 0) continue; for (let j = 0; j < m; j++) C[i][j] += a * B[p][j]; }
  return C;
};
export const matVec = (A, x) => A.map((r) => r.reduce((s, a, j) => s + a * x[j], 0));
export const outer = (a, b) => a.map((x) => b.map((y) => x * y));
export const symmetrize = (A) => A.map((r, i) => r.map((x, j) => 0.5 * (x + A[j][i])));

/** Cholesky factor L (lower) of SPD matrix; adds jitter if needed. Returns null if hopeless. */
export function cholesky(A) {
  const n = A.length;
  for (let attempt = 0, jitter = 0; attempt < 6; attempt++, jitter = jitter ? jitter * 10 : 1e-9 * (Math.abs(A[0][0]) + 1)) {
    const L = zeros(n);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j] + (i === j ? jitter : 0);
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (s <= 0) { ok = false; break; } L[i][i] = Math.sqrt(s); }
        else L[i][j] = s / L[j][j];
      }
    }
    if (ok) return L;
  }
  return null;
}

/** Inverse of a general square matrix via Gauss–Jordan with partial pivoting. */
export function inverse(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...eye(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(n));
}

/** Solve A x = b. */
export const solve = (A, b) => { const Ai = inverse(A); return Ai ? matVec(Ai, b) : null; };

/** Determinant via LU (small n). */
export function det(A) {
  const n = A.length, M = clone(A);
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { [M[c], M[p]] = [M[p], M[c]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let j = c; j < n; j++) M[r][j] -= f * M[c][j]; }
  }
  return d;
}

/** Trace of the position block (first 3 diagonal entries) — a scalar "uncertainty" summary. */
export const posVariance = (P) => P[0][0] + P[1][1] + P[2][2];
/** Extract 3x3 block starting at (r,c). */
export const block3 = (P, r = 0, c = 0) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => P[r + i][c + j]));

/** Eigen-decomposition of a symmetric 3x3 (Jacobi). Returns {values, vectors(columns)}. */
export function eigSym3(A) {
  const a = clone(A), V = eye(3);
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: V };
}
