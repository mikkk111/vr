// Orc Idle: attempt to load the original rigged FBX from this project's
// published assets directory. If it hasn't been pushed yet, app.js keeps the
// local browser-upload button available without an error scene.
export const OBJECT_CONFIG = Object.freeze({
  modelUrl: './assets/Orc%20Idle.fbx',
  fitToView: true,
  targetLongestSideMetres: 1.72,
  initialYawRadians: 0,
});
