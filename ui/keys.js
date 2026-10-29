// Shortcut names for the user's platform. The handlers accept Ctrl or Cmd everywhere,
// so only the labels change: Ctrl reads Cmd and Alt reads Option on a Mac.
export const isMac = platform => /mac|iphone|ipad/i.test(platform || '');

export const MAC = typeof navigator !== 'undefined' && isMac(navigator.userAgentData?.platform || navigator.platform);

export function keyText(text, mac = MAC) {
  text = String(text);
  return mac ? text.replace(/\bCtrl\b/g, 'Cmd').replace(/\bAlt\b/g, 'Option') : text;
}
