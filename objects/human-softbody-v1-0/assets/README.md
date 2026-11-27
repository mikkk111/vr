# Human Soft Body V1.0 — experimental prototype

Original user-supplied GLB: 3,511,396 bytes, SHA-256 202e5f68a3152b15cdb6fd57c009e138e1d9cfeb7fd4e51c5b4f388a74e32c4b.
Prepared character-softbody-v1.glb: 6,032,536 bytes, SHA-256 ab24354e86e81c76b560c0d898ee05b4437baefffe6ebfed8fea1012e5f3811d.
Original GLB binary data and original textured surface retained. Extra arrays in the GLB BIN chunk describe a 55 mm voxel-derived tetrahedral cage: 1,973 nodes, 7,236 tetrahedra, 2,831 actual skin sample points. Cage is approximate, not segmented anatomy. Render vertices use eight-corner trilinear interpolation. Source mesh has open boundaries/nonmanifold issues; the cage is a separate closed cell complex.

- Rapier 0.21 articulated rigid skeleton, native elbow/knee hinges and limited parent-frame quaternion rotation vectors elsewhere; 22 bones. No separately rigged fingers.
- CPU XPBD edge, volume and bone-tether constraints, fixed 120 Hz substeps. Sampled skin self-contact (spatial hash), floor contact, controller sphere pressure, tangential friction, approximate bounded reaction impulses. Not a complete OGC/CCD surface solver; fine geometry can still intersect, and the two solvers are only loosely coupled. Inverted tetrahedra are counted, not guaranteed impossible.
- Native WebGPU rendering, original surface texture, Zelda v13 whole-model grip controls unchanged. Gravity acts on the internal ragdoll, not the shared anchor. Invisible physical room-level floor.
- Triggers select a limb and apply a spring force, or apply a spherical pressure contact in Press mode. A/X toggles mode; two independent triggers. Start / drop, pause, reset. Desktop right drag orbits, left drag manipulates, wheel changes held depth.
- Approximate joint limits and tissue stiffness, not measured human material constants.

Testing: original GLB structural inspection, cage orientation/embedding checks, JS source parse, synthetic tetrahedron volume/floor test. Full-character dynamics, performance, browser dependency and headset tests remain outstanding. No promise of penetration-free motion.
Research: Macklin et al. XPBD (2016), Macklin and Müller Stable Neo-Hookean (2021, future material model), Chen et al. OGC (2025, future full-surface collision solver). https://graphics.cs.utah.edu/research/projects/ogc/

Asset publication pending: place prepared GLB at assets/character-softbody-v1.glb. Local file picker works with the prepared GLB; the original raw GLB has no tissue cage. Automatic loading is attempted when the hosted file exists.
