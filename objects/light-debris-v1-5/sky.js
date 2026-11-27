import * as THREE from 'three/webgpu';
import {makeCosmos as makeFallback} from '../light-debris-v1-4/cosmos.js?v=1.4';
export const SOURCES=[
 'https://raw.githubusercontent.com/cwtf/wiki-globe/8fbf260a7fc5be6c8e641e7cb1851479f5b23539/assets/milky-way-panorama-hires.jpg',
 'https://cdn.eso.org/images/large/eso0932a.jpg'
];
function load(url){
 return new Promise((resolve,reject)=>{
  const img=new Image();img.crossOrigin='anonymous';
  const timer=setTimeout(()=>{img.onload=img.onerror=null;reject(Error('Sky request timed out'));},6500);
  img.onload=()=>{clearTimeout(timer);resolve(img);};
  img.onerror=()=>{clearTimeout(timer);reject(Error('Sky image unavailable'));};
  img.src=url;
 });
}
export async function loadCosmos(maxSize,onStatus=()=>{}){
 for(const url of SOURCES){
  try{
   const img=await load(url);
   if(img.naturalWidth<2000||Math.abs(img.naturalWidth/img.naturalHeight-2)>.025)throw Error('Unexpected all-sky image dimensions');
   const width=Math.min(img.naturalWidth,maxSize),height=Math.round(width/2);
   const c=document.createElement('canvas');c.width=width;c.height=height;
   const ctx=c.getContext('2d',{alpha:false});ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,width,height);
   ctx.getImageData(0,0,1,1);
   const tex=new THREE.CanvasTexture(c);tex.mapping=THREE.EquirectangularReflectionMapping;tex.colorSpace=THREE.SRGBColorSpace;
   tex.generateMipmaps=true;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;
   onStatus('Photographic sky · '+width+' × '+height+' · ESO/S. Brunier');
   return {texture:tex,photo:true,width,height,url};
  }catch(e){console.warn('Sky source:',url,e.message);}
 }
 onStatus('Photographic sky unavailable — procedural fallback active');
 return {texture:makeFallback(),photo:false,width:4096,height:2048,url:null};
}
