(async () => {
  const w = window,
    d = w.document,
    n = w.spoolNative,
    $ = id => n.dialogRoot.getElementById(id) || d.getElementById(id),
    checks = [];
  const check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async fn => {
      for (let i = 0; i < 150; i++) {
        if (fn()) return;
        await new Promise(r => setTimeout(r, 40));
      }
      throw Error('Project dialog timed out');
    };
  const project = await w.fetch('/spool/api/projects/' + n.projectKey).then(r => r.json());
  check(
    'The loaded project reports its project folder',
    !!project.folder && project.document.clips.every(c => c.outputFolder?.startsWith('output/')),
  );
  const image = d.querySelector('#clipLane .filmstrip img');
  if (image)
    check('Timeline media URLs are scoped to this project', image.src.includes('/spool/media/' + n.projectKey + '/'));
  $('projectMenu').click();
  $('openProjects').click();
  await wait(() => !!$('projectOpenFile'));
  check(
    'The project manager shows folder paths',
    [...n.dialogRoot.querySelectorAll('.saved-project-copy small')].some(el => el.textContent === project.folder),
  );
  check('Open project names the folder operation', $('projectOpenFile').textContent.includes('Open project folder'));
  $('projectOpenFile').click();
  await wait(() => !!$('openProjectFolderPath'));
  check(
    'Open folder uses a path to project.spool',
    !!$('openProjectFolderButton') && $('modal').textContent.includes('project.spool'),
  );
  $('closeModal').click();
  $('projectMenu').click();
  $('openProjects').click();
  await wait(() => !!$('newNativeProject'));
  $('newNativeProject').click();
  await wait(() => !!$('newProjectFolder'));
  check('New project exposes its name and folder together', !!$('newProjectName') && !!$('createProjectFolder'));
  $('closeModal').click();
  return { checks };
})();
