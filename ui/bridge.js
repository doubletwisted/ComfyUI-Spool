// Every protocol between the Spool studio and a Comfy page, shared by both sides.
// Literal values are frozen: an open tab and an updated tab must still agree.
//
// - The bridge: a BroadcastChannel per Comfy tab for capture, drops and opening graphs.
// - Handoff: a new Comfy tab opened with HANDOFF_PARAM fetches its task over HTTP.
// - Templates: an embedded Comfy document, opened with TEMPLATE_PARAMS, browses or
//   prepares templates and answers the studio by postMessage (TEMPLATE_MESSAGES).
export const CHANNEL_PREFIX = 'spool-comfy-';
export const ACTIONS = Object.freeze({ capture: 'capture', workflowDrop: 'workflowDrop', open: 'open', ping: 'ping' });
export const WORKFLOW_TAB_TYPE = 'application/x-spool-workflow-tab';
export const LINK_APPLY = 'applyLinkedWorkflow';
export const LINK_APPLIED = 'workflowLinkApplied';
export const HANDOFF_PARAM = 'spoolHandoff';
export const TEMPLATE_PARAMS = Object.freeze({
  mode: 'spoolTemplates',
  session: 'spoolTemplateSession',
  origin: 'spoolTemplateOrigin',
  view: 'spoolTemplateView',
});
export const TEMPLATE_MODES = Object.freeze({ browse: 'embedded', prepare: 'prepare' });
export const TEMPLATE_MESSAGES = Object.freeze({
  request: 'spool-template-request',
  state: 'spool-template-state',
  prepare: 'spool-prepare-template',
  prepared: 'spool-template-preparation',
});
// Address an embedded template document for this studio session.
export function templateFrame(url, mode, session, origin, view = null) {
  url.searchParams.set(TEMPLATE_PARAMS.mode, mode);
  url.searchParams.set(TEMPLATE_PARAMS.session, session);
  url.searchParams.set(TEMPLATE_PARAMS.origin, origin);
  if (view) url.searchParams.set(TEMPLATE_PARAMS.view, view);
  return url;
}
// The embedded document's session, when this page was opened in that mode.
export function templateSession(search, mode) {
  const params = new URLSearchParams(search);
  return params.get(TEMPLATE_PARAMS.mode) === mode
    ? {
        session: params.get(TEMPLATE_PARAMS.session),
        origin: params.get(TEMPLATE_PARAMS.origin),
        view: params.get(TEMPLATE_PARAMS.view),
      }
    : null;
}
export function hostBridgeId(storage, { reload = false, embedded = false } = {}) {
  const key = 'spool-comfy-bridge',
    id = (reload && !embedded && storage.getItem(key)) || crypto.randomUUID();
  if (!embedded) storage.setItem(key, id);
  return id;
}
export const openChannel = id => new BroadcastChannel(CHANNEL_PREFIX + id);
export function createClient(channel, { timeoutMs = 10000 } = {}) {
  const pending = new Map();
  let closed = false;
  const receive = ({ data }) => {
    const request = pending.get(data?.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(data.requestId);
    data.error ? request.reject(Error(data.error)) : request.resolve(data.result);
  };
  channel.addEventListener('message', receive);
  function call(action, values = {}, options = {}) {
    if (closed) return Promise.reject(Error('Editor closed'));
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID(),
        timer = setTimeout(() => {
          pending.delete(requestId);
          const error = Error('Comfy did not reply. Its workflow may still be loading. Try again.');
          error.code = 'SPOOL_BRIDGE_TIMEOUT';
          reject(error);
        }, options.timeoutMs ?? timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      channel.postMessage({ requestId, action, ...values });
    });
  }
  function close() {
    if (closed) return;
    closed = true;
    channel.removeEventListener('message', receive);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error('Editor closed'));
    }
    pending.clear();
    channel.close();
  }
  return { call, close };
}
export function serve(channel, handlers) {
  let active = true;
  const receive = async ({ data }) => {
    if (!data?.requestId || !Object.hasOwn(handlers, data.action)) return;
    try {
      const result = await handlers[data.action](data);
      if (active) channel.postMessage({ requestId: data.requestId, result });
    } catch (error) {
      if (active) channel.postMessage({ requestId: data.requestId, error: error.message });
    }
  };
  channel.addEventListener('message', receive);
  return () => {
    active = false;
    channel.removeEventListener('message', receive);
  };
}
