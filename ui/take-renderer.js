import * as T from './timeline.js';
import * as G from './generation.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createTakeRenderer({
  $,
  esc,
  projectKey,
  url,
  thumbnails,
  takeHoverLabel,
  getFps,
  getState,
  review,
  takeSeen,
  selected,
  clamp,
  seconds,
  tc,
  draw,
  takeName,
  pendingJobs,
  getTakeBatchKey,
  updateTakeSelection,
  viewTake,
  chooseTake,
  getDraggedTake,
  writeDraggedTake,
  getTakeDropPreview,
  getRenderPlaceholderState,
  getPlay,
  selectedAudio,
  getDecimal,
}) {
  function takeMidpoint(c, t) {
    return (Math.min(c.in, t.media.frames - 1) + Math.min(c.out, t.media.frames)) / 2;
  }
  function scrubTake(button, t, frame) {
    takeHoverLabel.textContent = 'Hover · ' + takeName(t) + ' · ' + tc(Math.floor(frame));
    thumbnails.scrub(button, t.media, frame, getFps());
  }
  function takeBatchInputs(t) {
    const seeds = new Set(
      (t.summary?.bindings || t.request?.capture?.bindings || []).filter(b => b.role === 'seed').map(b => b.key),
    );
    return Object.entries(t.summary?.inputValues || t.request?.inputValues || {})
      .filter(([key]) => !seeds.has(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
  function takeBatchLabel(takes, previous) {
    const t = takes[0],
      count = takes.length + ' ' + (takes.length === 1 ? 'take' : 'takes');
    if (!t.generated) return [t.original ? 'Original' : 'Imported', count];
    const job = getState().jobs.find(j => j.id === (t.summary?.attemptId ?? t.request?.attemptId)),
      time = job?.createdAt
        ? new Date(job.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
    let summary = 'Generated';
    if (previous) {
      const labels = new Map(
          (t.summary?.bindings || t.request?.capture?.bindings || []).map(b => [b.key, b.label || b.key]),
        ),
        now = new Map(takeBatchInputs(t)),
        before = new Map(takeBatchInputs(previous));
      const changed = [...new Set([...now.keys(), ...before.keys()])]
        .filter(key => JSON.stringify(now.get(key)) !== JSON.stringify(before.get(key)))
        .map(key => labels.get(key) || key);
      summary =
        (t.summary?.workflowVersion ?? t.request?.workflowVersion) !==
        (previous.summary?.workflowVersion ?? previous.request?.workflowVersion)
          ? 'Workflow changed'
          : changed.length
            ? changed.slice(0, 2).join(', ') + (changed.length > 2 ? ' +' + (changed.length - 2) : '') + ' changed'
            : 'Same inputs';
    }
    return [summary, [time, count].filter(Boolean).join(' · ')];
  }
  function groupTakeCards(real, cards) {
    const groups = [];
    real.forEach((t, index) => {
      const key = getTakeBatchKey()(t);
      if (groups.at(-1)?.key === key) groups.at(-1).indexes.push(index);
      else groups.push({ key, indexes: [index] });
    });
    if (groups.length < 2) return cards.join('');
    let previous = null;
    return groups
      .map(({ indexes }) => {
        const takes = indexes.map(i => real[i]),
          [summary, meta] = takeBatchLabel(takes, previous);
        if (takes[0].generated) previous = takes[0];
        return (
          '<div class="take-group"><span>' +
          esc(summary) +
          '</span><span>' +
          esc(meta) +
          '</span></div>' +
          indexes.map(i => cards[i]).join('')
        );
      })
      .join('');
  }
  function jobPercent(j) {
    const observations = j.nodeProgress || [],
      node = observations.filter(n => n.max > 1).at(-1) || observations.at(-1),
      running = ['running', 'farm_running'].includes(j.status);
    return running
      ? j.target === 'deadline'
        ? j.farmProgress?.percent
        : node?.max > 1
          ? (100 * node.value) / node.max
          : null
      : null;
  }
  function renderPendingTakes(c) {
    const jobs = c && !selectedAudio() ? pendingJobs(c) : [];
    $('takes').classList.toggle('has-pending', jobs.length > 0);
    draw(
      'takePending',
      jobs
        .map(j => {
          const percent = jobPercent(j),
            known = Number.isFinite(percent);
          return (
            '<div class="take-pending-row" data-pending-job="' +
            esc(j.id) +
            '"><span class="take-pending-thumb">' +
            (known ? Math.round(percent) + '%' : '…') +
            '</span><span class="take-pending-info"><strong>' +
            (j.takeNumber ? 'Take ' + String(j.takeNumber).padStart(2, '0') : 'New take') +
            '</strong><small>' +
            esc(G.jobStage(j)) +
            ' · <span data-job-elapsed="' +
            esc(j.id) +
            '">' +
            esc(G.jobElapsed(j)) +
            '</span></small>' +
            (known ? '<span class="take-pending-bar"><i style="width:' + percent.toFixed(1) + '%"></i></span>' : '') +
            '</span></div>'
          );
        })
        .join(''),
    );
  }
  function renderTakes() {
    getRenderPlaceholderState()();
    const c = selected(),
      real = T.realTakes(c),
      list = $('takeList');
    updateTakeSelection();
    renderPendingTakes(c);
    $('takes').classList.toggle('has-real-takes', real.length > 0 && !selectedAudio());
    $('takes').classList.toggle('has-clip', !!c && !selectedAudio());
    $('takeCount').textContent = real.length;
    $('takesClip').textContent = c?.name || '';
    /** @type {HTMLElement} */ (document.querySelector('.takes-keys')).hidden = !!selectedAudio();
    $('takeCount').parentElement.firstChild.nodeValue = selectedAudio() ? 'Audio' : 'Takes';
    if (selectedAudio()) {
      thumbnails.stopScrub();
      $('takeCount').textContent = '';
      $('takesClip').textContent = selectedAudio().name;
      draw(
        'takeList',
        '<div class="takes-empty">Audio selected - adjust level and fades in Audio; Source reviews the full file.</div>',
      );
      return;
    }

    if (!real.length) {
      thumbnails.stopScrub();
      draw(
        'takeList',
        c ? '<div class="takes-empty">Copy videos or images into this clip’s folder to add takes.</div>' : '',
      );
      return;
    }
    const viewing = review.mode === 'source' && review.source?.clipId === c.id ? review.source.takeId : null,
      unseen = new Set(takeSeen.unseen(c).map(t => t.id));
    if (
      draw(
        'takeList',
        groupTakeCards(
          real,
          real.map(t => {
            const chosen = t.id === c.takeId,
              setupChosen = chosen && c.generationBase?.takeId === t.id,
              preview = t.id === viewing,
              title = t.original ? 'Original' : String(t.number).padStart(2, '0');
            const fresh = unseen.has(t.id)
              ? '<span class="take-badge new" title="Not yet reviewed in Source or Compare">New</span>'
              : '';
            const body =
              '<div class="take-heading"><strong>' +
              title +
              '</strong>' +
              (chosen || preview
                ? '<span class="take-badge ' +
                  (chosen ? 'used' : 'preview') +
                  '">' +
                  (chosen ? 'In edit' : 'Preview') +
                  '</span>'
                : '') +
              fresh +
              '</div><button class="take-thumb" data-view="' +
              t.id +
              '" aria-label="Preview ' +
              esc(title) +
              '"><img src="' +
              esc(url(t.media.poster)) +
              '" alt=""></button><div class="take-details"><span class="take-duration" title="Full take duration">' +
              seconds(t.media.frames) +
              '</span>' +
              (t.seed != null
                ? '<span class="take-seed" title="Seed ' +
                  esc(getDecimal()(t.seed)) +
                  '">Seed ' +
                  esc(getDecimal()(t.seed)) +
                  '</span>'
                : '') +
              (!setupChosen ? '<button class="use-take" data-use="' + t.id + '">Use take</button>' : '') +
              '</div>';
            return (
              '<article class="take-card' +
              (chosen ? ' chosen' : '') +
              (preview ? ' viewing' : '') +
              '" data-take="' +
              esc(t.id) +
              '" tabindex="0" aria-label="Take ' +
              esc(title) +
              '"><input type="checkbox" class="take-select" data-select-take="' +
              esc(t.id) +
              '" aria-label="Select take ' +
              esc(title) +
              '">' +
              body +
              '</article>'
            );
          }),
        ),
      )
    ) {
      thumbnails.stopScrub();
      list.querySelectorAll('[data-view]').forEach(b => {
        const img = b.querySelector('img'),
          t = c.takes.find(t => t.id === b.dataset.view),
          middle = takeMidpoint(c, t);
        thumbnails.bind(img, t.media, middle, getFps());
        b.draggable = true;
        img.draggable = false;
        b.ondragstart = e => {
          thumbnails.stopScrub();
          writeDraggedTake({ projectId: projectKey, clipId: c.id, takeId: t.id, frames: t.media.frames });
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/spool-take', JSON.stringify(getDraggedTake()));
        };
        b.ondragend = () => {
          writeDraggedTake(null);
          getTakeDropPreview().hidden = true;
        };
        b.onclick = () =>
          review.mode === 'source' && review.source?.takeId === b.dataset.view ? getPlay()() : viewTake(b.dataset.view);
        b.onpointerenter = b.onpointermove = e => {
          const r = b.getBoundingClientRect(),
            end = t.media.frames;
          scrubTake(b, t, Math.min(end - 1, Math.floor(clamp((e.clientX - r.left) / r.width, 0, 1) * end)));
        };
        b.onpointerleave = () => thumbnails.stopScrub(b);
      });
      list.querySelectorAll('[data-use]').forEach(b => (b.onclick = () => chooseTake(c.id, b.dataset.use)));
    }
    updateTakeSelection();
  }
  return { takeBatchInputs, jobPercent, renderPendingTakes, renderTakes };
}
