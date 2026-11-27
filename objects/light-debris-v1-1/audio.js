// Original procedural sound design. No downloaded music or audio assets.
const limit=(x,a,b)=>Math.max(a,Math.min(b,x));
export class DebrisAudio {
  constructor(onStatus=()=>{}) {
    this.onStatus=onStatus;this.ctx=null;this.enabled=false;this.volume=.48;
    this.ambient=.38;this.effects=.8;this.lastBell=-Infinity;this.voices=0;
    this.beams=[];this.sessionAudible=true;this.generation=0;
  }
  setParam(p,v,tau=.045){p.setTargetAtTime(v,this.ctx.currentTime,tau);}
  panner(){const p=this.ctx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=1;p.maxDistance=30;p.rolloffFactor=.72;return p;}
  position(p,v){this.setParam(p.positionX,v.x,.035);this.setParam(p.positionY,v.y,.035);this.setParam(p.positionZ,v.z,.035);}
  build(){
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Audio)throw Error('Web Audio unavailable');
    const c=this.ctx=new Audio({latencyHint:'interactive'});
    this.master=c.createGain();this.master.gain.value=0;
    this.ambBus=c.createGain();this.fxBus=c.createGain();
    this.ambBus.gain.value=this.ambient;this.fxBus.gain.value=this.effects;
    const comp=c.createDynamicsCompressor();comp.threshold.value=-21;comp.knee.value=18;comp.ratio.value=8;comp.attack.value=.003;comp.release.value=.25;
    this.ambBus.connect(this.master);this.fxBus.connect(this.master);this.master.connect(comp);comp.connect(c.destination);
    // Low, gently breathing, non-melodic room tone. No bells in this layer.
    const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=230;filter.Q.value=.35;
    const ambGain=c.createGain();ambGain.gain.value=.045;filter.connect(ambGain);ambGain.connect(this.ambBus);
    for(const [freq,amp] of [[43,.6],[64.7,.24],[86.2,.13]]){
      const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=freq;g.gain.value=amp;o.connect(g);g.connect(filter);o.start();
    }
    const wobble=c.createOscillator(),depth=c.createGain();wobble.frequency.value=.081;depth.gain.value=.013;wobble.connect(depth);depth.connect(ambGain.gain);wobble.start();
    // A seamless filtered noise bed, quiet enough to leave room for glass tails.
    const b=c.createBuffer(1,c.sampleRate*3,c.sampleRate),d=b.getChannelData(0);let n=0;
    for(let i=0;i<d.length;i++){n=.975*n+.025*(Math.random()*2-1);d[i]=n*Math.min(1,i/1024,(d.length-1-i)/1024);}
    const noise=c.createBufferSource();noise.buffer=b;noise.loop=true;
    const nf=c.createBiquadFilter(),ng=c.createGain();nf.type='bandpass';nf.frequency.value=310;nf.Q.value=.4;ng.gain.value=.085;noise.connect(nf);nf.connect(ng);ng.connect(this.ambBus);noise.start();
    // Independent spatial laser loops. Two oscillators per beam, no allocations per frame.
    for(let i=0;i<2;i++){
      const p=this.panner(),g=c.createGain(),f=c.createBiquadFilter();
      g.gain.value=0;f.type='lowpass';f.frequency.value=1150;f.Q.value=1.2;
      const o=c.createOscillator(),sub=c.createOscillator(),sg=c.createGain();
      o.type='sawtooth';o.frequency.value=132+i*49;sub.type='sine';sub.frequency.value=66+i*24.5;sg.gain.value=.45;
      o.connect(f);sub.connect(sg);sg.connect(f);f.connect(g);g.connect(p);p.connect(this.fxBus);o.start();sub.start();
      this.beams.push({p,g,f,o,sub,active:false});
    }
  }
  async enable(){
    try{
      if(!this.ctx)this.build();
      // Call directly from the user's click, before awaiting XR permission.
      const token=++this.generation;this.enabled=true;
      await this.ctx.resume();
      if(token!==this.generation||!this.enabled)return false;
      this.applyMaster();this.onStatus(this.ctx.state==='running'?'Audio active':'Audio suspended — tap Enable audio');return this.ctx.state==='running';
    }catch(e){this.enabled=false;this.onStatus('Audio unavailable: '+e.message);return false;}
  }
  applyMaster(){if(this.ctx&&this.master)this.setParam(this.master.gain,this.enabled&&this.sessionAudible?this.volume:0,.065);}
  setLevels(master,ambient,effects){this.volume=limit(master,0,1);this.ambient=limit(ambient,0,1);this.effects=limit(effects,0,1);if(this.ctx&&this.ambBus){this.setParam(this.ambBus.gain,this.ambient);this.setParam(this.fxBus.gain,this.effects);this.applyMaster();}}
  setAudible(v){this.sessionAudible=!!v;this.applyMaster();if(!v)this.silenceBeams();}
  disable(){this.generation++;this.enabled=false;this.applyMaster();this.silenceBeams();this.onStatus('Audio off');}
  get running(){return this.enabled&&this.sessionAudible&&this.ctx?.state==='running';}
  silenceBeams(){for(const b of this.beams){b.active=false;this.setParam(b.g.gain,0,.045);}}
  listener(pos,forward,up){if(!this.running)return;const l=this.ctx.listener;this.position(l,pos);for(const [key,val] of Object.entries({forwardX:forward.x,forwardY:forward.y,forwardZ:forward.z,upX:up.x,upY:up.y,upZ:up.z}))this.setParam(l[key],val,.025);}
  beam(i,active,source,strength=0,motion=0){
    if(!this.running)return;
    const b=this.beams[i],f=132+i*49+limit(motion,0,5)*20;this.position(b.p,source);
    if(active&&!b.active){
      const t=this.ctx.currentTime;b.o.frequency.cancelScheduledValues(t);b.o.frequency.setValueAtTime(f*5,t);b.o.frequency.exponentialRampToValueAtTime(f,t+.15);
    }else if(active){this.setParam(b.o.frequency,f,.09);}
    this.setParam(b.sub.frequency,f*.5,.09);
    this.setParam(b.f.frequency,650+strength*1250+limit(motion,0,5)*160,.07);
    this.setParam(b.g.gain,active?.035+strength*.035:0,active?.045:.075);b.active=active;
  }
  bell(pos,strength,size){
    if(!this.running||this.effects<=0||this.volume<=0||this.voices>=8)return false;
    const c=this.ctx,t=c.currentTime;if(t-this.lastBell<.085)return false;
    this.lastBell=t;this.voices++;
    const p=this.panner();this.position(p,pos);p.connect(this.fxBus);
    const base=limit(2100-size*21000,580,1950)*(1+(Math.random()-.5)*.12);
    const energy=limit(strength,.15,1),duration=.48+energy*.42;
    const amp=.035+energy*.05;let left=4;
    // Inharmonic resonances give glass/crystal rather than a musical beep.
    for(const [ratio,level,decay] of [[1,1,1],[2.17,.43,.67],[3.41,.19,.42],[5.16,.075,.26]]){
      const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=base*ratio;
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(amp*level,t+.006);
      g.gain.exponentialRampToValueAtTime(.0001,t+duration*decay);
      o.connect(g);g.connect(p);o.start(t);o.stop(t+duration*decay+.02);
      o.onended=()=>{o.disconnect();g.disconnect();if(--left===0){p.disconnect();this.voices--;}};
    }return true;
  }
}
// Contact onset detector: measured GPU sample positions, approximate enclosing spheres.
// No physical collision response is added to the original simulation.
export class ContactTracker {
  constructor(){this.prev=null;this.prevTime=0;this.contacts=new Set();this.cooldown=new Map();}
  reset(){this.prev=null;this.contacts.clear();this.cooldown.clear();}
  scan(data,time){
    if(data.length%4)throw Error('Unexpected contact sample layout');
    const dt=time-this.prevTime,old=this.prev;this.prev=data;this.prevTime=time;
    if(!old||old.length!==data.length||dt<.035||dt>.45){this.contacts.clear();return [];}
    const count=data.length/4,cell=.14,grid=new Map(),now=new Set(),events=[];
    const key=(x,y,z)=>x+','+y+','+z;
    for(let i=0;i<count;i++){
      const a=i*4,x=data[a],y=data[a+1],z=data[a+2],size=data[a+3];
      if(!Number.isFinite(x+y+z+size)||size<=0)continue;
      const cx=Math.floor(x/cell),cy=Math.floor(y/cell),cz=Math.floor(z/cell);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
        const bucket=grid.get(key(cx+dx,cy+dy,cz+dz));if(!bucket)continue;
        for(const j of bucket){
          const b=j*4,rx=x-data[b],ry=y-data[b+1],rz=z-data[b+2];
          const distance=Math.hypot(rx,ry,rz),radius=(size+data[b+3])*1.08;
          if(distance>radius||radius<=0)continue;
          const pair=j*count+i;now.add(pair);if(this.contacts.has(pair))continue;
          const oldDistance=Math.hypot(old[a]-old[b],old[a+1]-old[b+1],old[a+2]-old[b+2]);
          const closing=(oldDistance-distance)/dt;
          if(oldDistance<=radius||closing<.055||(this.cooldown.get(pair)||-Infinity)>time)continue;
          this.cooldown.set(pair,time+.65);
          events.push({x:(x+data[b])*.5,y:(y+data[b+1])*.5,z:(z+data[b+2])*.5,size:(size+data[b+3])*.5,strength:limit(closing/1.1,.15,1)});
        }
      }
      const k=key(cx,cy,cz);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);
    }
    this.contacts=now;for(const [k,t] of this.cooldown)if(t<time)this.cooldown.delete(k);
    return events.sort((a,b)=>b.strength-a.strength);
  }
}
