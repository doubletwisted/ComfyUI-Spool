import { TEMPLATE_MESSAGES, TEMPLATE_MODES, templateFrame } from './bridge.js';

// Keep the iframe attached to a stable overlay: moving it reloads Comfy's frontend.
// A fresh view nonce prevents a previous opening/async capture authorizing this one.
export function createTemplateBrowser({ overlay, onUse, onCancel, idleMs = 120000 }) {
  const host = overlay.ownerDocument.defaultView,
    doc = overlay.ownerDocument;
  const surface = doc.createElement('div');
  surface.className = 'template-frame-host';
  surface.hidden = true;
  overlay.append(surface);
  let frame,
    origin,
    address,
    session,
    view = null,
    timer,
    idleTimer,
    pending = null,
    initialized = false,
    disposed = false;
  const post = value =>
    frame?.contentWindow.postMessage({ type: TEMPLATE_MESSAGES.request, session, ...value }, origin);
  const position = () => {
    if (!view) return;
    const r = view.mount.getBoundingClientRect();
    Object.assign(surface.style, {
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    });
  };
  const observer = new host.ResizeObserver(position);
  host.addEventListener('resize', position);
  host.addEventListener('scroll', position, true);
  function reset() {
    clearTimeout(timer);
    clearTimeout(idleTimer);
    pending = null;
    initialized = false;
    if (frame) {
      frame.onerror = null;
      frame.remove();
    }
    frame = null;
    address = null;
    surface.hidden = true;
  }
  function fail(message) {
    if (disposed || !view) return;
    clearTimeout(timer);
    initialized = false;
    view.status.textContent = message;
    view.retryButton.hidden = false;
    view.useButton.disabled = true;
  }
  function suspend() {
    if (!view) return;
    post({ action: 'suspend', viewId: view.id });
    view.mount.closest('[role="dialog"]')?.removeAttribute('aria-owns');
    view = null;
    pending = null;
    clearTimeout(timer);
    observer.disconnect();
    surface.hidden = true;
    frame?.classList.remove('ready');
    if (initialized) idleTimer = setTimeout(reset, idleMs);
    else reset();
  }
  const receive = async event => {
    const value = event.data;
    if (
      disposed ||
      !view ||
      event.source !== frame?.contentWindow ||
      event.origin !== origin ||
      value?.type !== TEMPLATE_MESSAGES.state ||
      value.session !== session ||
      value.viewId !== view.id
    )
      return;
    if (value.state === 'ready') {
      clearTimeout(timer);
      initialized = true;
      view.retryButton.hidden = true;
      frame.classList.add('ready');
      view.mount.querySelector('.template-loading')?.remove();
      view.status.textContent = 'Choose a template to continue.';
    }
    if (value.state === 'selected' && !pending) {
      view.status.textContent = value.name;
      view.useButton.disabled = false;
    }
    if (value.state === 'error') {
      if (pending) {
        if (value.requestId !== pending) return;
        clearTimeout(timer);
        view.status.textContent = value.message;
        view.useButton.disabled = false;
        pending = null;
      } else fail(value.message);
    }
    if (value.state === 'captured' && pending && value.requestId === pending) {
      clearTimeout(timer);
      pending = null;
      await onUse(value.capture);
    }
    if (value.state === 'cancel') onCancel();
  };
  host.addEventListener('message', receive);
  function open(comfyUrl, controls) {
    if (disposed) return;
    suspend();
    clearTimeout(idleTimer);
    const target = new URL(comfyUrl).href;
    if (address !== target || !initialized) reset();
    view = { ...controls, id: crypto.randomUUID() };
    const current = view;
    view.mount.closest('[role="dialog"]')?.setAttribute('aria-owns', 'comfyTemplateBrowser');
    view.useButton.disabled = true;
    view.retryButton.hidden = true;
    view.status.textContent = 'Loading Comfy templates…';
    surface.hidden = false;
    position();
    observer.observe(view.mount);
    timer = setTimeout(() => fail('Comfy templates did not respond. Retry when Comfy is ready.'), 45000);
    if (frame) {
      post({ action: 'activate', viewId: view.id });
    } else {
      address = target;
      origin = new URL(target).origin;
      session = crypto.randomUUID();
      const url = new URL(target);
      templateFrame(url, TEMPLATE_MODES.browse, session, host.location.origin, view.id);
      frame = doc.createElement('iframe');
      frame.id = 'comfyTemplateBrowser';
      frame.className = 'template-frame';
      frame.title = 'Comfy workflow templates';
      frame.src = url.href;
      frame.onerror = () => fail('Could not load Comfy templates. Check the connection and retry.');
      surface.append(frame);
    }
    view.useButton.onclick = () => {
      if (view !== current || view.useButton.disabled) return;
      pending = crypto.randomUUID();
      view.useButton.disabled = true;
      view.status.textContent = 'Reading selected workflow…';
      post({ action: 'capture', viewId: view.id, requestId: pending });
      clearTimeout(timer);
      timer = setTimeout(() => fail('The workflow did not respond. Retry the template browser.'), 30000);
    };
  }
  return {
    open,
    reset,
    suspend,
    canReuse: comfyUrl => !!comfyUrl && !!frame && initialized && address === new URL(comfyUrl).href,
    dispose() {
      suspend();
      reset();
      disposed = true;
      host.removeEventListener('message', receive);
      host.removeEventListener('resize', position);
      host.removeEventListener('scroll', position, true);
      observer.disconnect();
      surface.remove();
    },
  };
}
