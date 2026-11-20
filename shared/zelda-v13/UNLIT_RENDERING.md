# Texture-only, unlit rendering — shared Zelda v13 Quest 3 environment

From 20 November 2026, this template and its six active loader pages use no artificial scene lights. Imported models receive in-memory THREE.MeshBasicMaterial copies of their authored base-colour texture maps and factors, including alpha/opacity, vertex colours and sidedness. Texture UVs/transforms, original model files, geometry, rigging, animation and Quest grab/zero-gravity controls remain unchanged. Imported light nodes are discarded. WebGL output is sRGB and tone mapping is disabled.

The Heidi brightness slider remains a base-colour multiplier, not a light.

This cannot remove shadows/highlights already baked into a JPEG/PNG. Special custom material shaders and physically transmissive glass are not reproducible in this strictly unlit mode. No headset hardware test is implied by source checks.
