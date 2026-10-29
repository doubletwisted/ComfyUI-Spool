import { BRIDGE_VERSION } from '/spool/ui/protocol.js';
import { app } from '../../scripts/app.js';
import { createTemplatePreparation } from './template-prepare.js';
import {
  ACTIONS,
  HANDOFF_PARAM,
  LINK_APPLIED,
  LINK_APPLY,
  TEMPLATE_PARAMS,
  createClient,
  WORKFLOW_TAB_TYPE,
  openChannel,
  serve,
  hostBridgeId,
} from '/spool/ui/bridge.js';
import { containsExactInt } from '/spool/ui/wire.js';
import { keyText } from '/spool/ui/keys.js';
import { createEmbeddedTemplates } from './template-browser.js';
import { createWorkflowLinks } from './workflow-link.js';
import { applyGraphInputs } from './graph-inputs.js';
import { captureComfyGraph } from './graph-capture.js';

// crypto.randomUUID exists only in secure contexts; Comfy opened over plain HTTP from another machine still needs IDs.
if (!crypto.randomUUID)
  crypto.randomUUID = () =>
    '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
    );
const bridgeId = hostBridgeId(sessionStorage, {
  reload: performance.getEntriesByType('navigation')[0]?.type === 'reload',
  embedded: new URLSearchParams(location.search).has(TEMPLATE_PARAMS.mode),
});
const channel = openChannel(bridgeId);
let embeddedTemplates, templatePreparation, stopWorkflowToolbar, studioButton, studioTab;
const workflowDragType = WORKFLOW_TAB_TYPE;
const workflowDrags = new Map();

function onWorkflowDragStart(event) {
  const tab = event.target.closest?.('[data-workflow-path]');
  if (!tab || !event.dataTransfer) return;
  const workflow = app.extensionManager.workflow.getWorkflowByPath(tab.dataset.workflowPath);
  if (!workflow) return;
  for (const [id, ref] of workflowDrags) if (Date.now() - ref.created > 60000) workflowDrags.delete(id);
  const token = crypto.randomUUID();
  workflowDrags.set(token, { workflow, created: Date.now() });
  event.dataTransfer.setData(workflowDragType, JSON.stringify({ token, path: workflow.path }));
}
document.addEventListener('dragstart', onWorkflowDragStart, true);

async function captureGraph(metadata) {
  return captureComfyGraph(app, metadata);
}

const graphActions = {
  [ACTIONS.capture]: data => workflowLinks.capture(data),
  [ACTIONS.workflowDrop]: async data => {
    let result;
    const ref = workflowDrags.get(data.token);
    workflowDrags.delete(data.token);
    if (
      !ref ||
      Date.now() - ref.created > 60000 ||
      ref.workflow.path !== data.path ||
      !app.extensionManager.workflow.openWorkflows.includes(ref.workflow)
    ) {
      throw Error('This dragged workflow is no longer available. Drag its tab again.');
    }
    const workflow = ref.workflow;
    if (workflow === app.extensionManager.workflow.activeWorkflow) result = await captureGraph();
    else {
      const graph = workflow.changeTracker?.activeState || JSON.parse(workflow.content);
      if (!Array.isArray(graph?.nodes))
        throw Error('This tab has no editor graph available. Open it in Comfy and Add current graph.');
      result = {
        workflow: JSON.parse(JSON.stringify(graph)),
        prompt: null,
        provenance: {
          source: 'inactive Comfy workflow tab',
          workflowPath: workflow.path,
          graphOnly: true,
          capturedAt: new Date().toISOString(),
        },
      };
    }
    result.name = workflow.filename;
    return result;
  },
  [ACTIONS.open]: data => workflowLinks.open(data),
  [LINK_APPLIED]: data => workflowLinks.applied(data),
  [ACTIONS.ping]: () => ({
    bridgeVersion: BRIDGE_VERSION,
    connected: true,
    bridgeId,
    workflowLinks: true,
  }),
};
async function loadWorkflow(data) {
  if (!data.workflow?.nodes?.length)
    throw Error('This recipe has no editable Comfy graph. Import the original workflow to edit it in Comfy.');
  if (containsExactInt(data.workflow))
    throw Error(
      "This historical graph contains integers beyond the browser's exact range. Use its preserved API prompt and exact decimal controls.",
    );
  const manager = app.extensionManager.workflow;
  const workflow = manager.createNewTemporary('Spool · ' + data.name + '.json', data.workflow);
  const loaded = await app.loadGraphData(data.workflow, true, true, workflow);
  if (
    loaded === false ||
    app.extensionManager.workflow.activeWorkflow?.path !== workflow.path ||
    app.rootGraph.nodes.length !== data.workflow.nodes.length
  )
    throw Error('Comfy could not open this workflow');
  applyGraphInputs(app.rootGraph, data.controls);
  return { opened: true };
}
const workflowLinks = createWorkflowLinks(app, loadWorkflow, captureGraph, sessionStorage);
const stopServing = serve(channel, graphActions);

function createWorkflowToolbar() {
  const bar = document.createElement('div'),
    brand = document.createElement('span'),
    name = document.createElement('span'),
    button = document.createElement('button'),
    status = document.createElement('span'),
    style = document.createElement('style');
  bar.id = 'spool-workflow-toolbar';
  bar.setAttribute('role', 'group');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 4px;white-space:nowrap;font:12px system-ui';
  brand.textContent = 'Spool';
  brand.style.fontWeight = '600';
  name.className = 'spool-linked-clip';
  name.style.cssText = 'max-width:140px;overflow:hidden;text-overflow:ellipsis';
  button.className = 'comfyui-button';
  button.textContent = 'Apply to clip';
  button.style.cssText =
    'background:#ffb526;color:#171717;border:0;border-radius:5px;padding:6px 10px;cursor:pointer;font:600 12px system-ui';
  status.className = 'spool-apply-status';
  status.setAttribute('role', 'status');
  status.style.cssText = 'max-width:140px;overflow:hidden;text-overflow:ellipsis';
  style.textContent =
    '@media(max-width:1400px){#spool-workflow-toolbar .spool-linked-clip{display:none}#spool-workflow-toolbar .spool-apply-status{max-width:90px}}';
  document.head.append(style);
  bar.append(brand, name, button, status);
  app.menu.actionsGroup.append(bar);
  const client = createClient(openChannel(bridgeId), { timeoutMs: 120000 });
  let active = null,
    busy = false;
  const refresh = () => {
    const record = workflowLinks.current();
    bar.style.display = record?.link?.editorId ? 'flex' : 'none';
    if (record !== active) {
      active = record;
      status.textContent = '';
    }
    name.textContent = record?.name || 'Spool clip';
    bar.setAttribute('aria-label', 'Spool · ' + name.textContent);
    button.title =
      'Save changes to ' + name.textContent + ' and its workflow JSON. ' + keyText('Ctrl') + '+S saves the Comfy copy.';
    button.disabled = busy;
    button.style.opacity = busy ? '.6' : '1';
    bar.title = status.textContent || button.title;
  };
  button.onclick = async () => {
    const record = workflowLinks.current();
    if (!record?.link?.editorId) return;
    busy = true;
    status.textContent = 'Applying...';
    refresh();
    try {
      await client.call(LINK_APPLY, { link: record.link });
      status.textContent = 'Applied';
    } catch (error) {
      status.textContent =
        error.code === 'SPOOL_BRIDGE_TIMEOUT' ? 'Open Spool and choose Edit in Comfy to reconnect.' : error.message;
    } finally {
      busy = false;
      refresh();
    }
  };
  refresh();
  const timer = setInterval(refresh, 250);
  return () => {
    clearInterval(timer);
    client.close();
    app.menu.actionsGroup.remove(bar);
    style.remove();
  };
}

async function receiveHandoff() {
  const id = new URLSearchParams(location.search).get(HANDOFF_PARAM);
  if (!id) return;
  const call = async (path, data) => {
    const r = await fetch('/spool/api/handoffs/' + encodeURIComponent(id) + path, {
      method: data ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    const value = await r.json();
    if (!r.ok) throw Error(value.error);
    return value;
  };
  const handoff = await call('');
  if (handoff.state !== 'pending') return;
  let result;
  try {
    const readyBy = Date.now() + 120000;
    while (app.extensionManager.spinner) {
      if (Date.now() > readyBy)
        throw Error('Comfy is still restoring its workspace. Try preparing again when it is ready.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (handoff.payload.action === 'open') result = await graphActions[ACTIONS.open](handoff.payload);
    else if (handoff.payload.action === 'prepare') {
      const workflow = JSON.parse(JSON.stringify(handoff.payload.workflow));
      workflow.extra = { ...workflow.extra, spoolPreparationId: id };
      await graphActions[ACTIONS.open]({ ...handoff.payload, workflow });
      if (app.rootGraph.extra.spoolPreparationId !== id)
        throw Error('Comfy changed the workflow during preparation. Prepare it again.');
      result = await captureGraph();
      if (result.workflow.extra.spoolPreparationId !== id)
        throw Error('Comfy changed the workflow during preparation. Prepare it again.');
      delete app.rootGraph.extra.spoolPreparationId;
      delete result.workflow.extra.spoolPreparationId;
    } else {
      const button = document.createElement('button');
      button.textContent = 'Send current graph to Spool';
      button.style.cssText =
        'position:fixed;top:64px;right:20px;z-index:100000;padding:12px;background:#dfa651;color:#171717';
      document.body.append(button);
      result = await new Promise((resolve, reject) => {
        button.onclick = async () => {
          try {
            resolve(await captureGraph());
            button.remove();
          } catch (e) {
            button.textContent = e.message;
          }
        };
      });
    }
  } catch (error) {
    result = { error: error.message };
  }
  await call('/complete', { ...result, bridgeId, workflowLinks: true });
}

app.registerExtension({
  name: 'Spool.Timeline',
  commands: [{ id: 'Spool.OpenStudio', label: 'Open Spool', category: 'view-controls', function: openStudio }],
  // Workflow identity is finalized afterConfigureGraph; capture only after load.
  afterLoadGraph() {
    embeddedTemplates?.selected();
  },
  setup() {
    templatePreparation = createTemplatePreparation(app, captureGraph);
    if (templatePreparation) return;
    embeddedTemplates = createEmbeddedTemplates(app, captureGraph, () =>
      app.extensionManager.command.execute('Comfy.BrowseTemplates'),
    );
    if (!embeddedTemplates) {
      studioButton = document.createElement('button');
      studioButton.id = 'spool-open-studio';
      studioButton.className = 'comfyui-button';
      studioButton.textContent = 'Open Spool ↗';
      studioButton.onclick = openStudio;
      app.menu.actionsGroup.append(studioButton);
      stopWorkflowToolbar = createWorkflowToolbar();
    }
    receiveHandoff().catch(error => console.error('Spool graph handoff:', error));
    window.addEventListener(
      'pagehide',
      () => {
        embeddedTemplates?.dispose();
        templatePreparation?.dispose();
        studioButton?.remove();
        stopWorkflowToolbar?.();
        document.removeEventListener('dragstart', onWorkflowDragStart, true);
        workflowDrags.clear();
        stopServing();
        channel.close();
      },
      { once: true },
    );
  },
});

function openStudio() {
  if (studioTab && !studioTab.closed) {
    studioTab.focus();
    return;
  }
  const url = new URL('/spool/', location.origin);
  url.searchParams.set('bridge', bridgeId);
  const project = new URLSearchParams(location.search).get('spoolProject');
  if (project) url.searchParams.set('project', project);
  studioTab = window.open('', 'spool-studio-' + bridgeId);
  if (studioTab) {
    if (studioTab.location.href === 'about:blank') studioTab.location.assign(url.href);
    studioTab.focus();
  }
}
