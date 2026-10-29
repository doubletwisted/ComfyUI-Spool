(async () => {
  const checks = [...window.__libraryPointerChecks],
    $ = selector => document.querySelector(selector),
    click = selector => $(selector).click();
  const check = (label, value) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const catalog = await fetch('/spool/api/templates').then(r => r.json());
  const ids = () => [...document.querySelectorAll('[data-builtin]')].map(b => b.dataset.builtin);
  click('[data-workflow-location="local"]');
  check(
    'Local filter shows only local built-ins and project workflows',
    ids().length === 9 &&
      ids().every(id => catalog.find(w => w.id === id).section === 'local') &&
      !!$('[data-template="custom-local"]') &&
      !$('[data-template="custom-cloud"]'),
  );
  click('[data-workflow-task="t2v"]');
  check(
    'Task and location filters combine',
    ids().length === 2 && ids().every(id => catalog.find(w => w.id === id).task === 't2v'),
  );
  click('[data-workflow-location="cloud"]');
  check(
    'Cloud and T2V include FLUX 3',
    ids().includes('api_bfl_flux3_t2v') && ids().every(id => catalog.find(w => w.id === id).section === 'cloud'),
  );
  click('[data-workflow-task="all"]');
  check(
    'Cloud filter shows only cloud built-ins and project workflows',
    ids().length === 14 && !$('[data-template="custom-local"]') && !!$('[data-template="custom-cloud"]'),
  );
  const search = $('#workflowSearch');
  search.value = 'FLUX 3';
  search.dispatchEvent(new Event('input'));
  check('Search combines with Cloud filtering', ids().length === 2);
  click('[data-workflow-location="local"]');
  check('An empty combined filter has a clear message', !ids().length && !!$('.workflow-empty'));
  click('[data-workflow-location="cloud"]');
  click('[data-bin-tab="media"]');
  click('[data-bin-tab="workflows"]');
  check(
    'Library navigation preserves search and filters',
    ids().length === 2 &&
      $('[data-workflow-location="cloud"]').getAttribute('aria-pressed') === 'true' &&
      search.value === 'FLUX 3',
  );
  search.value = '';
  search.dispatchEvent(new Event('input'));
  click('[data-workflow-location="all"]');
  check('All restores the complete catalog', ids().length === 23);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')),
    transfer = new DataTransfer();
  transfer.items.add(new File([image], 'library-tab.png', { type: 'image/png' }));
  const input = $('#mediaFiles');
  input.files = transfer.files;
  await input.onchange({ target: input });
  check(
    'Importing footage selects Media and synchronizes visible tab state',
    $('#mediaPanel').dataset.tab === 'media' &&
      $('[data-bin-tab="media"]').getAttribute('aria-selected') === 'true' &&
      getComputedStyle($('.workflow-library')).display === 'none' &&
      !!$('[data-media]'),
  );
  click('[data-bin-tab="workflows"]');
  check(
    'Workflows works immediately after media import',
    $('#mediaPanel').dataset.tab === 'workflows' && getComputedStyle($('.workflow-library')).display !== 'none',
  );
  click('[data-bin-tab="media"]');
  const workflow = {
    source: { class_type: 'EmptyImage', inputs: { width: 32, height: 32, batch_size: 1, color: 0 } },
    save: { class_type: 'SaveImage', inputs: { images: ['source', 0], filename_prefix: 'library-test' } },
  };
  const json = new DataTransfer();
  json.items.add(new File([JSON.stringify(workflow)], 'library-workflow.json', { type: 'application/json' }));
  input.files = json.files;
  const imported = await input.onchange({ target: input });
  check(
    'Importing JSON selects Workflows and preserves the imported graph',
    imported.imported === 1 &&
      !imported.failed &&
      $('#mediaPanel').dataset.tab === 'workflows' &&
      $('[data-bin-tab="workflows"]').getAttribute('aria-selected') === 'true' &&
      window.spoolNative.state.importedWorkflows.some(w => w.name === 'library-workflow.json'),
  );
  check('Library operations do not start generation', !window.spoolNative.state.jobs.length);
  return { checks };
})();
