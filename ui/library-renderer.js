// Editor adapters are explicit; rendering always reads the current draft.
export function createLibraryRenderer({
  $,
  esc,
  svg,
  T,
  url,
  thumbnails,
  getFps,
  getWorkflowLibrary,
  syncImportedWorkflows,
  getState,
  getBinTab,
  review,
  seconds,
  draw,
  getMediaFilter,
  applyMediaView,
  getPickImport,
  getRenderTakes,
  getCloseTakeComparison,
  getAddMediaClip,
  getUpdateViewer,
  getPause,
  getFinishViewerPan,
  getDecimal,
}) {
  function renderBin() {
    applyMediaView();
    syncImportedWorkflows();
    getWorkflowLibrary()?.render();
    renderFullLibrary();
  }
  function mediaRemoveButton(m) {
    return (
      '<button class="remove-media" data-remove-media="' +
      esc(m.id) +
      '" title="Remove from media pool" aria-label="Remove ' +
      esc(m.name) +
      ' from media pool">' +
      svg('trash') +
      '</button>'
    );
  }
  function takeFacts(t) {
    if (!t || t.placeholder) return '';
    const m = t.media || {},
      source = String(m.originalFile || m.name || '')
        .split('/')
        .at(-1);
    const rows = [
      [
        'Selected take',
        (t.original ? 'Original clip' : 'T' + String(t.number).padStart(2, '0')) + (t.generated ? ' · generated' : ''),
      ],
      ['Source', source],
      ['Length', m.frames ? seconds(m.frames) + ' · ' + m.frames + ' frames' : ''],
      ['Size', m.width && m.height ? m.width + ' × ' + m.height : ''],
      ['Frame rate', m.fps ? String(m.fps).replace(/\/1$/, '') + ' fps' : ''],
      ['Audio', m.kind === 'video' ? (m.audio ? 'Yes' : 'No') : ''],
      ['Seed', t.seed != null ? getDecimal()(t.seed) : ''],
    ].filter(([, value]) => value);
    return (
      '<dl class="take-facts">' +
      rows
        .map(([key, value]) => '<dt>' + esc(key) + '</dt><dd title="' + esc(value) + '">' + esc(value) + '</dd>')
        .join('') +
      '</dl>'
    );
  }
  function mediaOwners() {
    const owners = new Map();
    for (const c of getState().clips)
      for (const t of c.takes || [])
        if (t.media?.id && !owners.has(t.media.id)) owners.set(t.media.id, { clip: c, take: t });
    return owners;
  }
  function mediaLabel(m, owner) {
    return owner ? owner.clip.name : m.name;
  }
  function mediaTake(owner) {
    return owner ? (owner.take.original ? 'Original' : 'Take ' + owner.take.number) + ' / ' : '';
  }
  function mediaCard(m, owner) {
    const label = mediaLabel(m, owner);
    return (
      '<div class="bin-card' +
      (review.source?.media.id === m.id ? ' active' : '') +
      '" draggable="true" tabindex="0" role="button" aria-label="Preview ' +
      esc(label) +
      '" data-media="' +
      m.id +
      '"><img src="' +
      esc(url(m.poster)) +
      '" alt=""><span class="bin-tag">' +
      (owner && !owner.take.original ? 'T' + String(owner.take.number).padStart(2, '0') + ' · ' : '') +
      (m.kind === 'image' ? 'Image' : m.kind === 'audio' ? 'Audio' : seconds(m.frames)) +
      '</span><button class="add" data-add-media="' +
      m.id +
      '" title="Add to timeline" aria-label="Add ' +
      esc(m.name) +
      ' to timeline">' +
      svg('plus') +
      '</button>' +
      mediaRemoveButton(m) +
      '<div class="bin-text"><strong title="' +
      esc(m.name) +
      '">' +
      esc(label) +
      '</strong><span class="media-detail">' +
      esc(mediaTake(owner)) +
      esc(m.kind) +
      (m.kind === 'image' ? '' : ' / ' + seconds(m.frames)) +
      (m.width && m.height ? ' / ' + m.width + ' x ' + m.height : '') +
      '</span></div></div>'
    );
  }
  function projectMedia() {
    const items = new Map((getState().media || []).map(m => [m.id, m]));
    for (const c of getState().clips)
      for (const t of T.realTakes(c)) if (!t.generated && !items.has(t.media.id)) items.set(t.media.id, t.media);
    const hidden = new Set(getState().hiddenMediaIds || []);
    return [...items.values()].filter(m => !hidden.has(m.id));
  }
  function renderFullLibrary() {
    const query = $('poolSearch').value.trim().toLowerCase(),
      items = projectMedia().filter(
        m => (getMediaFilter() === 'all' || m.kind === getMediaFilter()) && m.name.toLowerCase().includes(query),
      );
    $('binTitle').textContent = items.length + ' ' + (items.length === 1 ? 'item' : 'items');
    const empty = query
      ? '<div class="pool-empty"><strong>No matching media</strong><p>Try another name or clear your search.</p><button class="outline" data-clear-search>Clear search</button></div>'
      : '<div class="pool-empty"><span class="empty-symbol">' +
        svg(getBinTab() === 'workflows' ? 'audio' : 'import') +
        '</span><strong>' +
        (getBinTab() === 'workflows' ? 'Add your soundtrack' : 'Bring your media in') +
        '</strong><p>' +
        (getBinTab() === 'workflows'
          ? 'Import audio or a video with sound.'
          : 'Video, images and audio, ready to edit.') +
        '</p><button class="outline" data-pool-import>' +
        svg('plus') +
        'Import media</button><small>You can also drop files here</small></div>';
    if (
      draw(
        'binGrid',
        items.length ? (owners => items.map(m => mediaCard(m, owners.get(m.id))).join(''))(mediaOwners()) : empty,
      )
    ) {
      const clear = $('binGrid').querySelector('[data-clear-search]'),
        add = $('binGrid').querySelector('[data-pool-import]');
      if (clear)
        clear.onclick = () => {
          $('poolSearch').value = '';
          renderBin();
          $('poolSearch').focus();
        };
      if (add) add.onclick = () => getPickImport()();
      $('binGrid')
        .querySelectorAll('[data-add-media]')
        .forEach(
          b =>
            (b.onclick = e => {
              e.stopPropagation();
              getAddMediaClip()(b.dataset.addMedia);
            }),
        );
      $('binGrid')
        .querySelectorAll('[data-media]')
        .forEach(b => {
          const m = projectMedia().find(m => m.id === b.dataset.media);
          thumbnails.bind(b.querySelector('img'), m, m.frames / 2, getFps());
          b.onclick = e => {
            if (e.target.closest('button')) return;
            const m = projectMedia().find(m => m.id === b.dataset.media);
            getPause()();
            getFinishViewerPan()();
            getCloseTakeComparison()();
            review.openMedia(m);
            renderBin();
            getRenderTakes()();
            getUpdateViewer()(true);
            $('binGrid')
              .querySelector('[data-media="' + CSS.escape(m.id) + '"]')
              ?.focus({ preventScroll: true });
          };
          b.ondragstart = e => e.dataTransfer.setData('application/spool', JSON.stringify({ media: b.dataset.media }));
        });
    }
  }

  return { renderBin, takeFacts, projectMedia };
}
