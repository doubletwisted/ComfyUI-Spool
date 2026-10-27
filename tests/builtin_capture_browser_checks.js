// Explicit bundle refresh: use Comfy's serializer, never generate or load models.
(async()=>{
 const {createBuiltinPreparer,prepareBuiltinGraph,builtinInputs}=await import('/spool/ui/builtin-workflows.js');
 const {resultChoices}=await import('/spool/ui/profile.js');
 const catalog=await (await fetch('/spool/api/templates')).json(),preparer=createBuiltinPreparer(),workflows=[],checks=[];
 const configuration=(await (await fetch('/spool/api/capabilities')).json()).configuration;
 try{
  for(const template of catalog){
   const capture=template.section==='cloud'?await (await fetch('/spool/api/templates/'+template.id+'/capture')).json():await preparer.capture(configuration.comfyUrl,prepareBuiltinGraph(template,await (await fetch('/spool/api/templates/'+template.id+'/json')).json()));
   const result=resultChoices(capture.prompt,capture.definitions).filter(r=>capture.prompt[r.nodeId].class_type==='SaveVideo').at(-1);
   if(!result)throw Error('Missing final SaveVideo: '+template.id);
   capture.bindings=builtinInputs(capture,capture.definitions,result,template).map(({value,...b})=>({...b,key:crypto.randomUUID()}));
   capture.result={nodeId:result.nodeId,group:result.group,index:result.index};capture.resultOnly=true;
   capture.provenance={...capture.provenance,source:'Comfy workflow template',builtinTemplate:template.id,builtinTask:template.task,workflowName:template.family+' · '+template.name};
   delete capture.definitions;
   workflows.push({id:template.id,name:template.name,data:capture});checks.push(template.id+' captured using the serializer and verified mapping');
  }
  const project=await (await fetch('/spool/api/projects/'+spoolNative.projectKey)).json();
  const response=await fetch('/spool/api/projects/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:project.revision,document:{...project.document,importedWorkflows:workflows}})});
  if(!response.ok)throw Error((await response.json()).error);
  return {checks};
 }finally{preparer.dispose();}
})()
