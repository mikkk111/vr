# Light & Debris V1.6 — Silent Space

V1.5 visual modules referenced unchanged. Only continuous cloud rainfall removed, including its eight voices and GPU audio sampling; original two directional trigger voices and volume controls preserved. Silence when neither trigger is active, with the original short release fade. Quest hardware test pending.

# Light & Debris V1.5 — Nebula & Milky Way

Built from V1.4 commit 53cc42619084a62107c4acbd4bf508c2cad08d4f. V1.3 rain, Zelda v13 controls, original fragment dynamics and quality presets preserved.
- Seven overlapping independently animated translucent wisps per controller, smooth procedural fractal noise and feathered boundaries; no opaque sphere. Stereo sprite geometry, not full volumetric ray marching.
- Soft anisotropic Gaussian emitter instead of spherical disc, retaining optical exit geometry, Fresnel, refraction and mixing. Emitter radius breathes with mist. Scatter retuned for larger emitter; approximate, not exact volumetric transport.
- Photographic 360° sky ESO/S. Brunier, eso0932a, 6000×3000 public image, CC BY 4.0. Source https://www.eso.org/public/images/eso0932a/ ; license https://creativecommons.org/licenses/by/4.0/ . Display brightness adjusted. Primary remote mirror pinned to cwtf/wiki-globe commit 8fbf260a7fc5be6c8e641e7cb1851479f5b23539, blob 05fc323684c193d0e1838f098a851bdb74c929ed. Official ESO CDN secondary. Binary import unavailable, so image is not stored locally. Loader checks aspect ratio, canvas readability, GPU texture limit and timeout; explicit procedural fallback. No fictional galaxies added to photo.
- Direction-only far-plane background, no translation/stereo parallax or anchor scaling. Static long-exposure composite, not live or photometrically calibrated sky. Brightness .72, fallback .48. AR sky absent. No star twinkle.
- No extra compute dispatch; 14 small sprites. JavaScript syntax and shader template generation checked; actual GPU compilation, sky CORS and headset performance not verified in a live browser.
