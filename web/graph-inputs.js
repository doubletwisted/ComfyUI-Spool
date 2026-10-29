// Resolve the same execution addresses that Comfy serializes, including exposed
// subgraph inputs. Widget names come from the live nodes, never array guesses.
function widgetForInput(root, control) {
  const ids = control.nodeId.split(':'),
    parents = [];
  let graph = root;
  const direct = root.getNodeById(control.nodeId);
  for (const id of direct ? [] : ids.slice(0, -1)) {
    const parent = graph.getNodeById(id);
    if (!parent?.subgraph) throw Error('Workflow subgraph is missing: ' + control.nodeId);
    parents.push(parent);
    graph = parent.subgraph;
  }
  let node = direct || graph.getNodeById(ids.at(-1)),
    name = control.input;
  for (let depth = 0; node && depth < 32; depth++) {
    const input = node.inputs?.find(i => i.name === name),
      link = input?.link != null ? graph.links.get(input.link) : null;
    if (String(link?.origin_id) === '-10') {
      name = graph.inputs[link.origin_slot]?.name;
      node = parents.pop();
      graph = node?.graph;
      continue;
    }
    if (link) {
      const upstream = graph.getNodeById(link.origin_id);
      if (upstream?.type?.startsWith('Primitive')) {
        node = upstream;
        name = 'value';
        continue;
      }
      throw Error('This saved control is linked in the editable workflow: ' + control.nodeId + ' / ' + control.input);
    }
    const widget = node.widgets?.find(w => w.name === name);
    if (!widget) throw Error('Workflow input is missing: ' + control.nodeId + ' / ' + control.input);
    return { node, widget };
  }
  throw Error('Workflow node is missing: ' + control.nodeId);
}
export function applyGraphInputs(root, controls) {
  for (const control of controls || []) {
    const { widget } = widgetForInput(root, control);
    widget.value = control.value;
    widget.callback?.(control.value);
  }
}
export function captureWidgetBindings(root, prompt) {
  const bindings = [];
  for (const [nodeId, node] of Object.entries(prompt))
    for (const [input, value] of Object.entries(node.inputs)) {
      if (value !== null && typeof value === 'object') continue;
      let target;
      try {
        target = widgetForInput(root, { nodeId, input });
      } catch {
        continue;
      }
      const widgets = target.node.widgets.filter(w => w.options?.serialize !== false),
        index = widgets.indexOf(target.widget),
        serialized = target.node.serialize().widgets_values;
      if (index < 0 || !serialized || JSON.stringify(serialized[index]) !== JSON.stringify(target.widget.value))
        continue;
      const find = (graph, prefix = '') => {
        for (const n of graph.nodes) {
          if (n === target.node) return prefix + String(n.id);
          if (n.subgraph) {
            const id = find(n.subgraph, prefix + String(n.id) + ':');
            if (id) return id;
          }
        }
      };
      const widgetNodeId = find(root);
      if (!widgetNodeId) continue;
      bindings.push({ nodeId, input, widgetNodeId, widgetName: target.widget.name, widgetIndex: index });
    }
  return bindings;
}
