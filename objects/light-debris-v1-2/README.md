# Light & Debris V1.2 — Refractive Glass

Derived from V1.1 commit a87c0fb1274820a88725110e1bd3e5b96ac41492. V1.0 and V1.1 remain independently accessible. Original compute force solver, density presets, controller mappings, and V1.1 audio module reused unchanged.

## Optical renderer
- Four convex geometry families use small affine shear. Every optical plane is computed from the actual triangulated geometry and validated against all vertices. Each fragment has its own orientation and optical seed.
- Per-eye camera world position from Three r187; world-space optical basis. Native WGSL runs Snell refraction, Schlick Fresnel, total internal reflection and Beer-Lambert-like attenuation through each fragment. Nearest positive plane intersection gives actual entry-to-exit travel, not screen-space background distortion.
- Surface mode skips internal intersections; Solid mode traces up to two internal interfaces for one central IOR; Prismatic traces three separate wavelengths with up to four interfaces per wavelength. Internal energy remaining at the bounce limit is omitted.
- Stable irregular surface-normal perturbation, glass striae and subtle cloudy-inclusion appearance. These are shader approximations, not volumetric inclusions or individually curved geometry.
- Directional procedural studio illumination and dynamic beam highlights; no scene-wide ray tracing, inter-fragment reflections, caustic projection, live room image sampling or true refraction of passthrough. AR uses alpha compositing with depth writes; transparent instance order can be imperfect. VR uses opaque rendered optical colour.
- No additional render passes or external textures. Same four draw groups; Prismatic can be very GPU-intensive at high density. Start with 8k and Solid. Surface is a lower-cost fallback.
- Shader source reviewed and JS syntax checked; physical headset and actual shader pipeline compilation not verified here.

Parameters: quality=quest|balanced|high|ultra, optics=fast|solid|prism, mode=ar|vr, palette=warm|red|white.
