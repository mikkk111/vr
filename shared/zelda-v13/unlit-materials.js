import * as THREE from 'three';

// Unlit display only; imported model geometry, UVs, textures and rig are unchanged.
export function prepareUnlitModel(root) {
  if (!root?.isObject3D) throw new TypeError('Expected an imported Object3D');
  const materials = new Map(), embeddedLights = [];
  let meshCount = 0;
  const asUnlit = original => {
    if (!original) return original;
    if (materials.has(original)) return materials.get(original);
    // Rebuild even existing basic materials to discard lightmaps and envmaps.
    const material = new THREE.MeshBasicMaterial({
      name: original.name || '',
      color: original.color?.clone() ?? new THREE.Color(0xffffff),
      map: original.map ?? original.emissiveMap ?? null,
      alphaMap: original.alphaMap ?? null,
      opacity: original.opacity ?? 1,
      transparent: Boolean(original.transparent),
      alphaTest: original.alphaTest ?? 0,
      alphaHash: Boolean(original.alphaHash),
      alphaToCoverage: Boolean(original.alphaToCoverage),
      side: original.side ?? THREE.FrontSide,
      vertexColors: Boolean(original.vertexColors),
      wireframe: Boolean(original.wireframe),
      depthTest: original.depthTest ?? true,
      depthWrite: original.depthWrite ?? true,
      colorWrite: original.colorWrite ?? true,
      blending: original.blending ?? THREE.NormalBlending,
      premultipliedAlpha: Boolean(original.premultipliedAlpha),
      polygonOffset: Boolean(original.polygonOffset),
      polygonOffsetFactor: original.polygonOffsetFactor ?? 0,
      polygonOffsetUnits: original.polygonOffsetUnits ?? 0,
      toneMapped: false,
      fog: false
    });
    material.visible = original.visible ?? true;
    material.userData = { ...original.userData };
    materials.set(original, material);
    return material;
  };
  root.traverse(node => {
    if (node.isLight) { embeddedLights.push(node); return; }
    if (!node.isMesh) return; // Includes SkinnedMesh (skeleton stays intact).
    meshCount++;
    node.castShadow = false;
    node.receiveShadow = false;
    node.material = Array.isArray(node.material)
      ? node.material.map(asUnlit)
      : asUnlit(node.material);
  });
  for (const light of embeddedLights) light.parent?.remove(light);
  return { meshCount, materialCount: materials.size, removedLights: embeddedLights.length };
}
