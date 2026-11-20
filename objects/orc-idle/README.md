# Orc Idle — Free Pose v3 (20 November 2026)

**Site:** https://mikkk111.github.io/vr/objects/orc-idle/

**Model:** `objects/orc-idle/assets/Orc Idle.fbx` (hosted and automatically loaded; local file upload is still supported).

## Latest correction

The earlier v2 pose layer had **three separate and harmful constraints**:

1. `t.offset.copy(desired).sub(t.baseLocal).clampLength(0,2.0)` stopped each end-effector offset after two FBX-local units, even though the source mesh can have arbitrary unit scale.
2. `maxAngles()`, per-axis `JOINT_LIMITS`, and quaternion caps limited the reachable directions of arms, legs and head.
3. Knees and elbows could be projected onto a single calibrated axis during manual rotation, interfering with free limb posing.

**v3 removes all three.** Target offsets are stored in original model coordinates with no artificial distance cap. The analytical two-bone IK solver works in WORLD metres, rotates its joints through the full orientation range, and only clamps an end-effector target to the true reachable distance of its existing bones. It NEVER changes bone lengths or skin weights.

Each bone has free pitch, yaw and roll controls, with UI sliders covering −180° to +180° per axis (the complete Euler orientation range). Controller rotation adjusts orientation independently from physical controller translation and pointing direction.

## Using Quest 3 controllers

- **Side grip:** Original Zelda VR v13 whole-character grab, remote aiming, wrist rotation, joystick movement, linear two-hand resizing 10%–350%, and frozen position when released. The shared physics engine remains unchanged.
- **Trigger:** Aim directly at the visible skin (no coloured balls), hold trigger, and physically move the controller or change its pointing direction to move the selected hand, foot, elbow, knee or head. Release trigger to retain the new target offset. Twist wrist while holding trigger to change the joint's orientation.
- **Desktop:** Click the skinned arm, leg, hand, foot or head. Drag to change position; Shift+drag moves depth. Select any existing bone in the dropdown for free three-axis rotation.
- **Animation:** Source `AnimationMixer` continues every frame, then the IK and freely set local bone rotations are applied as additive posing. No animation pause occurs automatically.

## Architecture

- `index.html`: UI with file upload, force-reload hosted model, free posing sliders and WebXR button.
- `app.js`: source FBX loading, world-model controller integration, live animation loop; versioned source imports.
- `pose-ik.js`: skinned-mesh ray selection, XR and mouse movement, scale-independent target offset, animation overlay.
- `ik-solver.js`: unrestricted two-bone endpoint targeting with real bone lengths and no arbitrary joint angle limits.
- `../../shared/zelda-v13/physics-grab.js`: unmodified shared Quest grab controller.

## Verification boundaries

The exact uploaded FBX binary in GitHub has blob SHA `0170ce867720cc60bad9b02c66e3f1f07e259882`. Its inspected skeleton contains `LeftArm → LeftForeArm → LeftHand` and `LeftUpLeg → LeftLeg → LeftFoot`, with right-side equivalents. JavaScript and DOM-interface checks are source-level only; no physical Quest 3 verification is claimed.

The app does not simulate self-collision, tissue constraints or automatic foot planting. Some goals are geometrically unreachable unless the original bone lengths are stretched; this editor intentionally preserves source bone lengths.