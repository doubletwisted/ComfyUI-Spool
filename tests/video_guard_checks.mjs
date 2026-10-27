// Deterministic guard boundary checks. These mock browser events/counters;
// decoded-pixel recovery is verified separately in the real T3 browser.
import assert from 'node:assert/strict';
import {videoFrameCount,createVideoSeekGuard} from '../ui/video-seek-guard.js';
let timers=new Map(),serial=0,now=0;
const api={videoFrameCount,createVideoSeekGuard};
globalThis.setTimeout=(fn,delay)=>{timers.set(++serial,{fn,at:now+delay});return serial;};
globalThis.clearTimeout=id=>timers.delete(id);
const advance=ms=>{now+=ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);next[1].fn();}};
const drain=()=>advance(500);
function fixture(){
 let active=true,playing=false,count=10;const events=new Map();
 const v={isConnected:true,hidden:false,paused:true,seeking:false,readyState:4,src:'proxy-a',currentSrc:'proxy-a',currentTime:.25,seekTarget:.25,decodeTarget:.25,loads:0,
  getVideoPlaybackQuality:()=>({totalVideoFrames:count,droppedVideoFrames:0}),
  addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
  removeEventListener:(name,fn)=>events.get(name)?.delete(fn),load(){this.loads++;this.emit('emptied');},
  emit:name=>{for(const fn of [...(events.get(name)||[])])fn();}};
 const guard=api.createVideoSeekGuard(()=>active,()=>playing);
 const arm=(time=.25,previous=0)=>{v.seekTarget=time;v.decodeTarget=time;v.currentTime=time;guard.observe(v,time,previous,api.videoFrameCount(v));};
 return {v,guard,arm,setActive:value=>active=value,setPlaying:value=>playing=value,setCount:value=>count=value};
}
const checks=[];
function check(name,fn){timers.clear();now=0;fn();checks.push(name);}
check('Stalled changed seek reloads once; metadata seeks cannot rearm it',()=>{
 const f=fixture();f.arm();drain();assert.equal(f.v.loads,1);
 f.guard.observe(f.v,.25,0,0);drain();assert.equal(f.v.loads,1);
 f.v.emit('seeked');f.arm();drain();assert.equal(f.v.loads,1);
});
check('Healthy progress and same-target seeks never reload',()=>{
 const f=fixture();f.arm();f.setCount(11);drain();assert.equal(f.v.loads,0);
 f.arm(.25,.25);drain();assert.equal(f.v.loads,0);
});
check('Unsupported or invalid counters disable an existing watch',()=>{
 const f=fixture();f.arm();f.v.getVideoPlaybackQuality=undefined;
 f.guard.observe(f.v,.25,0,api.videoFrameCount(f.v));drain();assert.equal(f.v.loads,0);
 f.v.getVideoPlaybackQuality=()=>({totalVideoFrames:NaN,droppedVideoFrames:0});
 assert.equal(api.videoFrameCount(f.v),null);f.arm();drain();assert.equal(f.v.loads,0);
 f.v.getVideoPlaybackQuality=()=>({totalVideoFrames:0,droppedVideoFrames:1});assert.equal(api.videoFrameCount(f.v),null);
});
check('New target invalidates even a previously queued timer callback',()=>{
 const f=fixture();f.arm();const old=[...timers.values()][0].fn;f.arm(.5);old();assert.equal(f.v.loads,0);
 assert.equal(f.guard.status(f.v).pending,true);
 f.setCount(11);drain();assert.equal(f.v.loads,0);
});
check('Playback event and playback intent both invalidate paused recovery',()=>{
 const f=fixture();f.arm();f.v.paused=false;f.v.emit('play');drain();assert.equal(f.v.loads,0);
 f.v.paused=true;f.arm(.5);f.setPlaying(true);drain();assert.equal(f.v.loads,0);
});
check('Source changes, hidden elements and lost viewer ownership cannot reload',()=>{
 for(const change of [f=>f.v.currentSrc='proxy-b',f=>f.v.hidden=true,f=>f.setActive(false),f=>f.v.isConnected=false]){
  const f=fixture();f.arm();change(f);drain();assert.equal(f.v.loads,0);
 }
});
check('An external load cancels the old request before it can retry',()=>{
 const f=fixture();f.arm();f.v.src='proxy-b';f.v.currentSrc='';f.v.emit('emptied');drain();assert.equal(f.v.loads,0);
});
check('A newer source/request can recover after an earlier recovery',()=>{
 const f=fixture();f.arm();drain();f.v.emit('seeked');
 f.v.src=f.v.currentSrc='proxy-b';f.arm(.5);drain();assert.equal(f.v.loads,2);
});
check('Coalesced target changes during recovery do not start another load',()=>{
 const f=fixture();f.arm();drain();f.v.seeking=true;f.arm(.5);f.v.emit('seeked');drain();assert.equal(f.v.loads,1);
 f.v.seeking=false;f.v.emit('seeked');f.setCount(12);f.arm(.5,.5);drain();assert.equal(f.v.loads,1);
});
check('A slow seek is watched for 500ms after completion, not after submission',()=>{
 const f=fixture();f.v.seeking=true;f.arm();advance(2000);assert.equal(f.v.loads,0);assert.equal(f.guard.status(f.v).pending,true);
 f.v.seeking=false;f.v.emit('seeked');advance(499);assert.equal(f.v.loads,0);advance(1);assert.equal(f.v.loads,1);
});
check('Reload error clears pending, keeps retry budget, and allows a newer target',()=>{
 const f=fixture();f.v.load=function(){this.loads++;this.emit('error');};f.arm();drain();assert.equal(f.v.loads,1);assert.equal(f.guard.status(f.v).pending,false);
 f.arm();drain();assert.equal(f.v.loads,1);f.arm(.5);drain();assert.equal(f.v.loads,2);assert.equal(f.guard.status(f.v).pending,false);
});
check('Terminal reload abort clears recovery after the new load starts',()=>{
 const f=fixture();f.v.load=function(){this.loads++;this.emit('loadstart');this.emit('abort');};f.arm();drain();assert.equal(f.guard.status(f.v).pending,false);
 f.arm(.5);drain();assert.equal(f.v.loads,2);assert.equal(f.guard.status(f.v).pending,false);
});
check('Expected restart abort is tolerated; a silent failed restart is bounded',()=>{
 const f=fixture();f.v.load=function(){this.loads++;this.emit('abort');this.emit('emptied');};f.arm();drain();assert.equal(f.guard.status(f.v).pending,true);
 advance(8000);assert.equal(f.guard.status(f.v).pending,false);f.arm(.5);drain();assert.equal(f.v.loads,2);
});
check('Play or source change terminates a recovery already in progress',()=>{
 for(const event of ['play','emptied']){const f=fixture();f.arm();drain();if(event==='emptied')f.v.src='proxy-b';f.v.emit(event);assert.equal(f.guard.status(f.v).pending,false);advance(10000);assert.equal(f.v.loads,1);}
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
