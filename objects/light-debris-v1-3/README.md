# Light & Debris V1.3 — Spatial Rain

Built from V1.2 (ef342e78573480c03ec4fc1a36bc20053ffe8766); the glass shader is imported directly from that version, with its geometry, force solver, presets and Zelda v13 controls preserved. V1.2 and earlier remain accessible.

Audio redesign:
- Entirely original procedural rain, composed of broadband noise and short droplet transients. Removed the drone, crystal chimes and electronic laser oscillators.
- Eight independent HRTF spatial sources distributed through the cloud's local octants. Each follows the cloud world transform and measured fragment centroid, including whole-object translation, rotation and scale. Head-tracked listener updates in XR. No head-locked ambient bed.
- 512 GPU samples of actual position and speed at up to 4 Hz update regional density and movement. Cloud rain brightens/intensifies with GPU fragment movement and beam proximity. One asynchronous readback in flight; 8192 bytes per readback maximum. If readback fails, eight fixed local cloud regions still follow all whole-object manipulation and beam proximity.
- Two independently positioned higher-pitched rain streams on trigger; if hitting the cloud they emanate from the beam impact location, otherwise controller position. All sound uses the same synthesised rain texture family.
- Fixed 10 persistent voices, four mono loop buffers, no per-fragment audio nodes or transient oscillator allocations. Separate master, cloud rain and fine beam rain gain controls, gentle fades and output compressor. No external audio dependencies.
- Spatial audio works in both AR and dark VR; also desktop preview. Audio is unlocked by the user's click, and muted on session exit.
- JavaScript, deterministic rain buffer and region calculations tested; actual Web Audio output, HRTF perception and Quest performance not tested here.
