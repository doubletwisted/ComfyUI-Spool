import { jobStage } from './generation.js';

// Activity reads the project's event log as sentences: what happened, to which take
// of which clip, and why it failed. The raw event stays one click away.

/** @typedef {{ cursor: number, kind: string, data: any, created: number }} ActivityEvent */
/** @typedef {{ tone: 'problem' | 'done' | 'info', title: string, subject: string, detail: string }} ActivityEntry */

function subjectOf(state, { attemptId, clipId }) {
  const job = attemptId ? state.jobs?.find(j => j.id === attemptId) : null,
    clip = state.clips?.find(c => c.id === (job?.clipId ?? clipId)),
    take = job?.takeNumber ? 'Take ' + String(job.takeNumber).padStart(2, '0') : attemptId ? 'A take' : '';
  return [clip?.name, take].filter(Boolean).join(' · ');
}

const by = actor => (actor && actor !== 'human' ? ' by ' + actor : '');

/** @param {ActivityEvent} event @returns {ActivityEntry} */
export function activityEntry(event, state) {
  const data = event.data || {},
    subject = subjectOf(state, data),
    entry = (tone, title, detail = '') => ({ tone, title, subject, detail });
  switch (event.kind) {
    case 'attempt.status':
      return data.status === 'failed'
        ? entry('problem', 'Generation failed', data.error || '')
        : data.status === 'complete'
          ? entry('done', 'Take ready')
          : entry('info', jobStage({ status: data.status }), data.error || '');
    case 'queue.accepted': {
      const count = data.attemptIds?.length || 0;
      return entry('info', 'Queued ' + count + ' ' + (count === 1 ? 'take' : 'takes') + by(data.actor));
    }
    case 'submission.acknowledged':
      return entry('info', 'Submission accepted', data.jobId ? 'Job ' + data.jobId : '');
    case 'receipt.rejected':
      return entry('problem', 'Result rejected', data.error || '');
    case 'cancellation.observed':
      return entry('info', 'Cancelled', data.note || '');
    case 'execution.collected':
      return data.accepted ? entry('done', 'Result collected') : entry('info', 'Late result kept aside');
    case 'graph.handoff':
      return entry('info', data.action === 'open' ? 'Opened in ComfyUI' : 'Prepared for ComfyUI');
    case 'takes.discovered': {
      const count = data.files?.length || 0;
      return entry('done', count + ' ' + (count === 1 ? 'file' : 'files') + ' added as takes');
    }
    default:
      // Only applied commands are logged.
      if (event.kind.startsWith('command.')) {
        const action = event.kind.slice('command.'.length).replaceAll('_', ' ');
        return {
          tone: 'info',
          title: action[0].toUpperCase() + action.slice(1) + by(data.actor),
          subject: subjectOf(state, data.arguments || {}),
          detail: '',
        };
      }
      return entry('info', event.kind.replaceAll(/[._]/g, ' '));
  }
}
