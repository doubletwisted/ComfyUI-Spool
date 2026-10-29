// Pointer gestures end when the window loses focus or the tab is hidden: the
// pointer-up that would finish them never arrives. Each gesture registers how it
// cancels itself (a no-op when it is not active); one listener interrupts them all,
// so a new gesture cannot forget either case. Escape stays with each gesture,
// because some restore the view and others keep it.
export function createInterruptions(view = globalThis.window, doc = globalThis.document) {
  const cancels = [];
  const interrupt = () => {
    for (const cancel of cancels) cancel();
  };
  const hidden = () => {
    if (doc.hidden) interrupt();
  };
  view.addEventListener('blur', interrupt);
  doc.addEventListener('visibilitychange', hidden);
  return {
    on(cancel) {
      cancels.push(cancel);
    },
    interrupt,
    dispose() {
      view.removeEventListener('blur', interrupt);
      doc.removeEventListener('visibilitychange', hidden);
      cancels.length = 0;
    },
  };
}
