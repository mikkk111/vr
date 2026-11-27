# Light & Debris V1.4 — Cosmic Light & Rain

Built from V1.3 commit ca9bad0fe355f8e0e0022c978c412d8b19e58703. Prior versions preserved. Spatial rain imported directly from V1.3; Zelda v13 shared controls, original compute solver and presets retained.

- Infinite sky: deterministic 4096×2048 equirectangular background with 34,000 tiny stars, faint galactic band and 16 compact glow patches. Native Three r187 background implementation projects directions with w=0 and far-plane depth. No object anchor, scaling, translation parallax or per-eye near-field disparity. Static angular directions; no flicker. AR stays transparent; optional checkbox disables the sky. Default is immersive VR and red/blue light palette.
- The two controller glow markers now have visible solid emissive sphere cores, whose radius matches the optical emitter. Their halo and original beam force/aim logic are preserved.
- Native WGSL finite sphere radiance uses the emitter angular radius at each optical surface; each reflected/refracted ray can see the coloured disc, with soft edge and roughness lobe. A low-energy approximate scattering term follows projected solid angle and incidence, to illuminate nearby pieces outside sharp specular directions. Multiple lamps add in linear colour. Ray exit point light vectors account for actual internal path and world scale; size-dependent absorption scales with the cloud.
- Independent light power slider and all previous light palettes plus red/blue. Power zero disables emitted lighting, not the grab/beam force. Marker core remains faintly visible as an interaction indicator.
- The sky is visual only: previous procedural studio reflections retained, not an HDR sky capture. No scene-wide ray tracing, mutual occlusion, inter-fragment bounces, or projected caustics. The rough scatter is an artistic approximation rather than full radiative transport.
- No extra per-frame compute dispatch for lighting or sky. One native background draw and two small core spheres. Texture generated once; hardware timing and shader compilation not verified on Quest.

Parameters: mode=ar|vr, quality=quest|balanced|high|ultra, optics=fast|solid|prism, palette=ruby|warm|red|white, space=off|on.
