import * as THREE from 'three/webgpu';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function hash(x,y){const a=Math.sin(x*127.1+y*311.7+19.13)*43758.5453123;return a-Math.floor(a);}
function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y);let u=x-ix,v=y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);const a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1);return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;}
function fbm(x,y){let sum=0,amp=.52;for(let i=0;i<4;i++){sum+=amp*noise(x,y);const nx=1.73*x-1.1*y;y=1.1*x+1.73*y+13.7;x=nx+9.1;amp*=.5;}return sum;}
export function makeMistTexture(){
 const n=192,c=document.createElement('canvas');c.width=c.height=n;
 const ctx=c.getContext('2d'),im=ctx.createImageData(n,n);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const u=(x+.5)/n*2-1,v=(y+.5)/n*2-1,r=Math.hypot(u,v),q=(y*n+x)*4;
  const a=fbm(u*3.5+8,v*3.5+12),b=fbm(u*6+5,v*5+21),warp=r+(a-.45)*.32;
  const edge=clamp((1-warp)*2.2,0,1)*clamp((1-r)*5,0,1);
  const density=edge*Math.exp(-2.2*r*r)*(.16+Math.pow(clamp(a*.73+b*.42,0,1),1.65)*.84);
  im.data[q]=im.data[q+1]=im.data[q+2]=255;im.data[q+3]=Math.round(clamp(density,0,1)*255);
 }
 ctx.putImageData(im,0,0);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}
export function createMist(texture,colour,phase){
 const group=new THREE.Group(),wisps=[];
 for(let i=0;i<7;i++){
  const material=new THREE.SpriteMaterial({map:texture,color:colour,transparent:true,opacity:.18,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending});
  const sprite=new THREE.Sprite(material);sprite.raycast=()=>{};group.add(sprite);wisps.push(sprite);
 }
 group.visible=false;group.raycast=()=>{};return {group,wisps,phase};
}
export function animateMist(mist,time,power,breath){
 const t=time+mist.phase;
 for(let i=0;i<mist.wisps.length;i++){
  const s=mist.wisps[i],a=i*2.399963+t*(.14+i*.011),b=t*.47+i*1.71;
  const radius=(.036+.012*Math.sin(b))*breath;
  s.position.set(Math.cos(a)*radius,.024*Math.sin(b*.8)*breath,Math.sin(a)*radius);
  s.scale.set((.23+.052*Math.sin(b+1.8))*breath,(.17+.043*Math.cos(b*.87))*breath,1);
  s.material.rotation=i*Math.PI*2/7+.35*Math.sin(b*.5)+t*.055;
  s.material.opacity=(.13+.08*(.5+.5*Math.sin(b+2)))*clamp(.25+power*.75,0,1.8);
 }
}
