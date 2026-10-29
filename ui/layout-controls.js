// Live getters and narrow actions keep this owner independent of editor initialization.
export function createLayoutControls({
  $,
  VIEW_KEY,
  getTimelineDrag,
  writeTimelineDrag,
  getState,
  getBinTab,
  writeBinTab,
  getPpf,
  getDrag,
  review,
  viewState,
  trackHeights,
  getTrackResize,
  writeTrackResize,
  applyTrackHeights,
  storeTrackHeights,
  clamp,
  getMediaView,
  getRenderBin,
  getRenderTimeline,
  getPointerBusy,
  getViewer,
  getViewerData,
  getUpdateViewer,
  getMediaCollapsedKey,
  getMediaRail,
  getViewerExpanded,
  writeViewerExpanded,
  getFullscreenPending,
  writeFullscreenPending,
  getViewerZoom,
  getViewerPan,
  writeViewerPan,
  getViewSaveTimer,
  writeViewSaveTimer,
  getInspectorFull,
  getInspectorHeightButton,
  getPanelWidths,
  getPanelDrag,
  writePanelDrag,
  getPanelKey,
  getTimelineHeightKey,
}) {
  function applyMediaView() {
    $('mediaPanel').dataset.tab = getBinTab();
    for (const button of $('mediaPanel').querySelectorAll('[data-bin-tab]')) {
      const active = button.dataset.binTab === getBinTab();
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active);
    }
    const active = getBinTab() === 'media';
    $('binGrid').classList.toggle('media-list', active && getMediaView() === 'list');
    for (const view of ['grid', 'list']) {
      $('mediaView' + view).setAttribute('aria-pressed', getMediaView() === view);
      $('mediaView' + view).classList.toggle('active', getMediaView() === view);
    }
    $('mediaViewControls').hidden = !active;
  }
  function setBinTab(tab) {
    writeBinTab(tab);
    getRenderBin()();
  }
  function syncMediaRail() {
    const panel = $('mediaPanel'),
      open = panel.classList.contains('open');
    for (const b of getMediaRail().querySelectorAll('[data-rail-tab]'))
      b.setAttribute('aria-pressed', open && panel.dataset.tab === b.dataset.railTab);
  }
  function closeMediaFlyout() {
    if (window.innerWidth > 1100 && $('mediaPanel').classList.contains('open')) {
      $('mediaPanel').classList.remove('open');
      syncMediaRail();
    }
  }
  function setMediaCollapsed(collapsed) {
    $('workbench').classList.toggle('hide-media', collapsed);
    $('mediaPanel').classList.remove('open');
    try {
      localStorage.setItem(getMediaCollapsedKey(), collapsed ? '1' : '0');
    } catch (error) {}
    syncMediaRail();
  }
  function setViewerExpanded(expanded) {
    writeViewerExpanded(expanded);
    const v = $('viewer');
    v.classList.toggle('expanded', expanded);
    $('fullscreen').title = expanded ? 'Exit fullscreen (F / Esc)' : 'Fullscreen viewer (F)';
    $('fullscreen').setAttribute('aria-label', expanded ? 'Exit fullscreen' : 'Fullscreen viewer');
    applyViewerZoom();
    (expanded ? v : $('editor')).focus({ preventScroll: true });
  }
  function toggleViewerFullscreen() {
    finishViewerPan();
    setViewerExpanded(!getViewerExpanded());
    if (!getViewerExpanded()) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }
    // Desktop webviews manage fullscreen in their host; use the window-filling view there.
    if (document.fullscreenEnabled && !navigator.userAgent.includes('Electron/') && !getFullscreenPending()) {
      writeFullscreenPending(true);
      $('viewer')
        .requestFullscreen()
        .then(() => {
          writeFullscreenPending(false);
          if (!getViewerExpanded() && document.fullscreenElement) document.exitFullscreen().catch(() => {});
        })
        .catch(() => {
          writeFullscreenPending(false);
        });
    }
  }
  function freshViewerZoom() {
    return { edit: { scale: 1, x: 0, y: 0 }, source: { scale: 1, x: 0, y: 0 } };
  }
  function persistView() {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(viewState()));
    } catch (error) {}
  }
  function saveView() {
    clearTimeout(getViewSaveTimer());
    writeViewSaveTimer(setTimeout(persistView, 100));
  }
  function viewerImageBox(element) {
    const parent = element?.closest('.trim-frame') || $('viewerStage'),
      box = parent.getBoundingClientRect(),
      ratio = element?.videoWidth
        ? element.videoWidth / element.videoHeight
        : element?.naturalWidth
          ? element.naturalWidth / element.naturalHeight
          : 16 / 9,
      width = Math.min(box.width, box.height * ratio),
      height = width / ratio;
    return { width, height, cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
  }
  function applyViewerZoom() {
    const z = getViewerZoom()[review.mode];
    z.scale = clamp(z.scale, 1, 6);
    z.x = clamp(z.x, -(z.scale - 1) / 2, (z.scale - 1) / 2);
    z.y = clamp(z.y, -(z.scale - 1) / 2, (z.scale - 1) / 2);
    if (z.scale < 1.01) ((z.scale = 1), (z.x = z.y = 0));
    for (const element of $('viewerStage').querySelectorAll(
      ':scope>video:not(.take-scrub-preview),#still,.trim-frame video,.trim-frame img',
    )) {
      if (element.hidden || element.closest('.trim-frame')?.hidden) continue;
      const b = viewerImageBox(element);
      element.style.transform =
        z.scale === 1 ? '' : 'translate(' + z.x * b.width + 'px,' + z.y * b.height + 'px) scale(' + z.scale + ')';
      element.classList.toggle('zoomable', element.tagName === 'VIDEO' || !element.hidden);
    }
    if (z.scale === 1) releaseViewerPan();
    $('viewerStage').classList.toggle('zoomed', z.scale > 1);
    $('viewerStage').classList.toggle('panning', !!getViewerPan());
    $('viewerZoom').textContent = z.scale === 1 ? 'Fit' : Math.round(z.scale * 100) + '%';
    $('viewerZoom').title =
      'Viewer ' +
      (z.scale === 1 ? 'fit' : Math.round(z.scale * 100) + '%') +
      ' · Wheel to zoom · Drag to pan · Double-click or Shift+F to fit';
  }
  function releaseViewerPan() {
    const p = getViewerPan();
    writeViewerPan(null);
    const stage = $('viewerStage');
    if (p && stage.hasPointerCapture(p.pointerId)) stage.releasePointerCapture(p.pointerId);
    stage.classList.remove('panning');
  }
  function resetViewerZoom() {
    releaseViewerPan();
    getViewerZoom()[review.mode] = { scale: 1, x: 0, y: 0 };
    applyViewerZoom();
    saveView();
  }
  function viewerZoomAt(scale, element, clientX, clientY) {
    const z = getViewerZoom()[review.mode],
      b = viewerImageBox(element);
    if (!b.width || !b.height) return;
    scale = clamp(scale, 1, 6);
    z.x += ((z.scale - scale) * ((clientX - b.cx) / b.width - z.x)) / z.scale;
    z.y += ((z.scale - scale) * ((clientY - b.cy) / b.height - z.y)) / z.scale;
    z.scale = scale;
    applyViewerZoom();
    saveView();
  }
  function viewerHit(e) {
    if (e.target.closest('button') || !getViewerData()() || getPointerBusy()()) return null;
    const frame = e.target.closest('.trim-frame');
    return frame
      ? frame.querySelector('video:not([hidden]),img:not([hidden])')
      : getViewer().shownVideo || (!$('still').hidden ? $('still') : null);
  }
  function finishViewerPan(cancel = false) {
    if (!getViewerPan()) return;
    if (cancel) getViewerZoom()[getViewerPan().mode] = getViewerPan().original;
    releaseViewerPan();
    applyViewerZoom();
    saveView();
  }
  function setTimelineZoom(value, anchor = getState().frame, pixel = null) {
    if (getPointerBusy()()) return;
    const sc = $('timelineScroll');
    if (pixel === null) {
      const x = anchor * getPpf() - sc.scrollLeft;
      pixel = x >= 0 && x <= sc.clientWidth ? x : sc.clientWidth / 2;
      if (x < 0 || x > sc.clientWidth) anchor = (sc.scrollLeft + pixel) / getPpf();
    }
    getState().zoom = Math.round(clamp(value, 100, 1600));
    $('zoom').value = getState().zoom;
    getRenderTimeline()();
    sc.scrollLeft = anchor * getPpf() - pixel;
    getUpdateViewer()();
    saveView();
  }
  function fitTimeline() {
    if (getDrag()) return;
    getState().zoom = 100;
    $('zoom').value = 100;
    $('timelineScroll').scrollLeft = 0;
    getRenderTimeline()();
    getUpdateViewer()();
    saveView();
  }
  function applyInspectorHeight() {
    const panel = $('inspector');
    (getInspectorFull() ? $('editor') : $('workbench')).append(panel);
    $('editor').classList.toggle('inspector-full', getInspectorFull());
    getInspectorHeightButton().setAttribute('aria-pressed', getInspectorFull());
    getInspectorHeightButton().title = getInspectorFull()
      ? 'Switch inspector to viewer height'
      : 'Extend inspector beside viewer and timeline';
  }
  function panelBounds(name) {
    const available = $('editor').clientWidth - 20;
    const width = available,
      drawer = name === 'media' ? innerWidth <= 1100 : innerWidth <= 760;
    let max;
    if (drawer) max = width - 24;
    else {
      const other = $(name === 'media' ? 'inspector' : 'mediaPanel'),
        takes = $('takes').getBoundingClientRect(),
        occupied =
          getComputedStyle(other).display !== 'none' && getComputedStyle(other).position !== 'absolute'
            ? other.getBoundingClientRect().width
            : 0,
        rail = takes.width && Math.abs(takes.top - $('viewer').getBoundingClientRect().top) < 2 ? takes.width : 0;
      max = width - 320 - occupied - rail;
    }
    max = Math.max(0, max);
    return { min: Math.min(name === 'media' ? 160 : 240, max), max };
  }
  function applyPanelWidths() {
    for (const name of ['media', 'inspector']) {
      const bounds = panelBounds(name),
        value = getPanelWidths()[name],
        sized = value !== null,
        handle = $(name + 'Resize'),
        panel = $(name === 'media' ? 'mediaPanel' : 'inspector');
      if (name === 'inspector') $('workbench').classList.toggle('inspector-sized', sized);
      if (sized) $('editor').style.setProperty('--' + name + '-width', clamp(value, bounds.min, bounds.max) + 'px');
      else $('editor').style.removeProperty('--' + name + '-width');
      handle.setAttribute('aria-valuemin', String(Math.round(bounds.min)));
      handle.setAttribute('aria-valuemax', String(Math.round(bounds.max)));
      handle.setAttribute('aria-valuenow', String(Math.round(panel.getBoundingClientRect().width)));
    }
  }
  function storePanelWidth(name) {
    try {
      if (getPanelWidths()[name] === null) sessionStorage.removeItem(getPanelKey()(name));
      else sessionStorage.setItem(getPanelKey()(name), getPanelWidths()[name]);
    } catch (error) {}
  }
  function endPanelResize(cancel = false) {
    if (!getPanelDrag()) return;
    const done = getPanelDrag();
    writePanelDrag(null);
    if (cancel) {
      getPanelWidths()[done.name] = done.initial;
      applyPanelWidths();
    }
    $('editor').classList.remove('resizing-panels');
    storePanelWidth(done.name);
  }
  function timelineBounds() {
    const min = innerHeight < 820 ? 180 : 236;
    return { min, max: Math.max(min, Math.min(440, innerHeight - 330)) };
  }
  function setTimelineHeight(height) {
    const bounds = timelineBounds();
    $('editor').style.setProperty('--timeline-height', clamp(height, bounds.min, bounds.max) + 'px');
    $('timelineResize').setAttribute('aria-valuemin', bounds.min);
    $('timelineResize').setAttribute('aria-valuemax', bounds.max);
    $('timelineResize').setAttribute(
      'aria-valuenow',
      Math.round(document.querySelector('.timeline-shell').getBoundingClientRect().height),
    );
  }
  function endTimelineResize(cancel = false) {
    if (!getTimelineDrag()) return;
    if (cancel) {
      if (getTimelineDrag().initial) $('editor').style.setProperty('--timeline-height', getTimelineDrag().initial);
      else $('editor').style.removeProperty('--timeline-height');
    } else
      sessionStorage.setItem(
        getTimelineHeightKey(),
        String(document.querySelector('.timeline-shell').getBoundingClientRect().height),
      );
    writeTimelineDrag(null);
    $('editor').classList.remove('resizing-timeline');
  }
  function endTrackResize(cancel = false) {
    if (!getTrackResize()) return;
    const done = getTrackResize();
    writeTrackResize(null);
    if (cancel) {
      if (done.initial === undefined) delete trackHeights[done.key];
      else trackHeights[done.key] = done.initial;
      applyTrackHeights();
    } else storeTrackHeights();
    $('editor').classList.remove('resizing-track');
    if (done.handle.hasPointerCapture(done.pointerId)) done.handle.releasePointerCapture(done.pointerId);
  }
  return {
    applyMediaView,
    setBinTab,
    syncMediaRail,
    closeMediaFlyout,
    setMediaCollapsed,
    setViewerExpanded,
    toggleViewerFullscreen,
    freshViewerZoom,
    persistView,
    saveView,
    viewerImageBox,
    applyViewerZoom,
    resetViewerZoom,
    viewerZoomAt,
    viewerHit,
    finishViewerPan,
    setTimelineZoom,
    fitTimeline,
    applyInspectorHeight,
    panelBounds,
    applyPanelWidths,
    storePanelWidth,
    endPanelResize,
    timelineBounds,
    setTimelineHeight,
    endTimelineResize,
    endTrackResize,
  };
}
