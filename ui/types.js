// Shared studio contracts. Runtime modules remain plain ES modules.
/** @typedef {null | boolean | number | string | ExactInteger | JsonValue[] | { [key: string]: JsonValue }} JsonValue */
/** @typedef {{ __spool_int__: string }} ExactInteger */
/**
 * @typedef {object} Media
 * @property {string} id
 * @property {string} kind
 * @property {string} file
 * @property {number} frames
 * @property {string} [name]
 * @property {string} [originalFile]
 * @property {string} [poster]
 * @property {string} [wave]
 * @property {number} [fps]
 * @property {number} [width]
 * @property {number} [height]
 * @property {boolean} [audio]
 */
/**
 * @typedef {object} Take
 * @property {string} id
 * @property {number} [number]
 * @property {Media} media
 * @property {boolean} [generated]
 * @property {boolean} [placeholder]
 * @property {Record<string, JsonValue>} [request]
 */
/**
 * @typedef {object} Binding
 * @property {string} key
 * @property {string} nodeId
 * @property {string} input
 * @property {string} [label]
 * @property {string} [role]
 * @property {string} [slot]
 * @property {boolean} [optional]
 * @property {boolean} [asset]
 * @property {boolean} [audio]
 * @property {string} [group]
 */
/** @typedef {{ gainDb?: number, muted?: boolean, fadeIn?: number, fadeOut?: number }} AudioMix */
/**
 * @typedef {object} Clip
 * @property {string} id
 * @property {string} name
 * @property {number} in
 * @property {number} out
 * @property {Take[]} takes
 * @property {string} takeId
 * @property {number} [revision]
 * @property {number} [start]
 * @property {number} [gapBefore]
 * @property {number} [videoTrack]
 * @property {string} [workflow]
 * @property {string} [workflowVersion]
 * @property {Binding[]} [bindings]
 * @property {Record<string, JsonValue>} [inputValues]
 * @property {{ key: string, source: string, audio?: boolean }[]} [shotInputs]
 * @property {number} [count]
 * @property {string} [seedMode]
 * @property {string} [seedKey]
 * @property {boolean} [enabled]
 * @property {AudioMix} [audio]
 * @property {boolean} [audioDetached]
 * @property {string[]} [hiddenTakeIds]
 */
/**
 * @typedef {object} AudioClip
 * @property {string} id
 * @property {string} name
 * @property {Media} media
 * @property {number} start
 * @property {number} in
 * @property {number} out
 * @property {string} [track]
 * @property {number} [sourceLane]
 * @property {AudioMix} [audio]
 */
/**
 * @typedef {object} Attempt
 * @property {string} id
 * @property {string} clipId
 * @property {string} status
 * @property {number} [createdAt]
 * @property {number} [finishedAt]
 * @property {number} [takeNumber]
 * @property {string} [takeId]
 * @property {{ id: string, value: number, max: number }[]} [nodeProgress]
 * @property {Record<string, JsonValue>} [farmProgress]
 */
/**
 * @typedef {object} Document
 * @property {string} project
 * @property {number} fps
 * @property {Clip[]} clips
 * @property {Media[]} [media]
 * @property {Attempt[]} [jobs]
 * @property {Record<string, unknown>[]} [recoverableResults]
 * @property {AudioClip[]} [audioClips]
 * @property {string} [brief]
 * @property {{ width: number, height: number }} [resolution]
 * @property {number} [tailGap]
 * @property {number} [videoTracks]
 * @property {Record<string, number>} [videoTailGaps]
 * @property {number[]} [disabledVideoTracks]
 * @property {string[]} [deletedTakeIds]
 * @property {string[]} [deletedMediaIds]
 * @property {string[]} [hiddenMediaIds]
 */
/**
 * @template T
 * @typedef {object} ApiResult
 * @property {string} id
 * @property {number} revision
 * @property {T} document
 * @property {string} [syncToken]
 * @property {Record<string, unknown>} [recipes]
 */
/**
 * @typedef {object} EditOptions
 * @property {string} id
 * @property {string} kind
 * @property {string} [mode]
 * @property {boolean} [audio]
 * @property {string} [edge]
 * @property {AudioClip} [peer]
 * @property {boolean} [snapEnabled]
 * @property {number} [snapTolerance]
 */
export {};
