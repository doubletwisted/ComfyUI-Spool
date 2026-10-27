// Synthetic jobs decide which renders offer Cancel request or Dismiss; the cancel command is intercepted.
(async()=>{
 const w=window,n=w.spoolNative,d=w.document,checks=[],check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);};
 const wait=async(predicate,label)=>{const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error(label+' timed out');await new Promise(r=>setTimeout(r,20));}};
 await n.flush();
 const now=Date.now()/1000,base={clipId:n.state.clips[0]?.id||'shot',name:'Cancel QA',takeNumber:1,createdAt:now-30,nodeProgress:[]};
 const jobs=[{...base,id:'ui-local-uncertain',status:'uncertain',target:'local',error:'Absent from Comfy queue and history'},
  {...base,id:'ui-local-running',status:'running',target:'local'},
  {...base,id:'ui-cloud-running',status:'running',target:'cloud'},
  {...base,id:'ui-farm-unowned',status:'submission_uncertain',target:'deadline'},
  {...base,id:'ui-farm-owned',status:'farm_running',target:'deadline',submission:{external_id:'owned-job'}}];
 const commands=[],original=w.fetch;
 w.fetch=async(input,options)=>{
  const path=new URL(String(input),location.href).pathname;
  if(path==='/spool/api/projects/'+n.projectKey+'/commands'){commands.push(JSON.parse(options.body));return new Response(JSON.stringify({result:{status:'cancelled'}}),{status:200});}
  if(path==='/spool/api/projects/'+n.projectKey&&(!options?.method||options.method==='GET')){
   const headers=new Headers(options?.headers);headers.delete('X-Spool-Since');
   const value=await original(input,{...options,headers}).then(r=>r.json());value.document.jobs=jobs;return new Response(JSON.stringify(value),{status:200});
  }
  return original(input,options);
 };
 try{
  n.state.jobs=jobs;d.getElementById('showQueue').click();
  await wait(()=>d.querySelector('[data-render="ui-farm-owned"]'),'Renders list');
  const button=id=>d.querySelector('[data-render="'+id+'"] [data-cancel-attempt]');
  check('A local render absent from Comfy can be dismissed',button('ui-local-uncertain')?.textContent==='Dismiss');
  check('A running local render is cancelled from Comfy, not Spool',!button('ui-local-running'));
  check('A Cloud render can be asked to stop',button('ui-cloud-running')?.textContent==='Cancel request');
  check('A Deadline submission without an owned job offers recovery instead',!button('ui-farm-unowned')&&!!d.querySelector('[data-render="ui-farm-unowned"] [data-recover-submission]'));
  check('An owned Deadline job can be asked to stop',button('ui-farm-owned')?.textContent==='Cancel request');
  button('ui-local-uncertain').click();
  await wait(()=>commands.length===1,'Dismiss command');
  check('Dismiss sends one scoped cancel command for that attempt',commands[0].action==='cancel'&&commands[0].arguments.attemptId==='ui-local-uncertain'&&commands[0].scope.capabilities.includes('cancel'));
 }finally{w.fetch=original;d.getElementById('closeRenders')?.click();}
 return {checks};
})()
