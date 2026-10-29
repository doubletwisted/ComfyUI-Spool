import { TEMPLATE_MESSAGES, TEMPLATE_MODES, templateSession } from '/spool/ui/bridge.js';

// A separate Comfy document serializes templates without touching the user's graph.
export function createTemplatePreparation(app, capture) {
  const { session, origin } = templateSession(location.search, TEMPLATE_MODES.prepare) || {};
  if (parent === window || !session || origin !== location.origin) return null;
  const send = value => parent.postMessage({ type: TEMPLATE_MESSAGES.prepared, session, ...value }, origin);
  let active = true,
    busy = false,
    metadata = null;
  const receive = async event => {
    const data = event.data;
    if (
      !active ||
      busy ||
      event.source !== parent ||
      event.origin !== origin ||
      data?.type !== TEMPLATE_MESSAGES.prepare ||
      data.session !== session
    )
      return;
    busy = true;
    try {
      const workspace = app.extensionManager.workflow.createNewTemporary(
        'Spool template preparation.json',
        data.workflow,
      );
      const loaded = await app.loadGraphData(data.workflow, true, true, workspace);
      if (loaded === false) throw Error('Comfy could not load this template. Update its required nodes.');
      const result = await capture(metadata);
      metadata = { definitions: result.definitions, frontendVersion: result.provenance.frontendVersion };
      result.definitions = Object.fromEntries(
        [...new Set(Object.values(result.prompt).map(n => n.class_type))]
          .filter(type => metadata.definitions[type])
          .map(type => [type, metadata.definitions[type]]),
      );
      send({ requestId: data.requestId, capture: result });
    } catch (error) {
      send({ requestId: data.requestId, error: error.message });
    } finally {
      busy = false;
    }
  };
  window.addEventListener('message', receive);
  void (async () => {
    const end = Date.now() + 90000;
    while (active && app.extensionManager.spinner && Date.now() < end)
      await new Promise(resolve => setTimeout(resolve, 50));
    if (active) send({ ready: true });
  })();
  return {
    dispose() {
      active = false;
      window.removeEventListener('message', receive);
    },
  };
}
