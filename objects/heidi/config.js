// Source GLB already has a Y-up scene hierarchy; preserve its node transforms.
// Relative scale in source is ~0.98 unit tall, without verified real-world metres.
export const OBJECT_CONFIG = Object.freeze({
  modelUrl: './assets/heidi.glb',
  sourceUpAxis: 'Y',
  fitToView: true,
  targetLongestSideMetres: 1.67,
  initialYawRadians: 0,
});
