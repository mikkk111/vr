import * as THREE from 'three/webgpu';
// Fixed angular texture. Scene.background is rendered at the far plane by
// Three r187 with a direction vector (w=0), eliminating translation/parallax.
export function makeCosmos(){
  const w=4096,h=2048,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.fillStyle='#020308';ctx.fillRect(0,0,w,h);
  let state=0x935721ab;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  const glow=(x,y,rx,ry,angle,colour,alpha)=>{
    for(const shift of [-w,0,w]){
      ctx.save();ctx.translate(x+shift,y);ctx.rotate(angle);ctx.scale(rx,ry);
      const grad=ctx.createRadialGradient(0,0,0,0,0,1);
      grad.addColorStop(0,'rgba('+colour+','+alpha+')');grad.addColorStop(.25,'rgba('+colour+','+(alpha*.42)+')');grad.addColorStop(1,'rgba('+colour+',0)');
      ctx.fillStyle=grad;ctx.fillRect(-1,-1,2,2);ctx.restore();
    }
  };
  // Diffuse, irregular Milky Way-like band, below the brightness of the glass.
  const latitude=x=>h*(.49+.17*Math.sin(x/w*2*Math.PI+.8));
  for(let i=0;i<120;i++){
    const x=random()*w,y=latitude(x)+(random()-.5)*h*.16;
    glow(x,y,70+random()*230,18+random()*100,.15*Math.cos(x/w*2*Math.PI+.8),i%3===0?'95,90,132':'65,91,140',.016+random()*.019);
  }
  // Faint compact galaxies; fixed at different directions, no animation.
  for(let i=0;i<16;i++){
    const x=random()*w,y=h*(.16+random()*.68),angle=random()*Math.PI,r=8+random()*25;
    glow(x,y,r,r*(.24+random()*.33),angle,'125,143,170',.085);
    glow(x,y,r*.22,r*.12,angle,'190,178,158',.12);
  }
  // Uniform spherical distribution via sin(latitude), plus a sparse galactic band.
  const colours=['159,177,205','196,207,225','206,193,176','140,166,212'];
  for(let i=0;i<34000;i++){
    const x=random()*w;
    const y=i<26000?Math.acos(2*random()-1)/Math.PI*h:Math.max(2,Math.min(h-2,latitude(x)+(random()+random()-1)*h*.19));
    const strength=Math.pow(random(),3.2),alpha=.12+strength*.55;
    const r=.34+strength*.63,colour=colours[Math.floor(random()*colours.length)];
    ctx.fillStyle='rgba('+colour+','+alpha+')';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    if(strength>.97)glow(x,y,2.6,2.6,0,colour,.20);
  }
  const tex=new THREE.CanvasTexture(canvas);
  tex.mapping=THREE.EquirectangularReflectionMapping;tex.colorSpace=THREE.SRGBColorSpace;
  tex.generateMipmaps=true;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;
  return tex;
}
