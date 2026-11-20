# Orc Idle — local FBX character editor (v1.0)

Object URL (GitHub Pages, if Pages is enabled): https://mikkk111.github.io/vr/objects/orc-idle/

## Model loading

- Open the page over HTTPS and choose **Upload your FBX / GLB**.
- The page intentionally has **no bundled or hosted model**. The user uploads from their own Quest Browser or desktop device on every reload. The model bytes are loaded into in-browser memory with a blob URL; this app does not POST them to GitHub or another server.
- Tested input inspection: `Orc Idle.fbx` is 31,838,656 bytes, binary FBX version 7700, with one skinned geometry, embedded base-colour JPEG, one Mixamo animation stack, and a 33-bone humanoid rig (34 model nodes including the mesh).
- Three.js FBXLoader loads the model, its embedded materials and animation tracks from the local file. Other FBX exports with external sidecar textures may need a self-contained GLB.
- Model dimensions are fitted *uniformly* to 1.72 metres for comfortable initial handling. Original hierarchy, skin weights, proportions and texture are not rewritten.

## Controls

**Whole model:** reference `../../shared/zelda-v13/physics-grab.js`, unchanged. Side squeeze grips grab near or far; physical movement, aiming direction and wrist twist steer the whole character. Two side grips resize linearly from 10% to 350%. Left stick horizontal moves model sideways; either stick vertical changes depth. Right stick horizontal snaps 30° for viewpoint when released, or object yaw when held. Release freezes pose, orientation, position and size. No virtual floor, gravity or scenery.

**Individual bones:** Quest **trigger** selects a coloured joint handle; while held, controller rotation **and physical movement** adjust the selected joint, with limits. Trigger release preserves the chosen angle. Desktop: click and drag a joint point, or use selected bone and angle sliders. Both controller triggers can edit different bones without taking over the side-grip engine. Manual editing pauses the animation; Play resumes it.

**Animation:** original FBX clip, automatically played on import, with pause/play, clip selector (if multiple clips) and speed slider. Manual offsets are applied after the AnimationMixer, using the same skinned source hierarchy. Clear them using **Reset joints**. **Reset view + character** restarts the clip and resets the model transform and pose.

## Constraint coverage

Single-axis hinges for elbows, knees, index-finger segments and toes; constrained multi-axis pitch/yaw/roll plus a total-angle cap for other joints. These are practical animation/pose-editing limits in the actual source rig's local basis. They do **not** simulate tendons, exact biomechanical range, inverse kinematics, self-collision, or tissue deformation. The uploaded rig has index-finger chains only; individual thumbs and other finger chains cannot be controlled.

## Change isolation / validation

- Shared Zelda v13 `physics-grab.js` stays untouched.
- The original objects and their files remain intact; only `objects/orc-idle/*`, `objects/manifest.json` and the catalogue's local-upload status wording are changed.
- Use HTML/JavaScript source checks and GitHub file reads as static verification. **A published URL, browser FBX render, WebXR session and physical Quest 3 hardware performance require separate real testing.**
- v1.0 (20 November 2026): local FBX import, embedded animation playback, joint markers, constrained joint rotation, XR trigger and controller-motion posing.
