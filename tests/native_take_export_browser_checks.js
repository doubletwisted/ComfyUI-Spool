// Native acceptance for audit findings F-12 and F-23.
//
// The F-12 cases drive the real take inspector and permanent-deletion dialog against
// project-owned PNG takes plus their workflow JSON. A delayed project PUT and an
// injected project-save network failure are test faults at window.fetch; successful
// saves and the delete-takes request still reach the isolated host.
//
// The F-23 cases open the real OTIO export dialog, click the actual download anchor
// (the runner supplies a CDP download directory). Faults include a window.fetch
// network rejection and a deliberately empty plan sent to the real host for HTTP
// rejection. The runner parses completed bytes and compares the host-written file.
(async () => {
  const w = window,
    d = document,
    n = w.spoolNative,
    $ = id => n.dialogRoot.getElementById(id) || d.getElementById(id),
    state = (w.__nativeTakeExport = {
      checks: [],
      gaps: [],
      deleted: [],
      events: [],
      urlEvents: [],
      downloads: [],
      evidence: {},
    }),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    check = (label, ok) => {
      if (!ok) throw Error(label);
      state.checks.push(label);
    },
    wait = async (label, fn, timeout = 30000) => {
      const end = Date.now() + timeout;
      while (!(await fn())) {
        if (Date.now() > end) throw Error(label);
        await sleep(50);
      }
    },
    paint = () =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
    clip = () => n.state.clips.find(value => value.id === 'shot'),
    card = id => d.querySelector('#takeList [data-take="' + id + '"]'),
    menu = () => [...d.querySelectorAll('#native-clip-menu [role=menuitem]')],
    menuAction = label => {
      const button = menu().find(value => value.textContent.startsWith(label));
      if (!button || button.disabled) throw Error('Unavailable menu action: ' + label);
      return button;
    },
    closeMenu = async () => {
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(
        'Take menu did not close',
        () => !d.getElementById('native-clip-menu') || d.getElementById('native-clip-menu').hidden,
      );
    },
    selectTake = async id => {
      const checkbox = card(id)?.querySelector('[data-select-take]');
      if (!checkbox) throw Error('No take card for ' + id);
      checkbox.click();
      await paint();
    },
    openDiskDelete = async (label = 'Permanently delete selected') => {
      $('deleteTakesFromDisk').click();
      await wait('Permanent-delete menu did not open', () => menu().length === 2);
      menuAction(label).click();
      await wait(
        'Permanent-delete confirmation did not open',
        () => !$('modalOverlay').hidden && $('takeDeleteConfirm'),
      );
    },
    mediaUrl = relative =>
      '/spool/media/' + encodeURIComponent(n.projectKey) + '/' + relative.split('/').map(encodeURIComponent).join('/'),
    mediaExists = async relative =>
      (
        await state.realFetch(mediaUrl(relative) + '?native-take-export=' + Date.now(), {
          cache: 'no-store',
        })
      ).ok,
    serverProject = async () =>
      (await state.realFetch('/spool/api/projects/' + encodeURIComponent(n.projectKey))).json(),
    relativeOf = id => {
      const take = clip()?.takes.find(value => value.id === id);
      return take && (take.media.originalFile || take.media.file);
    },
    renameClip = value => {
      const input = $('clipName');
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    installFetchProbe = () => {
      if (state.installed) return;
      state.installed = true;
      state.realFetch = w.fetch.bind(w);
      w.fetch = async (input, options = {}) => {
        const url = String(input),
          method = String(options.method || 'GET').toUpperCase(),
          projectPut = method === 'PUT' && url === '/spool/api/projects/' + n.projectKey,
          deleteTakes = method === 'POST' && url.includes('/delete-takes/'),
          otio = method === 'POST' && url === '/spool/api/export/otio?projectId=' + encodeURIComponent(n.projectKey);
        if (projectPut) {
          const payload = JSON.parse(options.body);
          state.events.push({ type: 'save-start', revision: payload.revision, name: payload.document.clips[0].name });
          if (state.failSave)
            throw new TypeError('Injected project-save network failure (test fault; no HTTP request was sent)');
          if (state.holdSave) {
            state.holdSave = false;
            state.putStarted = true;
            const response = await new Promise(resolve => {
              state.releaseSave = () => {
                state.events.push({ type: 'save-release' });
                resolve(state.realFetch(input, options));
              };
            });
            state.events.push({
              type: 'save-response',
              status: response.status,
              revision: (await response.clone().json()).revision,
            });
            return response;
          }
        }
        if (deleteTakes) state.events.push({ type: 'delete-start', ...JSON.parse(options.body) });
        if (otio && state.failExport)
          throw new TypeError('Injected OTIO export network failure (test fault; no HTTP request was sent)');
        if (otio) {
          if (state.rejectExport)
            options = { ...options, body: JSON.stringify({ ...JSON.parse(options.body), tracks: [] }) };
          state.events.push({ type: 'otio-start', injectedEmptyPlan: !!state.rejectExport });
        }
        const response = await state.realFetch(input, options);
        if (projectPut || deleteTakes || otio) {
          const value = await response.clone().json();
          state.events.push({
            type: otio ? 'otio-response' : projectPut ? 'save-response' : 'delete-response',
            status: response.status,
            revision: value.project?.revision ?? value.revision,
            ...(otio && { error: value.error }),
          });
        }
        return response;
      };
    },
    noStatus = status => !state.events.some(event => event.status === status),
    projectPutCount = () => state.events.filter(event => event.type === 'save-start').length,
    deleteStartCount = () => state.events.filter(event => event.type === 'delete-start').length,
    deleteResponseCount = () => state.events.filter(event => event.type === 'delete-response').length,
    timelinePlan = async range => {
      const T = await import('/spool/ui/timeline.js');
      return T.timelinePlan(n.state, range || T.exportRange(n.state));
    },
    planClips = plan => {
      const track = plan.tracks.find(value => value.kind === 'video' && value.clips.length);
      return (track?.clips || []).map(value => ({
        name: value.name,
        start: value.start,
        sourceStart: value.in,
        duration: value.out - value.in,
      }));
    },
    totalFrames = async () => (await import('/spool/ui/timeline.js')).total(n.state),
    expectedTimeline = async range => {
      const plan = await timelinePlan(range);
      return {
        project: n.state.project,
        fps: n.state.fps,
        width: (n.state.resolution || { width: 960 }).width,
        height: (n.state.resolution || { height: 540 }).height,
        duration: plan.duration,
        clips: planClips(plan),
      };
    },
    installUrlProbe = () => {
      if (state.urlProbe) return;
      state.urlProbe = true;
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      URL.createObjectURL = value => {
        const url = create.call(URL, value);
        state.urlEvents.push({ type: 'create', url });
        return url;
      };
      URL.revokeObjectURL = url => {
        state.urlEvents.push({ type: 'revoke', url });
        return revoke.call(URL, url);
      };
    },
    downloadLink = () => $('exportResult').querySelector('a.download-link'),
    clickDownload = () => {
      const anchor = downloadLink();
      if (!anchor) throw Error('No timeline download link is shown');
      const item = { name: anchor.getAttribute('download'), href: anchor.href };
      if (!item.name || !item.href.startsWith('blob:')) throw Error('Timeline download link is malformed');
      state.downloads.push(item);
      return item;
    },
    openOtioDialog = async () => {
      $('export').click();
      await wait('Export dialog did not open', () => $('exportFormat') && $('renderExport'));
      $('exportFormat').value = 'otio';
      $('exportFormat').dispatchEvent(new Event('change'));
      await wait('Timeline export controls did not become ready', () => !$('renderExport').disabled);
    },
    closeExportDialog = async () => {
      $('exportCancel').click();
      await wait('Export dialog did not close', () => $('modalOverlay').hidden);
    },
    exportOnce = async previous => {
      $('renderExport').click();
      await wait(
        previous ? 'Replacement timeline export did not finish' : 'Timeline export did not finish',
        () => downloadLink() && downloadLink().href !== previous,
        30000,
      );
      return downloadLink().href;
    },
    stages = {
      async f12_baseline() {
        installFetchProbe();
        n.selectClip('shot');
        await n.flush();
        await wait('Take inspector did not show the fixture takes', () => card('one'));
        state.revisionBefore = n.revision;
        state.relative = Object.fromEntries(['one', 'two', 'three', 'chosen'].map(id => [id, relativeOf(id)]));
        check('The F-12 fixture has five real takes and one chosen in the edit', clip().takes.length === 5);
        check(
          'The chosen take and the first deletion candidate have project-owned PNG files',
          Object.values(state.relative).every(Boolean) && (await mediaExists(state.relative.chosen)),
        );
        check('The inspector opens with the chosen take unchanged', clip().takeId === 'chosen');
        return { checks: [] };
      },
      async f12_prepare() {
        installFetchProbe();
        await selectTake('chosen');
        $('deleteTakesFromDisk').click();
        await wait('Permanent-delete menu did not open for the chosen take', () => menu().length === 2);
        check('The take in the edit is protected in the permanent-delete menu', menu()[0].disabled);
        await closeMenu();
        await selectTake('chosen');

        await selectTake('three');
        await openDiskDelete();
        check(
          'Permanent deletion asks for confirmation while the selected file and take still exist',
          card('three') && (await mediaExists(state.relative.three)) && $('takeDeleteCancel'),
        );
        $('takeDeleteCancel').click();
        await wait('Permanent-delete cancellation did not close', () => $('modalOverlay').hidden);
        check(
          'Cancelling permanent deletion keeps the selected take and its files',
          card('three') && (await mediaExists(state.relative.three)) && deleteStartCount() === 0,
        );
        await selectTake('three');

        state.holdSave = true;
        await selectTake('one');
        renameClip('Flush keeps the pending rename');
        await wait('The delayed project save did not start', () => state.putStarted);
        await openDiskDelete();
        $('takeDeleteConfirm').click();
        await wait(
          'Permanent deletion did not start while the delayed save was pending',
          () => $('takeDeleteConfirm').textContent === 'Deleting…',
        );
        check(
          'Permanent deletion starts while its preceding project save is still pending',
          $('takeDeleteConfirm').disabled && $('takeDeleteConfirm').textContent === 'Deleting…',
        );
        check(
          'No delete-takes request is sent while the delayed save is pending',
          deleteStartCount() === 0 && state.holdSave === false,
        );
        check(
          'The pending rename and both take files are intact before the save resolves',
          clip().name === 'Flush keeps the pending rename' &&
            (await mediaExists(state.relative.one)) &&
            (await mediaExists(state.relative.chosen)),
        );
        state.evidence.pendingSave = {
          requests: projectPutCount(),
          deleteRequests: deleteStartCount(),
          revision: n.revision,
        };
        return { checks: [] };
      },
      async f12_release() {
        if (!state.releaseSave) throw Error('The delayed project save was not released');
        state.releaseSave();
        await wait('Permanent deletion did not finish after the save resolved', () => deleteResponseCount() === 1);
        await wait('Deleted take did not leave the editor', () => !clip().takes.some(take => take.id === 'one'));
        await wait('Permanent-delete dialog did not close', () => $('modalOverlay').hidden);
        const saveResponse = state.events.findIndex(event => event.type === 'save-response');
        const deleteStart = state.events.findIndex(event => event.type === 'delete-start');
        const deleteResponse = state.events.find(event => event.type === 'delete-response');
        const saved = await serverProject();
        check(
          'The pending save completed before the delete-takes request started',
          saveResponse >= 0 && deleteStart > saveResponse,
        );
        check(
          'Permanent deletion sends the revision returned by the flushed save',
          state.events[deleteStart].revision === state.events[saveResponse].revision,
        );
        check(
          'The save and delete-takes replies are successful and never a revision conflict',
          state.events[saveResponse].status === 200 && deleteResponse?.status === 200 && noStatus(409),
        );
        check(
          'The authored rename survives the confirmed permanent deletion',
          clip().name === 'Flush keeps the pending rename' &&
            saved.document.clips[0].name === 'Flush keeps the pending rename',
        );
        check(
          'The saved project records exactly the deleted take and keeps the chosen take',
          saved.document.deletedTakeIds.includes('one') &&
            saved.document.clips[0].takes.some(take => take.id === 'chosen') &&
            !saved.document.clips[0].takes.some(take => take.id === 'one'),
        );
        const oneExists = await mediaExists(state.relative.one),
          chosenExists = await mediaExists(state.relative.chosen),
          twoExists = await mediaExists(state.relative.two);
        state.evidence.releaseFiles = { oneExists, chosenExists, twoExists, relative: state.relative };
        check(
          'The deleted take file is gone while the chosen and remaining files stay',
          !oneExists && chosenExists && twoExists,
        );
        state.revisionAfterFirst = n.revision;
        state.deleted.push('one');
        state.evidence.pendingSave.result = {
          events: state.events.slice(),
          revision: n.revision,
          name: clip().name,
        };
        return { checks: [] };
      },
      async f12_prepareFailure() {
        await selectTake('two');
        state.failSave = true;
        renameClip('Flush keeps the authored draft');
        await wait('The injected save failure did not reach the editor', () =>
          $('toast').textContent.includes('Injected project-save network failure'),
        );
        const failedPuts = projectPutCount(),
          deleteBefore = deleteStartCount();
        await openDiskDelete();
        $('takeDeleteConfirm').click();
        await wait('Permanent deletion did not refuse the failed save', () =>
          $('takeDeleteError').textContent.includes('Resolve the project save before continuing.'),
        );
        const saved = await serverProject();
        check(
          'A failed draft save refuses permanent deletion without replacing the draft',
          clip().name === 'Flush keeps the authored draft' && n.dirty && $('takeDeleteConfirm').disabled === false,
        );
        check(
          'The refusal keeps the confirmation dialog and names the save requirement',
          !$('modalOverlay').hidden && $('takeDeleteError').textContent.includes('Resolve the project save'),
        );
        check(
          'The refused deletion sends no delete-takes request and leaves the files alone',
          deleteStartCount() === deleteBefore &&
            (await mediaExists(state.relative.one)) === false &&
            (await mediaExists(state.relative.two)) &&
            (await mediaExists(state.relative.chosen)),
        );
        check(
          'The failed save leaves the server project unchanged at the previous revision',
          saved.document.clips[0].name === 'Flush keeps the pending rename' &&
            saved.revision === state.revisionAfterFirst &&
            n.revision === state.revisionAfterFirst,
        );
        check(
          'The failed save never reports a false revision conflict',
          noStatus(409) && !$('modal').textContent.includes('changed'),
        );
        state.evidence.failedSave = {
          failedPutAttempts: projectPutCount() - failedPuts,
          deleteRequests: deleteStartCount() - deleteBefore,
          revision: n.revision,
          serverRevision: saved.revision,
          draftName: clip().name,
          error: $('takeDeleteError').textContent,
        };
        return { checks: [] };
      },
      async f12_retry() {
        state.failSave = false;
        $('takeDeleteConfirm').click();
        await wait('Retry after the save failure did not finish deletion', () => deleteResponseCount() === 2);
        await wait('Retried deletion did not leave the editor', () => !clip().takes.some(take => take.id === 'two'));
        await wait('Retried deletion did not close the dialog', () => $('modalOverlay').hidden);
        const response = state.events.filter(event => event.type === 'delete-response').at(-1),
          saved = await serverProject();
        check(
          'Retrying after the save succeeds deletes the take without a conflict',
          response?.status === 200 && noStatus(409) && n.revision === state.revisionAfterFirst + 2,
        );
        check(
          'The retried save keeps the authored draft that the failed attempt preserved',
          clip().name === 'Flush keeps the authored draft' &&
            saved.document.clips[0].name === 'Flush keeps the authored draft',
        );
        check(
          'The retried deletion removes only the selected file and keeps the chosen file',
          !(await mediaExists(state.relative.two)) &&
            (await mediaExists(state.relative.chosen)) &&
            (await mediaExists(state.relative.three)),
        );
        check(
          'Both accepted deletions are durable and the chosen take is still in the edit',
          saved.document.deletedTakeIds.includes('one') &&
            saved.document.deletedTakeIds.includes('two') &&
            saved.document.clips[0].takeId === 'chosen' &&
            !saved.document.clips[0].takes.some(take => take.id === 'two'),
        );
        state.deleted.push('two');
        state.evidence.retry = {
          events: state.events.slice(),
          revision: n.revision,
          serverRevision: saved.revision,
          name: clip().name,
          remaining: clip().takes.map(take => take.id),
        };
        return { checks: [] };
      },
      async f12_final() {
        check(
          'The final editor still shows the authored draft, chosen take and untouched takes',
          clip().name === 'Flush keeps the authored draft' &&
            clip().takeId === 'chosen' &&
            ['chosen', 'three', 'four'].every(id => clip().takes.some(take => take.id === id)),
        );
        check(
          'The final take-card count and selected set are consistent after both deletions',
          d.querySelectorAll('#takeList [data-take]').length === 3 && n.view.takeSelection.ids.length === 0,
        );
        return { checks: [] };
      },
      async export_baseline() {
        installFetchProbe();
        n.selectClip('shot');
        await n.flush();
        installUrlProbe();
        await wait('Timeline did not render the export shot', () => d.querySelector('#clipLane [data-clip="shot"]'));
        state.relative = { chosen: relativeOf('chosen') };
        state.firstPlan = await expectedTimeline();
        check(
          'The export fixture has one real video take with a project-owned source',
          clip().takes.length === 1 && clip().takes[0].id === 'chosen' && !!state.relative.chosen,
        );
        check(
          'The baseline timeline plan has one clip trimmed to the authored range',
          state.firstPlan.clips.length === 1 &&
            state.firstPlan.clips[0].start === 0 &&
            state.firstPlan.clips[0].sourceStart === 12 &&
            state.firstPlan.clips[0].duration === 24,
        );
        return { checks: [] };
      },
      async export_prepare() {
        await openOtioDialog();
        check(
          'The export dialog selects OpenTimelineIO and names the timeline action',
          $('exportFormat').value === 'otio' && $('renderExport').textContent === 'Export timeline',
        );
        return { checks: [] };
      },
      async export_serverFailure() {
        state.rejectExport = true;
        $('renderExport').click();
        await wait('The real host did not reject the injected empty export plan', () =>
          $('exportResult').textContent.includes('Add a clip before exporting.'),
        );
        const response = state.events.filter(event => event.type === 'otio-response').at(-1);
        check(
          'The real export route rejects the deliberately empty plan with HTTP 400',
          response?.status === 400 && response.error === 'Add a clip before exporting.',
        );
        check(
          'A failed first export shows the host error and enables retry without a download link',
          !$('renderExport').disabled && $('renderExport').textContent === 'Try again' && !downloadLink(),
        );
        check('A failed first export creates and revokes no blob URLs', state.urlEvents.length === 0);
        state.evidence.serverFailure = {
          injectedCondition: 'The test sends tracks: [] in the otherwise real OTIO request.',
          actualHttpResponse: response,
          error: $('exportResult').textContent,
        };
        state.rejectExport = false;
        return { checks: [] };
      },
      async export_first() {
        const href = await exportOnce(null);
        state.first = { href, plan: state.firstPlan, created: state.urlEvents.length, revoked: 0 };
        check(
          'The first OTIO export creates exactly one download URL and no revoke happens yet',
          href.startsWith('blob:') &&
            state.urlEvents.filter(event => event.type === 'create').length === 1 &&
            state.urlEvents.filter(event => event.type === 'revoke').length === 0,
        );
        const item = clickDownload();
        state.first.download = item;
        check(
          'The real Download timeline anchor names the exported OTIO file',
          item.name.endsWith('.otio') && linkText().includes(item.name),
        );
        return {
          checks: [],
          download: { name: item.name, href: item.href, expected: state.first.plan },
        };
      },
      async export_second() {
        await closeExportDialog();
        await openOtioDialog();
        $('exportStart').value = '00:00:00:18';
        const plan = await expectedTimeline({ start: 18, end: await totalFrames() });
        state.secondPlan = plan;
        const href = await exportOnce(state.first.href);
        state.second = { href, plan };
        const firstCreate = state.urlEvents.findIndex(
            event => event.type === 'create' && event.url === state.first.href,
          ),
          firstRevoke = state.urlEvents.findIndex(event => event.type === 'revoke' && event.url === state.first.href),
          secondCreate = state.urlEvents.findIndex(event => event.type === 'create' && event.url === href);
        check(
          'The replacement OTIO export revokes the previous blob URL before creating the new one',
          firstRevoke > firstCreate && secondCreate > firstRevoke,
        );
        check(
          'Each successful OTIO export creates exactly one new blob download URL',
          state.urlEvents.filter(event => event.type === 'create').length === 2,
        );
        const item = clickDownload();
        state.second.download = item;
        check(
          'The second timeline anchor downloads its own OTIO filename',
          item.name !== state.first.download.name && item.href !== state.first.href,
        );
        return {
          checks: [],
          download: { name: item.name, href: item.href, expected: state.second.plan },
        };
      },
      async export_failed() {
        await closeExportDialog();
        await openOtioDialog();
        $('exportStart').value = '00:00:00:18';
        state.failExport = true;
        $('renderExport').click();
        await wait('The injected OTIO export failure did not reach the dialog', () =>
          $('exportResult').textContent.includes('Injected OTIO export network failure'),
        );
        const created = state.urlEvents.filter(event => event.type === 'create').length,
          revoked = state.urlEvents.filter(event => event.type === 'revoke').length,
          live = await w.fetch(state.second.href).then(
            () => true,
            () => false,
          );
        check(
          'A failed OTIO export restores the retry button and shows the failure text',
          $('renderExport').disabled === false &&
            $('renderExport').textContent === 'Try again' &&
            $('exportResult').textContent.includes('Injected OTIO export network failure'),
        );
        check(
          'A failed OTIO export creates no blob URL and removes the displayed download link',
          created === 2 && revoked === 1 && !downloadLink(),
        );
        check('The failed export retains one previous blob URL although its link is no longer shown', live);
        state.evidence.failedExport = {
          injected: true,
          created,
          revoked,
          previousUrlStillLive: live,
          button: $('renderExport').textContent,
          error: $('exportResult').textContent,
        };
        return { checks: [] };
      },
      async export_failedAgain() {
        $('renderExport').click();
        await wait(
          'Repeated network failure did not restore the retry button',
          () => !$('renderExport').disabled && $('renderExport').textContent === 'Try again',
        );
        const created = state.urlEvents.filter(event => event.type === 'create').length,
          revoked = state.urlEvents.filter(event => event.type === 'revoke').length;
        check(
          'Repeated failed exports retain exactly one existing URL without accumulating new blobs',
          created === 2 && revoked === 1 && !downloadLink(),
        );
        await closeExportDialog();
        const previousUrlLiveAfterClose = await w.fetch(state.second.href).then(
          () => true,
          () => false,
        );
        await openOtioDialog();
        $('exportStart').value = '00:00:00:18';
        check(
          'Closing and reopening after failure keeps one prior URL and presents fresh export controls',
          previousUrlLiveAfterClose && !downloadLink() && !$('renderExport').disabled,
        );
        state.evidence.failedExport.repeatedFailure = { created, revoked, previousUrlLiveAfterClose };
        state.evidence.failedExport.lifecycle =
          'A failed export discards the displayed link but keeps one previous blob until a later successful export replaces it or the page is destroyed. Closing the dialog does not revoke it.';
        return { checks: [] };
      },
      async export_retry() {
        state.failExport = false;
        $('renderExport').click();
        await wait(
          'Retry after the failed export did not finish',
          () => downloadLink() && downloadLink().href !== state.second.href,
          30000,
        );
        const href = downloadLink().href;
        state.third = { href, plan: state.secondPlan };
        const secondRevoke = state.urlEvents.findIndex(
            event => event.type === 'revoke' && event.url === state.second.href,
          ),
          thirdCreate = state.urlEvents.findIndex(event => event.type === 'create' && event.url === href);
        check(
          'A successful retry revokes the old blob URL and creates the next download URL',
          secondRevoke >= 0 && thirdCreate > secondRevoke,
        );
        const item = clickDownload();
        state.third.download = item;
        return {
          checks: [],
          download: { name: item.name, href: item.href, expected: state.third.plan },
        };
      },
      async export_final() {
        const created = state.urlEvents.filter(event => event.type === 'create').map(event => event.url),
          revoked = state.urlEvents.filter(event => event.type === 'revoke').map(event => event.url),
          firstLive = await w.fetch(state.first.href).then(
            () => true,
            () => false,
          ),
          secondLive = await w.fetch(state.second.href).then(
            () => true,
            () => false,
          ),
          thirdLive = await w.fetch(state.third.href).then(
            () => true,
            () => false,
          );
        check(
          'After the retry exactly two old URLs are revoked and the newest URL stays live',
          created.length === 3 &&
            revoked.length === 2 &&
            !firstLive &&
            !secondLive &&
            thirdLive &&
            revoked.includes(state.first.href) &&
            revoked.includes(state.second.href),
        );
        check(
          'The failed exports added no fourth URL or download',
          created.length === 3 && state.downloads.length === 3,
        );
        await closeExportDialog();
        check('The timeline export dialog closes without changing project state', clip().takes.length === 1);
        state.evidence.urls = { created, revoked, firstLive, secondLive, thirdLive };
        return { checks: [] };
      },
    };
  function linkText() {
    return $('exportResult').textContent;
  }
  w.__nativeTakeExportStages = stages;
  const caseName = w.__nativeTakeExportCase || 'f12',
    steps =
      caseName === 'f12'
        ? [
            { name: 'f12_baseline', capture: 'f12-before', deleted: [] },
            { name: 'f12_prepare', capture: 'f12-pending-save', deleted: [] },
            { name: 'f12_release', capture: 'f12-after-first-delete', deleted: ['one'] },
            { name: 'f12_prepareFailure', capture: 'f12-failed-save-refusal', deleted: ['one'] },
            { name: 'f12_retry', deleted: ['one', 'two'] },
            { name: 'f12_final', capture: 'f12-after-retry-delete', deleted: ['one', 'two'] },
          ]
        : [
            { name: 'export_baseline', capture: 'f23-before' },
            { name: 'export_prepare', capture: 'f23-export-dialog' },
            { name: 'export_serverFailure', capture: 'f23-server-rejection', noDownload: true },
            { name: 'export_first', capture: 'f23-first-export', download: true },
            { name: 'export_second', capture: 'f23-second-export', download: true },
            { name: 'export_failed', capture: 'f23-failed-export', noDownload: true },
            { name: 'export_failedAgain', capture: 'f23-repeated-failure-reopen', noDownload: true },
            { name: 'export_retry', capture: 'f23-retry-export', download: true },
            { name: 'export_final' },
          ];
  w.__nativeTakeExportSummary = () => ({
    checks: state.checks,
    gaps: state.gaps,
    deleted: state.deleted,
    downloads: state.downloads,
    evidence: state.evidence,
  });
  return { staged: true, steps, checks: [] };
})();
