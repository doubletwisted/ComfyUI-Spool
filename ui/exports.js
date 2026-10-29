import * as T from './timeline.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createExports({
  $,
  esc,
  api,
  request,
  projectKey,
  url,
  getFps,
  getExportRangeDrag,
  writeExportRangeDrag,
  getState,
  getPpf,
  edits,
  selectionIds,
  take,
  total,
  layout,
  clamp,
  tc,
  toast,
  setStatus,
  showModal,
  closeModal,
  getResolution,
  getExportRangeBar,
  getRangeSettings,
  getExportData,
  getExportFormat,
  writeExportFormat,
  getViewerExpanded,
  toggleViewerFullscreen,
  flushNative,
  downloadValue,
}) {
  async function exportViewerFrame(data) {
    if (getViewerExpanded()) toggleViewerFullscreen();
    showModal(
      'Export frame',
      '<p>Export this frame as a PNG at the footage’s original resolution.</p><p id="frameResult">Exporting frame…</p>',
    );
    const result = $('frameResult');
    try {
      await flushNative();
      const frame = await request(
        'projects/' + projectKey + '/frame',
        { mediaId: data.media.id, frame: Math.floor(data.frame) },
        'POST',
      );
      if ($('frameResult') !== result) return;
      result.innerHTML =
        '<a class="download-link" href="' +
        esc(frame.url) +
        '" download="' +
        esc(frame.filename) +
        '">Download PNG</a>';
      const a = document.createElement('a');
      a.href = frame.url;
      a.download = frame.filename;
      a.click();
    } catch (error) {
      if ($('frameResult') === result) result.textContent = error.message;
    }
  }
  function renderExportRange(range = T.exportRange(getState())) {
    getExportRangeBar().hidden = !range.end;
    getExportRangeBar().style.left = range.start * getPpf() + 'px';
    getExportRangeBar().style.width = (range.end - range.start) * getPpf() + 'px';
    for (const b of getExportRangeBar().children) {
      const edge = b.dataset.exportEdge;
      b.title = 'Export ' + edge + ' · ' + tc(range[edge]) + ' · drag or use arrow keys';
      b.setAttribute('aria-valuemin', edge === 'start' ? 0 : range.start + 1);
      b.setAttribute('aria-valuemax', edge === 'start' ? range.end - 1 : total());
      b.setAttribute('aria-valuenow', range[edge]);
      b.setAttribute('aria-valuetext', tc(range[edge]));
    }
    getRangeSettings().title =
      'Export ' +
      tc(range.start) +
      ' – ' +
      tc(range.end) +
      ' · ' +
      tc(range.end - range.start) +
      ' · I: start / O: end';
  }
  function setExportRange(range) {
    if (
      (!range && !getState().exportRange) ||
      (range &&
        getState().exportRange &&
        range.start === getState().exportRange.start &&
        range.end === getState().exportRange.end)
    )
      return;
    edits.apply(
      'Set export range',
      () => {
        if (range) getState().exportRange = range;
        else delete getState().exportRange;
      },
      'range',
    );
  }
  function setExportEdge(edge, frame) {
    const range = T.exportRange(getState());
    if (!range.end) return;
    range[edge] = clamp(frame, edge === 'start' ? 0 : range.start + 1, edge === 'start' ? range.end - 1 : total());
    setExportRange(range);
  }
  function cancelExportRange() {
    if (!getExportRangeDrag()) return;
    writeExportRangeDrag(null);
    renderExportRange();
  }
  function exportFrameValue(value) {
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.round(Number(value) * getFps());
    const m = value.trim().match(/^(\d+):(\d{2}):(\d{2}):(\d{2})$/);
    if (!m || Number(m[2]) >= 60 || Number(m[3]) >= 60 || Number(m[4]) >= getFps())
      throw Error('Enter seconds or HH:MM:SS:FF.');
    return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * getFps() + Number(m[4]));
  }
  async function exportVideo() {
    if (getState().clips.some(c => take(c).placeholder)) {
      toast('Remove empty workflow clips before exporting; they have no generated take.');
      return;
    }
    if (!total()) {
      toast('Add video or audio before exporting.');
      return;
    }
    showModal(
      'Export sequence',
      '<p>Assemble the selected takes using the current trims and clip order.</p><div class="two-fields"><label class="field"><span>Format</span><select id="exportFormat"><option value="mp4">MP4 · H.264</option><option value="otio">OpenTimelineIO (.otio)</option></select></label><label class="field"><span>Resolution / frame rate</span><input value="' +
        getResolution()().width +
        ' × ' +
        getResolution()().height +
        ' / ' +
        getFps() +
        ' fps" readonly></label></div><div class="two-fields export-range-fields"><label class="field"><span>Start</span><input id="exportStart" aria-label="Export start time" value="' +
        tc(T.exportRange(getState()).start) +
        '"></label><label class="field"><span>End</span><input id="exportEnd" aria-label="Export end time" value="' +
        tc(T.exportRange(getState()).end) +
        '"></label></div><div class="export-range-presets"><button class="outline" id="exportPicture">Picture length</button><button class="outline" id="exportEntire">Entire timeline</button><button class="outline" id="exportSelected">Selected clips</button></div><p id="exportRangeSummary"></p><p class="small">Enter seconds or HH:MM:SS:FF. The end marker is the cut after the included footage. Drag markers on the ruler, or use I / O at the playhead.</p><p id="exportRangeError" role="alert"></p><label class="export-audio"><input type="checkbox" id="exportAudio" checked> <span id="exportAudioLabel">Include audio mix</span></label><p class="small" id="exportFormatNote">Monitor mute does not affect export.</p><div id="exportResult"></div>',
      '<button class="outline" id="exportCancel">Cancel</button><button class="primary" id="renderExport">Export video</button>',
    );
    const updateRangeFields = () => {
      const range = T.exportRange(getState());
      $('exportStart').value = tc(range.start);
      $('exportEnd').value = tc(range.end);
      $('exportRangeSummary').textContent =
        'Duration: ' +
        tc(range.end - range.start) +
        ' / ' +
        (range.end - range.start) +
        ' frames' +
        (!getState().exportRange ? ' / follows picture length' : '');
      $('exportRangeError').textContent = '';
      $('renderExport').disabled = !range.end;
    };
    const applyRangeFields = () => {
      try {
        const start = exportFrameValue($('exportStart').value),
          end = exportFrameValue($('exportEnd').value);
        if (start < 0 || end <= start || end > total()) throw Error('Start must be before end, within the timeline.');
        const current = T.exportRange(getState());
        if (getState().exportRange || current.start !== start || current.end !== end) setExportRange({ start, end });
        updateRangeFields();
        return true;
      } catch (error) {
        $('exportRangeError').textContent = error.message;
        $('renderExport').disabled = true;
        return false;
      }
    };
    $('exportStart').onchange = $('exportEnd').onchange = applyRangeFields;
    $('exportPicture').onclick = () => {
      setExportRange(null);
      updateRangeFields();
    };
    $('exportEntire').onclick = () => {
      setExportRange({ start: 0, end: total() });
      updateRangeFields();
    };
    const selectedRows = [
      ...layout()
        .filter(r => selectionIds().includes(r.clip.id))
        .map(r => ({ start: r.start, end: r.end })),
      ...(getState().audioClips || [])
        .filter(c => selectionIds().includes(c.id))
        .map(c => ({ start: c.start, end: c.start + c.out - c.in })),
    ];
    $('exportSelected').disabled = !selectedRows.length;
    $('exportSelected').onclick = () => {
      setExportRange({
        start: Math.min(...selectedRows.map(r => r.start)),
        end: Math.max(...selectedRows.map(r => r.end)),
      });
      updateRangeFields();
    };
    updateRangeFields();
    const showFormat = () => {
      const otio = getExportFormat() === 'otio';
      $('exportFormat').value = getExportFormat();
      $('exportAudioLabel').textContent = otio ? 'Include audio tracks' : 'Include audio mix';
      $('exportFormatNote').textContent = otio
        ? 'Every track, clip and trim, for Resolve, Premiere Pro and other editors. Media stays where it is and is not copied. Gain and fades are not carried.'
        : 'Monitor mute does not affect export.';
      $('renderExport').textContent = otio ? 'Export timeline' : 'Export video';
      $('exportResult').textContent = '';
    };
    $('exportFormat').onchange = () => {
      writeExportFormat($('exportFormat').value);
      showFormat();
    };
    showFormat();
    $('exportCancel').onclick = closeModal;
    $('renderExport').onclick = async () => {
      if (!applyRangeFields()) return;
      if (
        layout().some(
          r =>
            r.start < T.exportRange(getState()).end &&
            r.end > T.exportRange(getState()).start &&
            take(r.clip).placeholder,
        )
      ) {
        $('exportRangeError').textContent =
          'The range includes empty workflow clips. Generate a take or exclude them from this range.';
        return;
      }
      const button = $('renderExport');
      button.disabled = true;
      button.textContent = 'Exporting…';
      if (getExportFormat() === 'otio') {
        exportTimeline(button);
        return;
      }
      $('exportResult').textContent = 'Rendering the selected edit locally…';
      try {
        await flushNative();
        const data = getExportData()();
        data.audio = $('exportAudio').checked;
        const result = await api.call('export?projectId=' + encodeURIComponent(projectKey), {
          method: 'POST',
          body: data,
          fallback: 'Export failed.',
        });
        if ($('exportResult'))
          $('exportResult').innerHTML =
            '<p>Export complete. <a class="download-link" href="' +
            esc(url(result.url)) +
            '" download="' +
            esc(result.filename) +
            '">Download MP4</a></p>';
        button.textContent = 'Export complete';
        setStatus('Sequence exported · ' + result.filename);
      } catch (error) {
        if ($('exportResult')) $('exportResult').textContent = error.message;
        button.disabled = false;
        button.textContent = 'Try again';
      }
    };
  }
  async function exportTimeline(button) {
    $('exportResult').textContent = 'Writing the timeline…';
    try {
      await flushNative();
      const plan = T.timelinePlan(getState(), T.exportRange(getState()));
      if (!$('exportAudio').checked) plan.tracks = plan.tracks.filter(t => t.kind === 'video');
      const result = await api.call('export/otio?projectId=' + encodeURIComponent(projectKey), {
        method: 'POST',
        body: { ...plan, fps: getFps(), ...getResolution()(), name: getState().project, projectId: projectKey },
        fallback: 'Export failed.',
      });
      const link = URL.createObjectURL(
        new Blob([JSON.stringify(result.timeline, null, 2)], { type: 'application/json' }),
      );
      if ($('exportResult'))
        $('exportResult').innerHTML =
          '<p>Export complete. <a class="download-link" href="' +
          link +
          '" download="' +
          esc(result.filename) +
          '">Download timeline</a></p><p class="small">Also saved as ' +
          esc(result.path) +
          '</p>';
      button.textContent = 'Export complete';
      setStatus('Timeline exported · ' + result.filename);
    } catch (error) {
      if ($('exportResult')) $('exportResult').textContent = error.message;
      button.disabled = false;
      button.textContent = 'Try again';
    }
  }
  async function downloadProject() {
    try {
      await flushNative();
      downloadValue(await request('projects/' + projectKey + '/export'));
    } catch (error) {
      toast(error.message);
    }
  }
  return {
    exportViewerFrame,
    renderExportRange,
    setExportRange,
    setExportEdge,
    cancelExportRange,
    exportVideo,
    downloadProject,
  };
}
