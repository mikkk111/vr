import { BufferAttribute, BufferGeometry, Uint16BufferAttribute, Uint32BufferAttribute } from 'three/webgpu'

/**
 * mergeVerticesFast — three's BufferGeometryUtils.mergeVertices(), with the same result, many
 * times faster.
 *
 *   import { mergeVerticesFast } from 'three-advanced-techniques/simulations/reaction-diffusion/utils/mergeVerticesFast.js'
 *   const merged = mergeVerticesFast(geometry) // instead of mergeVertices(geometry)
 *
 * Vertices merge when every attribute (position, normal, uv, color…) matches after rounding to
 * `tolerance`, as in mergeVertices, and the result has the same vertices in the same order and
 * the same index. mergeVertices builds a string key for every index entry and looks it up in an
 * object; this hashes each vertex once, with numbers, reading the arrays directly, and doesn't
 * clone the geometry first. Differences: the result is always a plain BufferGeometry (not the
 * input's subclass), and interleaved attributes and attributes of more than 4 components work
 * (mergeVertices throws on both).
 *
 * To merge by position only, e.g. to sew UV seams shut for smoothing or decimation, see
 * weldVertices.js.
 *
 * @param {BufferGeometry} geometry
 * @param {number} [tolerance=1e-4] - Attribute values are rounded to this before comparing.
 * @returns {BufferGeometry} A new, indexed geometry.
 */
export function mergeVerticesFast(geometry, tolerance = 1e-4) {
  tolerance = Math.max(tolerance, Number.EPSILON)
  const indices = geometry.getIndex()
  const positions = geometry.getAttribute('position')
  const vertexCount = indices ? indices.count : positions.count

  // The rounding mergeVertices applies, operation for operation, so the same vertices merge.
  const halfTolerance = tolerance * 0.5
  const exponent = Math.log10(1 / tolerance)
  const hashMultiplier = 10 ** exponent
  const hashAdditive = halfTolerance * hashMultiplier

  const names = Object.keys(geometry.attributes)
  const attributes = names.map((name) => geometry.attributes[name])
  const sizes = attributes.map((attribute) => attribute.itemSize)
  const direct = attributes.map(isPlain)
  const arrays = attributes.map((attribute) => attribute.array)
  const width = sizes.reduce((sum, size) => sum + size, 0)

  // With an index, each source vertex is hashed once and later entries reuse its result.
  const sourceCount = indices ? Math.max(0, ...attributes.map((attribute) => attribute.count)) : 0
  const merged = new Int32Array(sourceCount).fill(-1)
  // Per output vertex: its rounded values, source vertex and hash; grown as vertices are found.
  let capacity = 1024
  let keys = new Float64Array(capacity * width)
  let sources = new Uint32Array(capacity)
  let hashes = new Int32Array(capacity)
  // Open addressing, at most half full: output vertex + 1 per slot, 0 when empty.
  let table = new Int32Array(2 * capacity)
  let mask = table.length - 1
  const key = new Float64Array(width)
  const indexArray = indices?.array
  const newIndices = new Uint32Array(vertexCount)
  let nextIndex = 0

  for (let i = 0; i < vertexCount; i++) {
    const index = indices ? indexArray[i] : i
    let target = index < sourceCount ? merged[index] : -1
    if (target < 0) {
      let c = 0
      let h = 0x811c9dc5
      for (let a = 0; a < attributes.length; a++) {
        const size = sizes[a]
        for (let k = 0; k < size; k++) {
          const value = direct[a] ? arrays[a][index * size + k] : read(attributes[a], index, k)
          const rounded = Math.trunc(value * hashMultiplier + hashAdditive)
          key[c++] = rounded
          // Low and high 32 bits; NaN, ±Infinity and −0 all mix in as 0.
          h = Math.imul(h ^ (rounded | 0), 16777619)
          h = Math.imul(h ^ ((rounded / 4294967296) | 0), 16777619)
        }
      }
      if (nextIndex === capacity) {
        capacity *= 2
        keys = grow(keys, capacity * width)
        sources = grow(sources, capacity)
        hashes = grow(hashes, capacity)
        table = new Int32Array(2 * capacity)
        mask = table.length - 1
        for (let e = 0; e < nextIndex; e++) {
          let slot = hashes[e] & mask
          while (table[slot] !== 0) slot = (slot + 1) & mask
          table[slot] = e + 1
        }
      }
      let slot = h & mask
      for (;;) {
        const entry = table[slot]
        if (entry === 0) {
          target = nextIndex++
          table[slot] = target + 1
          keys.set(key, target * width)
          sources[target] = index
          hashes[target] = h
          break
        }
        if (hashes[entry - 1] === h && sameKey(keys, (entry - 1) * width, key, width)) {
          target = entry - 1
          break
        }
        slot = (slot + 1) & mask
      }
      if (index < sourceCount) merged[index] = target
    }
    newIndices[i] = target
  }

  const result = new BufferGeometry()
  result.name = geometry.name
  for (let a = 0; a < names.length; a++) result.setAttribute(names[a], compact(attributes[a], sources, nextIndex))
  for (const [name, morphs] of Object.entries(geometry.morphAttributes)) {
    // Like mergeVertices: morph attributes follow their base attribute, others are kept as they are.
    result.morphAttributes[name] = morphs.map((morph) =>
      name in geometry.attributes ? compact(morph, sources, nextIndex) : morph.clone(),
    )
  }
  result.morphTargetsRelative = geometry.morphTargetsRelative
  for (const group of geometry.groups) result.addGroup(group.start, group.count, group.materialIndex)
  if (geometry.boundingBox !== null) result.boundingBox = geometry.boundingBox.clone()
  if (geometry.boundingSphere !== null) result.boundingSphere = geometry.boundingSphere.clone()
  result.drawRange.start = geometry.drawRange.start
  result.drawRange.count = geometry.drawRange.count
  result.userData = geometry.userData
  // setIndex(array) picks Uint32 once any index reaches 65535 (primitive restart).
  const IndexAttribute = nextIndex - 1 >= 65535 ? Uint32BufferAttribute : Uint16BufferAttribute
  result.setIndex(new IndexAttribute(newIndices, 1))
  return result
}

const GETTERS = ['getX', 'getY', 'getZ', 'getW']
const SETTERS = ['setX', 'setY', 'setZ', 'setW']

// Whether the array holds exactly what the accessors return (so it can be read and copied as is).
function isPlain(attribute) {
  return (
    attribute.isBufferAttribute === true &&
    !attribute.normalized &&
    attribute.getX === BufferAttribute.prototype.getX &&
    attribute.setX === BufferAttribute.prototype.setX
  )
}

function grow(array, length) {
  const out = new array.constructor(length)
  out.set(array)
  return out
}

function read(attribute, index, k) {
  return k < 4 ? attribute[GETTERS[k]](index) : attribute.getComponent(index, k)
}

// Equal after rounding; NaN matches NaN, as mergeVertices' string keys do.
function sameKey(keys, offset, key, width) {
  for (let j = 0; j < width; j++) {
    const a = keys[offset + j],
      b = key[j]
    if (a !== b && (a === a || b === b)) return false
  }
  return true
}

// The attribute with only the output vertices, each copied from its source vertex.
function compact(attribute, sources, count) {
  const itemSize = attribute.itemSize
  if (isPlain(attribute)) {
    const array = attribute.array
    const out = new array.constructor(count * itemSize)
    for (let n = 0; n < count; n++) {
      const source = sources[n] * itemSize,
        target = n * itemSize
      for (let k = 0; k < itemSize; k++) out[target + k] = array[source + k]
    }
    return new attribute.constructor(out, itemSize, attribute.normalized)
  }
  // Through the accessors, as mergeVertices copies: a normalized or half-float value is decoded,
  // then encoded again. Interleaved attributes come out plain.
  const out = attribute.isInterleavedBufferAttribute
    ? new BufferAttribute(new attribute.array.constructor(count * itemSize), itemSize, attribute.normalized)
    : new attribute.constructor(new attribute.array.constructor(count * itemSize), itemSize, attribute.normalized)
  for (let n = 0; n < count; n++) {
    for (let k = 0; k < itemSize; k++) {
      const value = read(attribute, sources[n], k)
      if (k < 4) out[SETTERS[k]](n, value)
      else out.setComponent(n, k, value)
    }
  }
  return out
}
