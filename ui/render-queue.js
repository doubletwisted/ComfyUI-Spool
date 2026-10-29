import * as G from './generation.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createRenderQueue({
  $,
  edits,
  esc,
  svg,
  request,
  workflowStatus,
  productCapabilities,
  getProductDefinitions,
  cloudDefinitions,
  definitionsFor,
  projectKey,
  url,
  workflows,
  getState,
  selected,
  selectionIds,
  save,
  toast,
  jobPercent,
  showModal,
  closeModal,
  selectedAudio,
  getNativeRecipes,
  getDecimal,
  getProjectEdit,
  flushNative,
  pollNative,
  getQueueClips,
  getQueueSubmission,
  getExperimentRetryKey,
  getExperimentRetry,
  writeExperimentRetry,
  getJobStatus,
}) {
  function queueLabel() {
    const active = visibleJobs().filter(j => G.ACTIVE.includes(j.status)).length;
    $('queueLabel').textContent = 'Renders';
    const badge = $('renderCount');
    if (badge) badge.textContent = active || '';
    $('showQueue').setAttribute('aria-label', active ? 'Renders: ' + active + ' active requests' : 'Renders');
    $('showQueue').classList.toggle('busy', !!active);
  }
  function closeRenders() {
    const panel = $('rendersPanel');
    if (panel.hidden) return;
    const inside = panel.contains(document.activeElement);
    panel.hidden = true;
    panel.innerHTML = '';
    $('showQueue').setAttribute('aria-expanded', 'false');
    if (inside) $('showQueue').focus({ preventScroll: true });
  }
  function queueModal() {
    const panel = $('rendersPanel');
    if (!panel.hidden) {
      closeRenders();
      return;
    }
    panel.innerHTML =
      '<div class="modal-head"><h2 id="rendersTitle">Renders</h2><button class="iconbutton" id="closeRenders" aria-label="Close renders">' +
      svg('close') +
      '</button></div><div class="render-toolbar"><span id="queueSummary" role="status"></span><div class="render-toolbar-actions"><button class="textbutton" id="clearFinishedRenders" title="Clear finished entries from the queue. Takes are kept.">Clear finished</button><button class="textbutton" id="reconcileQueue" title="Refresh render status and retry collecting finished results">' +
      svg('loop') +
      ' Refresh</button></div></div><div id="queuePending" class="render-pending" hidden><div><strong>Submission not confirmed</strong><p>Retry to check the same request.</p></div><button class="outline" id="retryQueue">Retry submission</button></div><div id="queueList" class="queue-list"></div>';
    panel.hidden = false;
    $('showQueue').setAttribute('aria-expanded', 'true');
    $('closeRenders').onclick = closeRenders;
    renderQueueList();
    $('retryQueue').onclick = async () => {
      const button = $('retryQueue');
      button.disabled = true;
      try {
        await getQueueSubmission().retry();
      } catch (error) {
        toast(error.message);
      } finally {
        renderQueueList();
        if (!getQueueSubmission().pending) $('reconcileQueue').focus();
      }
    };
    $('reconcileQueue').onclick = refreshQueue;
    $('clearFinishedRenders').onclick = () =>
      clearRenders(
        visibleJobs()
          .filter(G.finishedRender)
          .map(j => j.id),
      );
    $('closeRenders').focus();
  }
  function visibleJobs() {
    return G.visibleRenderJobs(getState().jobs, getState().clearedRenderIds);
  }
  async function clearRenders(ids) {
    try {
      await flushNative();
      const requested = new Set(ids),
        clear = getState().jobs.filter(j => requested.has(j.id) && G.clearableRender(j));
      if (!clear.length) return;
      getState().clearedRenderIds = [...new Set([...(getState().clearedRenderIds || []), ...clear.map(j => j.id)])];
      save();
      await flushNative();
      renderQueueList();
      queueLabel();
      renderJobStatus();
      $('reconcileQueue')?.focus({ preventScroll: true });
      toast(clear.length + ' ' + (clear.length === 1 ? 'entry cleared' : 'entries cleared') + '. Takes kept.');
    } catch (error) {
      toast(error.message);
    }
  }
  async function refreshQueue() {
    try {
      await request('reconcile', {});
      await pollNative();
      renderQueueList();
    } catch (error) {
      toast(error.message);
    }
  }
  function renderQueueList() {
    const list = $('queueList');
    if (!list) return;
    const terminal = j => ['complete', 'cancelled'].includes(j.status),
      attention = j =>
        ['failed', 'collection_pending', 'submission_uncertain', 'uncertain', 'farm_attention'].includes(j.status);
    const jobs = visibleJobs().slice().reverse(),
      current = jobs.filter(j => !terminal(j)),
      past = jobs.filter(terminal),
      active = current.filter(j => !attention(j)),
      needs = current.filter(attention);
    $('clearFinishedRenders').disabled = !jobs.some(G.finishedRender);
    $('queueSummary').textContent =
      [
        active.length ? active.length + ' active render' + (active.length === 1 ? '' : '') : '',
        needs.length ? needs.length + ' need' + (needs.length === 1 ? 's' : '') + ' attention' : '',
      ]
        .filter(Boolean)
        .join(' · ') ||
      (past.length ? 'No active renders' : getState().jobs.length ? 'Queue is clear' : 'No renders yet');
    $('queuePending').hidden = !getQueueSubmission().pending;
    $('retryQueue').disabled = getQueueSubmission().sending;
    const row = j => {
      const observations = j.nodeProgress || [],
        running = ['running', 'farm_running'].includes(j.status);
      const farm = j.farmProgress,
        percent = jobPercent(j);
      const progress = Number.isFinite(percent)
        ? '<div class="render-progress"><progress max="100" value="' +
          esc(percent) +
          '" aria-label="' +
          esc(j.target === 'deadline' ? 'Deadline worker' : 'Current node') +
          ' progress"></progress></div>'
        : '';
      const result = getState()
          .clips.flatMap(c => c.takes)
          .find(t => t.generated && (t.summary?.attemptId ?? t.request?.attemptId) === j.id),
        output = result?.media?.originalFile;
      const details =
        '<div class="render-execution"><p>' +
        esc(
          j.target === 'deadline'
            ? 'Deadline'
            : j.target === 'cloud'
              ? 'Comfy Cloud · Developer Platform'
              : 'Local Comfy',
        ) +
        (farm?.worker ? ' · ' + esc(farm.worker) : '') +
        '</p>' +
        (farm?.message ? '<p>' + esc(farm.message) + '</p>' : '') +
        observations
          .map(
            n =>
              '<div class="job-node">' +
              esc(n.label) +
              (n.max > 1 ? ' / ' + esc(n.value) + ' of ' + esc(n.max) : '') +
              '</div>',
          )
          .join('') +
        (j.seeds?.length
          ? '<p class="job-seeds">' +
            j.seeds.map(b => esc(b.label) + ': ' + esc(getDecimal()(b.value))).join(' / ') +
            '</p>'
          : '') +
        (j.error ? '<pre class="render-error">' + esc(j.error) + '</pre>' : '') +
        (output
          ? '<p class="render-output">Saved to <a class="download-link" target="_blank" href="' +
            esc(url(output)) +
            '">' +
            esc(output) +
            '</a></p>'
          : '') +
        '<code>' +
        esc(j.submission?.external_id || j.promptId || '') +
        '</code><a class="download-link" target="_blank" href="/spool/api/attempts/' +
        encodeURIComponent(j.id) +
        '">Execution record ↗</a></div>';
      const actions =
        (j.status === 'collection_pending'
          ? '<button class="outline" data-retry-collection data-queue-focus="collect:' +
            esc(j.id) +
            '">Retry collection</button>'
          : '') +
        (G.cancelAction(j) !== 'refused' && j.status !== 'cancel_requested'
          ? '<button class="outline" data-cancel-attempt="' +
            esc(j.id) +
            '" data-queue-focus="cancel:' +
            esc(j.id) +
            '">' +
            (j.status === 'uncertain' && G.cancelAction(j) === 'cancelled' ? 'Dismiss' : 'Cancel request') +
            '</button>'
          : '') +
        (j.target === 'deadline' && j.status === 'submission_uncertain'
          ? '<button class="outline" data-recover-submission="' +
            esc(j.id) +
            '" data-queue-focus="recover:' +
            esc(j.id) +
            '">Find existing Deadline job</button>'
          : '');
      return (
        '<article class="queue-row" data-render="' +
        esc(j.id) +
        '"><details data-queue-detail="' +
        esc(j.id) +
        '"><summary class="' +
        (G.clearableRender(j) ? 'has-clear' : '') +
        '" data-queue-focus="details:' +
        esc(j.id) +
        '" aria-label="Take ' +
        esc(j.takeNumber || '') +
        ' details"><span class="render-take">Take ' +
        esc(j.takeNumber || '—') +
        '</span><span class="render-stage" data-state="' +
        (attention(j) ? 'attention' : j.status === 'complete' ? 'ready' : running ? 'running' : 'waiting') +
        '">' +
        esc(G.jobStage(j)) +
        '</span>' +
        (Number.isFinite(percent) ? '<span class="render-percent">' + Math.round(percent) + '%</span>' : '') +
        '<span data-job-elapsed="' +
        esc(j.id) +
        '"></span>' +
        (G.clearableRender(j)
          ? '<button class="render-clear" data-clear-render="' +
            esc(j.id) +
            '" data-queue-focus="clear:' +
            esc(j.id) +
            '" aria-label="Clear take ' +
            esc(j.takeNumber || '') +
            ' from queue" title="Clear from queue. Takes are kept.">' +
            svg('close') +
            '</button>'
          : '') +
        '</summary>' +
        details +
        (actions ? '<div class="render-row-actions">' + actions + '</div>' : '') +
        '</details>' +
        progress +
        '</article>'
      );
    };
    const grouped = items => {
      const groups = new Map();
      for (const job of items) {
        if (!groups.has(job.clipId)) groups.set(job.clipId, []);
        groups.get(job.clipId).push(job);
      }
      return [...groups]
        .map(
          ([id, group]) =>
            '<section class="render-shot" data-render-shot="' +
            esc(id) +
            '"><h3 title="' +
            esc(group[0].name) +
            '">' +
            esc(getState().clips.find(c => c.id === id)?.name || group[0].name) +
            '</h3>' +
            group.map(row).join('') +
            '</section>',
        )
        .join('');
    };
    const recovered = getState().recoverableResults || [];
    const html =
      grouped(current) +
      (past.length
        ? '<details class="render-history" data-queue-detail="history"><summary data-queue-focus="history">Recent renders <span>' +
          past.length +
          '</span></summary><div>' +
          grouped(past) +
          '</div></details>'
        : '') +
      (!jobs.length
        ? '<div class="queue-empty">' +
          (getState().jobs.length ? 'Queue is clear. Your takes are kept.' : 'Generated takes will appear here.') +
          '</div>'
        : '') +
      (recovered.length
        ? '<details class="render-history" data-queue-detail="recovered"><summary data-queue-focus="recovered">Results from removed shots <span>' +
          recovered.length +
          '</span></summary>' +
          recovered
            .map(
              r =>
                '<p>' +
                esc(r.clipName) +
                ' / ' +
                esc(r.takeId) +
                ' <a class="download-link" target="_blank" href="' +
                esc(url(r.media.file)) +
                '">Review media</a></p>',
            )
            .join('') +
          '</details>'
        : '');
    if (list.renderMarkup !== html) {
      const opened = new Set([...list.querySelectorAll('details[open]')].map(el => el.dataset.queueDetail)),
        focused = list.getRootNode().activeElement,
        focus = list.contains(focused) ? focused.dataset.queueFocus : null;
      list.innerHTML = html;
      list.renderMarkup = html;
      for (const el of list.querySelectorAll('details')) el.open = opened.has(el.dataset.queueDetail);
      const bind = (attribute, action, capability) =>
        list.querySelectorAll('[' + attribute + ']').forEach(
          button =>
            (button.onclick = async () => {
              try {
                const id = button.getAttribute(attribute),
                  job = getState().jobs.find(j => j.id === id),
                  clip = getState().clips.find(c => c.id === job.clipId) || { id: job.clipId };
                await authoredCommand(action, { attemptId: id }, clip, [capability]);
                await pollNative();
                renderQueueList();
              } catch (error) {
                toast(error.message);
              }
            }),
        );
      bind('data-cancel-attempt', 'cancel', 'cancel');
      bind('data-recover-submission', 'recover_submission', 'recover');
      list.querySelectorAll('[data-clear-render]').forEach(
        button =>
          (button.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            return clearRenders([button.dataset.clearRender]);
          }),
      );
      list.querySelectorAll('[data-retry-collection]').forEach(button => (button.onclick = refreshQueue));
      if (focus)
        (list.querySelector('[data-queue-focus="' + CSS.escape(focus) + '"]') || $('closeRenders')).focus({
          preventScroll: true,
        });
    }
    for (const el of list.querySelectorAll('[data-job-elapsed]'))
      el.textContent = G.jobElapsed(jobs.find(j => j.id === el.dataset.jobElapsed));
  }
  function commandScope(c, capabilities, maxTakes = 16) {
    return { projectId: projectKey, clipIds: c ? [c.id] : [], capabilities, maxTakes };
  }
  async function authoredCommand(action, args, c, capabilities) {
    await flushNative();
    const data = {
      operationId: crypto.randomUUID(),
      revision: getProjectEdit().revision,
      actor: 'human',
      scope: commandScope(c, capabilities),
      action,
      arguments: args,
    };
    await getProjectEdit().change(async () => {
      await request('projects/' + projectKey + '/commands', data);
      return request('projects/' + projectKey);
    });
    return data;
  }
  function generationSourceLabel(setting) {
    if (!setting) return 'Workflow file';
    if (setting.source === 'track')
      return setting.track === 'music'
        ? 'A2 soundtrack / aligned to shot'
        : 'A1 clip audio / V' + (setting.lane || 1) + ' / aligned to shot';
    if (setting.source === 'clip')
      return (
        [...getState().clips, ...(getState().audioClips || [])].find(c => c.id === setting.clipId)?.name ||
        'Removed audio clip'
      );
    return setting.source === 'original' ? 'Original shot' : 'Selected take';
  }
  async function reviewGeneration(clips) {
    const ids = clips.map(c => c.id);
    await flushNative();
    clips = ids.map(id => getState().clips.find(c => c.id === id)).filter(Boolean);
    if (clips.length !== ids.length) throw Error('A selected clip was removed. Select the clips to generate again.');
    let items;
    try {
      items = G.generationItems(clips, { ...cloudDefinitions, ...getProductDefinitions() }, getNativeRecipes());
    } catch (error) {
      toast(error.message);
      return;
    }
    const signature = G.reviewSignature(getState(), ids),
      total = items.reduce((n, i) => n + i.count, 0),
      takes = n => n + (n === 1 ? ' take' : ' takes'),
      decimal = getDecimal(),
      modes = {
        same: 'Fixed',
        different: 'Increment',
        increment: 'Increment',
        decrement: 'Decrement',
        randomize: 'Randomize',
      };
    function shot(c) {
      const controls = G.seedControls(c),
        count = c.count || 1,
        own = items.filter(i => i.clipId === c.id),
        seeds = i =>
          controls
            .map(
              b =>
                (controls.length > 1 ? esc(b.label) + ' ' : '') +
                esc(decimal(i.values?.[b.key] ?? c.inputValues[b.key])),
            )
            .join(' · '),
        fixed = controls.map(b => esc(decimal(c.inputValues[b.key]))).join(' / '),
        warning = !G.repeatsSameRequest(c)
          ? ''
          : controls.length
            ? '<div class="review-warning" role="alert">' +
              svg('warning') +
              '<p>Seed is Fixed, so all ' +
              count +
              ' takes use seed ' +
              fixed +
              ' and will likely come out identical.</p><button class="outline" data-vary-seeds="' +
              esc(c.id) +
              '">Increment seeds</button></div>'
            : '<div class="review-warning" role="alert">' +
              svg('warning') +
              '<p>This workflow exposes no seed, so all ' +
              count +
              ' takes run identical settings and will likely come out the same.</p></div>';
      return (
        '<section class="review-shot"><div class="review-shot-head"><strong>' +
        esc(c.name) +
        '</strong><span>' +
        takes(count) +
        ' · ' +
        esc(G.executionRoute(c, getNativeRecipes()[c.workflowVersion])) +
        '</span></div>' +
        (controls.length
          ? '<div class="review-seed-mode">' +
            (controls.length > 1 ? 'Seeds' : esc(controls[0].label)) +
            ' · ' +
            modes[c.seedMode || 'same'] +
            '</div><ol class="review-seeds">' +
            own
              .map(i => '<li>' + seeds(i) + (i.count > 1 ? '<small> × ' + i.count + '</small>' : '') + '</li>')
              .join('') +
            '</ol>'
          : '') +
        warning +
        '</section>'
      );
    }
    showModal(
      'Generate ' + takes(total),
      '<p class="review-summary">New takes are added to ' +
        (clips.length === 1 ? 'the shot' : clips.length + ' shots') +
        ' and stay unselected. The edit does not change.</p><div class="review-shots">' +
        clips.map(shot).join('') +
        '</div>',
      '<button class="outline" id="generationReviewCancel">Cancel</button><button class="primary" id="generationReviewQueue">Queue ' +
        takes(total) +
        '</button>',
    );
    $('modal').classList.add('review-dialog');
    $('modal')
      .querySelectorAll('[data-vary-seeds]')
      .forEach(
        button =>
          (button.onclick = async () => {
            const c = getState().clips.find(c => c.id === button.dataset.varySeeds),
              controls = c && G.seedControls(c);
            if (!controls?.length) return;
            edits.apply(
              'Change seed behavior',
              () => {
                c.seedMode = 'increment';
                c.seedKey = (controls.find(b => b.key === c.seedKey) || controls[0]).key;
                c.revision++;
              },
              'inspector',
            );
            await reviewGeneration(clips);
            $('generationReviewQueue')?.focus();
          }),
      );
    $('generationReviewCancel').onclick = closeModal;
    $('generationReviewQueue').onclick = async () => {
      if (G.reviewSignature(getState(), ids) !== signature) {
        await reviewGeneration(clips);
        toast('Settings changed. Review the updated values.');
        return;
      }
      $('generationReviewQueue').disabled = true;
      await getQueueClips()(clips, items);
      if ($('generationReviewQueue')) $('generationReviewQueue').disabled = false;
    };
  }
  function renderJobStatus() {
    if (!selected() || selectedAudio() || selectionIds().length > 1) {
      getJobStatus().textContent = '';
      return;
    }
    const jobs = visibleJobs().filter(j => j.clipId === selected().id && !G.TERMINAL.includes(j.status)),
      job = jobs.find(j => ['running', 'farm_running', 'collecting'].includes(j.status)) || jobs[0];
    getJobStatus().textContent = job
      ? G.jobStage(job) + ' / ' + G.jobElapsed(job) + (jobs.length > 1 ? ' / ' + jobs.length + ' pending' : '')
      : '';
  }
  async function submitExperiment(data) {
    await getProjectEdit().change(async () => {
      await request('projects/' + projectKey + '/commands', data);
      return request('projects/' + projectKey);
    });
    writeExperimentRetry(null);
    sessionStorage.removeItem(getExperimentRetryKey());
    toast('Experiment accepted. New takes stay unselected.');
  }
  function queueReason(c) {
    const recipe = getNativeRecipes()[c?.workflowVersion];
    return (
      workflowStatus(c, workflows[c?.workflow], recipe, definitionsFor(c)).reason ||
      (c?.executionTarget === 'deadline' &&
      !G.hasDeadlineLauncher(recipe) &&
      productCapabilities.deadlineExecution !== true
        ? G.DEADLINE_UNAVAILABLE
        : null) ||
      (recipe?.provenance?.builtinTemplate?.startsWith('api_') && !productCapabilities.hasApiKey
        ? 'Set your Comfy Cloud API key in Comfy settings.'
        : null)
    );
  }
  return {
    queueLabel,
    closeRenders,
    queueModal,
    visibleJobs,
    renderQueueList,
    generationSourceLabel,
    reviewGeneration,
    renderJobStatus,
    submitExperiment,
    queueReason,
  };
}
