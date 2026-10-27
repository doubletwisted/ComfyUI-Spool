// Capabilities are stubbed to report a missing tool and no Comfy Cloud SDK.
(async()=>{
 const checks=[],check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);};
 const wait=async(predicate,label)=>{const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error(label+' timed out');await new Promise(r=>setTimeout(r,20));}};
 const setup=document.getElementById('setupWarning');
 check('Missing requirements show a setup notice in the topbar',!!setup&&setup.textContent==='Setup needed'&&setup.getBoundingClientRect().width>0);
 setup.click();await wait(()=>!document.getElementById('modalOverlay').hidden,'Setup dialog');
 check('The notice lists each missing requirement',document.querySelector('.setup-issues li')?.textContent.startsWith('Install ffmpeg'));
 document.getElementById('closeModal').click();await wait(()=>document.getElementById('modalOverlay').hidden,'Close setup dialog');
 const badge=document.querySelector('[data-cloud-settings]');
 check('Cloud workflows say Cloud is unavailable',badge?.textContent==='Cloud unavailable');
 badge.click();await wait(()=>document.querySelector('#modal .setup-note'),'Comfy settings');
 check('Comfy settings explain how to enable Cloud',document.querySelector('#modal .setup-note').textContent.includes('comfy-sdk'));
 document.getElementById('closeModal').click();
 return {checks};
})()
