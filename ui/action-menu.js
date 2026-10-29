// Menu DOM, keyboard navigation and focus lifetime. Actions stay with their callers.
export function createActionMenu({ $, esc, menuParent }) {
  const clipMenu = document.createElement('div');
  clipMenu.id = 'native-clip-menu';
  clipMenu.setAttribute('role', 'menu');
  clipMenu.setAttribute('aria-label', 'Clip actions');
  clipMenu.hidden = true;
  document.body.append(clipMenu);
  let menuClipId = null,
    menuOrigin = null;
  function closeClipMenu(returnFocus = true) {
    if (clipMenu.hidden) return;
    clipMenu.hidden = true;
    if (menuOrigin?.hasAttribute('aria-expanded')) menuOrigin.setAttribute('aria-expanded', 'false');
    const origin = menuOrigin?.isConnected
      ? menuOrigin
      : $('clipLane').querySelector('[data-clip="' + menuClipId + '"]');
    menuClipId = null;
    menuOrigin = null;
    if (returnFocus) origin?.focus({ preventScroll: true });
  }
  function showActionMenu(label, actions, x, y, origin) {
    closeClipMenu(false);
    menuOrigin = origin;
    clipMenu.className = '';
    clipMenu.setAttribute('aria-label', label);
    clipMenu.innerHTML = actions
      .map(
        (a, i) =>
          '<button role="menuitem" data-action="' +
          i +
          '" ' +
          (a.reason ? 'disabled aria-disabled="true"' : '') +
          '>' +
          esc(a.label) +
          (a.reason ? '<small>' + esc(a.reason) + '</small>' : '') +
          '</button>',
      )
      .join('');
    clipMenu.querySelectorAll('button').forEach(
      b =>
        (b.onclick = () => {
          const action = actions[Number(b.dataset.action)];
          closeClipMenu();
          action.run();
        }),
    );
    placeMenu(x, y);
  }
  function placeMenu(x, y) {
    menuParent().append(clipMenu);
    clipMenu.hidden = false;
    const rect = clipMenu.getBoundingClientRect();
    clipMenu.style.left = Math.max(6, Math.min(x, innerWidth - rect.width - 6)) + 'px';
    clipMenu.style.top = Math.max(6, Math.min(y, innerHeight - rect.height - 6)) + 'px';
    /** @type {HTMLButtonElement} */ (clipMenu.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
  }
  const menuKey = e => {
    if (clipMenu.hidden) return;
    e.stopImmediatePropagation();
    if (e.type === 'keyup') return;
    const items = [
        .../** @type {NodeListOf<HTMLButtonElement>} */ (clipMenu.querySelectorAll('button:not(:disabled)')),
      ],
      i = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      closeClipMenu();
    } else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      items[
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : (i + (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1) + items.length) % items.length
      ]?.focus();
    }
  };
  window.addEventListener('keydown', menuKey, true);
  window.addEventListener('keyup', menuKey, true);
  const dismissMenu = e => {
    if (!clipMenu.contains(e.target)) closeClipMenu(false);
  };
  document.addEventListener('pointerdown', dismissMenu, true);
  window.addEventListener('pagehide', () => {
    closeClipMenu(false);
    document.removeEventListener('pointerdown', dismissMenu, true);
    window.removeEventListener('keydown', menuKey, true);
    window.removeEventListener('keyup', menuKey, true);
  });
  return {
    clipMenu,
    closeClipMenu,
    showActionMenu,
    placeMenu,
    setOrigin(origin, clipId = null) {
      menuOrigin = origin;
      menuClipId = clipId;
    },
  };
}
