// Cast mentions: `@Name` in a prompt brings that cast member's pictures to the workflow.
// spool/cast.py applies the same rules; tests/fixtures/cast_mentions.json pins both.
import { inputFilled } from './input-groups.js';

const MENTION = /(?<![\p{L}\p{N}_@])@([\p{L}\p{N}_-]+)/gu;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** MiniMax H3 local and Max name pictures <Picture 1>; the Cloud node names them Image 1. */
export function tagStyle(text) {
  text = String(text || '');
  return /\bImage \d/.test(text) && !text.includes('<Picture') ? 'plain' : 'angle';
}

export function tag(style, kind, number) {
  return style === 'plain' ? kind + ' ' + number : '<' + (kind === 'Image' ? 'Picture' : kind) + ' ' + number + '>';
}

/** Cast members in order of first mention; unknown names are left alone. */
function mentioned(cast, text) {
  const byName = new Map((cast || []).map(m => [m.name.toLowerCase(), m])),
    found = [];
  for (const match of String(text || '').matchAll(MENTION)) {
    const member = byName.get(match[1].toLowerCase());
    if (member && !found.includes(member)) found.push(member);
  }
  return found;
}

/** Mentions that name nobody in the cast. */
export function unknownMentions(cast, text) {
  const names = new Set((cast || []).map(m => m.name.toLowerCase()));
  return [...new Set([...String(text || '').matchAll(MENTION)].map(m => m[1]))].filter(
    name => !names.has(name.toLowerCase()),
  );
}

/** Fill empty reference slots with mentioned members' pictures and rewrite the mentions. */
export function resolveMentions(cast, bindings, values, settings, style = 'angle') {
  values = { ...values };
  const prompts = bindings.filter(b => b.role === 'positive' && typeof values[b.key] === 'string'),
    members = mentioned(cast, prompts.map(b => values[b.key]).join(' '));
  if (!members.length) return { values, report: [] };
  const slots = bindings.filter(b => b.asset && b.slot === 'reference');
  // Chosen pictures can leave gaps; a picture's number is its slot's.
  const free = slots.flatMap((b, i) => (inputFilled(b, values, settings) ? [] : [i])),
    report = [];
  for (const member of members) {
    const pictures = [];
    for (const image of member.images || []) {
      if (!free.length) break;
      const slot = /** @type {number} */ (free.shift());
      values[slots[slot].key] = image;
      pictures.push(slot + 1);
    }
    const description = (member.description || '').trim(),
      replacement = pictures.length
        ? tag(style, 'Image', pictures[0])
        : member.name + (description ? ' (' + description + ')' : ''),
      pattern = new RegExp('(?<![\\p{L}\\p{N}_@])@' + escape(member.name) + '(?![\\p{L}\\p{N}_-])', 'giu');
    for (const b of prompts) {
      let text = values[b.key].replace(pattern, () => replacement);
      if (pictures.length > 1)
        text +=
          ' ' +
          pictures
            .slice(1)
            .map(n => tag(style, 'Image', n))
            .join(' and ') +
          ' also show ' +
          member.name +
          '.';
      values[b.key] = text;
    }
    report.push({ id: member.id, name: member.name, pictures });
  }
  return { values, report };
}
