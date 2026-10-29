// Opt-in: run against an isolated host whose API_VERSION changed after tab load.
(async () => {
  const n = spoolNative,
    path = '/spool/api/projects/' + n.projectKey,
    checks = [],
    check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    };
  const before = await fetch(path).then(r => r.json());
  const { API_VERSION } = await import('/spool/ui/protocol.js');
  const capabilities = await fetch('/spool/api/capabilities?types=').then(r => r.json());
  check('Host and open studio have different API versions', capabilities.apiVersion !== API_VERSION);
  const draft = before.document.project + ' unsaved after update';
  n.state.project = draft;
  let error;
  try {
    await n.flush();
  } catch (caught) {
    error = caught;
  }
  check('Stale save fails and the authored draft stays dirty', !!error && n.dirty && n.state.project === draft);
  const saved = await fetch(path).then(r => r.json());
  check(
    'Rejected save does not change the server revision or project',
    saved.revision === before.revision && saved.document.project === before.document.project,
  );
  await n.poll();
  check('Polling preserves the unsaved draft', n.dirty && n.state.project === draft);
  try {
    await n.flush();
  } catch (caught) {}
  check(
    'The studio shows one reload notice across repeated saves',
    document.querySelectorAll('#spool-outdated').length === 1 &&
      document.querySelector('#spool-outdated').textContent === 'Spool was updated. Reload this page.',
  );
  return { checks };
})();
