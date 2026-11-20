# Heidi — independent Meta Quest 3 mixed-reality object

## Attribution and source
- **Title:** Heidi
- **Author:** jamray747
- **Original model:** https://sketchfab.com/3d-models/heidi-719b33ba7bb44203ab4ad1bc9872bb74
- **Licence as embedded in original GLB:** CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- Copyright and licence information come from the uploaded GLB's `asset.extras`; preserve attribution if this object is reused.

## Exact model inspection (20 November 2026)
- File: `heidi.glb`, 62,871,216 bytes
- SHA-256: `f8bbb4d3e71e93c6e3eb1d16a75fe4e0c5a1139479d554ededfef544f661219b`
- GLB v2.0 / embedded JSON and binary chunk
- 17 mesh primitives across 17 meshes, total **1,990,714 triangles** and **1,066,282 mesh vertices**.
- All primitives have `POSITION`, `NORMAL`, `TEXCOORD_0`; original meshes are divided into groups (16 × 65,532 vertices + 17,770).
- **One original 4096 × 4096 embedded JPEG texture** (4,846,261 bytes); no external image dependencies.
- Material: one double-sided `KHR_materials_unlit`, using the embedded base-colour texture (0 metallic).
- The scene hierarchy has inverse X-axis transforms on parent nodes; their net transform is Y-up, so **do not add an extra Z-to-Y rotation**.
- No skeleton, skins or animations; do not imply rigged movement.
- Original dimensions from mesh accessor bounds approx 0.284 wide × 0.979 high × 0.178 deep, but the original file does not establish actual metre units. Viewer uniformly fits longest side to 1.67 m without changing proportions.
- **Performance note:** 1.99 million triangles may reduce Quest 3 frame rate. The original GLB is intentionally published unchanged; do not silently decimate, retopologise or remove textures.

## VR architecture
- Standalone page: `objects/heidi/index.html`
- Per-object config: `objects/heidi/config.js`
- Model: `objects/heidi/assets/heidi.glb` (byte-identical to uploaded source)
- Reusable Zelda v13 physics/controller engine: `shared/zelda-v13/physics-grab.js` — unmodified.
- Shared model-only brightness: `objects/shared/app.js`, 100% original appearance and 0% black, independent of passthrough background.
- Preserves Quest 3 passthrough without grid/floor, zero gravity, remote/near grips, two-handed scale 10–350%, wrist pitch/roll, joystick positioning and freeze-on-release.
- Physical headset testing cannot be inferred from structural checks or GitHub Pages deployment.

## Verified binary upload
The model is transferred using the documented lossless binary bridge in `docs/BINARY_UPLOAD_METHOD.md`:
1. Original GLB compressed with XZ to **23,680,400 bytes**, SHA-256 `572777cf20393b2c04e537f454b9f63845859eb2fdaa04602050a2a9159a41ac`.
2. Split into **23** chunks (22 × 1,048,576 bytes, last 611,728 bytes), each independently base64-bridged into the connected GitHub API as a verified binary Git blob.
3. GitHub Actions `.github/workflows/assemble-heidi.yml` reassembles, verifies both SHA-256 values, writes the byte-identical GLB, removes transfer chunks, and marks the manifest entry `ready`.
4. Marking the manifest `ready` means only automated structural verification and hosting succeeded; Quest 3 performance needs physical testing.

URL: https://mikkk111.github.io/vr/objects/heidi/
