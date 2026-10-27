(async()=>{
 const n=spoolNative,d=document,$=id=>d.getElementById(id),checks=[],T=await import('/spool/ui/timeline.js'),check=(label,value)=>{if(!value)throw Error(label);checks.push(label);};
 const wait=async fn=>{const end=Date.now()+30000;while(!await fn()){if(Date.now()>end)throw Error('Frame interpretation: '+$('toast').textContent);await new Promise(r=>setTimeout(r,40));}};
 const shot=()=>n.state.clips.find(c=>c.id==='shot');n.selectClip('shot');await n.flush();
 check('Existing takes expose all 25 source frames at the 30 FPS sequence clock',shot().takes[0].media.frames===25&&shot().takes[0].media.frameRateMode==='interpret'&&n.state.fps===30);
 check('Legacy trims convert once and the next cut follows the shorter clip',shot().out===25&&T.rowFor(n.state,'next').start===25);
 n.setFrame(24);await wait(()=>{const v=d.querySelector('#viewerStage video.front');return v&&!v.seeking&&v.readyState>=2&&v.currentTime>24/30;});
 const video=d.querySelector('#viewerStage video.front');check('Viewer playback has 25 frames of duration instead of a resampled one-second proxy',Math.abs(video.duration-25/30)<.03);
 const pixel=v=>{const c=d.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(v,v.videoWidth/2,v.videoHeight/2,1,1,0,0,1,1);return c.getContext('2d').getImageData(0,0,1,1).data[0];};
 check('The final source frame is visible at timeline frame 24',pixel(video)>215);
 const thumb=d.querySelector('[data-view="legacy"]'),r=thumb.getBoundingClientRect();thumb.dispatchEvent(new PointerEvent('pointerenter',{bubbles:true,clientX:r.right-1,clientY:r.top+2}));thumb.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.right-1,clientY:r.top+2}));
 await wait(()=>{const v=d.querySelector('video.take-scrub-preview');return v&&!v.hidden&&!v.seeking&&v.readyState>=2;});const hover=d.querySelector('video.take-scrub-preview');
 check('Hover scrubbing replaces the old CFR proxy with the interpreted source clock',Math.abs(hover.duration-25/30)<.03&&pixel(hover)>215);thumb.dispatchEvent(new PointerEvent('pointerleave',{bubbles:true}));
 d.querySelector('[data-bin-tab="media"]').click();const media=n.state.media[0],before=n.state.clips.length,data=new DataTransfer();data.setData('application/spool',JSON.stringify({media:media.id}));const end=d.querySelector('[data-clip="next"]').getBoundingClientRect();$('clipLane').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:end.right+30,clientY:end.top+end.height/2}));await wait(()=>n.state.clips.length>before);await n.flush();
 check('A new media clip uses every source frame once and the shorter interpreted length',n.state.clips.at(-1).out-n.state.clips.at(-1).in===25);
 check('Frame interpretation submits no generation jobs',!n.state.jobs.length);return {checks};
})()
