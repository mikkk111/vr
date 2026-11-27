/**
 * ReactionDiffusionSimulation2D — Gray-Scott reaction-diffusion on the surface of any triangle mesh, simulated on the
 * GPU (TSL compute) for three.js WebGPURenderer, and drawn as that mesh, raised where the pattern grows.
 *
 *   import { ReactionDiffusionSimulation2D } from 'three-advanced-techniques'
 *
 *   const rd = new ReactionDiffusionSimulation2D(geometry, material, { feedRate: 0.055 }) // the material is cloned
 *   rd.feedRate = 0.042                                               // every option is a live property
 *   rd.material.colorNode = mix(grooves, ridges, rd.patternNode)      // the pattern, 0 … 1, for any node
 *   scene.add(rd)
 *   rd.compileAsync(renderer) // optional: the first update doesn't hitch; the pattern waits until then
 *
 *   const timer = new THREE.Timer()
 *   const stroke = new THREE.Line3()
 *   let last = null
 *   renderer.setAnimationLoop((time) => {
 *     timer.update(time)
 *     const hit = raycaster.intersectObject(rd)[0]?.point ?? null
 *     rd.brush = hit && last ? stroke.set(last, hit) : hit // world space: a Vector3, or a Line3 from the last point
 *     last = hit
 *     rd.update(renderer, timer.getDelta())                // seconds; 0 while paused
 *     renderer.render(scene, camera)
 *   })
 *
 * Two chemicals, A and B, live on the vertices, welded by position so the pattern flows across UV and hard-normal
 * seams. Each step both diffuse (the mean of a vertex's neighbours minus the vertex), B feeds on A at A·B², A is fed
 * in at `feedRate` and B removed at `feedRate + killRate`. Lengths are counted in edges: the pattern is a few edges
 * wide wherever it grows, so a finer mesh grows a finer pattern. Steps run at `stepsPerSecond` whatever the frame
 * rate, all of an update in one renderer.compute().
 *
 * The vertices are simulated in blocks of 64 nearby ones, one workgroup each, which gathers its neighbours from
 * workgroup memory. A block sleeps while neither it nor a block next to it changed by more than `sleepThreshold` in
 * the last step: ahead of a growth front, and where the pattern has settled, nothing is stepped or redrawn.
 *
 * The pattern is B through a smoothstep from `patternLow` (0, the grooves) to `patternHigh` (1, the ridges). The
 * surface rises by `displacementAmplitude` along each welded vertex normal, and the normal tilts with the pattern's
 * slope, so any material shades the relief, shadows included. A Mesh like any other: the geometry is drawn as given,
 * UVs, normals and groups kept (indexed, if it wasn't), and raycasts hit it undisplaced. Needs the WebGPU backend.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  abs,
  atomicAdd,
  atomicLoad,
  atomicStore,
  attribute,
  clamp,
  cross,
  dot,
  float,
  floor,
  hash,
  instanceIndex,
  instancedArray,
  ivec3,
  localId,
  max,
  min,
  mix,
  nodeObject,
  normalLocal,
  normalize,
  positionGeometry,
  positionLocal,
  positionPrevious,
  select,
  storage,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
  workgroupArray,
  workgroupBarrier,
  workgroupId,
} from 'three/tsl'
import { mergeVerticesFast } from './utils/mergeVerticesFast.js'
import { weldVertices } from './utils/weldVertices.js'

// Vertices per block, and the workgroup size of every kernel
const BLOCK = 64
// Storage buffers a compute pass binds at most, and the vertex stage reads (concentrationNode adds one).
const STAGE_STORAGE_BUFFERS = 6
const VERTEX_STORAGE_BUFFERS = 1
const BRUSH_MODES = ['erase', 'seed']
const MAX_BLUR_ITERATIONS = 16
// Lattice primes of the seed noise.
const PRIME_X = 73856093
const PRIME_Y = 19349663
const PRIME_Z = 83492791

// Numeric settings, [min, max]: validated on every update(), copied by copy().
const NUMBER_SETTINGS = {
  diffusionA: [0, Infinity],
  diffusionB: [0, Infinity],
  feedRate: [0, Infinity],
  killRate: [0, Infinity],
  timeStep: [0, Infinity],
  stepsPerSecond: [0, Infinity],
  maxStepsPerFrame: [2, Infinity],
  seed: [-Infinity, Infinity],
  seedFrequency: [0, Infinity],
  seedThreshold: [-Infinity, Infinity],
  brushRadius: [0, Infinity],
  brushStrength: [0, 1],
  patternLow: [-Infinity, Infinity],
  patternHigh: [-Infinity, Infinity],
  blurIterations: [0, MAX_BLUR_ITERATIONS],
  displacementAmplitude: [-Infinity, Infinity],
  normalScale: [-Infinity, Infinity],
  sleepThreshold: [-Infinity, Infinity],
}

// Each simulation's varyings, looked up by the object being drawn (see SurfaceNode).
const surfaceVaryings = new WeakMap()
let warnedForeignObject = false

// The surface nodes, patternNode, smoothPatternNode, slopeNode, restPositionNode and concentrationNode: they resolve at
// build time to the drawn simulation's own buffers, so material nodes built from them keep working when the material is
// cloned to another simulation.
class SurfaceNode extends THREE.Node {
  static get type() {
    return 'ReactionDiffusionSurfaceNode'
  }

  constructor(channel, nodeType) {
    super(nodeType)
    this.channel = channel
  }

  setup(builder) {
    const varyings = surfaceVaryings.get(builder.object)
    if (varyings) return varyings[this.channel]
    // The rest position is positionGeometry itself, so it holds on any object
    if (this.channel === 'restPosition') return positionGeometry
    if (!warnedForeignObject) {
      warnedForeignObject = true
      console.warn(
        'ReactionDiffusionSimulation2D: pattern, slope and concentration nodes read the empty state on other objects.',
      )
    }
    if (this.channel === 'slope') return vec3(0)
    return this.channel === 'concentration' ? vec2(1, 0) : float(0)
  }
}

export class ReactionDiffusionSimulation2D extends THREE.Mesh {
  isReactionDiffusionSimulation2D = true
  type = 'ReactionDiffusionSimulation2D'

  // ---- Reaction ----

  /** How fast A spreads between neighbouring vertices. */
  diffusionA = 1
  /** How fast B spreads; patterns form when it is about half of diffusionA. */
  diffusionB = 0.5
  /** Rate A is fed in, toward 1. */
  feedRate = 0.055
  /** Rate B is removed, on top of feedRate. */
  killRate = 0.062

  // ---- Time ----

  /**
   * Simulated time per step. Stable while diffusionA × timeStep stays below about 1.3 on an even triangle mesh, and
   * 1 on any mesh; beyond, neighbouring vertices oscillate.
   */
  timeStep = 1
  /** Steps per second of real time, taken in pairs; 0 pauses the reaction. */
  stepsPerSecond = 2400
  /** Most steps one update() takes: a slower frame runs in slow motion instead. */
  maxStepsPerFrame = 120
  /**
   * A block of vertices sleeps, neither stepped nor redrawn, while none of its vertices nor of the blocks next to it
   * changed A or B by more than this in the last step of the last update. 0 sleeps only what is exactly at rest, as
   * ahead of a growth front; a small value, such as 1e-6, also the pattern once it has nearly settled, freezing what
   * drift is left; negative steps every vertex. New rates wake every block.
   */
  sleepThreshold = 0

  // ---- Seeding, applied by reset() ----

  /** Seed of the starting pattern. */
  seed = 1
  /** Frequency of the seed noise, per unit of the object's space: higher scatters smaller blobs. */
  seedFrequency = 2
  /** Where the seed noise, in [0, 1), is above this, B starts at 1: higher seeds fewer blobs. */
  seedThreshold = 0.55

  // ---- Brush ----

  /**
   * Where a brush touches the surface, in world space: a point (THREE.Vector3), a stroke (THREE.Line3, painted along
   * its whole length), or null. Paints on every update().
   */
  brush = null
  /** Reach of the brush, in the object's units. */
  brushRadius = 0.3
  /** 'erase' empties the vertices within reach (A = 1, B = 0); 'seed' seeds them, as reset() does (B = 1). */
  brushMode = 'erase'
  /**
   * How far each update takes the vertices within reach toward the brush mode's state, 0 … 1: 1 sets it, less blends
   * toward it, as a stroke fading out.
   */
  brushStrength = 1

  // ---- Surface ----

  /** B at which the pattern starts to rise from 0. */
  patternLow = 0
  /** B at which the pattern reaches 1. Below patternLow, the pattern inverts. */
  patternHigh = 0.5
  /**
   * Passes of blur over B for the surface drawn, each taking every vertex halfway to its neighbours' mean, up to 16:
   * smoother edges and relief from a pattern that is ragged at the scale of the edges. The simulation is unchanged.
   */
  blurIterations = 0
  /** How far the pattern raises the surface along its normal, in the object's units; 0 leaves it flat. */
  displacementAmplitude = 0.02
  /** Multiplies the slope the lighting sees: 1 shades the displaced surface as it is. */
  normalScale = 1

  /** The vertices simulated, their blocks of 64, and the steps the last update() took. */
  info = { vertices: 0, blocks: 0, steps: 0 }

  #mesh // the simulated mesh, see buildMesh() and buildBlocks()
  #buffers
  #uniforms
  #kernels
  #positionNode
  #patternNode
  #smoothPatternNode
  #slopeNode
  #restPositionNode
  #concentrationNode
  #material = null // the deformed material in use
  #materials = [] // deformed clones, owned
  #copying = false
  #batches = new Map() // kernel lists by shape: renderer.compute() keys its pass state on the array

  #renderer = null
  #unsupported = false
  #disposed = false
  #compiled = false // every pipeline built, by the first update() or compileAsync()
  #compiling = null // the compileAsync() in flight, which update() holds for and GPU frees wait for
  #started = false // a reset has run on the GPU
  #warned = []
  #valid = {} // last valid value of each number setting

  #accumulator = 0 // steps owed, carried between updates
  #lastTime = -1
  #resetPending = true
  #seeding = true // whether the pending reset seeds, or only clears
  #surfaceRange = '' // the pattern range the surface pass last ran with
  #frame = 2 // updates that stepped, from 2: a block's stamp is the last one in which it changed
  #rates = '' // the rates the last stepping update ran with

  /**
   * @param {THREE.BufferGeometry} geometry - Any triangles. Drawn as given; simulated with its vertices welded by
   *   position.
   * @param {THREE.Material} [material] - Any mesh material, node or classic, cloned. Defaults to a
   *   MeshStandardNodeMaterial coloured by the pattern. Own-property overrides on it (an assigned setupLightingModel)
   *   don't survive the clone: configure `rd.material` in place.
   * @param {object} [options] - Starting values of the numeric settings and `brushMode`, by name:
   *   `{ feedRate: 0.0545 }`.
   */
  constructor(geometry, material = null, options = {}) {
    super(new THREE.BufferGeometry(), null)
    this.#mesh = buildBlocks(buildMesh(geometry))
    for (const key of Object.keys(NUMBER_SETTINGS)) this.#valid[key] = this[key]
    for (const [key, value] of Object.entries(options ?? {})) {
      if (key in NUMBER_SETTINGS || key === 'brushMode') this[key] = value
      else this.#warnOnce(`option:${key}`, `unknown option ${key}; ignored.`)
    }
    this.info.vertices = this.#mesh.count
    this.info.blocks = this.#mesh.blocks

    this.#buffers = this.#createBuffers()
    this.#uniforms = createUniforms()
    this.#kernels = this.#createKernels()
    this.#createDisplay()

    this.geometry = this.#mesh.geometry
    // three's morph node reads the influences, which Mesh's constructor sized for the placeholder geometry.
    this.updateMorphTargets()
    this.#material = this.#deform(material ?? this.#defaultMaterial())
    // An accessor, so an assigned material is cloned and deformed at once.
    Object.defineProperty(this, 'material', {
      get: () => this.#material,
      set: (value) => this.#setMaterial(value),
      configurable: true,
      enumerable: true,
    })
  }

  // ---- Accessors ----

  /** TSL: the pattern, 0 in the grooves to 1 on the ridges, per vertex and interpolated (float). */
  get patternNode() {
    return this.#patternNode
  }

  /**
   * TSL: the pattern continued along its slope from each corner of the triangle, so it bends across the triangle where
   * patternNode runs straight: smooth contours on a coarse mesh, equal to patternNode at the vertices (float, 0 … 1).
   */
  get smoothPatternNode() {
    return this.#smoothPatternNode
  }

  /**
   * TSL: the pattern's gradient along the surface, per vertex and interpolated, in the object's space: per unit of
   * length, pointing up the pattern (vec3). smoothPatternNode's slope, continuous across triangles.
   */
  get slopeNode() {
    return this.#slopeNode
  }

  /**
   * TSL: the vertex's position before the displacement, in the object's space, interpolated (vec3): positionGeometry,
   * from the varying smoothPatternNode reads, so a material that reads both interpolates it once.
   */
  get restPositionNode() {
    return this.#restPositionNode
  }

  /** TSL: the concentrations (A, B) as of the last update(), per vertex and interpolated (vec2). */
  get concentrationNode() {
    return this.#concentrationNode
  }

  // ---- Simulation ----

  /**
   * Advances the simulation by `delta` seconds of real time, in steps of `timeStep` at `stepsPerSecond`, applies the
   * brush and refreshes the surface. Call once per frame, before rendering. Without `delta`, the wall-clock time since
   * the previous call is used. While a compileAsync() is in flight, nothing runs.
   *
   * @param {THREE.WebGPURenderer} renderer - The same renderer on every call.
   * @param {number} [delta] - Seconds since the previous update(); 0 while paused.
   */
  update(renderer, delta) {
    if (this.#disposed) {
      this.#warnOnce('disposed', 'update() after dispose().')
      return this
    }
    if (!this.#bind(renderer)) return this
    this.info.steps = 0
    // A pass whose pipeline three is still creating would be dispatched without one.
    if (this.#compiling) return this
    const settings = this.#readSettings()
    this.#applySettings(settings)

    const now = performance.now()
    if (delta === undefined) delta = this.#lastTime < 0 ? 1 / 60 : (now - this.#lastTime) / 1000
    this.#lastTime = now
    if (typeof delta !== 'number' || Number.isNaN(delta)) {
      this.#warnOnce('delta', `update(renderer, delta) needs delta in seconds, got ${String(delta)}; using 0.`)
      delta = 0
    }

    // Steps go in pairs, A → B → A, so the state is in A between updates. A frame that owes more than
    // maxStepsPerFrame drops the rest instead of catching up.
    let steps = 0
    if (settings.timeStep > 0 && settings.stepsPerSecond > 0) {
      this.#accumulator += THREE.MathUtils.clamp(delta, 0, 1) * settings.stepsPerSecond
      const pairs = Math.floor(this.#accumulator / 2)
      this.#accumulator -= 2 * pairs
      steps = Math.min(2 * pairs, 2 * Math.floor(settings.maxStepsPerFrame / 2))
    }

    const reset = this.#resetPending
    const brush = this.#syncBrush(settings)
    // The first update builds every pipeline, the brush's too, so the first stroke doesn't hitch.
    const prewarm = !this.#compiled
    const blurs = Math.round(settings.blurIterations)
    const range = `${this.#uniforms.patternLow.value}|${this.#uniforms.patternHigh.value}|${blurs}`
    const surface = reset || brush || steps > 0 || prewarm || range !== this.#surfaceRange
    if (!surface) return this

    // Only updates that step age the blocks' stamps: a pause keeps what was awake awake.
    if (steps > 0) this.#frame++
    const u = this.#uniforms
    u.frame.value = this.#frame
    const everything = settings.sleepThreshold < 0
    // New rates move a settled pattern too, and a lower threshold wakes what a higher one put to sleep: every block
    // steps once, and those that change stay awake.
    const { diffusionA, diffusionB, feedRate, killRate, timeStep, sleepThreshold } = settings
    const rates = `${diffusionA}|${diffusionB}|${feedRate}|${killRate}|${timeStep}|${sleepThreshold}`
    u.stepAll.value = everything || (steps > 0 && rates !== this.#rates) ? 1 : 0
    if (steps > 0) this.#rates = rates
    // A new pattern range or blur count changes every vertex's surface, and the blur buffers' roles.
    u.displayAll.value = everything || prewarm || range !== this.#surfaceRange ? 1 : 0
    u.brushActive.value = brush ? 1 : 0
    renderer.compute(this.#batch(reset, brush || prewarm, steps, blurs))
    this.#compiled = true
    this.#started ||= reset
    this.#resetPending = false
    this.#surfaceRange = range
    this.info.steps = steps
    return this
  }

  /** Starts over at the next update(): every vertex empty (A = 1, B = 0), and B = 1 where the seed noise is high. */
  reset() {
    this.#resetPending = true
    this.#seeding = true
    return this
  }

  /** Empties every vertex at the next update(), with no seeds: nothing grows until the brush seeds it. */
  clear() {
    this.#resetPending = true
    this.#seeding = false
    return this
  }

  /**
   * Builds every compute pipeline ahead of the first update(), which otherwise builds them all at once: a simulation
   * created while frames run then doesn't hitch. Until it settles, update() does nothing. Optional.
   *
   * @param {THREE.WebGPURenderer} renderer - The renderer update() runs with.
   * @returns {Promise<void>}
   */
  async compileAsync(renderer) {
    if (this.#disposed) throw new Error('ReactionDiffusionSimulation2D: compileAsync() after dispose().')
    if (!renderer?.isRenderer) {
      throw new TypeError('ReactionDiffusionSimulation2D: compileAsync(renderer) needs the WebGPURenderer.')
    }
    if (!renderer.initialized) await renderer.init()
    if (this.#disposed || !this.#bind(renderer) || this.#compiled) return
    // One pass at a time: three's compile can't be stopped, and would build and bind a pass disposed meanwhile.
    this.#compiling ??= (async () => {
      for (const kernel of this.#allKernels()) {
        if (this.#disposed) return
        await renderer.compileComputeAsync(kernel)
      }
      this.#compiled = true
    })().finally(() => {
      this.#compiling = null
    })
    return this.#compiling
  }

  /**
   * Reads the simulated mesh back, one vertex per welded vertex: `position`, `normal` (the direction the pattern
   * raises it), `concentration` (A, B as of the last update()) and the triangles. Slow: for export, tools and tests.
   *
   * @param {THREE.WebGPURenderer} renderer - The renderer update() runs with.
   * @returns {Promise<THREE.BufferGeometry>}
   */
  async readStateAsync(renderer) {
    if (this.#disposed) throw new Error('ReactionDiffusionSimulation2D: readStateAsync() after dispose().')
    if (renderer !== this.#renderer || !this.#started) {
      throw new Error(
        'ReactionDiffusionSimulation2D: readStateAsync(renderer) needs the renderer of a previous update().',
      )
    }
    const { count, positions, directions } = this.#mesh
    const buffer = await renderer.getArrayBufferAsync(this.#buffers.state[0].value)
    if (this.#disposed) throw new Error('ReactionDiffusionSimulation2D: readStateAsync() after dispose().')
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, 3 * count), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(directions.slice(0, 3 * count), 3))
    geometry.setAttribute('concentration', new THREE.BufferAttribute(new Float32Array(buffer, 0, 2 * count).slice(), 2))
    geometry.setIndex(new THREE.BufferAttribute(simulatedTriangles(this.#mesh.geometry), 1))
    return geometry
  }

  /**
   * Reads back how many blocks of 64 vertices the last update() stepped and redrew, of `info.blocks`. Slow: for tools
   * and tests.
   *
   * @param {THREE.WebGPURenderer} renderer - The renderer update() runs with.
   * @returns {Promise<{ blocks: number, stepped: number, redrawn: number }>}
   */
  async readActivityAsync(renderer) {
    if (this.#disposed) throw new Error('ReactionDiffusionSimulation2D: readActivityAsync() after dispose().')
    if (renderer !== this.#renderer || !this.#started) {
      throw new Error(
        'ReactionDiffusionSimulation2D: readActivityAsync(renderer) needs the renderer of a previous update().',
      )
    }
    const counts = new Uint32Array(await renderer.getArrayBufferAsync(this.#buffers.counters.value))
    return { blocks: this.#mesh.blocks, stepped: counts[0], redrawn: counts[1] }
  }

  // ---- Object3D ----

  /**
   * Copies the object (children included, like three.js) and the settings, the brush included (the same object). The
   * geometry, material and state stay this one's.
   */
  copy(source, recursive) {
    const geometry = this.geometry
    this.#copying = true
    try {
      super.copy(source, recursive)
    } finally {
      this.#copying = false
    }
    this.geometry = geometry
    if (source.isReactionDiffusionSimulation2D) {
      for (const key of Object.keys(NUMBER_SETTINGS)) this[key] = source[key]
      this.brush = source.brush
      this.brushMode = source.brushMode
    }
    return this
  }

  /**
   * A new simulation of the same geometry, with this one's settings and a clone of its material, starting over.
   * Material nodes built from the surface nodes (patternNode, smoothPatternNode, slopeNode, restPositionNode,
   * concentrationNode) read the clone's own state.
   */
  clone(recursive) {
    // The drawn geometry, merged already, stands in for the source, which isn't kept.
    const geometry = this.#mesh.geometry.clone()
    geometry.deleteAttribute('reactionDiffusionVertex')
    geometry.deleteAttribute('reactionDiffusionDirection')
    const material = this.#material.clone()
    material.positionNode = null // the clone deforms it again
    return new this.constructor(geometry, material).copy(this, recursive)
  }

  /** Frees the GPU resources, once a compileAsync() in flight settles, and removes the simulation from the scene. */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.removeFromParent()
    super.dispose()
    const kernels = this.#allKernels()
    const free = () => {
      for (const kernel of kernels) kernel.dispose()
      this.#mesh.geometry.dispose()
      for (const material of this.#materials) material.dispose()
      this.#materials = []
      if (!this.#renderer) return
      const { backend, info } = this.#renderer
      const b = this.#buffers
      const nodes = [
        ...b.state,
        b.neighbours,
        b.halo,
        b.vertices,
        b.surface,
        ...b.blur,
        b.stamp,
        ...b.flags,
        b.adjacency,
        b.bounds,
        b.stepList,
        b.displayList,
        b.counters,
      ]
      const attributes = [...nodes.map((node) => node.value), b.stepArgs, b.displayArgs]
      for (const attribute of attributes) {
        if (backend.has(attribute) && backend.get(attribute).buffer) {
          backend.destroyAttribute(attribute)
          info.destroyAttribute(attribute) // keeps renderer.info.memory truthful
        }
      }
    }
    // The pass three is compiling would build and bind what this frees.
    if (this.#compiling) this.#compiling.then(free, free)
    else free()
  }

  // ---- Setup ----

  #createBuffers() {
    const { padded: P, blocks, positions, directions, neighbours, halo, adjacency, bounds } = this.#mesh
    // Per vertex: (position, 0), (displacement direction, 0).
    const vertices = new Float32Array(8 * P)
    for (let v = 0; v < P; v++) {
      vertices.set(positions.subarray(3 * v, 3 * v + 3), 8 * v)
      vertices.set(directions.subarray(3 * v, 3 * v + 3), 8 * v + 4)
    }
    return {
      // (A, B) per vertex: A holds the state between updates, B is the other half of each step pair.
      state: [
        instancedArray(P, 'vec2').setName('reactionDiffusionStateA'),
        instancedArray(P, 'vec2').setName('reactionDiffusionStateB'),
      ],
      // Each vertex's neighbours, as indices into its block's workgroup memory: its block's 64, then the block's halo.
      neighbours: instancedArray(neighbours, 'uint').setName('reactionDiffusionNeighbours').toReadOnly(),
      // Each block's halo, the vertices outside it next to one inside: offsets [0, blocks], then the vertices.
      halo: instancedArray(halo, 'uint').setName('reactionDiffusionHalo').toReadOnly(),
      vertices: instancedArray(vertices, 'vec4').setName('reactionDiffusionVertices').toReadOnly(),
      // (slope of the pattern in the object's space, pattern) per vertex, for the draw.
      surface: instancedArray(P, 'vec4').setName('reactionDiffusionSurface'),
      // B blurred for the surface, ping-ponged by the blur's passes.
      blur: [
        instancedArray(P, 'float').setName('reactionDiffusionBlurA'),
        instancedArray(P, 'float').setName('reactionDiffusionBlurB'),
      ],
      // Per block: the last stepping update in which it changed, or the brush or a reset touched it.
      stamp: instancedArray(blocks, 'uint').setName('reactionDiffusionStamp'),
      // Per block: two scratch flags for the redrawn set's dilation.
      flags: [
        instancedArray(blocks, 'uint').setName('reactionDiffusionDilatedA'),
        instancedArray(blocks, 'uint').setName('reactionDiffusionDilatedB'),
      ],
      // The blocks next to each, within two edges of it: offsets [0, blocks], then the blocks.
      adjacency: instancedArray(adjacency, 'uint').setName('reactionDiffusionAdjacency').toReadOnly(),
      // Each block's bounding sphere, for the brush.
      bounds: instancedArray(bounds, 'vec4').setName('reactionDiffusionBounds').toReadOnly(),
      // The blocks to step and to redraw this update, their counts, and the indirect dispatches of both.
      stepList: instancedArray(blocks, 'uint').setName('reactionDiffusionStepList'),
      displayList: instancedArray(blocks, 'uint').setName('reactionDiffusionDisplayList'),
      counters: instancedArray(2, 'uint').setName('reactionDiffusionCounters'),
      stepArgs: new THREE.IndirectStorageBufferAttribute(new Uint32Array([0, 1, 1]), 1),
      displayArgs: new THREE.IndirectStorageBufferAttribute(new Uint32Array([0, 1, 1]), 1),
    }
  }

  #createKernels() {
    const b = this.#buffers
    const u = this.#uniforms
    const { count: N, padded: P, blocks: NB, words: W, slots: S, bits, haloMax } = this.#mesh
    const SENTINEL = 2 ** bits - 1
    // Workgroup memory entries: a block's own vertices, then its halo
    const SIZE = BLOCK + haloMax
    const HALO_PASSES = Math.ceil(haloMax / BLOCK)
    // Where the halo's and the adjacency's lists start, past their offsets
    const LISTS = NB + 1
    const readOnly = (node, type, count) => storage(node.value, type, count).toReadOnly()
    const stateRead = b.state.map((node) => readOnly(node, 'vec2', P))
    const blurRead = b.blur.map((node) => readOnly(node, 'float', P))
    const flagRead = b.flags.map((node) => readOnly(node, 'uint', NB))
    const stampRead = readOnly(b.stamp, 'uint', NB)
    const stepListRead = readOnly(b.stepList, 'uint', NB)
    const displayListRead = readOnly(b.displayList, 'uint', NB)
    const counters = storage(b.counters.value, 'uint', 2).toAtomic()
    const stepArgs = storage(b.stepArgs, 'uint', 3)
    const displayArgs = storage(b.displayArgs, 'uint', 3)
    const { neighbours, halo, vertices, surface, stamp, adjacency, bounds } = b
    const lane = localId.x

    const positionOf = (v) => vertices.element(v.mul(2)).xyz
    const directionOf = (v) => vertices.element(v.mul(2).add(1)).xyz
    // The pattern of a B concentration: a smoothstep that also runs downhill when patternHigh < patternLow.
    const pattern = (b) => {
      const t = clamp(b.sub(u.patternLow).div(u.patternHigh.sub(u.patternLow)), 0, 1).toVar()
      return t.mul(t).mul(t.mul(-2).add(3))
    }
    // Fills workgroup memory, one entry per vertex of the block and of its halo: arrays[i][entry] = values[i](vertex).
    const gather = (block, base, arrays, values) => {
      for (const [i, array] of arrays.entries()) array.element(lane).assign(values[i](base.add(lane)))
      const begin = halo.element(block).toVar()
      const count = halo.element(block.add(1)).sub(begin).toVar()
      for (let pass = 0; pass < HALO_PASSES; pass++) {
        const k = lane.add(uint(pass * BLOCK)).toVar()
        If(k.lessThan(count), () => {
          const vertex = halo.element(begin.add(k).add(LISTS)).toVar()
          for (const [i, array] of arrays.entries()) array.element(k.add(uint(BLOCK))).assign(values[i](vertex))
        })
      }
      workgroupBarrier()
    }
    // Calls body(entry, valid) for each neighbour slot of v: its workgroup memory entry, and whether the slot is used.
    const forNeighbours = (v, body) => {
      for (let w = 0; w < W; w++) {
        const word = neighbours.element(v.mul(W).add(w)).toVar()
        for (let s = 0; s < S; s++) {
          const local = (s === 0 ? word : word.shiftRight(uint(s * bits))).bitAnd(uint(SENTINEL)).toVar()
          body(min(local, uint(SIZE - 1)), local.notEqual(uint(SENTINEL)))
        }
      }
    }
    // Marks the block in the stamps, for the next update, when any lane of the workgroup raised the flag.
    const stampIfRaised = (flag, block) => {
      workgroupBarrier()
      If(lane.equal(uint(0)).and(atomicLoad(flag.element(uint(0))).notEqual(uint(0))), () => {
        stamp.element(block).assign(u.frame)
      })
    }

    // ─── reset: empty, with B = 1 where the seed noise is above the threshold (unless clearing); every block awake ───
    const reset = Fn(() => {
      const v = instanceIndex
      const noise = valueNoise(positionOf(v).mul(u.seedFrequency), u.seedHash)
      const seeded = select(noise.greaterThan(u.seedThreshold).and(v.lessThan(uint(N))), u.seeding, float(0))
      b.state[0].element(v).assign(vec2(1, seeded))
      If(v.bitAnd(uint(BLOCK - 1)).equal(uint(0)), () => {
        stamp.element(v.div(uint(BLOCK))).assign(u.frame)
      })
    })()
      .compute(P, [BLOCK])
      .setName('reactionDiffusion.reset')

    // ─── brush: empties or seeds the vertices within reach of the stroke, a segment (a point when its ends meet) ───
    const brush = Fn(() => {
      If(u.brushActive.greaterThan(0), () => {
        const painted = workgroupArray('uint', 1).toAtomic()
        const block = workgroupId.x
        const v = block.mul(uint(BLOCK)).add(lane).toVar()
        If(lane.equal(uint(0)), () => {
          atomicStore(painted.element(uint(0)), uint(0))
        })
        workgroupBarrier()
        const ba = u.brushEnd.sub(u.brushStart).toVar()
        const along = (p) => clamp(dot(p, ba).div(max(dot(ba, ba), 1e-20)), 0, 1)
        // Blocks out of reach skip their vertices.
        const sphere = bounds.element(block).toVar()
        const ca = sphere.xyz.sub(u.brushStart).toVar()
        // Distance from a point at `p` from the stroke's start to the stroke
        const distance = (p) => p.sub(ba.mul(along(p))).length()
        const reaches = distance(ca).lessThan(u.brushRadius.add(sphere.w))
        If(reaches.and(v.lessThan(uint(N))), () => {
          If(distance(positionOf(v).sub(u.brushStart).toVar()).lessThan(u.brushRadius), () => {
            const state = b.state[0].element(v)
            state.assign(mix(state, vec2(1, u.brushSeeds), u.brushStrength))
            atomicStore(painted.element(uint(0)), uint(1))
          })
        })
        stampIfRaised(painted, block)
      })
    })()
      .compute([NB, 1, 1], [BLOCK])
      .setName('reactionDiffusion.brush')

    // ─── activity: which blocks step and which redraw, as lists, and the indirect dispatches over them ───
    const recent = (block) => stampRead.element(block).add(uint(1)).greaterThanEqual(u.frame)
    // Calls body(other) for each block next to `block`.
    const forAdjacent = (block, body) => {
      const begin = adjacency.element(block).toVar()
      const end = adjacency.element(block.add(1)).toVar()
      Loop({ start: begin, end, type: 'uint', condition: '<', name: 'r' }, ({ r }) => {
        body(adjacency.element(r.add(LISTS)).toVar())
      })
    }
    const activityBegin = Fn(() => {
      atomicStore(counters.element(0), uint(0))
      atomicStore(counters.element(1), uint(0))
    })()
      .compute(1, [1])
      .setName('reactionDiffusion.activityBegin')
    // Steps a block that changed, or one next to it.
    const activityStep = Fn(() => {
      const block = instanceIndex
      const stepped = u.stepAll.greaterThan(0).or(recent(block)).toVar()
      forAdjacent(block, (other) => {
        stepped.assign(stepped.or(recent(other)))
      })
      If(stepped, () => {
        const i = atomicAdd(counters.element(0), uint(1)).toVar()
        b.stepList.element(i).assign(block)
      })
    })()
      .compute(NB, [BLOCK])
      .setName('reactionDiffusion.activityStep')
    const activityStepArgs = Fn(() => {
      stepArgs.element(0).assign(atomicLoad(counters.element(0)))
    })()
      .compute(1, [1])
      .setName('reactionDiffusion.activityStepArgs')
    // After the steps, redraws a block that changed in this update or the last one, or one within reach of one through
    // the blur and the slope: each pass widens the set by a ring of blocks, two edges at least; the last appends it to
    // the list. It holds every block stepped, each within a block of a recent stamp.
    const dilate = (from, to, name) =>
      Fn(() => {
        const block = instanceIndex
        const isOn = (x) => (from === null ? recent(x) : flagRead[from].element(x).notEqual(uint(0)))
        const on = u.displayAll.greaterThan(0).or(isOn(block)).toVar()
        forAdjacent(block, (other) => {
          on.assign(on.or(isOn(other)))
        })
        if (to === null) {
          If(on, () => {
            const i = atomicAdd(counters.element(1), uint(1)).toVar()
            b.displayList.element(i).assign(block)
          })
        } else {
          b.flags[to].element(block).assign(select(on, uint(1), uint(0)))
        }
      })()
        .compute(NB, [BLOCK])
        .setName(name)
    // From the stamps (null) or a scratch flag: dilate[i] widens into the other flag, append[i] lists the set widened
    const sources = [null, 0, 1]
    const activityDisplay = {
      dilate: sources.map((from) => dilate(from, from === 0 ? 1 : 0, 'reactionDiffusion.activityDilate')),
      append: sources.map((from) => dilate(from, null, 'reactionDiffusion.activityDisplay')),
    }
    const activityDisplayArgs = Fn(() => {
      displayArgs.element(0).assign(atomicLoad(counters.element(1)))
    })()
      .compute(1, [1])
      .setName('reactionDiffusion.activityDisplayArgs')

    // ─── step: one explicit Gray-Scott step of a listed block, from one state buffer into the other ───
    const step = (from, to, track, name) =>
      Fn(() => {
        const shared = workgroupArray('vec2', SIZE)
        const changed = workgroupArray('uint', 1).toAtomic()
        const block = stepListRead.element(workgroupId.x).toVar()
        const base = block.mul(uint(BLOCK)).toVar()
        const v = base.add(lane).toVar()
        if (track) {
          If(lane.equal(uint(0)), () => {
            atomicStore(changed.element(uint(0)), uint(0))
          })
        }
        gather(block, base, [shared], [(i) => stateRead[from].element(i)])
        const c = shared.element(lane).toVar()
        const sum = vec2(0).toVar()
        const count = float(0).toVar()
        forNeighbours(v, (entry, valid) => {
          sum.addAssign(select(valid, shared.element(entry), vec2(0)))
          count.addAssign(select(valid, float(1), float(0)))
        })
        // The umbrella Laplacian: the mean of the neighbours minus the vertex.
        const laplacian = select(count.greaterThan(0), sum.div(count).sub(c), vec2(0)).toVar()
        const reaction = c.x.mul(c.y).mul(c.y).toVar()
        const rate = vec2(
          u.diffusionA
            .mul(laplacian.x)
            .sub(reaction)
            .add(u.feedRate.mul(float(1).sub(c.x))),
          u.diffusionB.mul(laplacian.y).add(reaction).sub(u.feedRate.add(u.killRate).mul(c.y)),
        )
        const next = clamp(c.add(rate.mul(u.timeStep)), 0, 1).toVar()
        b.state[to].element(v).assign(next)
        if (track) {
          const delta = abs(next.sub(c)).toVar()
          If(max(delta.x, delta.y).greaterThan(u.sleepThreshold), () => {
            atomicStore(changed.element(uint(0)), uint(1))
          })
          stampIfRaised(changed, block)
        }
      })()
        .compute(b.stepArgs, [BLOCK])
        .setName(name)

    // ─── blur: B taken halfway to its neighbours' mean, from the state or the other blur buffer, for the surface ───
    const blurPass = (bOf, to, name) =>
      Fn(() => {
        const shared = workgroupArray('float', SIZE)
        const block = displayListRead.element(workgroupId.x).toVar()
        const base = block.mul(uint(BLOCK)).toVar()
        const v = base.add(lane).toVar()
        gather(block, base, [shared], [bOf])
        const value = shared.element(lane).toVar()
        const sum = float(0).toVar()
        const count = float(0).toVar()
        forNeighbours(v, (entry, valid) => {
          sum.addAssign(select(valid, shared.element(entry), float(0)))
          count.addAssign(select(valid, float(1), float(0)))
        })
        b.blur[to].element(v).assign(select(count.greaterThan(0), value.add(sum.div(count)).mul(0.5), value))
      })()
        .compute(b.displayArgs, [BLOCK])
        .setName(name)
    const stateB = (v) => stateRead[0].element(v).y
    const blurB = blurRead.map((read) => (v) => read.element(v))

    // ─── surface: the pattern and its slope, by least squares over the neighbours in the tangent plane ───
    const surfacePass = (bOf, name) =>
      Fn(() => {
        const heights = workgroupArray('float', SIZE)
        const points = workgroupArray('vec3', SIZE)
        const block = displayListRead.element(workgroupId.x).toVar()
        const base = block.mul(uint(BLOCK)).toVar()
        const v = base.add(lane).toVar()
        gather(block, base, [heights, points], [(i) => pattern(bOf(i)), positionOf])
        const p = points.element(lane).toVar()
        const n = directionOf(v).toVar()
        const h = heights.element(lane).toVar()
        const e1 = normalize(cross(n, select(abs(n.x).lessThan(0.9), vec3(1, 0, 0), vec3(0, 1, 0)))).toVar()
        const e2 = cross(n, e1).toVar()
        // Each neighbour weighs 1 / its distance², so it fits slopes, not heights.
        const moments = vec3(0).toVar() // Σ w·x², Σ w·x·y, Σ w·y²
        const rhs = vec2(0).toVar() // Σ w·x·Δh, Σ w·y·Δh
        forNeighbours(v, (entry, valid) => {
          If(valid, () => {
            const d = points.element(entry).sub(p).toVar()
            const lengthSq = dot(d, d).toVar()
            const w = select(lengthSq.greaterThan(0), float(1).div(lengthSq), float(0)).toVar()
            const xy = vec2(dot(d, e1), dot(d, e2)).toVar()
            const dh = heights.element(entry).sub(h)
            moments.addAssign(vec3(xy.x.mul(xy.x), xy.x.mul(xy.y), xy.y.mul(xy.y)).mul(w))
            rhs.addAssign(xy.mul(dh.mul(w)))
          })
        })
        const det = moments.x.mul(moments.z).sub(moments.y.mul(moments.y)).toVar()
        const trace = moments.x.add(moments.z).toVar()
        // On a degenerate fan (all neighbours in a line), the estimate of an even fan.
        const slope = select(
          det.greaterThan(trace.mul(trace).mul(1e-4)),
          vec2(moments.z.mul(rhs.x).sub(moments.y.mul(rhs.y)), moments.x.mul(rhs.y).sub(moments.y.mul(rhs.x))).div(det),
          select(trace.greaterThan(0), rhs.mul(2).div(trace), vec2(0)),
        ).toVar()
        surface.element(v).assign(vec4(e1.mul(slope.x).add(e2.mul(slope.y)), h))
      })()
        .compute(b.displayArgs, [BLOCK])
        .setName(name)

    return {
      reset,
      brush,
      activityBegin,
      activityStep,
      activityStepArgs,
      activityDisplay,
      activityDisplayArgs,
      // stepBA again, which also stamps the blocks that changed: the last step of an update
      step: [
        step(0, 1, false, 'reactionDiffusion.stepAB'),
        step(1, 0, false, 'reactionDiffusion.stepBA'),
        step(1, 0, true, 'reactionDiffusion.stepBA'),
      ],
      // From the state, or from the blur buffer the last blur pass wrote
      surface: [
        surfacePass(stateB, 'reactionDiffusion.surface'),
        surfacePass(blurB[0], 'reactionDiffusion.surfaceBlurA'),
        surfacePass(blurB[1], 'reactionDiffusion.surfaceBlurB'),
      ],
      // The first pass reads the state into blur A; the others go A → B, B → A
      blur: [
        blurPass(stateB, 0, 'reactionDiffusion.blurState'),
        blurPass(blurB[0], 1, 'reactionDiffusion.blurAB'),
        blurPass(blurB[1], 0, 'reactionDiffusion.blurBA'),
      ],
    }
  }

  #allKernels() {
    const k = this.#kernels
    const a = k.activityDisplay
    return [
      k.reset,
      k.brush,
      k.activityBegin,
      k.activityStep,
      k.activityStepArgs,
      ...a.dilate,
      ...a.append,
      k.activityDisplayArgs,
      ...k.step,
      ...k.blur,
      ...k.surface,
    ]
  }

  // The kernels of one update, cached by their shape.
  #batch(reset, brush, steps, blurs) {
    const key = `${reset}|${brush}|${steps}|${blurs}`
    let list = this.#batches.get(key)
    if (!list) {
      const k = this.#kernels
      list = []
      if (reset) list.push(k.reset)
      if (brush) list.push(k.brush)
      list.push(k.activityBegin)
      if (steps > 0) list.push(k.activityStep, k.activityStepArgs)
      for (let i = 0; i < steps; i += 2) list.push(k.step[0], i + 2 < steps ? k.step[1] : k.step[2])
      // The redrawn set: the blocks that changed widened by blurs + 1 edges, two edges a ring of blocks.
      const rings = Math.max(1, Math.ceil((blurs + 1) / 2))
      let source = 0 // index into activityDisplay's: the stamps, then the scratch flags
      for (let ring = 1; ring < rings; ring++) {
        list.push(k.activityDisplay.dilate[source])
        source = source === 1 ? 2 : 1
      }
      list.push(k.activityDisplay.append[source], k.activityDisplayArgs)
      for (let i = 0; i < blurs; i++) list.push(i === 0 ? k.blur[0] : k.blur[2 - (i % 2)])
      list.push(blurs === 0 ? k.surface[0] : k.surface[2 - (blurs % 2)])
      this.#batches.set(key, list)
    }
    return list
  }

  #createDisplay() {
    const u = this.#uniforms
    const P = this.#mesh.padded
    const surface = storage(this.#buffers.surface.value, 'vec4', P).toReadOnly()
    const state = storage(this.#buffers.state[0].value, 'vec2', P).toReadOnly()
    const vertex = attribute('reactionDiffusionVertex', 'uint')
    const direction = attribute('reactionDiffusionDirection', 'vec3')

    this.#positionNode = Fn((builder) => {
      const data = surface.element(vertex).toVar()
      const offset = direction.mul(data.w.mul(u.displacementAmplitude)).toVar()
      // The displaced surface's normal: the vertex normal tilted against the pattern's slope.
      const slope = data.xyz.mul(u.displacementAmplitude.mul(u.normalScale)).toVar()
      const normal = normalLocal.toVar()
      normalLocal.assign(normalize(normal.sub(slope.sub(normal.mul(dot(normal, slope))))))
      // Motion vectors see the pattern hold still: last frame's position gets this frame's displacement.
      if (builder.needsPreviousData()) positionPrevious.assign(positionPrevious.add(offset))
      return positionLocal.add(offset)
    })()

    // The smooth pattern: h − slope · x per vertex and the slope, interpolated, then + slope · x per fragment, which is
    // quadratic over a triangle and h at its corners. Two vec4 varyings: the rest position x with h, and the slope with
    // h − slope · x.
    const data = surface.element(vertex)
    const positionPattern = vec4(positionGeometry, data.w).toVarying('v_reactionDiffusionPositionPattern')
    const slopeBase = vec4(data.xyz, data.w.sub(dot(data.xyz, positionGeometry))).toVarying(
      'v_reactionDiffusionSlopeBase',
    )
    surfaceVaryings.set(this, {
      pattern: positionPattern.w,
      smoothPattern: clamp(slopeBase.w.add(dot(slopeBase.xyz, positionPattern.xyz)), 0, 1),
      slope: slopeBase.xyz,
      restPosition: positionPattern.xyz,
      concentration: state.element(vertex).toVarying('v_reactionDiffusionConcentration'),
    })
    this.#patternNode = nodeObject(new SurfaceNode('pattern', 'float'))
    this.#smoothPatternNode = nodeObject(new SurfaceNode('smoothPattern', 'float'))
    this.#slopeNode = nodeObject(new SurfaceNode('slope', 'vec3'))
    this.#restPositionNode = nodeObject(new SurfaceNode('restPosition', 'vec3'))
    this.#concentrationNode = nodeObject(new SurfaceNode('concentration', 'vec2'))
  }

  #defaultMaterial() {
    const material = new THREE.MeshStandardNodeMaterial({ name: 'reactionDiffusion', roughness: 0.5 })
    material.colorNode = vec3(this.#patternNode)
    return material
  }

  // ---- Material ----

  // A clone of `source` drawing the simulation.
  #deform(source) {
    for (const key of ['positionNode', 'vertexNode', 'castShadowPositionNode']) {
      if (source[key]) this.#warnOnce(`material:${key}`, `the material's ${key} is replaced by the simulation.`)
    }
    const material = toNodeMaterial(source)
    material.positionNode = this.#positionNode
    // A vertexNode would override the surface in clip space; the shadow pass takes positionNode.
    material.vertexNode = null
    material.castShadowPositionNode = null
    // Simulations with structurally equal materials would otherwise share one program, and its buffers.
    const base = material.customProgramCacheKey.bind(material)
    const key = this.uuid
    material.customProgramCacheKey = () => `${base()}|ReactionDiffusionSimulation2D:${key}`
    material.needsUpdate = true
    this.#materials.push(material)
    return material
  }

  // `rd.material = value`: cloned and deformed, or refused with a warning.
  #setMaterial(value) {
    if (this.#copying || value === this.#material) return
    if (Array.isArray(value)) {
      this.#warnOnce('materialArray', 'takes one material; using the first.')
      value = value[0]
    }
    if (!value?.isMaterial) {
      this.#warnOnce('material', '`material` must be a THREE.Material; keeping the previous one.')
      return
    }
    const ours = this.#materials.includes(value)
    const material = ours ? value : this.#deform(value)
    for (const old of this.#materials) if (old !== material) old.dispose()
    this.#materials = [material]
    this.#material = material
  }

  // ---- Per update ----

  // False while nothing can run; binds the renderer on the first call.
  #bind(renderer) {
    if (!renderer?.isRenderer) {
      throw new TypeError('ReactionDiffusionSimulation2D: update(renderer, delta) needs the WebGPURenderer.')
    }
    if (this.#renderer === null) {
      if (!renderer.initialized) {
        this.#warnOnce('init', 'call update() after `await renderer.init()`.')
        return false
      }
      this.#renderer = renderer
      const problem = deviceProblem(renderer, this.#buffers, this.#mesh)
      if (problem) {
        console.error(`ReactionDiffusionSimulation2D: ${problem}`)
        this.#unsupported = true
      }
    } else if (renderer !== this.#renderer) {
      this.#warnOnce('renderer', 'update() with another renderer than the first one; ignored.')
      return false
    }
    // Never drawn where it can't run: its vertex stage reads storage buffers.
    if (this.#unsupported) this.visible = false
    return !this.#unsupported
  }

  // A setting that isn't a finite number keeps its last valid value, with one warning.
  #readSettings() {
    const settings = {}
    for (const [key, [low, high]] of Object.entries(NUMBER_SETTINGS)) {
      const value = this[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        this.#valid[key] = Math.min(Math.max(value, low), high)
      } else {
        this.#warnOnce(key, `${key} must be a finite number, got ${String(value)}; keeping ${this.#valid[key]}.`)
      }
      settings[key] = this.#valid[key]
    }
    return settings
  }

  #applySettings(s) {
    const u = this.#uniforms
    u.diffusionA.value = s.diffusionA
    u.diffusionB.value = s.diffusionB
    u.feedRate.value = s.feedRate
    u.killRate.value = s.killRate
    u.timeStep.value = s.timeStep
    u.seedFrequency.value = s.seedFrequency
    u.seedThreshold.value = s.seedThreshold
    u.seedHash.value = hashSeed(s.seed)
    u.seeding.value = this.#seeding ? 1 : 0
    u.sleepThreshold.value = s.sleepThreshold
    // The smoothstep divides by the range.
    u.patternLow.value = s.patternLow
    u.patternHigh.value = Math.abs(s.patternHigh - s.patternLow) < 1e-6 ? s.patternLow + 1e-6 : s.patternHigh
    u.displacementAmplitude.value = s.displacementAmplitude
    u.normalScale.value = s.normalScale
    // Culling sees the surface at its highest.
    this.#mesh.geometry.boundingSphere.radius = this.#mesh.radius + Math.abs(s.displacementAmplitude)
  }

  // Whether the brush paints this update; its uniforms are set in the object's space.
  #syncBrush(settings) {
    const brush = this.brush
    if (brush === null || brush === undefined) return false
    // A Line3 has no `is` flag.
    const stroke = brush.start?.isVector3 === true && brush.end?.isVector3 === true
    if (brush.isVector3 !== true && !stroke) {
      this.#warnOnce('brush', 'brush must be a THREE.Vector3 or THREE.Line3 in world space, or null.')
      return false
    }
    const start = stroke ? brush.start : brush
    const end = stroke ? brush.end : brush
    if (!isFiniteVector(start) || !isFiniteVector(end)) return false
    if (!(settings.brushRadius > 0) || !(settings.brushStrength > 0)) return false
    let mode = this.brushMode
    if (!BRUSH_MODES.includes(mode)) {
      this.#warnOnce('brushMode', `brushMode must be 'erase' or 'seed', got ${String(mode)}; erasing.`)
      mode = 'erase'
    }
    const u = this.#uniforms
    this.updateWorldMatrix(true, false)
    _inverse.copy(this.matrixWorld).invert()
    u.brushStart.value.copy(start).applyMatrix4(_inverse)
    u.brushEnd.value.copy(end).applyMatrix4(_inverse)
    u.brushRadius.value = settings.brushRadius
    u.brushSeeds.value = mode === 'seed' ? 1 : 0
    u.brushStrength.value = settings.brushStrength
    return true
  }

  #warnOnce(key, message) {
    if (this.#warned.includes(key)) return
    this.#warned.push(key)
    console.warn(`ReactionDiffusionSimulation2D: ${message}`)
  }
}

// ---- Module helpers ----

const _inverse = new THREE.Matrix4()

function isFiniteVector(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

function createUniforms() {
  return {
    diffusionA: uniform(1),
    diffusionB: uniform(0.5),
    feedRate: uniform(0.055),
    killRate: uniform(0.062),
    timeStep: uniform(1),
    seedFrequency: uniform(2),
    seedThreshold: uniform(0.55),
    seedHash: uniform(0, 'uint'),
    seeding: uniform(1),
    brushStart: uniform(new THREE.Vector3()),
    brushEnd: uniform(new THREE.Vector3()),
    brushRadius: uniform(0),
    brushSeeds: uniform(0),
    brushStrength: uniform(1),
    brushActive: uniform(0),
    patternLow: uniform(0),
    patternHigh: uniform(0.5),
    displacementAmplitude: uniform(0),
    normalScale: uniform(1),
    sleepThreshold: uniform(0),
    frame: uniform(2, 'uint'),
    stepAll: uniform(0),
    displayAll: uniform(1),
  }
}

// TSL value noise in [0, 1): hashed lattice values, blended with a smoothstep fade. `seed` offsets the hash.
function valueNoise(p, seed) {
  const base = floor(p).toVar()
  const cell = ivec3(base).toVar()
  const f = p.sub(base).toVar()
  const w = f.mul(f).mul(f.mul(-2).add(3)).toVar()
  const corner = (x, y, z) =>
    hash(
      uint(cell.x.add(x))
        .mul(uint(PRIME_X))
        .add(uint(cell.y.add(y)).mul(uint(PRIME_Y)))
        .add(uint(cell.z.add(z)).mul(uint(PRIME_Z)))
        .add(seed),
    )
  const y0 = mix(mix(corner(0, 0, 0), corner(1, 0, 0), w.x), mix(corner(0, 1, 0), corner(1, 1, 0), w.x), w.y)
  const y1 = mix(mix(corner(0, 0, 1), corner(1, 0, 1), w.x), mix(corner(0, 1, 1), corner(1, 1, 1), w.x), w.y)
  return mix(y0, y1, w.z)
}

// A seed scrambled into 32 bits, so nearby seeds give unrelated noise.
function hashSeed(seed) {
  let h = Math.imul(Math.round(seed) | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

// The drawn geometry and the simulated mesh. The geometry is indexed with every attribute kept, plus the simulated
// vertex of each drawn one and the direction it rises along. The simulated vertices are the drawn ones welded by
// position, numbered in the order the drawn ones reach them, with their neighbour lists (CSR) and directions.
function buildMesh(source) {
  if (!source?.isBufferGeometry)
    throw new TypeError('ReactionDiffusionSimulation2D: `geometry` must be a BufferGeometry.')
  if (!source.getAttribute('position')) {
    throw new TypeError('ReactionDiffusionSimulation2D: `geometry` has no "position" attribute.')
  }
  // Each vertex drawn once; UV and hard-normal seams stay split.
  const geometry = mergeVerticesFast(source, 1e-6)
  const position = geometry.getAttribute('position')
  const R = position.count
  const xyz = new Float32Array(3 * R)
  for (let i = 0; i < R; i++) {
    xyz[3 * i] = position.getX(i)
    xyz[3 * i + 1] = position.getY(i)
    xyz[3 * i + 2] = position.getZ(i)
  }
  if (!xyz.every(Number.isFinite)) {
    throw new RangeError('ReactionDiffusionSimulation2D: `geometry` has positions that are not finite.')
  }

  const weld = weldVertices(xyz)
  const simOf = new Uint32Array(R)
  let N = 0
  for (let i = 0; i < R; i++) simOf[i] = weld[i] === i ? N++ : simOf[weld[i]]
  const positions = new Float32Array(3 * N)
  for (let i = 0; i < R; i++) if (weld[i] === i) positions.set(xyz.subarray(3 * i, 3 * i + 3), 3 * simOf[i])

  const triangles = simulatedTriangles(geometry, simOf)
  if (triangles.length === 0) throw new Error('ReactionDiffusionSimulation2D: `geometry` has no triangles.')

  // Neighbours: both other corners of every triangle around a vertex, sorted, each once.
  const start = new Uint32Array(N + 1)
  for (const v of triangles) start[v + 1] += 2
  for (let v = 0; v < N; v++) start[v + 1] += start[v]
  const cursor = start.slice(0, N)
  const ring = new Uint32Array(start[N])
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]
    const b = triangles[t + 1]
    const c = triangles[t + 2]
    ring[cursor[a]++] = b
    ring[cursor[a]++] = c
    ring[cursor[b]++] = c
    ring[cursor[b]++] = a
    ring[cursor[c]++] = a
    ring[cursor[c]++] = b
  }
  const lists = new Uint32Array(N + 1 + ring.length)
  let k = 0
  for (let v = 0; v < N; v++) {
    lists[v] = k
    const list = ring.subarray(start[v], start[v + 1]).sort()
    let previous = -1
    for (const neighbour of list) {
      if (neighbour !== previous) lists[N + 1 + k++] = neighbour
      previous = neighbour
    }
  }
  lists[N] = k
  // Inner edges are listed from both of their triangles.
  const topology = lists.slice(0, N + 1 + k)

  // Directions: the drawn normals averaged over each welded vertex; where they cancel, or there are none, the
  // area-weighted normal of the triangles around it.
  const directions = new Float32Array(3 * N)
  const normal = geometry.getAttribute('normal')
  if (normal) {
    for (let i = 0; i < R; i++) {
      const v = 3 * simOf[i]
      directions[v] += normal.getX(i)
      directions[v + 1] += normal.getY(i)
      directions[v + 2] += normal.getZ(i)
    }
  }
  const areaNormals = new Float32Array(3 * N)
  for (let t = 0; t < triangles.length; t += 3) {
    _a.fromArray(positions, 3 * triangles[t])
    _b.fromArray(positions, 3 * triangles[t + 1]).sub(_a)
    _c.fromArray(positions, 3 * triangles[t + 2]).sub(_a)
    _b.cross(_c)
    for (let corner = 0; corner < 3; corner++) {
      const v = 3 * triangles[t + corner]
      areaNormals[v] += _b.x
      areaNormals[v + 1] += _b.y
      areaNormals[v + 2] += _b.z
    }
  }
  for (let v = 0; v < 3 * N; v += 3) {
    _a.fromArray(directions, v)
    if (!(_a.length() > 1e-6)) _a.fromArray(areaNormals, v)
    if (_a.length() > 0) _a.normalize()
    else _a.set(0, 0, 1)
    _a.toArray(directions, v)
  }

  if (!normal) {
    const drawn = new Float32Array(3 * R)
    for (let i = 0; i < R; i++) drawn.set(directions.subarray(3 * simOf[i], 3 * simOf[i] + 3), 3 * i)
    geometry.setAttribute('normal', new THREE.BufferAttribute(drawn, 3))
  }
  geometry.computeBoundingSphere()

  return { geometry, simOf, count: N, positions, directions, topology, radius: geometry.boundingSphere.radius }
}

// Renumbers the simulated vertices in blocks of 64, each grown breadth first over the mesh from a seed taken along a
// Morton curve, so each is a compact patch, and lays out what the kernels read: each vertex's neighbours as indices
// into its block's workgroup memory (the block's 64, then its halo, the vertices outside it next to one inside), the
// halos, the blocks within two edges of each, and each block's bounding sphere. Vertices past the last one pad the
// last block: no neighbours, never drawn.
function buildBlocks(mesh) {
  const { geometry, simOf, count: N, positions: sourcePositions, directions: sourceDirections, topology } = mesh
  const order = growBlocks(mortonOrder(sourcePositions, N), topology, N)
  const rank = new Uint32Array(N)
  for (let v = 0; v < N; v++) rank[order[v]] = v
  const blocks = Math.ceil(N / BLOCK)
  const P = blocks * BLOCK

  const positions = new Float32Array(3 * P)
  const directions = new Float32Array(3 * P)
  for (let v = 0; v < N; v++) {
    for (let axis = 0; axis < 3; axis++) {
      positions[3 * v + axis] = sourcePositions[3 * order[v] + axis]
      directions[3 * v + axis] = sourceDirections[3 * order[v] + axis]
    }
  }
  for (let v = N; v < P; v++) directions[3 * v + 2] = 1

  // Neighbour lists in the new numbering, in the given order: the sums round as they did before the renumbering
  const start = new Uint32Array(N + 1)
  let valence = 0
  for (let v = 0; v < N; v++) {
    const n = topology[order[v] + 1] - topology[order[v]]
    start[v + 1] = start[v] + n
    valence = Math.max(valence, n)
  }
  const ring = new Uint32Array(start[N])
  for (let v = 0; v < N; v++) {
    const o = order[v]
    for (let k = start[v], r = topology[o]; r < topology[o + 1]; r++, k++) ring[k] = rank[topology[N + 1 + r]]
  }

  // Halos, sorted, and each vertex's workgroup-memory entry within the block being laid out
  const haloStarts = new Uint32Array(blocks + 1)
  const haloAll = new Uint32Array(start[N])
  const entryOf = new Int32Array(N)
  const seenBy = new Int32Array(N).fill(-1)
  let haloCount = 0
  let haloMax = 0
  for (let b = 0; b < blocks; b++) {
    const first = b * BLOCK
    const last = Math.min(first + BLOCK, N)
    haloStarts[b] = haloCount
    for (let v = first; v < last; v++) {
      for (let r = start[v]; r < start[v + 1]; r++) {
        const n = ring[r]
        if ((n < first || n >= last) && seenBy[n] !== b) {
          seenBy[n] = b
          haloAll[haloCount++] = n
        }
      }
    }
    haloAll.subarray(haloStarts[b], haloCount).sort()
    haloMax = Math.max(haloMax, haloCount - haloStarts[b])
  }
  haloStarts[blocks] = haloCount
  const haloIds = haloAll.subarray(0, haloCount)
  const halo = new Uint32Array(blocks + 1 + haloCount)
  halo.set(haloStarts)
  halo.set(haloIds, blocks + 1)

  // Neighbour slots: 8-bit entries while a block and its halo fit, 16-bit beyond; all ones marks an empty slot.
  const bits = BLOCK + haloMax < 255 ? 8 : 16
  const slots = 32 / bits
  const words = Math.max(1, Math.ceil(valence / slots))
  const neighbours = new Uint32Array(P * words).fill(0xffffffff)
  const mask = 2 ** bits - 1
  for (let b = 0; b < blocks; b++) {
    const first = b * BLOCK
    const last = Math.min(first + BLOCK, N)
    for (let i = haloStarts[b]; i < haloStarts[b + 1]; i++) entryOf[haloIds[i]] = BLOCK + i - haloStarts[b]
    for (let v = first; v < last; v++) {
      for (let k = 0, r = start[v]; r < start[v + 1]; r++, k++) {
        const n = ring[r]
        const entry = n >= first && n < last ? n - first : entryOf[n]
        const word = v * words + Math.floor(k / slots)
        const shift = (k % slots) * bits
        neighbours[word] = ((neighbours[word] & ~(mask << shift)) | (entry << shift)) >>> 0
      }
    }
  }

  // Blocks within two edges of each: those of its halo and of the halo's neighbours
  const blockOf = (v) => Math.floor(v / BLOCK)
  const adjacentStarts = new Uint32Array(blocks + 1)
  let adjacentIds = new Uint32Array(16 * blocks)
  let adjacentCount = 0
  const markedBy = new Int32Array(blocks).fill(-1)
  const mark = (other, b) => {
    if (markedBy[other] === b) return
    markedBy[other] = b
    if (adjacentCount === adjacentIds.length) {
      const grown = new Uint32Array(2 * adjacentIds.length)
      grown.set(adjacentIds)
      adjacentIds = grown
    }
    adjacentIds[adjacentCount++] = other
  }
  for (let b = 0; b < blocks; b++) {
    markedBy[b] = b
    adjacentStarts[b] = adjacentCount
    for (let i = haloStarts[b]; i < haloStarts[b + 1]; i++) {
      const h = haloIds[i]
      mark(blockOf(h), b)
      for (let r = start[h]; r < start[h + 1]; r++) mark(blockOf(ring[r]), b)
    }
  }
  adjacentStarts[blocks] = adjacentCount
  const adjacency = new Uint32Array(blocks + 1 + adjacentCount)
  adjacency.set(adjacentStarts)
  adjacency.set(adjacentIds.subarray(0, adjacentCount), blocks + 1)

  // Bounding spheres: the box's centre, and the farthest vertex from it
  const bounds = new Float32Array(4 * blocks)
  for (let b = 0; b < blocks; b++) {
    const first = b * BLOCK
    const last = Math.min(first + BLOCK, N)
    _box.makeEmpty()
    for (let v = first; v < last; v++) _box.expandByPoint(_a.fromArray(positions, 3 * v))
    _box.getCenter(_b)
    let radius = 0
    for (let v = first; v < last; v++) radius = Math.max(radius, _b.distanceTo(_a.fromArray(positions, 3 * v)))
    bounds.set([_b.x, _b.y, _b.z, radius], 4 * b)
  }

  // The drawn vertices' simulated vertex and direction, in the new numbering
  const R = simOf.length
  const vertex = new Uint32Array(R)
  const drawnDirections = new Float32Array(3 * R)
  for (let i = 0; i < R; i++) {
    const v = (vertex[i] = rank[simOf[i]])
    drawnDirections[3 * i] = directions[3 * v]
    drawnDirections[3 * i + 1] = directions[3 * v + 1]
    drawnDirections[3 * i + 2] = directions[3 * v + 2]
  }
  geometry.setAttribute('reactionDiffusionVertex', new THREE.BufferAttribute(vertex, 1))
  geometry.setAttribute('reactionDiffusionDirection', new THREE.BufferAttribute(drawnDirections, 3))

  return {
    geometry,
    count: N,
    padded: P,
    blocks,
    positions,
    directions,
    neighbours,
    halo,
    adjacency,
    bounds,
    words,
    slots,
    bits,
    haloMax,
    valence,
    radius: mesh.radius,
  }
}

// The vertices sorted along a Morton curve over their bounding cube, 10 bits an axis, ties in their given order.
function mortonOrder(positions, N) {
  _box.makeEmpty()
  for (let v = 0; v < N; v++) _box.expandByPoint(_a.fromArray(positions, 3 * v))
  _box.getSize(_b)
  const span = Math.max(_b.x, _b.y, _b.z) || 1
  const spread = (x) => {
    x &= 0x3ff
    x = (x | (x << 16)) & 0x30000ff
    x = (x | (x << 8)) & 0x300f00f
    x = (x | (x << 4)) & 0x30c30c3
    x = (x | (x << 2)) & 0x9249249
    return x
  }
  const cell = (value, low) => Math.min(1023, Math.floor(((value - low) / span) * 1024))
  // The code above the index, exact in a double: 30 bits of code, 23 of index
  const keys = new Float64Array(N)
  for (let v = 0; v < N; v++) {
    const x = spread(cell(positions[3 * v], _box.min.x))
    const y = spread(cell(positions[3 * v + 1], _box.min.y))
    const z = spread(cell(positions[3 * v + 2], _box.min.z))
    keys[v] = ((x | (y << 1) | (z << 2)) >>> 0) * 2 ** 23 + v
  }
  keys.sort()
  const order = new Uint32Array(N)
  for (let r = 0; r < N; r++) order[r] = keys[r] % 2 ** 23
  return order
}

// The vertices in blocks of BLOCK, each grown breadth first from the first vertex along `curve` not yet placed; a block
// whose reach runs out continues from the next one along the curve.
function growBlocks(curve, topology, N) {
  const order = new Uint32Array(N)
  const queued = new Uint8Array(N)
  const queue = new Uint32Array(N)
  let placed = 0
  let next = 0
  while (placed < N) {
    const end = Math.min(placed + BLOCK, N)
    let head = 0
    let tail = 0
    while (placed < end) {
      if (head === tail) {
        while (queued[curve[next]]) next++
        queued[curve[next]] = 1
        queue[tail++] = curve[next]
      }
      const v = queue[head++]
      order[placed++] = v
      // Never more queued than the block has room for, so the queue is empty when it is full
      for (let r = topology[v]; r < topology[v + 1] && placed + tail - head < end; r++) {
        const n = topology[N + 1 + r]
        if (!queued[n]) {
          queued[n] = 1
          queue[tail++] = n
        }
      }
    }
  }
  return order
}

// The drawn triangles in simulated vertices, without the ones the weld collapsed.
function simulatedTriangles(geometry, simOf = geometry.getAttribute('reactionDiffusionVertex').array) {
  const index = geometry.index
  const out = new Uint32Array(3 * Math.floor(index.count / 3))
  let n = 0
  for (let i = 0; i + 2 < index.count; i += 3) {
    const a = simOf[index.getX(i)]
    const b = simOf[index.getX(i + 1)]
    const c = simOf[index.getX(i + 2)]
    if (a === b || b === c || c === a) continue
    out[n++] = a
    out[n++] = b
    out[n++] = c
  }
  return out.slice(0, n)
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _box = new THREE.Box3()

function nodeMaterialClass(material) {
  if (!/^Mesh\w*Material$/.test(material.type)) return null
  const NodeClass = THREE[material.type.replace(/Material$/, 'NodeMaterial')]
  return typeof NodeClass === 'function' && NodeClass.prototype instanceof THREE.NodeMaterial ? NodeClass : null
}

function toNodeMaterial(material) {
  if (material.isNodeMaterial) return material.clone()
  const NodeClass = nodeMaterialClass(material)
  if (!NodeClass) {
    throw new TypeError(`ReactionDiffusionSimulation2D: can't draw with a ${material.type}; use a mesh material.`)
  }
  // A fresh copy first: its fields, without the listeners the renderer attached to the original.
  const source = material.clone()
  const node = new NodeClass()
  for (const key in source) if (key !== 'uuid' && key !== 'type') node[key] = source[key]
  return node
}

// Why this renderer can't run the simulation, or null.
function deviceProblem(renderer, buffers, { blocks, haloMax }) {
  const backend = renderer.backend
  if (backend.isWebGPUBackend !== true) {
    return 'needs the WebGPU backend; this renderer fell back to WebGL 2. The surface is hidden.'
  }
  const limits = backend.device?.limits
  const perStage = limits?.maxStorageBuffersPerShaderStage
  if (perStage !== undefined && perStage < STAGE_STORAGE_BUFFERS) {
    return `needs ${STAGE_STORAGE_BUFFERS} storage buffers per shader stage; this device allows ${perStage}.`
  }
  const vertexStorage = limits?.maxStorageBuffersInVertexStage
  if (vertexStorage !== undefined ? vertexStorage < VERTEX_STORAGE_BUFFERS : backend.compatibilityMode === true) {
    return (
      `needs ${VERTEX_STORAGE_BUFFERS} storage buffer in the vertex stage; this device allows ${vertexStorage ?? 0} ` +
      '(request maxStorageBuffersInVertexStage with new WebGPURenderer({ requiredLimits })). The surface is hidden.'
    )
  }
  const largest = Math.max(
    buffers.neighbours.value.array.byteLength,
    buffers.halo.value.array.byteLength,
    buffers.vertices.value.array.byteLength,
  )
  const bindingSize = limits?.maxStorageBufferBindingSize
  if (bindingSize !== undefined && largest > bindingSize) {
    return `needs a ${largest}-byte storage buffer; this device binds ${bindingSize} at most. Use fewer vertices.`
  }
  const perDimension = limits?.maxComputeWorkgroupsPerDimension
  if (perDimension !== undefined && blocks > perDimension) {
    return `needs ${blocks} workgroups a dispatch; this device runs ${perDimension} at most. Use fewer vertices.`
  }
  // The surface pass: a float and a vec3 an entry
  const workgroupBytes = (BLOCK + haloMax) * 20
  const workgroupStorage = limits?.maxComputeWorkgroupStorageSize
  if (workgroupStorage !== undefined && workgroupBytes > workgroupStorage) {
    return `needs ${workgroupBytes} bytes of workgroup memory; this device has ${workgroupStorage}. Use an even mesh.`
  }
  return null
}
