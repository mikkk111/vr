# Paintable2 — skinned Meta Quest 3 figure

Updated with a 24-bone, Y-up humanoid rig, from the user's Paintable2.glb.

- Current rigged model: `assets/Paintable2-rigged.glb`
- Original preserved: `assets/Paintable2.glb`
- Original source SHA-256: `573c31b2309b0f5555ac8a300063f5aded1b55fea24e91c741ecfd8fea15c274`
- Rigged model SHA-256: `6b4cc08e1aa5440a9bbbdb548be3eb876adf9e5bd73a8778a7598c45bb7c0921`
- Source geometry topology preserved: 255,147 indexed per-material vertex records / 196,405 triangles
- Nine existing materials and ten embedded textures retained, all UVs and face indices preserved
- GLTF skinning: 24 humanoid bones, inverse-bind matrices, up to four normalized skin influences per vertex
- Original Z-up orientation rotated into Y-up (front +Z) for Three.js/WebXR
- Trigger selects/poses wrist, elbow, knee, ankle, head, neck, chest and pelvis handles
- Side grips continue using unchanged `../../shared/zelda-v13/physics-grab.js`
- Pose bounds are preliminary engineering limits, not medically validated joint envelopes
- Structural skinning and synthetic arm deformation tested offline; real Quest 3/controller testing not performed

This is a **procedural first-pass anatomical skin rig**, not manual weight-painting in Blender. Further visual deformation cleanup may be needed around shoulders, elbows, hips and knees.
