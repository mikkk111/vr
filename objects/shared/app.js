// Shared model-only brightness control for object pages; no change to XR passthrough or controller engine.
export function createModelBrightnessControl({slider,valueLabel}={}) {
  const originals=new WeakMap();
  let currentRoot=null;
  let brightness=1;
  const applyMaterial=material=>{
    if(!material || typeof material!=='object')return;
    let base=originals.get(material);
    if(!base){
      base={
        color:material.color?.clone()||null,
        emissive:material.emissive?.clone()||null,
      };
      originals.set(material,base);
    }
    if(base.color)material.color.copy(base.color).multiplyScalar(brightness);
    if(base.emissive)material.emissive.copy(base.emissive).multiplyScalar(brightness);
  };
  const apply=()=>{
    if(!currentRoot)return;
    currentRoot.traverse(part=>{
      if(!part.isMesh)return;
      for(const mat of (Array.isArray(part.material)?part.material:[part.material]))applyMaterial(mat);
    });
  };
  const setBrightness=raw=>{
    const n=Number(raw);
    const percentage=Number.isFinite(n)?Math.max(0,Math.min(100,n)):100;
    brightness=percentage/100;
    if(slider)slider.value=String(percentage);
    if(valueLabel)valueLabel.textContent=Math.round(percentage)+'%';
    apply();
  };
  if(slider)slider.addEventListener('input',()=>setBrightness(slider.value));
  setBrightness(slider?.value??100);
  return {attachModel(root){currentRoot=root;apply();},setBrightness};
}
