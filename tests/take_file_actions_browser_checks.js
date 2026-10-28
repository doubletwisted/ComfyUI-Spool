(async()=>{
 const w=window,d=w.document,n=w.spoolNative,checks=[];
 const check=(label,value)=>{if(!value)throw Error(label);checks.push(label);};
 n.selectClip('shot');await n.flush();
 const original=JSON.stringify(n.state),revision=n.revision,selection=JSON.stringify(n.view.takeSelection),card=d.querySelector('#takeList [data-take="one"]');
 const open=()=>{card.dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:w.innerWidth-10,clientY:w.innerHeight-10}));return d.getElementById('native-clip-menu');};
 let menu=open(),buttons=[...menu.querySelectorAll('button')],a=buttons[0].getBoundingClientRect(),b=buttons[1].getBoundingClientRect(),r=menu.getBoundingClientRect();
 const mac=w.navigator.platform==='MacIntel',manager=mac?'Finder':'Explorer';
 check('Right-click offers only Reveal in '+manager+' and Download',!menu.hidden&&buttons.length===2&&buttons[0].textContent==='Reveal in '+manager&&buttons[1].textContent==='Download');
 check('Shortcut labels name '+(mac?'Cmd and Option':'Ctrl and Alt'),d.getElementById('undo').title.includes(mac?'Cmd+Z':'Ctrl+Z')&&d.getElementById('timelineHint').textContent.startsWith(mac?'Option-drag':'Alt-drag')&&d.getElementById('archiveTakes').title.includes(mac?'Cmd+Z':'Ctrl+Z'));
 check('File actions sit side by side and stay within the editor',Math.abs(a.top-b.top)<1&&a.right<=b.left&&r.left>=0&&r.right<=w.innerWidth&&r.bottom<=w.innerHeight);
 buttons[0].focus();w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));check('Arrow keys navigate the horizontal actions',d.activeElement===buttons[1]);
 w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('Escape closes the take menu',menu.hidden);
 let revealed=null,download=null;const fetch=w.fetch;
 w.fetch=async(url,options)=>{if(String(url).endsWith('/take-file/shot/one/reveal')){revealed={url,options};return new w.Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});}return fetch.call(w,url,options);};
 try{open().querySelector('button').click();await new Promise(resolve=>setTimeout(resolve,30));}finally{w.fetch=fetch;}
 check('Reveal targets the right-clicked take without a client filesystem path',revealed?.options.method==='POST'&&revealed.options.body==='{}'&&menu.hidden);
 const capture=e=>{const anchor=e.target.closest('a');if(anchor?.hasAttribute('download')){download=anchor.getAttribute('href');e.preventDefault();}};
 d.addEventListener('click',capture,true);try{open().querySelectorAll('button')[1].click();}finally{d.removeEventListener('click',capture,true);}
 check('Download uses the original take attachment endpoint',download==='/spool/api/projects/'+n.projectKey+'/take-file/shot/one'&&menu.hidden);
 check('File actions preserve project, selection, chosen take and review state',JSON.stringify(n.state)===original&&n.revision===revision&&JSON.stringify(n.view.takeSelection)===selection);
 d.getElementById('takeList').dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));check('Empty take space offers no file actions',menu.hidden);
 open();
 return {checks};
})()
