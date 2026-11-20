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

## Preferred publication: direct GitHub browser upload
GitHub's browser upload limit is 25 MiB per individual file. The unchanged original is 22,415,968 bytes (21.38 MiB), so **no compression, splitting, format conversion or CLI is needed**.

1. Download the original `trellis_20261120-203304-746854.glb` from this project's ChatGPT conversation.
2. While signed in to GitHub with **write permission** for `mikkk111/vr`, open [the exact asset folder](https://github.com/mikkk111/vr/tree/main/objects/trellis-20261120-203304/assets).
3. Choose **Add file → Upload files**; pick `trellis_20261120-203304-746854.glb` and commit directly to `main`.
4. The dedicated [verification workflow](https://github.com/mikkk111/vr/actions/workflows/verify-trellis-20261120-203304.yml) checks size, full SHA-256, GLB 2.0 structure, mesh attributes, vertex/index counts and both embedded 2048 × 2048 PNGs. **Only if every test passes** does it mark the catalogue entry `ready`.
5. Check `https://mikkk111.github.io/vr/objects/trellis-20261120-203304/` after the GitHub Pages deployment finishes. Physical Quest 3 manipulation testing is a separate step.

Do not upload the compressed XZ archive or transfer ZIP into this folder; upload the **original `.glb` file**. No personal access tokens are required for GitHub's own web uploader. Do not change an existing object's files.

## Alternative transfer retained for larger models
The existing `.github/workflows/assemble-trellis-20261120-203304.yml` supports checksum-verified reconstruction from 13 XZ parts in `assets/upload/` if GitHub's 25 MiB browser limit is exceeded or a direct file upload cannot be used. This fallback is **not required** for the 22.4 MB original. Both processes must publish the same SHA-256 `b41f9107a1b5f0eb5760b2950b4081cc960e8ecd68cd51ce9ac11a92bdba8dfa`. Never mark the object ready before verifying the hosted binary.
