// Resolve the same execution addresses that Comfy serializes, including exposed
// subgraph inputs. Widget names come from the live nodes, never array guesses.
const imageLoaders = new Set(['LoadImage', 'LoadImageMask']);
const loaderRequests = new WeakMap();

// Comfy's file choices come from node definitions captured before Spool staged
// project inputs. Refresh only the image loaders present in this graph. Keep
// values and callbacks untouched: choices are discovery, not an authored edit.
export async function refreshLoaderOptions(root, fetcher = globalThis.fetch, current = () => true) {
  const targets = [];
  const visit = (graph, prefix = '') => {
    for (const node of graph.nodes || []) {
      if (imageLoaders.has(node.type)) {
        for (const widget of node.widgets || [])
          if (widget.name === 'image') targets.push({ node, owner: node, widget, type: node.type });
        // An exposed subgraph input owns its value/choices on the parent node,
        // while the execution address still names the inner image loader.
        if (root.getNodeById) {
          try {
            const { node: owner, widget } = widgetForInput(root, { nodeId: prefix + node.id, input: 'image' });
            if (owner !== node && widget.type === 'combo') targets.push({ node, owner, widget, type: node.type });
          } catch {
            // Linked execution inputs without an editable widget have no choices.
          }
        }
      }
      if (node.subgraph) visit(node.subgraph, prefix + node.id + ':');
    }
  };
  visit(root);
  if (!targets.length) return;
  for (const target of targets) target.selected = target.widget.value;
  let requests = loaderRequests.get(fetcher);
  if (!requests) loaderRequests.set(fetcher, (requests = new Map()));
  const definitions = await Promise.all(
    [...new Set(targets.map(({ type }) => type))].map(async type => {
      if (!requests.has(type)) {
        const request = (async () => {
          const response = await fetcher('/object_info/' + encodeURIComponent(type), { cache: 'no-store' });
          if (!response.ok) throw Error('Could not refresh Comfy image choices for ' + type);
          const definition = (await response.json())[type];
          const spec = definition?.input?.required?.image || definition?.input?.optional?.image;
          const values = Array.isArray(spec?.[0]) ? spec[0] : spec?.[0] === 'COMBO' ? spec[1]?.options : null;
          if (!Array.isArray(values)) throw Error('Comfy returned no image choices for ' + type);
          return values;
        })();
        requests.set(type, request);
        void request.finally(() => requests.delete(type)).catch(() => {});
      }
      return [type, await requests.get(type)];
    }),
  );
  const choices = new Map(definitions);
  const selectedImages = new Map();
  await Promise.all(
    targets.map(async ({ selected: value, type }) => {
      if (typeof value !== 'string' || !value.includes('/') || choices.get(type).includes(value)) return;
      // Native definitions list only the input directory's immediate files.
      // A project-staged selection lives below it. Confirm that exact image
      // before adding it, so genuinely missing sources still stay missing.
      const key = 'image:' + value;
      if (!requests.has(key)) {
        const request = (async () => {
          const annotation = / \[(input|output|temp)\]$/.exec(value),
            path = annotation ? value.slice(0, annotation.index) : value,
            slash = path.lastIndexOf('/'),
            query = new URLSearchParams({
              filename: path.slice(slash + 1),
              subfolder: path.slice(0, slash),
              type: annotation?.[1] || 'input',
            });
          const response = await fetcher('/view?' + query, { method: 'HEAD', cache: 'no-store' });
          if (response.status === 404) return false;
          if (!response.ok) throw Error('Could not check the selected Comfy image');
          return response.headers?.get('Content-Type')?.startsWith('image/') || false;
        })();
        requests.set(key, request);
        void request.finally(() => requests.delete(key)).catch(() => {});
      }
      selectedImages.set(value, await requests.get(key));
    }),
  );
  if (!current()) return;
  const liveNodes = new Set();
  const collect = graph => {
    for (const node of graph.nodes || []) {
      liveNodes.add(node);
      if (node.subgraph) collect(node.subgraph);
    }
  };
  collect(root);
  for (const { node, owner, widget, type, selected } of targets) {
    // A graph can be replaced while discovery is in flight. Never update a
    // detached widget or use another workflow's current selection as a fallback.
    if (
      !liveNodes.has(node) ||
      !liveNodes.has(owner) ||
      node.type !== type ||
      !owner.widgets?.includes(widget) ||
      widget.value !== selected
    )
      continue;
    widget.options ||= {};
    widget.options.values = [...choices.get(type)];
    if (selectedImages.get(widget.value) && !widget.options.values.includes(widget.value))
      widget.options.values.push(widget.value);
  }
}

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
