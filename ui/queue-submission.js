import * as G from './generation.js';

// Submission ownership spans asynchronous preflight, transport and explicit retry.
export function createQueueActions({
  storage,
  retryKey,
  getClips,
  getBridge,
  getRecipes,
  getCloudDefinitions,
  getDefinitions,
  isConnected,
  pingAction,
  projectKey,
  projectEdit,
  request,
  edits,
  decimal,
  $,
  closeModal,
  queueReason,
  reviewGeneration,
  flushNative,
  toast,
  renderQueueList,
}) {
  const queueSubmission = G.createQueueSubmission({ storage, key: retryKey, submit: submitQueue });
  async function submitQueue(body) {
    const { seedUpdates = [], ...payload } = body;
    await projectEdit.change(() => request('projects/' + projectKey + '/queue', payload));
    const updates = seedUpdates.filter(update => {
      const c = getClips().find(c => c.id === update.clipId);
      return (
        c &&
        c.workflowVersion === update.workflowVersion &&
        c.seedMode === update.mode &&
        c.seedKey === update.seedKey &&
        decimal(c.inputValues[update.key]) === decimal(update.before)
      );
    });
    if (updates.length) {
      edits.apply(
        'Advance generation seeds',
        () => {
          for (const update of updates) {
            const c = getClips().find(c => c.id === update.clipId);
            c.inputValues[update.key] = update.after;
            c.revision++;
          }
        },
        'inspector',
      );
    }
    if ($('generationReviewQueue')) closeModal();
    const cloudOnly = payload.items?.every(item => {
      const clip = getClips().find(c => c.id === item.clipId);
      return (clip?.executionTarget || getRecipes()[clip?.workflowVersion]?.executionTarget) === 'cloud';
    });
    toast(
      cloudOnly
        ? 'Cloud generation requests accepted.'
        : isConnected()
          ? 'Generation requests accepted.'
          : 'Requests saved; waiting for Comfy.',
    );
  }
  function queueClips(clips, reviewed = null) {
    return queueSubmission
      .start(async () => {
        if (!clips.length) return;
        if (getBridge()) {
          const live = await getBridge()
              .call(pingAction, {}, { timeoutMs: 300 })
              .catch(() => null),
            linked = live?.linkedWorkflow;
          if (
            linked?.projectId === projectKey &&
            linked.deadline &&
            clips.some(
              c =>
                c.id === linked.clipId &&
                !Object.values(getRecipes()[c.workflowVersion]?.prompt || {}).some(n =>
                  ['DeadlineSubmit', 'SaveAndSubmitNode'].includes(n.class_type),
                ),
            )
          )
            throw Error(
              'Apply this clip’s Comfy changes before generating. Its saved workflow has no Deadline submit node.',
            );
        }
        for (const c of clips) {
          const reason = queueReason(c);
          if (reason) throw Error(c.name + ': ' + reason);
        }
        if (!reviewed && clips.some(c => (c.count || 1) > 1)) {
          await reviewGeneration(clips);
          return;
        }
        await flushNative();
        const items =
          reviewed || G.generationItems(clips, { ...getCloudDefinitions(), ...getDefinitions() }, getRecipes());
        return {
          revision: projectEdit.revision,
          items,
          seedUpdates: G.seedUpdates(clips, items),
          operationId: crypto.randomUUID(),
        };
      })
      .catch(error => {
        if (error.status !== 409) toast(error.message);
      })
      .finally(() => {
        if ($('queueList')) renderQueueList();
      });
  }
  return { queueClips, queueSubmission };
}
