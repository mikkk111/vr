// Paintable2 pose controls — Quest triggers manipulate skinned joints;
// Zelda v13 SIDE GRIPS remain in the unchanged shared physics-grab.js.
import * as THREE from 'three';

const DEFINITION = [
  ['LeftHand', 'LeftUpperArm', 'LeftForeArm', 'LeftHand', 0x5adfff],
  ['RightHand', 'RightUpperArm', 'RightForeArm', 'RightHand', 0x5adfff],
  ['LeftFoot', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 0x5adfff],
  ['RightFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 0x5adfff],
  ['LeftForeArm', 'LeftUpperArm', null, 'LeftForeArm', 0xffa753],
  ['RightForeArm', 'RightUpperArm', null, 'RightForeArm', 0xffa753],
  ['LeftLeg', 'LeftUpLeg', null, 'LeftLeg', 0xffa753],
  ['RightLeg', 'RightUpLeg', null, 'RightLeg', 0xffa753],
  ['Head', 'Neck', null, 'Head', 0xc79aff],
  ['Neck', 'Spine2', null, 'Neck', 0xc79aff],
  ['Spine2', 'Spine1', null, 'Spine2', 0xc79aff],
  ['Hips', 'Hips', null, 'Hips', 0x8fffc8]
];
const capRadians = {
  LeftUpperArm: 2.7, RightUpperArm: 2.7,
  LeftForeArm: 2.65, RightForeArm: 2.65,
  LeftUpLeg: 1.9, RightUpLeg: 1.9,
  LeftLeg: 2.4, RightLeg: 2.4,
  Neck: 0.75, Head: 0.72,
  Spine1: 0.42, Spine2: 0.42, Hips: 0.65
};
const tmpQ = new THREE.Quaternion(), pQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3(), forward = new THREE.Vector3();
const world = bone => bone.getWorldPosition(new THREE.Vector3());
function setWorldTurn(bone, from, to, original) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  bone.updateWorldMatrix(true, true);
  const current = bone.getWorldQuaternion(new THREE.Quaternion());
  const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const desired = delta.multiply(current);
  const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(pQ).clone() : new THREE.Quaternion();
  const local = parentWorld.invert().multiply(desired).normalize();
  const max = capRadians[bone.name] ?? 2.8;
  const bind = original.get(bone.name) || new THREE.Quaternion();
  const angle = bind.angleTo(local);
  if (angle > max) local.copy(bind).slerp(local, max / angle);
  bone.quaternion.copy(local);
  bone.updateWorldMatrix(true, true);
}
function twoBoneTarget(a, b, c, goal, originals, pole) {
  a.updateWorldMatrix(true, true);
  let pa = world(a), pb = world(b), pc = world(c);
  const l1 = pa.distanceTo(pb), l2 = pb.distanceTo(pc);
  if (l1 < 1e-5 || l2 < 1e-5) return;
  const direction = goal.clone().sub(pa);
  const d0 = direction.length();
  if (d0 < 1e-5) return;
  direction.normalize();
  const d = THREE.MathUtils.clamp(d0, Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
  const centre = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, l1 * l1 - centre * centre));
  let bend = pb.clone().sub(pa).addScaledVector(direction, -pb.clone().sub(pa).dot(direction));
  if (bend.lengthSq() < 1e-5) {
    bend.copy(pole).addScaledVector(direction, -pole.dot(direction));
  }
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
  bend.normalize();
  const elbow = pa.clone().addScaledVector(direction, centre).addScaledVector(bend, height);
  setWorldTurn(a, pb.sub(pa), elbow.clone().sub(pa), originals);
  a.updateWorldMatrix(true, true);
  pb = world(b); pc = world(c);
  const wrist = pa.clone().addScaledVector(direction, d);
  setWorldTurn(b, pc.sub(pb), wrist.sub(pb), originals);
}

export function createPaintablePose({ renderer, scene, avatar, camera, onStatus }) {
  const bones = new Map(), originals = new Map();
  avatar.traverse(o => {
    if (o.isBone) { bones.set(o.name, o); originals.set(o.name, o.quaternion.clone()); }
  });
  const hasSkin = [];
  avatar.traverse(o => { if (o.isSkinnedMesh && o.skeleton?.bones?.length) hasSkin.push(o); });
  if (!hasSkin.length || !bones.has('Hips')) {
    throw new Error('This character needs a skinned skeleton (Paintable2-rigged.glb).');
  }
  for (const row of DEFINITION) {
    for (const name of row.slice(0, 4)) if (name && !bones.has(name)) {
      throw new Error(`Missing joint ${name} in Paintable2 rig`);
    }
  }

  const geometry = new THREE.SphereGeometry(0.016, 10, 8);
  const handles = DEFINITION.map(([name, upper, lower, end, color]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.87, depthTest: false }));
    mesh.renderOrder = 60; mesh.visible = false; scene.add(mesh);
    return { name, upper: bones.get(upper), lower: lower ? bones.get(lower) : null,
      end: bones.get(end), mesh, bone: bones.get(name) };
  });
  const xrControllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const active = new Map();
  let enabled = true, pointer = null, hover = null, mouseState = null;
  const cPos = new THREE.Vector3(), cQuat = new THREE.Quaternion(), ray = new THREE.Vector3();
  const getAim = controller => new THREE.Vector3(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const solve = (handle, goal) => {
    if (handle.lower) {
      twoBoneTarget(handle.upper, handle.lower, handle.end, goal, originals,
        new THREE.Vector3(0, 0, 1));
    } else if (handle.name === 'Hips') {
      // Pelvis remains part of whole-body rig; steer hips only gently to prevent tearing legs.
      const anchor = world(handle.bone);
      const v = goal.clone().sub(anchor);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.clamp(v.z * 0.8, -0.3, 0.3), 0,
        THREE.MathUtils.clamp(-v.x * 0.8, -0.3, 0.3)));
      handle.bone.quaternion.copy(originals.get('Hips')).multiply(q);
    } else {
      // Elbows, knees, head and spine: steer their proximal bone toward the handle.
      const base = world(handle.upper);
      const current = world(handle.bone);
      setWorldTurn(handle.upper, current.sub(base), goal.clone().sub(base), originals);
    }
  };
  function selectXR(controller, index) {
    if (!enabled || active.has(index)) return;
    avatar.updateWorldMatrix(true, true);
    controller.getWorldPosition(cPos);
    const aim = getAim(controller);
    let best = null, bestScore = Infinity;
    for (const h of handles) {
      const pos = world(h.bone);
      const close = pos.distanceTo(cPos);
      const delta = pos.clone().sub(cPos);
      const d = delta.dot(aim);
      const perpendicular = delta.clone().addScaledVector(aim, -d).length();
      // Near-hand selection first; otherwise pick a targeted joint along the ray.
      const score = close < 0.30 ? close : d > 0 && d < 3.5 && perpendicular < 0.11 ? 1 + perpendicular + d * .03 : Infinity;
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (!best) { onStatus?.('Trigger missed a joint. Aim at a cyan wrist/ankle or amber elbow/knee point.'); return; }
    const originalPosition = world(best.bone);
    active.set(index, {
      handle: best, controller, start: cPos.clone(), startAim: aim,
      startGoal: originalPosition, remote: bestScore > 1,
      rayDistance: originalPosition.distanceTo(cPos)
    });
    best.mesh.visible = true;
    onStatus?.(`${best.name} selected. Move controller, then release trigger to keep the pose. Zelda side grips still move the whole model.`);
  }
  function releaseXR(index) { active.delete(index); }
  const events = xrControllers.map((controller, index) => {
    const start = () => selectXR(controller, index);
    const end = () => releaseXR(index);
    controller.addEventListener('selectstart', start);
    controller.addEventListener('selectend', end);
    return { controller, start, end };
  });
  function pixelDistance(h, clientX, clientY) {
    const p = world(h.bone).project(camera);
    if (p.z < -1 || p.z > 1) return Infinity;
    return Math.hypot((p.x + 1) * innerWidth * .5 - clientX, (1 - p.y) * innerHeight * .5 - clientY);
  }
  function nearestPixel(clientX, clientY) {
    let best = null, score = 25;
    for (const h of handles) {
      const d = pixelDistance(h, clientX, clientY);
      if (d < score) { score = d; best = h; }
    }
    return best;
  }
  const onPointerMove = event => {
    if (!enabled || renderer.xr.isPresenting) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!mouseState) return;
    const screen = new THREE.Vector2(2 * event.clientX / innerWidth - 1, 1 - 2 * event.clientY / innerHeight);
    const rc = new THREE.Raycaster(); rc.setFromCamera(screen, camera);
    const hit = new THREE.Vector3();
    if (rc.ray.intersectPlane(mouseState.plane, hit)) solve(mouseState.handle, hit);
  };
  const onPointerDown = event => {
    if (!enabled || event.button !== 0 || renderer.xr.isPresenting || event.target?.closest?.('button, input, #panel')) return;
    avatar.updateWorldMatrix(true, true);
    const h = nearestPixel(event.clientX, event.clientY);
    if (!h) return;
    const start = world(h.bone);
    const normal = camera.getWorldDirection(new THREE.Vector3());
    mouseState = {handle: h, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start)};
    controlsDummy();
    event.preventDefault();
  };
  // Handled by the host app by stopping OrbitControls on desktop while a joint is dragged.
  let setDesktopDragging = () => {};
  const controlsDummy = () => setDesktopDragging(true);
  const onPointerUp = () => { if (mouseState) setDesktopDragging(false); mouseState = null; };
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  const instance = {
    setDesktopDragging(fn) { setDesktopDragging = fn; },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) { active.clear(); mouseState = null; for (const h of handles) h.mesh.visible = false; }
    },
    update() {
      if (!enabled) return;
      avatar.updateWorldMatrix(true, true);
      if (renderer.xr.isPresenting) {
        for (const state of active.values()) {
          const pos = state.controller.getWorldPosition(new THREE.Vector3());
          const goal = state.startGoal.clone().add(pos.sub(state.start));
          if (state.remote) goal.add(getAim(state.controller).sub(state.startAim).multiplyScalar(state.rayDistance * .55));
          solve(state.handle, goal);
        }
      }
      for (const h of handles) {
        h.mesh.position.copy(world(h.bone));
        if (renderer.xr.isPresenting) {
          h.mesh.visible = activeHas(h) || xrControllers.some(c => {
            const pos = c.getWorldPosition(new THREE.Vector3());
            const close = pos.distanceTo(h.mesh.position);
            if (close < .30) return true;
            const aim = getAim(c), delta = h.mesh.position.clone().sub(pos);
            const along = delta.dot(aim);
            return along > 0 && along < 3.5 && delta.addScaledVector(aim, -along).length() < .05;
          });
        } else {
          h.mesh.visible = Boolean((mouseState?.handle === h) || (pointer && pixelDistance(h, pointer.x, pointer.y) < 30));
        }
      }
    },
    resetPose() {
      active.clear(); mouseState = null;
      for (const bone of bones.values()) {
        const q = originals.get(bone.name);
        if (q) bone.quaternion.copy(q);
      }
      avatar.updateWorldMatrix(true, true);
      onStatus?.('Limb pose reset. Trigger joints to reposition arms and legs.');
    },
    dispose() {
      active.clear();
      for (const {controller, start, end} of events) {
        controller.removeEventListener('selectstart', start);
        controller.removeEventListener('selectend', end);
      }
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      for (const h of handles) { scene.remove(h.mesh); h.mesh.material.dispose(); }
      geometry.dispose();
    },
    boneCount: bones.size
  };
  function activeHas(h) { return [...active.values()].some(s => s.handle === h); }
  return instance;
}