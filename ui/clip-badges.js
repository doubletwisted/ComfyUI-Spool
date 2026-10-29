import { keyText } from './keys.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createClipBadges({
  $,
  svg,
  drawn,
  getInspectorTab,
  getState,
  takeSeen,
  selectionIds,
  selectedVideos,
  selectionQueueReason,
  buttons,
  draw,
  getClipNotes,
  renderTakes,
  selectedAudio,
  renderAudioInspector,
  getCountLabel,
  getJobStatus,
}) {
  function renderNonVideoInspector() {
    const audio = selectedAudio();
    $('inputsInspectorTab').classList.toggle('active', getInspectorTab() === 'inputs' && !audio);
    $('audioInspectorTab').classList.toggle('active', getInspectorTab() === 'audio' || !!audio);
    $('inputsInspectorTab').setAttribute('aria-selected', getInspectorTab() === 'inputs' && !audio);
    $('audioInspectorTab').setAttribute('aria-selected', getInspectorTab() === 'audio' || !!audio);
    $('generate').hidden = !!audio;
    $('inspector').classList.toggle('audio-selected', !!audio);
    if (getInspectorTab() === 'audio' || audio) {
      renderAudioInspector();
      renderTakes();
      return;
    }

    $('clipName').value = 'No clip selected';
    draw(
      'inspectorContent',
      '<div class="selection-empty"><span class="empty-symbol">' +
        svg('cursor') +
        '</span><strong>Select a clip</strong><p>Choose a timeline clip to adjust its workflow, inputs and sound.</p><small>' +
        keyText('Ctrl-click to select more than one') +
        '</small></div>',
    );
    renderTakes();
  }
  function renderSelectionInspector() {
    const ids = selectionIds(),
      videos = selectedVideos(),
      audio = ids.length - videos.length;
    $('inspector').classList.remove('audio-selected');
    $('inspector').classList.add('multi-selected');
    $('clipName').value = ids.length + ' clips selected';
    getCountLabel().hidden = true;
    getJobStatus().textContent = '';
    $('generate').hidden = !videos.length;
    $('generateLabel').textContent = 'Generate ' + videos.length + ' clips';
    $('generate').title = selectionQueueReason() || 'Generate takes for the selected clips';
    draw(
      'inspectorContent',
      '<div class="group-label">Selection</div><p class="audio-summary">' +
        videos.length +
        ' video ' +
        (videos.length === 1 ? 'clip' : 'clips') +
        ' / ' +
        audio +
        ' audio ' +
        (audio === 1 ? 'clip' : 'clips') +
        '</p><p class="audio-note">Drag a selected clip to move the selection together. ' +
        keyText('Ctrl') +
        '-click toggles clips; Shift-click selects a range on one track.</p>',
    );
    renderTakes();
    buttons();
  }
  function clipAttentionCounts(c, video) {
    return [getClipNotes()(c).filter(n => n.status === 'open').length, video ? takeSeen.unseen(c).length : 0];
  }
  function clipAttention(c, video = true) {
    const [notes, fresh] = clipAttentionCounts(c, video);
    return (
      '<span class="clip-attention" data-counts="' +
      notes +
      ':' +
      fresh +
      '"' +
      (!notes && !fresh ? ' hidden' : '') +
      '>' +
      (notes
        ? '<span class="clip-attention-badge open-notes" data-open-notes="' +
          notes +
          '" title="' +
          notes +
          ' open ' +
          (notes === 1 ? 'note' : 'notes') +
          '" aria-label="' +
          notes +
          ' open ' +
          (notes === 1 ? 'note' : 'notes') +
          '">' +
          svg('clipboard') +
          notes +
          '</span>'
        : '') +
      (fresh
        ? '<span class="clip-attention-badge unseen-takes" data-unseen-takes="' +
          fresh +
          '" title="' +
          fresh +
          ' unseen ' +
          (fresh === 1 ? 'take' : 'takes') +
          '" aria-label="' +
          fresh +
          ' unseen ' +
          (fresh === 1 ? 'take' : 'takes') +
          '">' +
          'New' +
          (fresh > 1 ? ' <span class="new-take-count">' + fresh + '</span>' : '') +
          '</span>'
        : '') +
      '</span>'
    );
  }
  function renderClipAttention() {
    for (const node of $('timelineContent').querySelectorAll('[data-clip],[data-audio]')) {
      const video = !!node.dataset.clip,
        c = (video ? getState().clips : getState().audioClips || []).find(
          c => c.id === (node.dataset.clip || node.dataset.audio),
        ),
        badge = node.querySelector('.clip-attention');
      if (c && badge && badge.dataset.counts !== clipAttentionCounts(c, video).join(':')) {
        badge.outerHTML = clipAttention(c, video);
        // A direct badge patch changes the lane DOM outside draw()'s cached string.
        drawn[node.parentElement.id] = null;
      }
    }
  }
  function markTakesSeen(ids) {
    if (takeSeen.mark(ids)) renderClipAttention();
  }
  return { renderNonVideoInspector, renderSelectionInspector, clipAttention, renderClipAttention, markTakesSeen };
}
