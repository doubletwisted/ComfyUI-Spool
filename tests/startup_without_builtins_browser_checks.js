// The runner answers builtin-captures.json with 503; the studio must still start.
(async()=>{
 const n=window.spoolNative,checks=[],check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);};
 const wait=async(predicate,label)=>{const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error(label+' timed out');await new Promise(r=>setTimeout(r,20));}};
 check('The studio starts when built-in workflows cannot load',!!n&&!document.getElementById('spool-loading')&&!document.getElementById('editor').inert);
 await wait(()=>document.getElementById('toast').textContent.includes('Built-in workflows could not load'),'Built-in notice');
 check('A notice explains that built-in workflows are unavailable',document.getElementById('toast').textContent.includes('Reload Spool'));
 await n.flush();
 check('Projects still open and save',typeof n.revision==='number'&&!n.dirty);
 return {checks};
})()
