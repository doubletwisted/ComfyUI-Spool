import { captureWidgetBindings } from './graph-inputs.js';

// Layout, viewport state and derived execution order can change during a save.
// Only authored execution state determines whether the API/graph pair needs retrying.
function executionState(graph) {
  const state = g => ({
    nodes: g.nodes.map(n => ({
      id: n.id,
      type: n.type,
      mode: n.mode,
      inputs: n.inputs,
      outputs: n.outputs,
      properties: n.properties,
      widgets_values: n.widgets_values,
    })),
    links: g.links,
    inputs: g.inputs,
    outputs: g.outputs,
    subgraphs: g.definitions?.subgraphs?.map(state),
  });
  return JSON.stringify(state(graph.serialize()));
}

export async function captureComfyGraph(app, metadata = null) {
  const graph = app.rootGraph,
    workflow = app.extensionManager.workflow.activeWorkflow;
  const current = () => {
    if (app.rootGraph !== graph || app.extensionManager.workflow.activeWorkflow !== workflow)
      throw Error('Saving was cancelled because you switched workflows. Return to the linked tab and apply again.');
  };
  // Fetch schemas before capturing. Editing while these requests finish must not
  // invalidate the snapshot we are about to take.
  if (!metadata) {
    const [definitions, stats] = await Promise.all([
      fetch('/object_info').then(r => r.json()),
      fetch('/system_stats').then(r => r.json()),
    ]);
    metadata = {
      definitions,
      frontendVersion: stats.system.comfy_package_versions.find(p => p.name === 'comfyui-frontend-package')?.installed,
    };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    current();
    graph.computeExecutionOrder(false);
    const before = executionState(graph),
      serialized = await app.graphToPrompt(graph);
    current();
    const widgetBindings = captureWidgetBindings(graph, serialized.output);
    if (executionState(graph) !== before) continue;
    return structuredClone({
      widgetBindings,
      name: workflow?.filename || 'Current workflow',
      workflow: serialized.workflow,
      prompt: serialized.output,
      definitions: metadata.definitions,
      provenance: {
        source: 'Comfy graphToPrompt',
        capturedAt: new Date().toISOString(),
        workflowPath: workflow?.path,
        graphId: graph.id,
        frontendVersion: metadata.frontendVersion,
      },
    });
  }
  throw Error(
    'Comfy could not finish saving the latest inputs. Your edits are still in the graph; Apply to clip will try again.',
  );
}
