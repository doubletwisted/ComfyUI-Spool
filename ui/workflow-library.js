export function createWorkflowLibrary({
  root,
  projectWorkflows,
  selectedWorkflow,
  onProject,
  onBuiltin,
  onImport,
  onTemplates,
  onCurrent,
  onSettings,
  hasApiKey,
  cloudReady = () => true,
  revealMedia,
  templates,
}) {
  root.classList.add('workflow-catalog');
  const section = root.querySelector('.workflow-library');
  section.innerHTML =
    '<div class="workflow-search"><input type="search" id="workflowSearch" placeholder="Search workflows" aria-label="Search workflows"><button type="button" class="workflow-filter-toggle" id="workflowFilterToggle" aria-expanded="false" aria-controls="workflowTaskFilters"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg><span id="workflowFilterCount"></span></button><div class="seg" role="group" aria-label="Workflow display"><button data-workflow-view="grid" title="Grid" aria-label="Grid"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg></button><button data-workflow-view="list" title="List" aria-label="List"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/></svg></button></div></div><div class="workflow-actions"><button class="textbutton" id="addCurrentWorkflow">+ Current Comfy Graph</button><button class="textbutton" id="importWorkflow">+ Import .json</button></div><div class="workflow-filters" id="workflowTaskFilters" role="group" aria-label="Workflow task">' +
    [
      ['all', 'All types'],
      ['i2v', 'I2V'],
      ['flf', 'First/Last'],
      ['t2v', 'T2V'],
      ['ref', 'Ref / V2V'],
    ]
      .map(([id, name]) => '<button data-workflow-task="' + id + '">' + name + '</button>')
      .join('') +
    '</div><div id="workflowList" aria-live="polite"></div><div class="panel-foot"><button class="textbutton" id="browseComfyTemplates">Browse all Comfy templates…</button></div>';
  const $ = id => section.querySelector('#' + id),
    list = $('workflowList'),
    escape = value =>
      String(value).replace(
        /[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  const locations = document.createElement('div');
  locations.className = 'workflow-location';
  locations.id = 'workflowLocationFilters';
  locations.setAttribute('role', 'group');
  locations.setAttribute('aria-label', 'Workflow location');
  locations.innerHTML = [
    ['all', 'Local + Cloud'],
    ['local', 'Local'],
    ['cloud', 'Cloud'],
  ]
    .map(([id, name]) => '<button data-workflow-location="' + id + '">' + name + '</button>')
    .join('');
  section.querySelector('.workflow-search').after(locations);
  let catalog = [],
    view = 'grid',
    task = 'all',
    location = 'all',
    error = '',
    filtersOpen = false;
  try {
    view = localStorage.getItem('spool-workflow-view') === 'list' ? 'list' : 'grid';
    filtersOpen = localStorage.getItem('spool-workflow-filters') === 'open';
  } catch {}
  const matches = w =>
    (location === 'all' || w.section === location) &&
    (task === 'all' || w.task === task) &&
    (w.family + ' ' + w.name).toLowerCase().includes($('workflowSearch').value.trim().toLowerCase());
  function card(w, builtin = false) {
    const key = builtin ? 'data-builtin' : 'data-template',
      poster = builtin ? '/spool/api/templates/' + encodeURIComponent(w.id) + '/webp' : w.poster;
    return (
      '<button class="workflow-row' +
      (w.id === selectedWorkflow() ? ' active' : '') +
      '" draggable="true" ' +
      key +
      '="' +
      escape(w.id) +
      '" title="' +
      escape(
        (w.family ? w.family + ' · ' : '') + w.name + ' · Click to append a shot; drag to insert or replace a workflow',
      ) +
      '" aria-label="' +
      escape('Add ' + (w.family ? w.family + ' ' : '') + w.name + ' shot') +
      '">' +
      (poster ? '<img loading="lazy" src="' + escape(poster) + '" alt="">' : '') +
      '<span><strong>' +
      escape(w.name) +
      '</strong><small>' +
      escape(w.family || 'This project') +
      '</small></span></button>'
    );
  }
  function render() {
    section.dataset.view = view;
    section.dataset.filters = filtersOpen ? 'open' : 'closed';
    const active = Number(task !== 'all'),
      toggle = $('workflowFilterToggle');
    $('workflowFilterCount').textContent = active || '';
    toggle.classList.toggle('active', active > 0);
    toggle.setAttribute('aria-expanded', filtersOpen);
    toggle.setAttribute(
      'aria-label',
      (filtersOpen ? 'Hide' : 'Show') + ' workflow filters' + (active ? ', ' + active + ' active' : ''),
    );
    toggle.title = (filtersOpen ? 'Hide' : 'Show') + ' task filters';
    for (const b of section.querySelectorAll('[data-workflow-view]')) {
      b.classList.toggle('active', b.dataset.workflowView === view);
      b.setAttribute('aria-pressed', b.dataset.workflowView === view);
    }
    for (const b of section.querySelectorAll('[data-workflow-task]')) {
      b.classList.toggle('active', b.dataset.workflowTask === task);
      b.setAttribute('aria-pressed', b.dataset.workflowTask === task);
    }
    for (const b of section.querySelectorAll('[data-workflow-location]')) {
      b.classList.toggle('active', b.dataset.workflowLocation === location);
      b.setAttribute('aria-pressed', b.dataset.workflowLocation === location);
    }
    const projects = Object.values(projectWorkflows()).filter(
      w =>
        !w.data?.provenance?.builtinTemplate &&
        matches({
          ...w,
          family: '',
          section: w.data?.executionTarget || 'local',
          task: w.data?.provenance?.builtinTask,
        }),
    );
    let html = projects.length
      ? '<section class="workflow-section"><h3>Project Workflows</h3><div class="workflow-cards">' +
        projects.map(w => card(w)).join('') +
        '</div></section>'
      : '';
    for (const [id, title, subtitle] of [
      ['local', 'Local Workflows', 'Open Weights · Local GPU'],
      ['cloud', 'Cloud Workflows', 'Partner Nodes · Comfy Cloud'],
    ]) {
      const rows = catalog.filter(w => w.section === id && matches(w));
      if (!rows.length) continue;
      html +=
        '<section class="workflow-section"><header><h3>' +
        title +
        '</h3>' +
        (id === 'cloud'
          ? '<button class="api-key-badge" data-cloud-settings>' +
            (!cloudReady() ? 'Cloud unavailable' : hasApiKey() ? 'API Key ✓' : 'Set API Key') +
            '</button>'
          : '') +
        '</header><p>' +
        subtitle +
        '</p>';
      for (const family of new Set(rows.map(w => w.family))) {
        const group = rows.filter(w => w.family === family);
        html +=
          '<h4>' +
          escape(family) +
          ' <span>(' +
          group.length +
          ')</span></h4><div class="workflow-cards">' +
          group.map(w => card(w, true)).join('') +
          '</div>';
      }
      html += '</section>';
    }
    html ||= '<div class="workflow-empty"><p>' + escape(error || 'No workflows match this search.') + '</p></div>';
    if (list.innerHTML === html) return;
    const scroll = list.scrollTop;
    list.innerHTML = html;
    list.scrollTop = scroll;
    list.querySelectorAll('[data-template],[data-builtin]').forEach(b => {
      b.onclick = () => (b.dataset.builtin ? onBuiltin(b.dataset.builtin) : onProject(b.dataset.template));
      b.ondragstart = e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(
          'application/spool',
          JSON.stringify(b.dataset.builtin ? { builtin: b.dataset.builtin } : { workflow: b.dataset.template }),
        );
      };
    });
    list.querySelector('[data-cloud-settings]')?.addEventListener('click', onSettings);
  }
  $('workflowSearch').oninput = render;
  $('workflowFilterToggle').onclick = () => {
    filtersOpen = !filtersOpen;
    try {
      localStorage.setItem('spool-workflow-filters', filtersOpen ? 'open' : 'closed');
    } catch {}
    render();
  };
  $('importWorkflow').onclick = onImport;
  $('browseComfyTemplates').onclick = onTemplates;
  $('addCurrentWorkflow').onclick = onCurrent;
  for (const b of section.querySelectorAll('[data-workflow-task]'))
    b.onclick = () => {
      task = b.dataset.workflowTask;
      render();
    };
  for (const b of section.querySelectorAll('[data-workflow-location]'))
    b.onclick = () => {
      location = b.dataset.workflowLocation;
      render();
    };
  for (const b of section.querySelectorAll('[data-workflow-view]'))
    b.onclick = () => {
      view = b.dataset.workflowView;
      try {
        localStorage.setItem('spool-workflow-view', view);
      } catch {}
      render();
    };
  const ready = templates()
    .then(value => {
      catalog = value;
      render();
    })
    .catch(e => {
      error = e.message;
      render();
    });
  return {
    render,
    ready,
    template: id => catalog.find(w => w.id === id),
    toggle() {
      revealMedia();
      $('workflowSearch').focus();
    },
  };
}
