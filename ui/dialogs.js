// Owns one modal's cleanup, keyboard boundary and return focus.
export function createDialogs({ $, esc, svg, pause, cancelCapture, stopDiagnostics }) {
  let modalCleanup = null,
    modalReturnFocus = null;
  function showModal(title, body, footer = '') {
    modalCleanup?.();
    modalCleanup = null;
    $('modal').classList.remove('project-dialog', 'render-dialog', 'template-dialog', 'shortcut-dialog');
    pause();
    modalReturnFocus = document.activeElement;
    $('modal').innerHTML =
      '<div class="modal-head"><h2 id="modalTitle">' +
      esc(title) +
      '</h2><button class="iconbutton" id="closeModal" aria-label="Close dialog">' +
      svg('close') +
      '</button></div>' +
      body +
      (footer ? '<div class="modal-footer">' + footer + '</div>' : '');
    $('modalOverlay').hidden = false;
    $('closeModal').onclick = closeModal;
    $('closeModal').focus();
  }
  function closeModal() {
    modalCleanup?.();
    modalCleanup = null;
    stopDiagnostics();
    cancelCapture();
    $('modalOverlay').hidden = true;
    modalReturnFocus?.focus();
  }
  $('modalOverlay').onclick = e => {
    if (e.target === $('modalOverlay')) closeModal();
  };
  function keydown(e) {
    if (e.key === 'Escape' && !$('modalOverlay').hidden) {
      e.stopPropagation();
      closeModal();
      return true;
    }
    if (!$('modalOverlay').hidden) {
      if (e.key === 'Tab') {
        const nodes = [...$('modalOverlay').querySelectorAll('button:not(:disabled),input,a,iframe')].filter(
          n => n.getClientRects().length,
        );
        if (!nodes.length) return true;
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
      return true;
    }
    return false;
  }
  return {
    showModal,
    closeModal,
    keydown,
    setCleanup(cleanup) {
      modalCleanup = cleanup;
    },
  };
}
