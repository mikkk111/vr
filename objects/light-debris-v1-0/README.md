# Light & Debris GPU V1.0

An independent VR interpretation of [Light & Debris by FunTech / nkondo-ft](https://nkondo-ft.github.io/light-and-debris/). Upstream repository inspected: https://github.com/nkondo-ft/light-and-debris. No licence file or explicit code reuse grant was found; upstream code, geometry, artwork and assets have not been copied. This version implements its own GPU particle state, force field, rotation, lighting and scene.

- Three.js r187, native WebGPU compute, four instanced faceted geometry groups.
- Quest light: 8,000; balanced: 24,000; high: 60,000; full density: 150,000.
- Separate immersive-ar alpha-blend and immersive-vr opaque sessions. Shared Zelda v13 grips and stick mapping. No artificial floor or gravity.
- Two trigger-controlled finite light beams; particles repel, tumble and spring toward their original positions. Desktop mouse preview.
- Quality and environment changes reload the page to avoid overlapping GPU allocations. GPU device loss is surfaced. No silently substituted WebGL renderer.
- No stereo screen-space bloom, depth-of-field, shadow maps, portals or multiscene effects. Those were intentionally excluded in V1.0. Full density describes fragment count, not fidelity to the original.
- Callback FPS is not a GPU benchmark or proof of headset refresh rate.
- Hardware validation pending. Begin at 8,000, then test 24,000 and above only if comfortable. Use headset system exit controls if needed.

Query parameters: mode=ar|vr, quality=quest|balanced|high|ultra, palette=warm|red|white.

## Preserved baseline — 27 November 2026

The owner reported that V1.0 works successfully. Individual quality/environment tests and device were not specified in the feedback; no independent hardware testing is claimed. The exact working source is pinned at commit `7012380f8a6e9763efaccf3c69bd2564b2b01048`. `presets.json` records all original GPU, environment and palette settings and source blob identifiers. This snapshot is documentation only: the executable code and shared controls remain unchanged. Future experiments must use a separate version folder.
