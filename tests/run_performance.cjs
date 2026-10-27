// Installed browser regression and timings. Requires the isolated CPU host on 8195.
// node tests/run_performance.cjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE EVIDENCE_DIRECTORY
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [modulePath,browserPath,evidence='.native-test/performance']=process.argv.slice(2),{chromium}=require(modulePath),base=(process.env.SPOOL_BROWSER_BASE||'http://127.0.0.1:8195');
const documentFor=fps=>{
 const media={id:'qa-still',kind:'image',name:'QA still',file:'assets/black.png',originalFile:'assets/black.png',poster:'assets/black.png',frames:150,width:16,height:16,audio:false};
 return {project:'Performance QA',fps,resolution:{width:3840,height:2160},media:[media],audioClips:[],importedWorkflows:[{id:'qa-workflow',name:'Large workflow',data:{workflow:{nodes:[],links:[]},provenance:{originalText:'x'.repeat(450000)}}}],clips:Array.from({length:20},(_,i)=>({id:'qa-clip-'+i,name:'Shot '+i,in:0,out:150,takeId:'qa-take-'+i,takes:[{id:'qa-take-'+i,number:1,media}],sources:[],revision:1,count:1}))};
};
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});const browser=await chromium.launch({executablePath:browserPath,headless:true}),results=[];
 try{for(const compact of [false]){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const created=await(await page.request.post(base+'/spool/api/projects',{data:{document:documentFor(30)}})).json();
  await page.goto(base+(compact?'/?spoolProject=':'/spool/?project=')+created.id);
  let frame=page;if(compact){await page.waitForSelector('#spool-dock iframe');frame=await page.locator('#spool-dock iframe').elementHandle().then(node=>node.contentFrame());}
  await frame.waitForFunction(()=>window.spoolNative);
  const result=await frame.evaluate(async()=>{
   const n=spoolNative,$=id=>document.getElementById(id),checks=[],times=[];
   const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
   const wait=async predicate=>{const deadline=performance.now()+10000;while(!predicate()){if(performance.now()>deadline)throw Error('Timed out: '+$('toast').textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
   n.selectClip(n.state.clips[0].id,true);
   for(let i=0;i<30;i++){const start=performance.now();n.duplicate();times.push(performance.now()-start);await n.flush();}
   const key='spool-native-'+n.projectKey+':view:history',stored=JSON.parse(sessionStorage.getItem(key));
   check(sessionStorage.getItem(key).length<=1800000&&stored.undo.length>0&&stored.undo.length<30,'Large edit history stays bounded in browser storage');
   let snapshots=0,writes=0;const stringify=JSON.stringify,setItem=Storage.prototype.setItem;
   JSON.stringify=function(value,...rest){if(value?._label||Array.isArray(value?.undo)&&value.undo.length>5)snapshots++;return stringify.call(this,value,...rest);};
   Storage.prototype.setItem=function(name,value){if(name===key)writes++;return setItem.call(this,name,value);};
   const start=performance.now();
   try{n.selectClip(n.state.clips[0].id,true);$('frameForward').click();await n.flush();}
   finally{JSON.stringify=stringify;Storage.prototype.setItem=setItem;}
   const selectMs=performance.now()-start;
   check(snapshots===0&&writes===0,'Selection, frame stepping and flush skip unchanged undo serialization and storage');
   // A 4K image with real pixel data; time begins after the clipboard bytes exist.
   const canvas=document.createElement('canvas');canvas.width=3840;canvas.height=2160;
   const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);
   for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=i%251;pixels.data[i+1]=(i*7)%241;pixels.data[i+2]=(i*13)%239;pixels.data[i+3]=255;}
   ctx.putImageData(pixels,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   n.setFrame(n.state.clips.reduce((sum,c)=>sum+(c.gapBefore||0)+c.out-c.in,0),true);
   const oldFile=$('still').dataset.file,count=n.state.clips.length,data=new DataTransfer();data.items.add(new File([blob],'paste.png',{type:'image/png'}));
   const fetch0=window.fetch,requests=[];window.fetch=async(...args)=>{requests.push({path:String(args[0]),method:args[1]?.method});return fetch0(...args);};
   const pasteStart=performance.now();let insertedMs,visibleMs;
   try{
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});$('timelineContent').dispatchEvent(event);check(event.defaultPrevented,'Timeline accepts clipboard image');
    await wait(()=>n.state.clips.length===count+1);insertedMs=performance.now()-pasteStart;
    await wait(()=>!$('still').hidden&&$('still').complete&&$('still').naturalWidth===3840&&$('still').dataset.file!==oldFile);visibleMs=performance.now()-pasteStart;await n.flush();
   }finally{window.fetch=fetch0;}
   const pasteMs=performance.now()-pasteStart,puts=requests.filter(r=>r.method==='PUT'&&r.path.endsWith(n.projectKey));
   check(puts.length===1,'Timeline paste saves the media and clip in one PUT');
   const pasted=n.state.clips.find(c=>c.id===n.state.selected),file=pasted.takes[0].media.file;
   const storedBytes=new Uint8Array(await(await fetch('/spool/media/'+file)).arrayBuffer()),original=new Uint8Array(await blob.arrayBuffer());
   check(storedBytes.length===original.length&&storedBytes.every((byte,i)=>byte===original[i]),'4K paste preserves the original image bytes');
   n.undo();await n.flush();check(n.state.clips.length===count&&n.state.media.some(m=>m.file===file),'Undo removes the clip and retains the imported image');
   n.redo();await n.flush();check(n.state.clips.length===count+1&&n.state.clips.some(c=>c.takes.some(t=>t.media.file===file)),'Redo restores the pasted clip');
   n.undo();await n.flush();const before=JSON.parse(sessionStorage.getItem(key));check(before.redo.length>0,'Undo saves a bounded redo stack');
   return {project:n.projectKey,checks,times,selectMs,insertedMs,visibleMs,pasteMs,bytes:blob.size,clips:count+1,requests};
  });
  await page.reload();if(compact){await page.waitForSelector('#spool-dock iframe');frame=await page.locator('#spool-dock iframe').elementHandle().then(node=>node.contentFrame());}await frame.waitForFunction(()=>window.spoolNative);
  assert.equal(await frame.locator('#redo').isEnabled(),true);await frame.evaluate(async()=>{spoolNative.redo();await spoolNative.flush();});assert.equal(await frame.evaluate(()=>spoolNative.state.clips.length),result.clips);result.checks.push('Reload restores redo and saves the same pasted clip');
  assert.deepEqual(errors,[]);result.compact=compact;result.errors=errors;results.push(result);await page.close();console.log(JSON.stringify({compact,checks:result.checks.length,selectMs:result.selectMs,pasteMs:result.pasteMs,visibleMs:result.visibleMs}));
 }}finally{await browser.close();}fs.writeFileSync(path.join(evidence,'checks.json'),JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
