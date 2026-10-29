// Per-editor ownership of the shared edit. View state, rendering and graph capture
// stay in adapters; request ordering and revision/draft decisions stay here.
export function createProjectEdit({ project, document, apply, request, blocked, notify, progress }) {
  const path = 'projects/' + project.id;
  let revision = project.revision,
    last = signature(),
    pending = null,
    draining = null,
    sendingSignature = null;
  let conflict = false,
    saveError = null,
    polling = false,
    changing = 0,
    epoch = 0;
  let capture = null,
    committedCapture = null;
  let syncToken = project.syncToken;
  function signature() {
    return JSON.stringify(document());
  }
  function dirty() {
    return conflict || !!pending || !!saveError || signature() !== last;
  }
  function status() {
    notify({
      kind: conflict ? 'conflict' : saveError ? 'error' : draining || pending ? 'saving' : 'saved',
      revision,
      message: saveError,
    });
  }
  function checkpoint() {
    return { revision, signature: signature(), epoch };
  }
  function fail(error) {
    if (error.status === 409) {
      conflict = true;
      pending = null;
      epoch++;
      notify({ kind: 'conflict', revision, error });
    }
  }
  /** @param {import('./types.js').ApiResult<import('./types.js').Document>} value */
  function applyProject(value, replace) {
    apply(value, replace);
    project = value;
    syncToken = value.syncToken;
  }
  function accept(value, replace = true) {
    revision = value.revision;
    applyProject(value, replace);
    last = signature();
    status();
  }
  function drain() {
    if (draining || conflict || changing) return;
    status();
    draining = Promise.resolve()
      .then(async () => {
        let sending = null;
        try {
          while (pending) {
            sending = pending;
            pending = null;
            sendingSignature = JSON.stringify(sending);
            const value = await request(path, { revision, document: sending }, 'PUT');
            revision = value.revision;
            last = sendingSignature;
            saveError = null;
            applyProject(value, false);
            status();
          }
        } catch (error) {
          if (error.status === 409) fail(error);
          else {
            pending = pending || sending;
            saveError = error.message;
            notify({ kind: 'error', revision, message: saveError });
          }
        }
      })
      .finally(() => {
        draining = null;
        sendingSignature = null;
        if (!saveError) status();
      });
  }
  function save() {
    if (blocked('save')) return;
    if (conflict) return;
    const current = document();
    if (saveError || JSON.stringify(current) !== (sendingSignature || last)) {
      pending = current;
      drain();
    } else {
      pending = null;
      status();
    }
  }
  async function flush() {
    if (blocked('save')) throw Error('Resolve the project save before queueing or capturing.');
    save();
    while (draining) await draining;
    if (dirty()) throw Error('Resolve the project save before queueing or capturing.');
  }
  function pollBlocked() {
    return (
      conflict ||
      saveError ||
      pending ||
      draining ||
      changing ||
      capture ||
      committedCapture ||
      blocked('poll') ||
      signature() !== last
    );
  }
  async function poll() {
    if (polling || pollBlocked()) return;
    polling = true;
    const started = checkpoint();
    try {
      let value = await request(path, undefined, 'GET', syncToken ? { 'X-Spool-Since': syncToken } : {});
      if (
        pollBlocked() ||
        revision !== started.revision ||
        epoch !== started.epoch ||
        signature() !== started.signature ||
        value.revision < revision
      )
        return;
      const progressOnly = !value.document;
      if (progressOnly) {
        const progress = new Map(value.jobs.map(job => [job.id, job]));
        value = {
          ...project,
          revision: value.revision,
          syncToken: value.syncToken,
          document: {
            ...project.document,
            jobs: projectJobs().map(({ farmProgress, nodeProgress, ...job }) => ({ ...job, ...progress.get(job.id) })),
          },
        };
      }
      if (progressOnly && value.revision === revision) {
        if (JSON.stringify(value.document.jobs) !== JSON.stringify(projectJobs())) {
          if (progress) progress(value.document.jobs);
          else apply(value, false);
          project = value;
        }
        syncToken = value.syncToken;
        status();
        return;
      }
      if (value.revision !== revision || JSON.stringify(value.document.jobs) !== JSON.stringify(projectJobs())) {
        if (blocked('replace')) {
          // Ledger arrivals can merge without repainting an input being edited.
          if (value.revision !== revision) return;
          applyProject(value, false);
          status();
        } else accept(value);
      } else {
        syncToken = value.syncToken;
        status();
      }
    } catch (error) {
      notify({ kind: 'connection', message: error.message });
    } finally {
      polling = false;
    }
  }
  // The authored document omits jobs; retain the last applied server ledger.
  /** @returns {import('./types.js').Attempt[]} */
  function projectJobs() {
    return project.document.jobs;
  }
  // Raw library imports reject a changed draft rather than overwriting it or
  // silently attaching an executable recipe. Other receipts merge the ledger.
  async function change(send, strict = false) {
    const started = checkpoint();
    changing++;
    epoch++;
    try {
      const value = await send(revision),
        incoming = value.project || value;
      const unchanged = signature() === started.signature;
      if (strict && !unchanged) return { value, adopted: false };
      if (unchanged) accept(incoming);
      else {
        revision = incoming.revision;
        applyProject(incoming, false);
        last = started.signature;
        save();
      }
      return { value, adopted: unchanged };
    } catch (error) {
      fail(error);
      throw error;
    } finally {
      changing--;
      if (pending && !saveError) drain();
    }
  }
  function beginCapture(values) {
    if (capture || committedCapture) throw Error('Finish the current capture first.');
    let complete;
    const session = {
      ...values,
      cancelled: false,
      saving: false,
      completed: new Promise(resolve => (complete = resolve)),
      owns: () => capture === session && !session.cancelled,
      cancel() {
        session.cancelled = true;
        if (capture === session) {
          capture = null;
          epoch++;
        }
        if (committedCapture !== session) complete(false);
      },
      commit() {
        if (!session.owns() || committedCapture) return false;
        capture = null;
        committedCapture = session;
        epoch++;
        return true;
      },
      finish(added = false) {
        if (committedCapture !== session) return false;
        committedCapture = null;
        epoch++;
        complete(added);
        return true;
      },
    };
    capture = session;
    epoch++;
    return session;
  }
  function cancelCapture() {
    capture?.cancel();
  }
  async function prepareNavigation() {
    const busy = () => capture || committedCapture || changing || blocked('navigation');
    if (busy()) throw Error('Finish the current dialog or gesture before opening ComfyUI.');
    await flush();
    if (busy()) throw Error('Finish the current dialog or gesture before opening ComfyUI.');
  }
  async function reload() {
    changing++;
    epoch++;
    try {
      const value = await request(path);
      conflict = false;
      pending = null;
      saveError = null;
      accept(value);
    } finally {
      changing--;
    }
  }
  return {
    save,
    flush,
    poll,
    change,
    beginCapture,
    cancelCapture,
    prepareNavigation,
    reload,
    get revision() {
      return revision;
    },
    get dirty() {
      return dirty();
    },
  };
}
