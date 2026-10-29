import * as T from './timeline.js';
import { keyText } from './keys.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createTakeActions({
  $,
  request,
  productCapabilities,
  projectKey,
  thumbnails,
  getSelectedCut,
  writeSelectedCut,
  getNudgeGroup,
  writeNudgeGroup,
  getState,
  review,
  history,
  edits,
  getSelectedTakeClip,
  writeSelectedTakeClip,
  getSelectedTakeIds,
  writeSelectedTakeIds,
  getTakeSelectionAnchor,
  writeTakeSelectionAnchor,
  selected,
  take,
  rowFor,
  clamp,
  saveHistory,
  toast,
  setStatus,
  render,
  takeName,
  markTakesSeen,
  renderInspector,
  renderTakes,
  takeSelectionTools,
  takeTools,
  clipFolderButton,
  getOpeningClipFolder,
  getRenderTimeline,
  chooseTake,
  getViewer,
  getUpdateViewer,
  getPause,
  getPlay,
  getShowModal,
  getCloseModal,
  getViewerExpanded,
  saveView,
  finishViewerPan,
  selectedAudio,
  hideTrimPreview,
  clearHeld,
  getProjectEdit,
  getShowActionMenu,
}) {
  function takeSelection(c = selected()) {
    if (c?.id !== getSelectedTakeClip()) {
      writeSelectedTakeClip(c?.id || null);
      writeSelectedTakeIds([]);
      writeTakeSelectionAnchor(null);
    }
    const available = new Set(T.realTakes(c).map(t => t.id));
    writeSelectedTakeIds(getSelectedTakeIds().filter(id => available.has(id)));
    if (!available.has(getTakeSelectionAnchor())) writeTakeSelectionAnchor(null);
    return getSelectedTakeIds();
  }
  function updateTakeSelection() {
    if (!$('takeSelectionCount')) return;
    const c = selected(),
      takes = T.realTakes(c),
      ids = takeSelection(c);
    takeTools.hidden = takeSelectionTools.hidden = !!selectedAudio() || !takes.length;
    clipFolderButton.hidden = !c || !!selectedAudio();
    clipFolderButton.disabled = getOpeningClipFolder() || !productCapabilities.clipFolderReveal;
    clipFolderButton.title = productCapabilities.clipFolderReveal
      ? 'Open in ' +
        (productCapabilities.fileManager || 'Explorer') +
        '. Copy completed videos or images here; they appear as new takes after a short scan.'
      : 'Opening clip folders needs a desktop file manager on the Spool host';
    $('takeSelectionCount').textContent = ids.length + ' selected';
    $('takeSelectionCount').hidden = !ids.length;
    $('selectAllTakes').textContent = ids.length === takes.length ? 'Clear' : 'Select all';
    $('archiveTakes').disabled = !ids.length || !takes.some(t => t.id !== c?.takeId);
    $('deleteTakesFromDisk').disabled = $('archiveTakes').disabled;
    $('archiveTakes').hidden = $('deleteTakesFromDisk').hidden = !ids.length;
    $('deleteTakesFromDisk').title = 'Permanently delete media and its workflow JSON; cannot be undone';
    for (const card of $('takeList').querySelectorAll('[data-take]')) {
      const checked = ids.includes(card.dataset.take);
      card.classList.toggle('take-selected', checked);
      card.querySelector('[data-select-take]').checked = checked;
    }
  }
  function selectTake(id, e = {}) {
    const takes = T.realTakes(selected()),
      ids = takeSelection().slice();
    if (e.shiftKey && getTakeSelectionAnchor()) {
      const a = takes.findIndex(t => t.id === getTakeSelectionAnchor()),
        b = takes.findIndex(t => t.id === id),
        range = takes.slice(Math.min(a, b), Math.max(a, b) + 1).map(t => t.id);
      writeSelectedTakeIds(e.ctrlKey || e.metaKey ? [...new Set([...ids, ...range])] : range);
    } else {
      writeSelectedTakeIds(
        e.toggle || e.ctrlKey || e.metaKey
          ? ids.includes(id)
            ? ids.filter(value => value !== id)
            : [...ids, id]
          : [id],
      );
      writeTakeSelectionAnchor(id);
    }
    updateTakeSelection();
    saveView();
  }
  function archiveTakes(others = false) {
    const c = selected(),
      selectedIds = takeSelection(c).slice();
    if (!c || !selectedIds.length) return;
    const ids = T.realTakes(c)
      .filter(t => t.id !== c.takeId && (others ? !selectedIds.includes(t.id) : selectedIds.includes(t.id)))
      .map(t => t.id);
    if (!ids.length) {
      toast('The take in the edit is kept. Choose another take before deleting it.');
      return;
    }
    edits.apply('Delete ' + ids.length + ' ' + (ids.length === 1 ? 'take' : 'takes'), () => {
      T.hideTakes(c, ids);
      thumbnails.stopScrub();
      if (
        (review.source?.clipId === c.id && ids.includes(review.source.takeId)) ||
        (review.audition?.clipId === c.id && ids.includes(review.audition.takeId)) ||
        (review.comparison?.clipId === c.id && review.comparison.ids.some(id => ids.includes(id)))
      ) {
        getPause()();
        editView();
        review.clear();
      }
    });
    $('editor').focus({ preventScroll: true });
    toast(
      ids.length +
        ' ' +
        (ids.length === 1 ? 'take' : 'takes') +
        ' removed. Files are kept; ' +
        keyText('Ctrl') +
        '+Z restores the takes.',
    );
  }
  function openTakeActions(action, origin) {
    const c = selected(),
      selection = takeSelection(c),
      verb = action === 'archive' ? 'Delete' : 'Permanently delete',
      r = origin.getBoundingClientRect();
    getShowActionMenu()(
      action === 'archive' ? 'Delete takes' : 'Permanently delete files',
      [false, true].map(others => {
        const ids = T.realTakes(c)
          .filter(t => t.id !== c.takeId && (others ? !selection.includes(t.id) : selection.includes(t.id)))
          .map(t => t.id);
        return {
          label: verb + (others ? ' others' : ' selected'),
          reason: !selection.length ? 'Select takes first' : !ids.length ? 'The take in the edit is kept' : null,
          run: () => (action === 'archive' ? archiveTakes(others) : deleteTakes(others)),
        };
      }),
      r.left,
      r.bottom + 4,
      origin,
    );
    origin.setAttribute('aria-expanded', 'true');
  }
  async function deleteTakes(others = false) {
    const c = selected(),
      selection = takeSelection(c),
      ids = T.realTakes(c)
        .filter(t => t.id !== c.takeId && (others ? !selection.includes(t.id) : selection.includes(t.id)))
        .map(t => t.id);
    if (!selection.length || !ids.length) return;
    const clipId = c.id;
    getShowModal()(
      'Delete ' + ids.length + ' ' + (ids.length === 1 ? 'take' : 'takes') + ' from disk?',
      '<p>The media files and matching workflow JSON will be permanently deleted. This cannot be undone.</p><p>The take in the edit is kept. Files used by other takes, clips or generation inputs are protected.</p><p id="takeDeleteError" role="status"></p>',
      '<button class="outline" id="takeDeleteCancel">Cancel</button><button class="primary" id="takeDeleteConfirm">Delete from disk</button>',
    );
    $('takeDeleteCancel').onclick = getCloseModal();
    $('takeDeleteConfirm').onclick = async () => {
      const button = $('takeDeleteConfirm');
      button.disabled = true;
      button.textContent = 'Deleting…';
      try {
        thumbnails.stopScrub();
        getPause()();
        editView();
        review.clear();
        getViewer().clearVideos();
        const { value } = await getProjectEdit().change(revision =>
          request('projects/' + projectKey + '/delete-takes/' + clipId, { revision, takeIds: ids }),
        );
        history.clear();
        writeSelectedTakeIds([]);
        getCloseModal()();
        render();
        saveHistory();
        saveView();
        toast(
          value.pendingFiles
            ? 'Takes deleted; ' + value.pendingFiles + ' files await release by another application.'
            : ids.length + ' ' + (ids.length === 1 ? 'take' : 'takes') + ' deleted from disk.',
        );
      } catch (error) {
        $('takeDeleteError').textContent = error.message;
        button.disabled = false;
        button.textContent = 'Delete from disk';
        render();
      }
    };
  }
  function comparisonTakes() {
    return review.takes;
  }
  function sourceLength() {
    return review.length;
  }
  function comparisonVideos() {
    return comparisonTakes() ? Array.from($('takeCompare').querySelectorAll('video:not([hidden])')) : [];
  }
  function closeTakeComparison() {
    review.closeComparison();
    $('takeCompare').hidden = true;
    $('editor').classList.remove('compare-active');
    for (const v of $('takeCompare').querySelectorAll('video')) {
      v.pause();
      v.hidden = true;
    }
  }
  function toggleTakeComparison() {
    getPause()();
    finishViewerPan();
    hideTrimPreview();
    if (comparisonTakes()) {
      closeTakeComparison();
      renderTakes();
      getUpdateViewer()(true);
      return;
    }
    const c = selected();
    if (T.realTakes(c).length < 2 || selectedAudio()) return;
    writeSelectedCut(null);
    writeNudgeGroup(null);
    clearHeld();
    getState().selectedAudio = null;
    review.compare(c.id);
    markTakesSeen(review.comparison.ids);
    renderTakes();
    getRenderTimeline()();
    getUpdateViewer()(true);
    $('editor').focus({ preventScroll: true });
  }
  function selectComparisonPane(index) {
    if (!review.selectPane(index)) return;
    renderTakes();
    getUpdateViewer()();
    (getViewerExpanded() ? $('viewer') : $('editor')).focus({ preventScroll: true });
  }
  function editView() {
    finishViewerPan();
    closeTakeComparison();
    review.edit();
  }
  function viewTake(id, c = selected()) {
    thumbnails.stopScrub();
    finishViewerPan();
    hideTrimPreview();
    getState().selectedAudio = null;
    const t = T.realTakes(c).find(t => t.id === id);
    if (!t) return;
    if (!(review.mode === 'source' && review.source?.clipId === c.id)) getPause()();
    if (!(review.comparison?.clipId === c.id && review.mode === 'source')) closeTakeComparison();
    review.reviewTake(c.id, id);
    markTakesSeen([id]);
    renderTakes();
    getRenderTimeline()();
    getUpdateViewer()(true);
    setStatus(
      c.name + ' - ' + takeName(t) + (t.id === c.takeId ? ' - in the edit' : ' - review only, the edit is unchanged'),
    );
  }
  function flipTake(step) {
    if (selectedAudio()) return;
    const c = (review.mode === 'source' && getState().clips.find(c => c.id === review.source?.clipId)) || selected(),
      real = T.realTakes(c);
    if (!real.length) return;
    const index = real.findIndex(t => t.id === review.source?.takeId);
    viewTake(real[clamp(index < 0 ? 0 : index + step, 0, real.length - 1)].id, c);
  }
  function setViewMode(mode) {
    finishViewerPan();
    hideTrimPreview();
    if (mode === 'source' && selectedAudio()) {
      const c = selectedAudio();
      review.rememberMedia(c.media, review.source?.media.file === c.media.file ? review.frame : c.in);
    }
    if (mode === review.mode) return;
    if (mode === 'source') {
      const c = selected();
      if (c && (!review.source || (review.source.clipId && review.source.clipId !== c.id))) {
        viewTake(take(c).id, c);
        return;
      }
      if (!review.source) return;
    }
    getPause()();
    closeTakeComparison();
    review.setMode(mode);
    renderTakes();
    getRenderTimeline()();
    getUpdateViewer()(true);
  }
  function tryInEdit() {
    const c = getState().clips.find(c => c.id === review.source?.clipId),
      row = c && rowFor(c.id);
    if (!row) return;
    getPause()();
    closeTakeComparison();
    review.tryInEdit();
    getState().selected = c.id;
    getState().frame = Math.max(0, row.start - 36);
    renderInspector();
    getRenderTimeline()();
    getUpdateViewer()(true);
    getPlay()();
    setStatus(
      review.audition
        ? 'Trying ' +
            takeName(c.takes.find(t => t.id === review.audition.takeId)) +
            ' in the edit · Enter uses it, Esc cancels'
        : c.name + ' in the edit',
    );
  }
  function cancelAudition() {
    if (!review.audition) return;
    getPause()();
    review.cancelTrial();
    renderTakes();
    getRenderTimeline()();
    getUpdateViewer()(true);
    setStatus('Showing the saved edit');
  }
  function useViewerTake() {
    const target = review.candidate;
    if (target?.takeId) chooseTake(target.clipId, target.takeId);
  }
  return {
    takeSelection,
    updateTakeSelection,
    selectTake,
    archiveTakes,
    openTakeActions,
    comparisonTakes,
    sourceLength,
    comparisonVideos,
    closeTakeComparison,
    toggleTakeComparison,
    selectComparisonPane,
    editView,
    viewTake,
    flipTake,
    setViewMode,
    tryInEdit,
    cancelAudition,
    useViewerTake,
  };
}
