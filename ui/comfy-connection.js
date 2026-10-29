import * as B from './bridge.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createComfyConnection({
  getTopbar,
  request,
  productCapabilities,
  getProductDefinitions,
  writeProductDefinitions,
  projectKey,
  getState,
  selected,
  getBridgeId,
  writeBridgeId,
  getBridge,
  writeBridge,
  getBridgeClient,
  writeBridgeClient,
  getBridgeReady,
  writeBridgeReady,
  getStopWorkflowApply,
  writeStopWorkflowApply,
  getProjectEdit,
  flushNative,
  getFocusViewId,
  getComfyConnection,
  writeComfyConnection,
  updateClipInputs,
}) {
  function listenForWorkflowApply() {
    getStopWorkflowApply()?.();
    if (!getBridge()) return;
    const channel = getBridge();
    const receive = async ({ data }) => {
      if (
        !data?.requestId ||
        data.action !== B.LINK_APPLY ||
        data.link?.editorId !== getFocusViewId() ||
        data.link.projectId !== projectKey
      )
        return;
      let reply;
      try {
        await updateClipInputs(data.link.clipId, data.link);
        reply = { result: { applied: true } };
      } catch (error) {
        reply = { error: error.message };
      }
      if (getBridge() === channel) channel.postMessage({ requestId: data.requestId, ...reply });
    };
    channel.addEventListener('message', receive);
    writeStopWorkflowApply(() => channel.removeEventListener('message', receive));
  }
  function reconnectBridge(id) {
    if (id === getBridgeId()) return;
    getBridgeClient()?.close();
    writeBridgeId(id);
    writeBridgeReady(null);
    writeBridge(id ? B.openChannel(id) : null);
    writeBridgeClient(getBridge() ? B.createClient(getBridge()) : null);
    listenForWorkflowApply();
    const address = new URL(location.href);
    if (id) address.searchParams.set('bridge', id);
    else address.searchParams.delete('bridge');
    window.history.replaceState(null, '', address);
  }
  async function host(action, values = {}, preparedTab = null) {
    if (['open', 'prepare'].includes(action) && (values.workflow || values.prompt)) {
      const prepared = await request('prepare-workflow?projectId=' + encodeURIComponent(projectKey), {
        ...(values.workflow && (!values.prompt || values.preferWorkflow) ? { workflow: values.workflow } : {}),
        ...(values.prompt ? { prompt: values.prompt } : {}),
      });
      values = {
        ...values,
        workflow: values.prompt && !values.preferWorkflow ? null : prepared.workflow,
        prompt: prepared.prompt,
        controls: values.controls?.map(c => ({
          ...c,
          value: prepared.prompt?.[c.nodeId]?.inputs?.[c.input] ?? c.value,
        })),
      };
    }
    if (getBridgeClient() && action !== 'prepare') {
      let live;
      try {
        live = await getBridgeClient().call(B.ACTIONS.ping, {}, { timeoutMs: 900 });
      } catch (error) {
        if (error.code !== 'SPOOL_BRIDGE_TIMEOUT') throw error;
      }
      if (live?.connected && (!values.link || live.workflowLinks)) {
        writeBridgeReady(true);
        preparedTab?.close();
        return getBridgeClient().call(action, values, { timeoutMs: 120000 });
      }
      reconnectBridge(null);
    }
    if (action === B.ACTIONS.workflowDrop)
      throw Error('That Comfy tab is no longer connected. Drag the workflow again from its current tab.');
    if (action === B.ACTIONS.capture && values.link) {
      if (
        productCapabilities.configuration?.comfyUrl &&
        new URL(productCapabilities.configuration.comfyUrl).origin !== location.origin
      )
        throw Error('Open Spool from the paired Comfy host to apply linked workflow changes.');
      throw Error('Choose Edit in Comfy for this clip to reconnect its workflow, then apply changes.');
    }
    if (!['capture', 'open', 'prepare'].includes(action))
      throw Error('This action requires a connected Comfy graph tab.');
    await ensureComfy();
    const config = productCapabilities.configuration;
    await flushNative();
    const c = values.link ? getState().clips.find(c => c.id === values.link.clipId) : selected();
    if (!c && action === 'open') throw Error('Select a saved shot first.');
    const handoff = await request('projects/' + projectKey + '/handoffs', {
      action,
      clipId: c?.id,
      revision: getProjectEdit().revision,
      ...values,
    });
    const address = config.comfyUrl + '/?' + B.HANDOFF_PARAM + '=' + encodeURIComponent(handoff.id);
    const tab = preparedTab || window.open(address, '_blank');
    if (preparedTab) preparedTab.location.href = address;
    if (!tab) throw Error('Allow this site to open the Comfy graph tab, then retry.');
    const end = Date.now() + 600000;
    while (Date.now() < end) {
      await new Promise(r => setTimeout(r, 750));
      const current = await request('handoffs/' + handoff.id);
      if (current.state === 'complete') {
        if (current.result.error) throw Error(current.result.error);
        if (current.result.bridgeId) reconnectBridge(current.result.bridgeId);
        return current.result;
      }
      if (tab.closed)
        throw Error(
          'The Comfy tab was closed before the workflow finished opening. Choose Edit in Comfy to try again.',
        );
    }
    throw Error('Graph handoff expired. Open a fresh one.');
  }
  function withBridge(url) {
    return url + (getBridgeId() ? (url.includes('?') ? '&' : '?') + 'bridge=' + encodeURIComponent(getBridgeId()) : '');
  }
  function renderConnection() {
    if (getTopbar()) getTopbar().connection(getComfyConnection());
  }
  async function connectComfy() {
    writeComfyConnection(await request('comfy'));
    renderConnection();
    if (getComfyConnection().state !== 'connected') {
      if (!getComfyConnection().settings.startupFile)
        throw Error('Choose a startup file in Project → Comfy settings first.');
      writeComfyConnection(await request('comfy/start', {}));
      renderConnection();
      const end = Date.now() + 180000;
      while (getComfyConnection().state === 'starting' && Date.now() < end) {
        await new Promise(r => setTimeout(r, 750));
        writeComfyConnection(await request('comfy'));
        renderConnection();
      }
      if (getComfyConnection().state !== 'connected')
        throw Error(getComfyConnection().error || 'Comfy is still starting. Check its startup log in Comfy settings.');
    }
  }
  async function ensureComfy() {
    await connectComfy();
    Object.assign(productCapabilities, await request('capabilities'));
    writeProductDefinitions(productCapabilities.definitions || {});
  }
  return { listenForWorkflowApply, host, withBridge, connectComfy, ensureComfy, renderConnection };
}
