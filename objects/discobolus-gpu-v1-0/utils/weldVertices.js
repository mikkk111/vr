/**
 * weldVertices — finds the vertices that are really the same point, so seams can be sewn shut.
 *
 *   const weldMap = weldVertices(positions) // xyz per vertex
 *   weldMap[v]                             // v's representative: the first vertex within tolerance
 *
 * glTF assets split vertices at UV and hard-normal seams, and generated meshes (e.g.
 * SphereGeometry's meridian) leave duplicates a few ulps apart, so exact matching is not enough.
 * No dependencies, so workers can use it as is.
 *
 * To merge a geometry's vertices on all their attributes instead (a render mesh, seams kept), see
 * mergeVerticesFast.js.
 *
 * @param {ArrayLike<number>} positions - xyz per vertex.
 * @param {number} [tolerance] - Weld distance; defaults to 1e-6 of the bounding-box diagonal.
 * @returns {Uint32Array} Per vertex, the first vertex within `tolerance` of it (itself if none).
 */
export function weldVertices(positions, tolerance) {
  const count = positions.length / 3
  const weldMap = new Uint32Array(count)
  if (tolerance === undefined) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], positions[i])
      max[i % 3] = Math.max(max[i % 3], positions[i])
    }
    tolerance = 1e-6 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  }
  if (!(tolerance > 0)) {
    for (let v = 0; v < count; v++) weldMap[v] = v
    return weldMap
  }

  // Cells 4× the tolerance: a match can only sit in a neighbouring cell when the point is
  // within the tolerance of that cell's face, so at most 8 cells are searched.
  const cell = 4 * tolerance
  const toleranceSq = tolerance * tolerance
  const buckets = new Map()
  const bucketKey = (i, j, k) => (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) | 0
  const find = (i, j, k, x, y, z) => {
    const bucket = buckets.get(bucketKey(i, j, k))
    if (!bucket) return -1
    for (const r of bucket) {
      if (
        (positions[3 * r] - x) ** 2 + (positions[3 * r + 1] - y) ** 2 + (positions[3 * r + 2] - z) ** 2 <=
        toleranceSq
      ) {
        return r
      }
    }
    return -1
  }
  for (let v = 0; v < count; v++) {
    const x = positions[3 * v],
      y = positions[3 * v + 1],
      z = positions[3 * v + 2]
    const fx = x / cell,
      fy = y / cell,
      fz = z / cell
    const i = Math.floor(fx),
      j = Math.floor(fy),
      k = Math.floor(fz)
    // Neighbour offset per axis: −1 / +1 when within the tolerance of a face, else none.
    const di = fx - i < 0.25 ? -1 : fx - i > 0.75 ? 1 : 0
    const dj = fy - j < 0.25 ? -1 : fy - j > 0.75 ? 1 : 0
    const dk = fz - k < 0.25 ? -1 : fz - k > 0.75 ? 1 : 0
    let rep = -1
    for (let a = 0; a <= (di ? 1 : 0) && rep < 0; a++)
      for (let b = 0; b <= (dj ? 1 : 0) && rep < 0; b++)
        for (let c = 0; c <= (dk ? 1 : 0) && rep < 0; c++) rep = find(i + a * di, j + b * dj, k + c * dk, x, y, z)
    if (rep < 0) {
      rep = v
      const key = bucketKey(i, j, k)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(v)
      else buckets.set(key, [v])
    }
    weldMap[v] = rep
  }
  return weldMap
}
