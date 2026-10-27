(async()=>{
 const n=window.spoolNative,checks=[],check=(label,value)=>{if(!value)throw Error(label);checks.push(label);};
 const id=new URL(location.href).searchParams.get('project');
 check('Bare URL resolves to a durable project',!!id&&id===n.projectKey);
 check('Startup removes the blocking overlay',!document.getElementById('spool-loading')&&!document.getElementById('editor').inert);
 if(window.__fixtureProjectId)check('Startup opens the listed project',id===window.__fixtureProjectId);
 else check('Empty listing creates an empty project',n.state.clips.length===0&&n.revision===0);
 const response=await fetch('/spool/api/projects/'+id);check('Resolved project can be reopened',response.ok);
 check('The editor opens as the full studio',!document.getElementById('editor').classList.contains('compact'));
 return {checks};
})()
