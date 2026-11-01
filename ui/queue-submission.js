import * as G from './generation.js';

// Submission ownership spans asynchronous preflight, transport and explicit retry.
export function createQueueActions({
  storage,
  retryKey,
  getClips,
  getRecipes,
  getCloudDefinitions,
  getDefinitions,
  isConnected,
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
  getQuality = () => 'final',
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
  // Draft takes are a request setting; the server lowers resolution the same way for agents.
  const withQuality = items => (getQuality() === 'draft' ? items.map(i => ({ ...i, quality: 'draft' })) : items);
  function queueClips(clips, reviewed = null) {
    return (
      queueSubmission
        .start(async () => {
          if (!clips.length) return;
          for (const c of clips) {
            const reason = queueReason(c);
            if (reason) throw Error(c.name + ': ' + reason);
          }
          if (!reviewed && clips.some(c => (c.count || 1) > 1)) {
            await reviewGeneration(clips);
            return;
          }
          await flushNative();
          const items = withQuality(
            reviewed || G.generationItems(clips, { ...getCloudDefinitions(), ...getDefinitions() }, getRecipes()),
          );
          return {
            revision: projectEdit.revision,
            items,
            seedUpdates: G.seedUpdates(clips, items),
            operationId: crypto.randomUUID(),
          };
        })
        // Resolves true when submitted; a conflict stays quiet for a person to press Generate
        // again, and callers that queue on their own retry it.
        .then(() => true)
        .catch(error => {
          if (error.status !== 409) toast(error.message);
          return error;
        })
        .finally(() => {
          if ($('queueList')) renderQueueList();
        })
    );
  }
  /** Re-render a draft take at full quality with its seed and the clip's current settings. */
  function queueFinal(c, take) {
    return queueSubmission
      .start(async () => {
        const reason = queueReason(c);
        if (reason) throw Error(c.name + ': ' + reason);
        if (take.summary?.workflowVersion && take.summary.workflowVersion !== c.workflowVersion)
          throw Error('This draft came from another workflow. Use it again before making it final.');
        await flushNative();
        const seeds = Object.fromEntries(
          (c.bindings || [])
            .filter(b => b.role === 'seed')
            .map(b => [b.key, take.summary?.inputValues?.[b.key] ?? take.seed])
            .filter(([, value]) => value != null),
        );
        return {
          revision: projectEdit.revision,
          items: [{ clipId: c.id, count: 1, values: seeds }],
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
  return { queueClips, queueFinal, queueSubmission };
}
