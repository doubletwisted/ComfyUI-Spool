import { API_VERSION } from './protocol.js';

// The studio's HTTP client for /spool/api. It owns the editor view header, how a
// failed reply becomes an Error, the label each request shows in the processing
// status, which requests are background work, and attaching recipes that exist
// only in this tab to a project save. Call sites pass a path below /spool/api/.
const LABELS = [
  [path => path.endsWith('/generation-preview'), 'Preparing generation inputs'],
  [path => path.endsWith('/preview'), 'Preparing viewer preview'],
  [path => path === 'import-footage', 'Importing video'],
  [path => path === 'export', 'Exporting video'],
  [path => path.endsWith('/detect-cuts'), 'Detecting cuts'],
  [path => path.includes('/capture/'), 'Capturing workflow'],
  [path => path.endsWith('/queue'), 'Queueing takes'],
  [path => path === 'comfy/start', 'Starting Comfy'],
  [(path, verb) => verb === 'PUT', 'Saving project'],
  [path => path === 'comfy', 'Checking Comfy'],
  [path => path === 'capabilities', 'Loading Comfy node definitions'],
  [(path, verb) => verb === 'GET', 'Syncing project'],
];

export function requestLabel(path, verb) {
  return LABELS.find(([match]) => match(path, verb))?.[1] || 'Updating project';
}

// A failed reply carries its status and, for revision conflicts, the current project.
async function replyValue(response, fallback = 'Spool request failed') {
  let value = null;
  try {
    value = await response.json();
  } catch (error) {
    if (response.ok) throw error;
  }
  if (!response.ok) {
    const error = Error(value?.error || fallback + (value ? '' : ' (' + response.status + ')'));
    error.code = value?.code || (response.status >= 500 ? 'internal_error' : 'invalid_request');
    error.status = response.status;
    error.current = value?.current;
    throw error;
  }
  return value;
}

export function createApi({
  diagnostics,
  project,
  recipes,
  send = (...args) => fetch(...args),
  onOutdated = () => {},
}) {
  let outdated = null;
  async function sendValue(path, options, fallback) {
    if (outdated && !['GET', 'HEAD', 'OPTIONS'].includes(options.method)) throw outdated;
    try {
      return await replyValue(await send(url(path), options), fallback);
    } catch (error) {
      if (error.code === 'studio_outdated' && !outdated) {
        outdated = error;
        onOutdated('Spool was updated. Reload this page.');
      }
      throw error;
    }
  }
  const url = path => '/spool/api/' + path;
  const projectPath = () => 'projects/' + project();

  // JSON request with the editor view. A body of undefined sends GET.
  async function request(path, body, method = 'POST', headers = {}) {
    const verb = body === undefined ? 'GET' : method,
      own = path === projectPath();
    const pending =
      verb === 'PUT' && own
        ? Object.fromEntries(
            [...new Set(body.document.clips.map(c => c.workflowVersion))]
              .filter(id => recipes().has(id))
              .map(id => [id, recipes().get(id)]),
          )
        : {};
    const payload = Object.keys(pending).length ? { ...body, workflowRecipes: pending } : body;
    return diagnostics.run(
      requestLabel(path, verb),
      async () => {
        const value = await sendValue(path, {
          method: verb,
          headers: {
            'Content-Type': 'application/json',
            'X-Spool-View': 'editor',
            ...headers,
            'X-Spool-Api-Version': String(API_VERSION),
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        for (const id of Object.keys(pending)) if (value.recipes?.[id]) recipes().delete(id);
        return value;
      },
      {
        background: (verb === 'GET' && path !== 'capabilities') || path.includes('/focus/'),
        quiet: (verb === 'GET' && own) || path.includes('/focus/'),
        detail: verb + ' /spool/api/' + path,
      },
    );
  }

  // A request outside the editor's routine sync: raw bodies, custom failure text.
  async function call(path, { method = 'GET', body, headers = {}, json = true, fallback } = {}) {
    const options = {
      method,
      headers: {
        ...(json && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
        'X-Spool-Api-Version': String(API_VERSION),
      },
    };
    if (body !== undefined) options.body = json ? JSON.stringify(body) : body;
    return sendValue(path, options, fallback);
  }

  // Send a file's bytes; the name travels percent-encoded in X-Filename.
  function upload(path, file, name, { headers = {}, fallback } = {}) {
    return call(path, {
      method: 'POST',
      body: file,
      json: false,
      fallback,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name), ...headers },
    });
  }

  return { request, call, upload };
}
