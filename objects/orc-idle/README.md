# Orc Idle — Quest 3 FBX rig editor v2 (live animation + spatial IK)

**Published source**: `objects/orc-idle/index.html` in `mikkk111/vr`.
**Website path**: https://mikkk111.github.io/vr/objects/orc-idle/
**Model**: local browser import (FBX/GLB). Does not require a model binary on GitHub.

## Version 2 — 20 November 2026

Fixes two original shortcomings:

1. **Spatial end-effector movement**. Quest TRIGGER on green handles now moves the target in full 3D via physical controller position plus remote pointing. Desktop drag moves the marker in the camera plane; Shift-drag adjusts depth. For left/right wrists and ankles, a two-bone analytical IK solver rotates shoulder/hip and elbow/knee, keeping bone lengths intact. Elbow/knee markers also support one-bone repositioning. Head uses `Spine2 → Neck → Head`.
2. **Nonstop idle animation**. Selecting/dragging bones no longer calls the animation pause function. Every frame, the system restores edited bones' base rig state, advances the imported FBX AnimationMixer, computes each animated target position and adds stored avatar-local target offsets, then solves the pose. This keeps the authored animation playing under the adjusted posture rather than locking the entire clip.

Other bones remain available through limited rotation sliders, and Quest wrist twist on their trigger markers. The explicit **Pause animation** button still works. Posing does not unpause a user-paused clip.

## Architecture and constraints

- `app.js` owns model loading, Mixer and scene setup; calls `poseLayer.prepareFrame()`, then `mixer.update(dt)`, then `poseLayer.update()`.
- `pose-ik.js` owns Quest select/TRIGGER and desktop dragging, local-space target offsets, skeletal pose overlay and markers.
- `ik-solver.js` performs position-based two-bone analytic IK with natural poles calibrated from the imported FBX limb geometry; one-bone aiming; joint rotation caps and hinge projection.
- `pose-controls.js` is retained as the former v1 experimental implementation, but **is no longer imported**.
- `../../shared/zelda-v13/physics-grab.js` remains untouched, preserving the original v13 whole-model grip, distant aiming, linear 10%–350% two-handed scale, position freeze and thumbstick controls.

**Joint limits are approximations**, not a collision-aware human biomechanics simulation. Reach targets are clamped to chain lengths, with rotations limited to a fraction of a turn; no bone translation or skin-weight changes occur. Rigging cannot bend missing fingers (the inspected FBX has only index-finger chains).

## Technical verification and limits

Original attached file was inspected as binary FBX 7700, 31,838,656 bytes, with 34 Model records (one mesh and 33 limb/model nodes), one geometry, and one AnimationStack in the FBX binary hierarchy. Rig hierarchy includes `Spine2→Neck→Head`, `LeftArm→LeftForeArm→LeftHand`, `LeftUpLeg→LeftLeg→LeftFoot`, and their right-side equivalents.

Live GitHub source and JS syntax checks were performed, including link paths, page IDs, controller import and manifest. **The app has not been tested on physical Quest 3 hardware, nor has live in-headset motion been verified.** An FBX file imported directly from a user's device is not persistently uploaded to the server, and GitHub Pages publication may lag Git commit availability.

## Usage

1. Open HTTPS page on Quest Browser or desktop; upload `Orc Idle.fbx` with the file chooser.
2. Let the idle clip play. To move an arm in VR, point at the **green hand marker**, hold the trigger and move the controller in any direction. Release to keep the position while the clip continues.
3. Do the same at a green foot, elbow, knee or head marker. Use purple/amber markers for constrained wrist-twist rotations.
4. For desktop, click and drag markers, Shift-drag for depth, select bones and tweak sliders.
5. **Reset joints** removes target offsets and rotations; **Reset view + character** also repositions the whole model and restarts its animation.
