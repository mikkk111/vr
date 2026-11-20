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

## Publication completed — 20 November 2026

The original **`trellis_20261120-203304-746854.glb`** was published automatically to GitHub using the verified, lossless 13-part binary bridge. No user-side upload, conversion, downsampling or geometry modification was required.

- Reconstruction GitHub Actions run: https://github.com/mikkk111/vr/actions/runs/44818784842 — successful.
- Published binary commit: https://github.com/mikkk111/vr/commit/4dec2a9834b9bea23f1748348d29ff100452cd81
- Git blob SHA-1: `e435fcb30d7f1fb2a14fed689f927c2231451608` (matches the original source file).
- Source SHA-256: `b41f9107a1b5f0eb5760b2950b4081cc960e8ecd68cd51ce9ac11a92bdba8dfa` (verified during reconstruction).
- Catalogue: `ready`; temporary GitHub upload parts deleted after successful assembly.
- GitHub Pages deployment for the published binary: successful. The actual Quest 3 headset has not been tested.

The tested upload workflow and future-object method are documented in [Verified model uploads](../../docs/BINARY_UPLOAD_METHOD.md).

## Alternative publication methods

For a different revision under 25 MiB, the repository owner may upload a GLB directly using GitHub's website, but **must** give it a new uniquely named object page unless explicitly replacing this object. The direct-upload verification workflow checks this exact source file before marking it ready. The original 13-part assembly Action is retained as a proven alternative for larger assets.
