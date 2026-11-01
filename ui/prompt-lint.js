// Prompt checks shown under a clip's prompt before it spends GPU time. Pure; the
// inspector supplies what the workflow will receive. Each finding names the fix.
import { unknownMentions } from './cast.js';

const QUALITY =
  /\b(4k|8k|16k|masterpiece|best quality|high quality|ultra[- ]?detailed|highly detailed|ultra[- ]?realistic|award[- ]winning|trending on artstation)\b/gi;
const NEGATIVE = /\b(no|without|don't|do not|never|avoid)\s+([a-z]+)/i;
const CAMERA =
  /\b(push(?:es|ing)? in|pull(?:s|ing)? (?:back|out)|pans?|panning|tilts?|tilting|orbits?|orbiting|dolly|dollies|zoom(?:s|ing)? (?:in|out)|crane|tracking shot|whip pan|handheld|crash zoom)\b/gi;
const CUTS = /\b(cut \d+|cut to|hard cut|smash cut)\b/gi;
const SOUND =
  /\b(sound|sounds|music|silence|silent|quiet|voice|says|said|whisper|speaks|sings|hum|roar|ambien(?:t|ce)|noise|audio|footsteps|wind|waves|splash|bubbles|laugh|<audio \d+>|audio \d+|dialogue)\b|"/i;

/**
 * @param {string} text
 * @param {{ cast?: object[], pictures?: number, videos?: number, audios?: number,
 *   seconds?: number, audio?: boolean, references?: boolean, negative?: boolean, style?: string }} context
 * @returns {{ level: 'warn' | 'info', message: string }[]}
 */
export function lintPrompt(text, context = {}) {
  const value = String(text || ''),
    out = [],
    warn = message => out.push({ level: 'warn', message }),
    info = message => out.push({ level: 'info', message });
  if (!value.trim()) return [{ level: 'warn', message: 'The prompt is empty.' }];
  for (const name of unknownMentions(context.cast, value))
    warn('@' + name + ' is not in the cast. Add them in the Cast tab or fix the name.');
  if (context.references) {
    const highest = (pattern, plain) =>
      Math.max(
        0,
        ...[...value.matchAll(pattern)].map(m => Number(m[1])),
        ...[...value.matchAll(plain)].map(m => Number(m[1])),
      );
    const picture = highest(/<Picture (\d+)>/g, /\bImage (\d+)\b/g),
      video = highest(/<Video (\d+)>/g, /\bVideo (\d+)\b/g),
      audio = highest(/<Audio (\d+)>/g, /\bAudio (\d+)\b/g);
    if (picture > (context.pictures || 0))
      warn(
        'The prompt names picture ' +
          picture +
          ' but ' +
          (context.pictures ? 'only ' + context.pictures + (context.pictures === 1 ? ' is' : ' are') : 'none is') +
          ' set.',
      );
    if (video > (context.videos || 0)) warn('The prompt names video ' + video + ' but no reference video fills it.');
    if (audio > (context.audios || 0)) warn('The prompt names audio ' + audio + ' but no audio fills it.');
  }
  const words = value.split(/\s+/).filter(Boolean).length;
  if (words > 220) warn(words + ' words: long prompts lose details. Keep what the shot needs.');
  const quality = [...new Set([...value.matchAll(QUALITY)].map(m => m[0].toLowerCase()))];
  if (quality.length)
    info('“' + quality.join('”, “') + '” does little for video models. Describe the light, lens or texture instead.');
  const negative = !context.negative && value.match(NEGATIVE);
  if (negative) info('“' + negative[0] + '” can bring in the thing it names. Describe what is there instead.');
  const cuts = [...value.matchAll(CUTS)].length,
    seconds = context.seconds || 0;
  if (cuts && seconds && cuts + 1 > Math.max(1, Math.floor(seconds / 2)))
    warn(cuts + 1 + ' shots in ' + seconds + ' s. Give each cut about 2 seconds, or make the clip longer.');
  const moves = [...new Set([...value.matchAll(CAMERA)].map(m => m[0].toLowerCase()))];
  if (moves.length > 2 && !cuts)
    info('Several camera moves (' + moves.join(', ') + ') in one shot. Choose one or two.');
  if (context.audio && !SOUND.test(value))
    info('This model makes sound too. Say what we hear: voices, music or ambience.');
  return out;
}
