# Trellis 3D — 20 November 2026 (Meta Quest 3)

## Source asset
- Original file: `trellis_20261120-203304-746854.glb`
- Source length: **22,415,968 bytes**
- Original SHA-256: `b41f9107a1b5f0eb5760b2950b4081cc960e8ecd68cd51ce9ac11a92bdba8dfa`
- GLB 2.0; one mesh, **382,250 vertices**, **494,423 triangles**.
- Full embedded textures: **two 2048 x 2048 PNGs**, material, normals, UVs; no external dependencies.
- One scene node. No skeleton or rig; no animation.
- Original bounds (XYZ): X -0.1507931..0.1503802, Y -0.1053490..0.1015963, Z -0.4991955..0.4997741.
- **Source is Z-up**: viewer rotates the source -90° about X before measuring and centering; its geometry, UVs, material and source GLB bytes are not modified.
- Source is *unit-normalized*, not documented as real-world metres: viewer uniformly displays longest dimension as **1.67 metres**, with unchanged proportions.
- Appearance caveat: the source PBR material has metallicFactor=1; no material changes are applied. Skin may appear metallic in the renderer.
- Mesh is not watertight; no inferred repairs or simplifications were applied.

## Architecture
Standalone page and per-object configuration. The viewer reuses the common `../../shared/zelda-v13/physics-grab.js` Zelda VR v13 controller engine. No shared control logic is modified. Quest 3 immersive-ar passthrough, grip/ray manipulation, zero gravity, two-handed resizing, wrist rotation, joysticks and freeze-on-release retained. Physical Quest 3 verification is still required.

## Binary transfer
A per-object GitHub Actions workflow in `.github/workflows/assemble-trellis-20261120-203304.yml` reconstructs the *byte-identical* original GLB from 13 XZ compressed chunks in `assets/upload/`, verifies SHA-256, publishes `assets/trellis_20261120-203304-746854.glb`, marks this manifest object ready, and removes temporary chunks. An unpopulated uploader directory is **not** a published model; never mark this entry ready until GitHub has committed and hosted the validated binary.

Compressed transfer length: **13,524,372 bytes**. Compressed SHA-256: `db138659392c5ec02d325cdaed03232f21e3b30f99b0fb022274347e322f52db`.
Chunk size: **1,048,576 bytes**, 12 full parts plus 941,460 bytes; names `trellis_20261120-203304-746854.glb.xz.part000` through `trellis_20261120-203304-746854.glb.xz.part012`.
