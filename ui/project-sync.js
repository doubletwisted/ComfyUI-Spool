// Socket messages are hints. All reads still pass through project-edit's guards.
export function createProjectSync({
  enabled,
  projectId,
  url,
  refresh,
  now = Date.now,
  open = url => new WebSocket(url),
}) {
  let socket = null,
    connected = false,
    stopped = false,
    retryAt = 0,
    lastPoll = now(),
    pending = false;
  function invalidate() {
    pending = true;
    refresh();
  }
  function connect() {
    if (!enabled || stopped || socket || now() < retryAt) return;
    try {
      socket = open(url);
    } catch {
      retryAt = now() + 5000;
      return;
    }
    const current = socket;
    current.onopen = () => {
      connected = true;
      invalidate(); // Recover messages missed before connection/reconnection.
    };
    current.onmessage = event => {
      if (typeof event.data !== 'string') return; // Comfy also sends binary previews.
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message?.type === 'spool.project' && message.data?.projectId === projectId) invalidate();
    };
    current.onclose = current.onerror = () => {
      if (socket !== current) return;
      connected = false;
      socket = null;
      retryAt = now() + 5000;
      current.onopen = current.onmessage = current.onclose = current.onerror = null;
      current.close();
      invalidate();
    };
  }
  return {
    requestPoll() {
      pending = true;
    },
    due(active) {
      connect();
      return pending || now() - lastPoll >= (connected ? 30000 : active ? 1200 : 15000);
    },
    didPoll() {
      lastPoll = now();
      pending = false;
    },
    start: connect,
    dispose() {
      stopped = true;
      connected = false;
      if (!socket) return;
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      socket = null;
    },
  };
}
