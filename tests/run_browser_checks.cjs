// Dependency-free installed browser checks against the owned CPU QA host on 8195.
// Serves this checkout's ui/* and Spool web/* over Fetch interception, so frontend
// edits use this branch even when another QA checkout started the shared 8195 host.
//
//   node tests/run_browser_checks.cjs CHROMIUM_EXECUTABLE EVIDENCE_DIR [check-name ...]
//
// Each registered check declares the project it needs, the editor mode it runs in
// and the file under tests/ that asserts it. A check file is an async IIFE that
// returns { checks: [...] } and throws on the first failure.
const fs = require('node:fs'),
  path = require('node:path'),
  { spawn, execFileSync } = require('node:child_process'),
  assert = require('node:assert/strict');
const [executable, evidence = '.native-test/browser-checks'] = process.argv.slice(2);
const ui = path.join(__dirname, '../ui');
const requested = process.argv.slice(4);
const base = process.env.SPOOL_BROWSER_BASE || 'http://127.0.0.1:8195',
  port = Number(process.env.SPOOL_BROWSER_PORT || 9228);
const apiBase = process.env.SPOOL_API_BASE || base;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url),
    pending = new Map(),
    handlers = {};
  let serial = 0;
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = event => {
    const value = JSON.parse(event.data),
      waiting = pending.get(value.id);
    if (waiting) {
      pending.delete(value.id);
      value.error ? waiting.reject(Error(value.error.message)) : waiting.resolve(value.result);
    } else handlers[value.method]?.(value.params);
  };
  return {
    on: (method, fn) => (handlers[method] = fn),
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}

async function api(endpoint, data, method) {
  const response = await fetch(apiBase + '/spool/api/' + endpoint, {
    method: method || (data ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'Spool request failed');
  return value;
}

// --- fixtures ---------------------------------------------------------------
const still = (id, extra) => ({
  id,
  kind: 'video',
  name: id + '.mp4',
  file: 'assets/black.png',
  originalFile: 'assets/black.png',
  poster: 'assets/black.png',
  frames: 120,
  width: 16,
  height: 16,
  audio: false,
  ...extra,
});
const graph = firstNode => ({ nodes: [{ id: firstNode, type: 'SaveImage' }], links: [], version: 0.4 });
const probe = { streams: [{ codec_type: 'video', nb_frames: '120' }], format: { duration: '5.0' } };

// A timeline long enough that rebuilding the lane per drag frame is measurable, with
// a clip in the middle to drag and neighbours either side of it.
const timelineClips = (count, gapBefore = 0) => {
  const media = id => ({
    id,
    kind: 'image',
    name: id + '.png',
    file: 'assets/black.png',
    originalFile: 'assets/black.png',
    poster: 'assets/black.png',
    frames: 120,
    width: 16,
    height: 16,
    audio: false,
  });
  return Array.from({ length: count }, (_, index) => ({
    id: 'drag-clip-' + index,
    name: 'Shot ' + index,
    in: 0,
    out: 48,
    count: 1,
    revision: 1,
    sources: [],
    ...(index && gapBefore ? { gapBefore } : {}),
    takeId: 'drag-take-' + index,
    takes: [{ id: 'drag-take-' + index, number: 1, media: media('drag-media-' + index) }],
  }));
};
async function timelineDragFixture() {
  const created = await api('projects', {
    document: {
      project: 'Timeline drag QA',
      fps: 24,
      resolution: { width: 960, height: 540 },
      media: [],
      audioClips: [],
      importedWorkflows: [],
      tailGap: 0,
      clips: timelineClips(120),
    },
  });
  return { id: created.id };
}
// A group move is refused when it would overlap another clip, so a group needs free
// space to move into: this timeline leaves a gap after every clip.
async function timelineGroupFixture() {
  const created = await api('projects', {
    document: {
      project: 'Timeline group drag QA',
      fps: 24,
      resolution: { width: 960, height: 540 },
      media: [],
      audioClips: [],
      importedWorkflows: [],
      tailGap: 0,
      clips: timelineClips(60, 120),
    },
  });
  return { id: created.id };
}
// Trim checks need clips wide enough in pixels that a width change is visible; 120
// clips at this zoom all sit on the 14px minimum.
async function timelineNarrowFixture() {
  const created = await api('projects', {
    document: {
      project: 'Timeline trim QA',
      fps: 24,
      resolution: { width: 960, height: 540 },
      media: [],
      audioClips: [],
      importedWorkflows: [],
      tailGap: 0,
      clips: timelineClips(12),
    },
  });
  return { id: created.id };
}

async function embeddedWorkflowFixture() {
  const created = await api('projects', {
    document: {
      project: 'Embedded take workflow QA',
      fps: 24,
      resolution: { width: 960, height: 540 },
      media: [],
      audioClips: [],
      importedWorkflows: [],
      tailGap: 0,
      clips: [
        {
          id: 'clip-embedded',
          name: 'Embedded shot',
          in: 0,
          out: 48,
          count: 1,
          revision: 1,
          takeId: 'embedded',
          sources: [],
          takes: [
            { id: 'embedded', number: 1, media: still('embedded-source', { workflow: graph(5), probe }) },
            { id: 'other', number: 2, media: still('other-source', { workflow: graph(9), probe }) },
            { id: 'plain', number: 3, media: still('plain-source', { probe }) },
          ],
        },
      ],
    },
  });
  return { id: created.id, bridge: 'embedded-workflow-qa' };
}

async function reviewFixture() {
  const takes = ['one', 'two', 'three'].map((id, index) => ({
    id,
    number: index + 1,
    media: still(id, { kind: 'image' }),
  }));
  const created = await api('projects', {
    document: {
      project: 'Review ownership QA',
      fps: 24,
      resolution: { width: 960, height: 540 },
      media: [],
      audioClips: [],
      importedWorkflows: [],
      tailGap: 0,
      clips: [
        { id: 'shot', name: 'Review shot', in: 12, out: 60, count: 1, revision: 1, takeId: 'one', sources: [], takes },
      ],
    },
  });
  return { id: created.id };
}
async function workflowFixture() {
  const fixture = await reviewFixture();
  let project = await api('projects/' + fixture.id);
  const prompt = {
    solid: { class_type: 'EmptyImage', inputs: { width: 16, height: 16, batch_size: 1, color: 0 } },
    save: { class_type: 'SaveImage', inputs: { images: ['solid', 0], filename_prefix: 'setup-qa' } },
  };
  const capture = {
    workflow: { nodes: [] },
    prompt,
    bindings: [],
    result: { nodeId: 'save', group: 'images', index: 0 },
    provenance: { workflowName: 'Captured CPU solid' },
  };
  const library = structuredClone(capture);
  library.prompt.second = structuredClone(prompt.save);
  project.document.importedWorkflows = [{ id: 'library', name: 'Two outputs', data: library }];
  project = await api('projects/' + fixture.id, { revision: project.revision, document: project.document }, 'PUT');
  await api('projects/' + fixture.id + '/capture/shot', { revision: project.revision, capture });
  return fixture;
}

async function thumbnailFixture() {
  const source = path.resolve(evidence, 'thumbnail-source.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=960x540:r=24:d=12',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=960x540:r=24:d=12',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      source,
    ],
    { windowsHide: true },
  );
  const created = await api('projects', { document: { project: 'Thumbnail work QA', fps: 24, clips: [], media: [] } });
  const uploaded = await fetch(base + '/spool/api/upload?projectId=' + created.id + '&fps=24', {
    method: 'POST',
    headers: { 'X-Filename': 'thumbnail-profile.mp4' },
    body: fs.readFileSync(source),
  });
  const media = await uploaded.json();
  if (!uploaded.ok) throw Error(media.error || 'Thumbnail footage upload failed');
  const clips = Array.from({ length: 80 }, (_, i) => ({
    id: 'thumb-' + i,
    name: 'Thumbnail shot ' + i,
    in: i * 6,
    out: i * 6 + 4,
    revision: 1,
    count: 1,
    takeId: 'thumb-take-' + i,
    takes: [{ id: 'thumb-take-' + i, number: 1, media }],
  }));
  const project = await api(
    'projects/' + created.id,
    {
      revision: created.revision,
      document: {
        project: 'Thumbnail work QA',
        fps: 24,
        resolution: { width: 960, height: 540 },
        media: [media],
        clips,
        audioClips: [],
        importedWorkflows: [],
        tailGap: 0,
      },
    },
    'PUT',
  );
  return { id: project.id };
}

async function takeHoverFixture() {
  let project = await api('projects', {
    document: { project: 'Full-take hover QA', fps: 24, clips: [], media: [], audioClips: [] },
  });
  const takes = [];
  for (const [id, seconds] of [
    ['short', 0.5],
    ['long', 1],
  ]) {
    const source = path.resolve(evidence, 'hover-' + id + '.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=96x64:r=24:d=' + seconds,
        '-f',
        'lavfi',
        '-i',
        'color=c=lime:s=96x64:r=24:d=' + seconds,
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=96x64:r=24:d=' + seconds,
        '-filter_complex',
        '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
        '-map',
        '[v]',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        source,
      ],
      { windowsHide: true },
    );
    const response = await fetch(base + '/spool/api/upload?projectId=' + project.id + '&fps=24', {
      method: 'POST',
      headers: { 'X-Filename': 'hover-' + id + '.mp4' },
      body: fs.readFileSync(source),
    });
    if (!response.ok) throw Error('Hover fixture upload failed');
    takes.push({ id, number: takes.length + 1, media: await response.json() });
  }
  project = await api(
    'projects/' + project.id,
    {
      revision: project.revision,
      document: {
        ...project.document,
        clips: [{ id: 'shot', name: 'Trimmed shot', in: 12, out: 24, takeId: 'short', takes }],
        media: takes.map(t => t.media),
      },
    },
    'PUT',
  );
  return { id: project.id };
}

async function templateFixture() {
  const fixture = await workflowFixture(),
    project = await api('projects/' + fixture.id);
  return {
    ...fixture,
    bridge: 'native-templates-qa',
    capture: project.recipes[project.document.clips[0].workflowVersion],
  };
}
// Writes a named image into the host's ComfyUI input folder. Checks expect an
// isolated host (tests/run_host.py), whose inputs live in its runtime folder.
async function uploadInput(name, bytes) {
  const form = new FormData();
  form.set('image', new Blob([bytes], { type: 'image/png' }), name);
  form.set('overwrite', 'true');
  const uploaded = await fetch(base + '/upload/image', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200, 'Input upload failed: ' + name);
  return (await uploaded.json()).name;
}
async function embeddedTemplatesFixture() {
  const fixture = await workflowFixture(),
    image = await fetch(apiBase + '/spool/media/' + fixture.id + '/assets/black.png');
  assert.equal(image.status, 200);
  await uploadInput('spool-template-browser-qa.png', await image.arrayBuffer());
  return fixture;
}
async function workflowPreviewFixture() {
  const fixture = await workflowFixture(),
    project = await api('projects/' + fixture.id),
    poster = '.spool/previews/library-relative.png';
  const response = await fetch(apiBase + '/spool/media/' + project.id + '/assets/black.png');
  assert.equal(response.status, 200);
  fs.writeFileSync(path.join(project.folder, poster), Buffer.from(await response.arrayBuffer()));
  project.document.importedWorkflows[0].poster = poster;
  await api('projects/' + project.id, { revision: project.revision, document: project.document }, 'PUT');
  return fixture;
}
async function controlnetVideoFixture() {
  let project = await api('projects', {
    document: { project: 'ControlNet timeline video QA', fps: 30, clips: [], media: [] },
  });
  const file = path.resolve(evidence, 'controlnet-timeline.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=96x64:r=25:d=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=96x64:r=25:d=1',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      file,
    ],
    { windowsHide: true },
  );
  const response = await fetch(apiBase + '/spool/api/upload?projectId=' + project.id + '&fps=30', {
    method: 'POST',
    headers: { 'X-Filename': 'timeline-control.mp4' },
    body: fs.readFileSync(file),
  });
  assert.equal(response.status, 200);
  const media = await response.json();
  assert.equal(media.frames, 50);
  project = await api(
    'projects/' + project.id,
    {
      revision: project.revision,
      document: {
        ...project.document,
        clips: [
          {
            id: 'shot',
            name: 'Timeline control clip',
            in: 10,
            out: 40,
            count: 1,
            revision: 1,
            takeId: 'video-take',
            takes: [{ id: 'video-take', number: 1, media }],
          },
        ],
        media: [media],
      },
    },
    'PUT',
  );
  return { id: project.id };
}
async function controlnetControlsFixture() {
  // Projects saved before Spool shipped its own ControlNet workflow keep the curated template's six bindings.
  const fixture = await controlnetVideoFixture(),
    capture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/legacy_controlnet_capture.json'), 'utf8'));
  let project = await api('projects/' + fixture.id);
  project = await api('projects/' + fixture.id + '/capture/shot', { revision: project.revision, capture });
  project.document.clips[0].shotInputs = [
    { key: capture.bindings.find(b => b.slot === 'video').key, source: 'selected' },
  ];
  await api('projects/' + fixture.id, { revision: project.revision, document: project.document }, 'PUT');
  return { ...fixture, bridge: 'controlnet-controls-qa' };
}
async function firstWorkflowFixture() {
  let project = await api('projects', {
    document: { project: 'First workflow QA', fps: 24, clips: [], media: [], audioClips: [], importedWorkflows: [] },
  });
  const capture = JSON.parse(fs.readFileSync(path.join(ui, 'builtin-captures.json'), 'utf8')).templates
      .video_ltx2_5_i2v,
    source = capture.bindings.find(b => b.asset);
  project.document.clips = ['neon_cyborg_portrait.png', 'transparent_rgb_gaming_mouse.png'].map((name, i) => ({
    id: 'missing-' + i,
    name: 'Missing legacy source ' + i,
    in: 0,
    out: 120,
    revision: 1,
    count: 1,
    takeId: 'missing-take-' + i,
    takes: [
      {
        id: 'missing-take-' + i,
        placeholder: true,
        number: 0,
        media: {
          id: 'missing-media-' + i,
          name: 'Not generated',
          kind: 'image',
          file: 'assets/black.png',
          poster: 'assets/black.png',
          frames: 120,
        },
      },
    ],
  }));
  project = await api('projects/' + project.id, { revision: project.revision, document: project.document }, 'PUT');
  for (const [i, name] of ['neon_cyborg_portrait.png', 'transparent_rgb_gaming_mouse.png'].entries()) {
    const legacy = structuredClone(capture);
    legacy.prompt[source.nodeId].inputs[source.input] = name;
    project = await api('projects/' + project.id + '/capture/missing-' + i, {
      revision: project.revision,
      capture: legacy,
    });
  }
  return { id: project.id };
}
const CHECKS = {
  'frame-interpretation': {
    fixture: frameInterpretationFixture,
    modes: ['full'],
    file: 'frame_interpretation_browser_checks.js',
  },
  'workflow-capture-bundle': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Serialized built-in capture QA',
          fps: 24,
          clips: [],
          media: [],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['full'],
    branchTemplates: true,
    file: 'builtin_capture_browser_checks.js',
  },
  'workflow-first': {
    fixture: firstWorkflowFixture,
    modes: ['full'],
    branchTemplates: true,
    firstWorkflow: true,
    file: 'workflow_first_browser_checks.js',
  },
  'workflow-project-profile': {
    fixture: async () => {
      if (!process.env.SPOOL_QA_PROJECT) throw Error('Set SPOOL_QA_PROJECT to an owned QA copy');
      const project = await api('projects/' + process.env.SPOOL_QA_PROJECT);
      if (!/QA/.test(project.document.project)) throw Error('Profile only an explicitly named QA project');
      return { id: project.id };
    },
    modes: ['full'],
    branchTemplates: true,
    file: 'workflow_project_profile_browser_checks.js',
  },
  'workflow-drop': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Workflow drop QA',
          fps: 24,
          videoTracks: 2,
          clips: timelineClips(3).map((c, i) => ({
            ...c,
            videoTrack: i === 2 ? 2 : 1,
            ...(i === 2 ? { gapBefore: 48 } : {}),
          })),
          media: [still('drop-footage')],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['full'],
    branchTemplates: true,
    libraryDrop: true,
    file: 'workflow_drop_browser_checks.js',
  },
  'workflow-insert': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Workflow insertion QA',
          fps: 24,
          clips: [],
          media: [],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['full'],
    branchTemplates: true,
    file: 'workflow_insert_browser_checks.js',
  },
  'reference-inputs': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Reference inputs QA',
          fps: 24,
          clips: [],
          media: [],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['full'],
    branchTemplates: true,
    file: 'reference_inputs_browser_checks.js',
  },
  'builtin-comfy-link': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Spool workflows Comfy link QA',
          fps: 24,
          clips: [],
          media: [],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['full'],
    branchTemplates: true,
    userGesture: true,
    file: 'builtin_comfy_link_browser_checks.js',
  },
  'arrival-focus': { fixture: workflowFixture, modes: ['full'], file: 'arrival_focus_browser_checks.js' },
  'idle-sync': { fixture: workflowPreviewFixture, modes: ['full'], file: 'idle_sync_browser_checks.js' },
  'controlnet-video': {
    fixture: controlnetVideoFixture,
    modes: ['full'],
    branchTemplates: true,
    file: 'controlnet_video_browser_checks.js',
  },
  'controlnet-video-narrow': {
    fixture: controlnetVideoFixture,
    modes: ['full'],
    branchTemplates: true,
    file: 'controlnet_video_browser_checks.js',
    width: 360,
    height: 800,
  },
  'controlnet-controls': {
    fixture: controlnetControlsFixture,
    modes: ['full'],
    file: 'controlnet_controls_browser_checks.js',
  },
  'controlnet-controls-narrow': {
    fixture: controlnetControlsFixture,
    modes: ['full'],
    file: 'controlnet_controls_browser_checks.js',
    width: 360,
    height: 800,
  },
  'controlnet-comfy': {
    fixture: async () => ({
      ...(await controlnetControlsFixture()),
      bridge: 'closed-controlnet-qa-' + crypto.randomUUID(),
    }),
    modes: ['full'],
    userGesture: true,
    file: 'controlnet_comfy_browser_checks.js',
  },
  'comfy-added-inputs': {
    fixture: async () => ({
      ...(await takeSetupFixture(true)),
      bridge: 'closed-added-inputs-qa-' + crypto.randomUUID(),
    }),
    modes: ['full'],
    userGesture: true,
    file: 'comfy_added_inputs_browser_checks.js',
  },
  'comfy-added-inputs-narrow': {
    fixture: async () => ({
      ...(await takeSetupFixture(true)),
      bridge: 'closed-added-inputs-qa-' + crypto.randomUUID(),
    }),
    modes: ['full'],
    userGesture: true,
    file: 'comfy_added_inputs_browser_checks.js',
    width: 420,
    height: 850,
  },
  'library-navigation': {
    fixture: libraryFixture,
    modes: ['full'],
    branchTemplates: true,
    libraryNavigation: true,
    file: 'library_navigation_browser_checks.js',
  },
  'library-navigation-narrow': {
    fixture: libraryFixture,
    modes: ['full'],
    branchTemplates: true,
    libraryNavigation: true,
    file: 'library_navigation_browser_checks.js',
    width: 360,
    height: 800,
  },
  'setup-requirements': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Setup requirements QA',
          fps: 24,
          clips: [],
          media: [],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['full'],
    missingRequirements: true,
    file: 'setup_requirements_browser_checks.js',
  },
  'cloud-smoke': {
    fixture: async () => {
      if (process.env.SPOOL_CLOUD_SMOKE !== '1')
        throw Error('cloud-smoke spends Comfy Cloud credits; set SPOOL_CLOUD_SMOKE=1 to run it');
      return api('projects', {
        document: { project: 'Cloud smoke QA', fps: 24, clips: [], media: [], audioClips: [], importedWorkflows: [] },
      });
    },
    modes: ['full'],
    branchTemplates: true,
    globals: () => ({ __cloudSmokeTarget: process.env.SPOOL_CLOUD_SMOKE_TARGET || 'cloud' }),
    file: 'cloud_smoke_browser_checks.js',
  },
  'studio-cloud-offline': {
    fixture: async () =>
      api('projects', {
        document: { project: 'Cloud offline QA', fps: 24, clips: [], media: [], audioClips: [], importedWorkflows: [] },
      }),
    modes: ['full'],
    branchTemplates: true,
    cloudOnly: true,
    offline: true,
    file: 'cloud_studio_browser_checks.js',
  },
  'comfy-studio-entry': {
    fixture: async () =>
      api('projects', {
        document: { project: 'Studio entry QA', fps: 24, clips: [], media: [], audioClips: [], importedWorkflows: [] },
      }),
    modes: ['full'],
    file: 'comfy_studio_entry_browser_checks.js',
  },
  studio: {
    fixture: async () =>
      api('projects', {
        document: { project: 'Full studio QA', fps: 24, clips: [], media: [], audioClips: [], importedWorkflows: [] },
      }),
    modes: ['full'],
    branchTemplates: true,
    file: 'studio_browser_checks.js',
  },
  'studio-legacy-url': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Studio legacy URL QA',
          fps: 24,
          clips: [],
          media: [],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['compact'],
    branchTemplates: true,
    file: 'studio_browser_checks.js',
    width: 360,
    height: 800,
  },
  'studio-followups': {
    fixture: studioFollowupFixture,
    modes: ['full'],
    width: 1920,
    height: 1080,
    file: 'studio_followups_browser_checks.js',
  },
  'panel-controls': {
    fixture: workflowFixture,
    modes: ['full'],
    width: 1440,
    height: 1000,
    file: 'panel_controls_browser_checks.js',
  },
  'panel-controls-medium': {
    fixture: workflowFixture,
    modes: ['full'],
    width: 1000,
    height: 800,
    file: 'panel_controls_browser_checks.js',
  },
  'panel-controls-narrow': {
    fixture: workflowFixture,
    modes: ['full'],
    width: 360,
    height: 800,
    file: 'panel_controls_browser_checks.js',
  },
  'clip-attention': { fixture: clipAttentionFixture, modes: ['full'], file: 'clip_attention_browser_checks.js' },
  'clip-attention-narrow': {
    fixture: clipAttentionFixture,
    modes: ['full'],
    width: 360,
    height: 800,
    file: 'clip_attention_browser_checks.js',
  },
  'inspector-notes': { fixture: inspectorMenuFixture, modes: ['full'], file: 'inspector_notes_browser_checks.js' },
  'inspector-notes-narrow': {
    fixture: inspectorMenuFixture,
    modes: ['full'],
    width: 360,
    height: 800,
    file: 'inspector_notes_browser_checks.js',
  },
  'timeline-snapping': {
    fixture: timelineSnapFixture,
    modes: ['full'],
    timelineSnapping: true,
    file: 'timeline_snapping_browser_checks.js',
  },
  'take-cleanup': {
    fixture: takeCleanupFixture,
    modes: ['full'],
    takeFiles: true,
    file: 'take_cleanup_browser_checks.js',
  },
  'take-file-actions': { fixture: takeCleanupFixture, modes: ['full'], file: 'take_file_actions_browser_checks.js' },
  'take-file-actions-narrow': {
    fixture: takeCleanupFixture,
    modes: ['full'],
    width: 360,
    height: 800,
    file: 'take_file_actions_browser_checks.js',
  },
  'take-file-actions-mac': {
    fixture: takeCleanupFixture,
    modes: ['full'],
    mac: true,
    file: 'take_file_actions_browser_checks.js',
  },
  'clip-folder': { fixture: clipFolderFixture, modes: ['full'], file: 'clip_folder_browser_checks.js' },
  'clip-folder-narrow': {
    fixture: clipFolderFixture,
    modes: ['full'],
    width: 360,
    height: 800,
    file: 'clip_folder_browser_checks.js',
  },
  'clip-folder-mac': { fixture: clipFolderFixture, modes: ['full'], mac: true, file: 'clip_folder_browser_checks.js' },
  'take-cleanup-narrow': {
    fixture: takeCleanupFixture,
    modes: ['full'],
    takeFiles: true,
    width: 360,
    height: 800,
    file: 'take_cleanup_browser_checks.js',
  },
  'workflow-sidecar': {
    fixture: sidecarFixture,
    modes: ['full'],
    userGesture: true,
    file: 'workflow_sidecar_browser_checks.js',
  },
  'project-folders': { fixture: workflowFixture, modes: ['full'], file: 'project_folder_browser_checks.js' },
  'timeline-interactions': {
    fixture: timelineInteractionFixture,
    modes: ['full'],
    timelineInteractions: true,
    file: 'timeline_interaction_browser_checks.js',
  },
  'inspector-flow': { fixture: takeSetupFixture, modes: ['full'], file: 'inspector_flow_browser_checks.js' },
  'inspector-flow-narrow': {
    fixture: takeSetupFixture,
    modes: ['full'],
    width: 360,
    height: 800,
    file: 'inspector_flow_browser_checks.js',
  },
  'comfy-link': {
    fixture: async () => ({ ...(await takeSetupFixture(true)), bridge: 'closed-comfy-qa-' + crypto.randomUUID() }),
    modes: ['full'],
    userGesture: true,
    continuation: true,
    file: 'comfy_link_browser_checks.js',
  },
  'comfy-link-placeholder': {
    fixture: ungeneratedLinkFixture,
    modes: ['full'],
    userGesture: true,
    file: 'comfy_link_placeholder_browser_checks.js',
  },
  'template-startup': { fixture: workflowFixture, modes: ['full'], file: 'template_startup_browser_checks.js' },

  'inspector-menu': { fixture: inspectorMenuFixture, modes: ['full'], file: 'inspector_menu_browser_checks.js' },
  'inspector-menu-narrow': {
    fixture: inspectorMenuFixture,
    modes: ['full'],
    width: 360,
    height: 800,
    file: 'inspector_menu_browser_checks.js',
  },
  'embedded-templates-live': {
    fixture: embeddedTemplatesFixture,
    modes: ['full'],
    file: 'embedded_templates_live_browser_checks.js',
  },
  'workflow-library-narrow': {
    fixture: templateFixture,
    modes: ['full'],
    templates: true,
    file: 'workflow_library_browser_checks.js',
    width: 360,
    height: 800,
  },
  'take-setup': { fixture: takeSetupFixture, modes: ['full'], file: 'take_setup_browser_checks.js' },
  'render-queue': { fixture: workflowFixture, modes: ['full'], file: 'render_queue_browser_checks.js' },
  'render-cancel': { fixture: workflowFixture, modes: ['full'], file: 'render_cancel_browser_checks.js' },
  'render-queue-pending': {
    fixture: workflowFixture,
    modes: ['full'],
    file: 'render_queue_browser_checks.js',
    pendingQueue: true,
  },
  'render-queue-narrow': {
    fixture: workflowFixture,
    modes: ['full'],
    file: 'render_queue_browser_checks.js',
    width: 360,
    height: 800,
  },
  'workflow-library': {
    fixture: templateFixture,
    modes: ['full'],
    templates: true,
    file: 'workflow_library_browser_checks.js',
  },
  topbar: { fixture: workflowFixture, modes: ['full'], file: 'topbar_browser_checks.js' },
  'topbar-offline': {
    fixture: workflowFixture,
    modes: ['full'],
    file: 'topbar_offline_browser_checks.js',
    offline: true,
  },
  'topbar-narrow': {
    fixture: workflowFixture,
    modes: ['full'],
    file: 'topbar_offline_browser_checks.js',
    offline: true,
    width: 360,
    height: 800,
  },
  'startup-without-builtins': {
    fixture: async () =>
      api('projects', {
        document: {
          project: 'Builtins unavailable QA',
          fps: 24,
          clips: [],
          media: [],
          audioClips: [],
          importedWorkflows: [],
        },
      }),
    modes: ['full'],
    brokenBuiltins: true,
    file: 'startup_without_builtins_browser_checks.js',
  },
  'ui-empty': {
    fixture: async () =>
      api('projects', {
        document: { project: 'Empty UI QA', fps: 24, clips: [], media: [], audioClips: [], importedWorkflows: [] },
      }),
    modes: ['full'],
    file: 'ui_empty_browser_checks.js',
  },
  'ui-polish': { fixture: workflowFixture, modes: ['full'], file: 'ui_polish_browser_checks.js' },
  'thumbnail-work': {
    fixture: thumbnailFixture,
    modes: ['full'],
    file: 'thumbnail_work_browser_checks.js',
    thumbnails: true,
  },
  'take-hover': { fixture: takeHoverFixture, modes: ['full'], file: 'take_hover_browser_checks.js' },
  'take-hover-narrow': {
    fixture: takeHoverFixture,
    modes: ['full'],
    file: 'take_hover_browser_checks.js',
    width: 360,
    height: 800,
  },
  'startup-project': { fixture: timelineDragFixture, modes: ['full'], file: 'startup_browser_checks.js', bare: true },
  'startup-empty': {
    fixture: async () => ({ id: null }),
    modes: ['full'],
    file: 'startup_browser_checks.js',
    bare: true,
  },
  'workflow-setup': { fixture: workflowFixture, modes: ['full'], file: 'workflow_setup_browser_checks.js' },
  'workflow-edit-new': {
    fixture: async () => ({ ...(await workflowFixture()), bridge: 'new-workflow-qa' }),
    modes: ['full'],
    userGesture: true,
    file: 'workflow_edit_new_browser_checks.js',
  },
  'take-review': { fixture: reviewFixture, modes: ['full'], file: 'take_review_browser_checks.js' },
  'embedded-workflow': {
    fixture: embeddedWorkflowFixture,
    modes: ['full'],
    file: 'embedded_workflow_browser_checks.js',
  },
  'timeline-drag': {
    fixture: timelineGroupFixture,
    modes: ['full'],
    file: 'timeline_drag_browser_checks.js',
    drag: {
      selector: '#clipLane [data-clip="drag-clip-1"]',
      select: ['drag-clip-1', 'drag-clip-2'],
      frames: 24,
      sample: 4,
      dx: -60,
      end: 'up',
    },
  },
  'timeline-copy': {
    fixture: timelineCopyFixture,
    modes: ['full'],
    file: 'timeline_copy_browser_checks.js',
    drag: {
      selector: '#clipLane [data-clip="shot"]',
      select: ['shot'],
      frames: 20,
      sample: 4,
      moveFrames: 72,
      alt: true,
      releaseAltAt: 12,
      end: 'up',
    },
  },
  'timeline-drag-cancel': {
    fixture: timelineNarrowFixture,
    modes: ['full'],
    file: 'timeline_drag_cancel_browser_checks.js',
    drag: {
      selector: '#clipLane [data-clip="drag-clip-1"]',
      select: ['drag-clip-1'],
      handle: 'out',
      frames: 20,
      sample: 4,
      dx: -50,
      end: 'escape',
    },
  },
  'timeline-drag-ripple': {
    fixture: timelineNarrowFixture,
    modes: ['full'],
    file: 'timeline_drag_ripple_browser_checks.js',
    drag: {
      selector: '#clipLane [data-clip="drag-clip-1"]',
      select: ['drag-clip-1'],
      frames: 20,
      sample: 4,
      dx: -50,
      end: 'up',
      shift: true,
      handle: 'out',
    },
  },
};

async function timelineSnapFixture() {
  const clips = timelineClips(3);
  for (const [index, id] of ['fixed', 'moving', 'following'].entries()) {
    clips[index].id = id;
    clips[index].name = id;
    clips[index].gapBefore = index < 2 ? 96 : 48;
  }
  return api('projects', {
    document: { project: 'Timeline snapping QA', fps: 24, clips, media: [], audioClips: [], tailGap: 0 },
  });
}

async function clipFolderFixture() {
  const clips = timelineClips(1);
  clips[0].name = 'External takes';
  clips.push({
    id: 'empty-shot',
    name: 'Ungenerated shot',
    takeId: 'pending',
    takes: [{ id: 'pending', placeholder: true, media: still('pending') }],
    in: 0,
    out: 48,
    revision: 1,
  });
  const project = await api('projects', {
    document: { project: 'Clip folder QA', fps: 24, clips, media: [], audioClips: [] },
  });
  const external = path.join(project.folder, project.document.clips[0].outputFolder, 'external-take.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=96x64:r=24:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      external,
    ],
    { windowsHide: true },
  );
  const stable = new Date(Date.now() - 20000);
  fs.utimesSync(external, stable, stable);
  return { id: project.id };
}

async function takeCleanupFixture() {
  let project = await api('projects', {
    document: { project: 'Take cleanup QA', fps: 24, clips: [], media: [], audioClips: [] },
  });
  const takes = [],
    files = {};
  for (const [index, id] of ['chosen', 'one', 'two', 'three', 'four'].entries()) {
    const file = path.resolve(evidence, 'cleanup-' + id + '.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=96x64', '-frames:v', '1', file], {
      windowsHide: true,
    });
    const response = await fetch(base + '/spool/api/upload?projectId=' + project.id + '&fps=24', {
      method: 'POST',
      headers: { 'X-Filename': id + '.png' },
      body: fs.readFileSync(file),
    });
    if (!response.ok) throw Error('Take cleanup fixture upload failed');
    const media = await response.json();
    takes.push({ id, number: index + 1, media: { ...media, frames: 120 } });
    const source = path.join(project.folder, media.originalFile),
      json = source.slice(0, source.lastIndexOf('.')) + '.json';
    fs.writeFileSync(json, JSON.stringify({ version: 0.4, nodes: [{ id: 1, type: 'SaveImage' }], links: [] }));
    files[id] = { source, json };
  }
  project = await api(
    'projects/' + project.id,
    {
      revision: project.revision,
      document: {
        ...project.document,
        clips: [{ id: 'shot', name: 'Shot', takeId: 'chosen', takes, in: 0, out: 48, revision: 1 }],
        media: takes.map(t => t.media),
      },
    },
    'PUT',
  );
  return { id: project.id, files };
}

async function sidecarFixture() {
  const fixture = await takeSetupFixture(true),
    project = await api('projects/' + fixture.id),
    take = project.document.clips[0].takes[0],
    capture = project.recipes[project.document.clips[0].workflowVersion],
    normal = structuredClone(capture.workflow);
  normal.nodes.find(n => n.type === 'LoadImage').widgets_values[0] = 'take-setup-s15.png';
  const source = path.join(project.folder, take.media.originalFile || take.media.file),
    sidecar = source.slice(0, source.lastIndexOf('.')) + '.json';
  fs.writeFileSync(sidecar, JSON.stringify(normal, null, 2));
  return fixture;
}

async function timelineInteractionFixture() {
  const fixture = await takeSetupFixture(),
    p = await api('projects/' + fixture.id),
    clips = timelineClips(2);
  clips[0].id = 'cover';
  clips[0].name = 'Covered clip';
  clips[0].in = 0;
  clips[0].out = 120;
  clips[1].id = 'following';
  p.document.clips.push(...clips);
  await api('projects/' + p.id, { revision: p.revision, document: p.document }, 'PUT');
  return fixture;
}
async function ungeneratedLinkFixture() {
  const fixture = await takeSetupFixture(true),
    project = await api('projects/' + fixture.id),
    recipe = project.recipes[project.document.clips[0].workflowVersion];
  project.document.importedWorkflows = [{ id: 'fresh-graph', name: 'New workflow shot', data: recipe }];
  await api('projects/' + fixture.id, { revision: project.revision, document: project.document }, 'PUT');
  return { ...fixture, bridge: 'closed-new-shot-qa-' + crypto.randomUUID() };
}
async function frameInterpretationFixture() {
  const project = await api('projects', {
      document: { project: 'Frame interpretation QA', fps: 30, clips: [], media: [], audioClips: [] },
    }),
    folder = path.resolve('.native-test/frame-interpretation');
  fs.mkdirSync(folder, { recursive: true });
  const source = path.join(folder, 'browser-indexed.mkv');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'nullsrc=s=64x36:r=25:d=1,geq=lum=16+N*8:cb=128:cr=128',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=400:duration=1',
    '-c:v',
    'ffv1',
    '-c:a',
    'pcm_s16le',
    source,
  ]);
  const response = await fetch(apiBase + '/spool/api/upload?projectId=' + project.id + '&fps=30', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': 'indexed-25fps.mkv' },
      body: fs.readFileSync(source),
    }),
    media = await response.json();
  assert.ok(response.ok, JSON.stringify(media));
  const oldFile = '.spool/previews/legacy-cfr.mp4',
    target = path.join(project.folder, oldFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    source,
    '-vf',
    'fps=30',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    target,
  ]);
  const legacy = {
    ...media,
    id: 'legacy-video',
    file: oldFile,
    frames: 30,
    duration: 1,
    review: { fps: 30, frames: 30 },
  };
  delete legacy.frameRateMode;
  project.document.media = [media];
  project.document.clips = [
    {
      id: 'shot',
      name: 'Legacy 25 FPS',
      in: 0,
      out: 30,
      takeId: 'legacy',
      takes: [{ id: 'legacy', number: 1, media: legacy }],
    },
    {
      id: 'next',
      name: 'Existing next cut',
      in: 0,
      out: 30,
      takeId: 'still',
      takes: [{ id: 'still', number: 1, media: still('next-still') }],
    },
  ];
  await api('projects/' + project.id, { revision: project.revision, document: project.document }, 'PUT');
  return project;
}
async function inspectorMenuFixture() {
  const fixture = await workflowFixture(),
    project = await api('projects/' + fixture.id);
  project.document.videoTracks = 3;
  const next = timelineClips(1)[0];
  next.id = 'next';
  next.name = 'Next shot';
  next.takes[0].media.kind = 'video';
  next.takes[0].media.audio = true;
  project.document.clips.push(next);
  project.document.media = [project.document.clips[0].takes[0].media, next.takes[0].media];
  await api('projects/' + fixture.id, { revision: project.revision, document: project.document }, 'PUT');
  return fixture;
}

async function timelineCopyFixture() {
  const fixture = await inspectorMenuFixture(),
    project = await api('projects/' + fixture.id);
  project.document.project = 'Alt-drag copy QA';
  project.document.videoTracks = 2;
  project.document.tailGap = 240;
  project.document.clips[1].gapBefore = 96;
  project.document.audioClips = [
    {
      id: 'music',
      name: 'Music',
      start: 0,
      in: 6,
      out: 42,
      media: { ...still('music'), kind: 'audio' },
      audio: { gainDb: -3, muted: false, fadeIn: 4, fadeOut: 5 },
    },
  ];
  await api('projects/' + fixture.id, { revision: project.revision, document: project.document }, 'PUT');
  return fixture;
}

async function clipAttentionFixture() {
  const fixture = await inspectorMenuFixture(),
    project = await api('projects/' + fixture.id),
    shot = project.document.clips[0];
  project.document.videoTracks = 1;
  shot.takes = shot.takes.slice(0, 1);
  shot.notes = [
    { id: 'motion', text: 'Add slow watch rotation.', status: 'open' },
    { id: 'camera', text: 'Pan the camera right.', status: 'open' },
    {
      id: 'old-note',
      text: 'Preserve the lighting.',
      status: 'addressed',
      addressedBy: 'user',
      addressedAt: Date.now(),
    },
  ];
  project.document.audioClips = [
    {
      id: 'music',
      name: 'Music',
      track: 'music',
      start: 0,
      in: 0,
      out: 48,
      media: { ...project.document.clips[1].takes[0].media, id: 'audio-media', kind: 'audio' },
      notes: [{ id: 'music-note', text: 'Lower the level.', status: 'open' }],
    },
  ];
  await api('projects/' + fixture.id, { revision: project.revision, document: project.document }, 'PUT');
  return fixture;
}
async function studioFollowupFixture() {
  const fixture = await inspectorMenuFixture(),
    project = await api('projects/' + fixture.id),
    recipe = project.recipes[project.document.clips[0].workflowVersion];
  recipe.prompt.noise = { class_type: 'ImageAddNoise', inputs: { image: ['solid', 0], seed: 123, strength: 0 } };
  recipe.prompt.save.inputs.images = ['noise', 0];
  recipe.bindings = [{ key: 'seed', nodeId: 'noise', input: 'seed', role: 'seed', label: 'Seed' }];
  project.document.clips[1].videoTrack = 3;
  project.document.audioClips = [
    {
      id: 'music',
      name: 'Music',
      start: 0,
      in: 0,
      out: 48,
      media: { ...project.document.clips[1].takes[0].media, id: 'audio', kind: 'audio' },
    },
  ];
  const saved = await api('projects/' + fixture.id, { revision: project.revision, document: project.document }, 'PUT');
  await api('projects/' + fixture.id + '/capture/shot', { revision: saved.revision, capture: recipe });
  return fixture;
}

async function takeSetupFixture(editable = false) {
  const files = {};
  for (const [shot, color] of [
    ['s04', 'red'],
    ['s15', 'blue'],
  ]) {
    const file = path.resolve(evidence, shot + '.png');
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=' + color + ':s=96x64', '-frames:v', '1', file],
      { windowsHide: true },
    );
    files[shot] = await uploadInput('take-setup-' + shot + '.png', fs.readFileSync(file));
  }
  const prompt = shot => ({
    '105:114': { class_type: 'LoadImage', inputs: { image: files[shot] } },
    save: { class_type: 'SaveImage', inputs: { images: ['105:114', 0], filename_prefix: 'old-' + shot } },
  });
  const workflow = editable
    ? {
        last_node_id: 2,
        last_link_id: 1,
        version: 0.4,
        groups: [{ title: 'Recovered layout', bounding: [0, 0, 700, 350], color: '#3f789e', font_size: 24, flags: {} }],
        config: {},
        nodes: [
          {
            id: '105:114',
            type: 'LoadImage',
            pos: [40, 70],
            size: [270, 250],
            flags: {},
            order: 0,
            mode: 0,
            inputs: [],
            outputs: [
              { name: 'IMAGE', type: 'IMAGE', links: [1], slot_index: 0 },
              { name: 'MASK', type: 'MASK', links: null },
            ],
            properties: { 'Node name for S&R': 'LoadImage' },
            widgets_values: [files.s15, 'image'],
          },
          {
            id: 'save',
            type: 'SaveImage',
            pos: [400, 70],
            size: [270, 250],
            flags: {},
            order: 1,
            mode: 0,
            inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
            outputs: [],
            properties: { 'Node name for S&R': 'SaveImage' },
            widgets_values: ['old-s04'],
          },
        ],
        links: [[1, '105:114', 0, 'save', 0, 'IMAGE']],
      }
    : {
        nodes: [{ id: 105, type: 'subgraph' }],
        definitions: {
          subgraphs: [
            { id: 'subgraph', nodes: [{ id: 114, type: 'LoadImage', widgets_values: [files.s15, 'image'] }] },
          ],
        },
      };
  let project = await api('projects', {
    document: {
      project: 'Take metadata CPU QA',
      fps: 24,
      resolution: { width: 960, height: 540 },
      media: [],
      audioClips: [],
      importedWorkflows: [],
      tailGap: 0,
      clips: [
        {
          id: 'shot',
          name: 'Wrist check',
          in: 12,
          out: 60,
          count: 1,
          revision: 1,
          takeId: 's04',
          sources: [],
          takes: [
            ...['s04', 's15'].map((id, index) => ({
              id,
              number: index + 1,
              media: still(id, {
                kind: 'image',
                name: id + '.png',
                workflow: id === 's04' ? workflow : undefined,
                prompt: prompt(id),
              }),
            })),
            { id: 'plain', number: 3, media: still('plain', { kind: 'image' }) },
          ],
        },
      ],
    },
  });
  for (const [i, id] of ['s04', 's15'].entries()) {
    const response = await fetch(base + '/spool/api/upload?projectId=' + project.id + '&fps=24', {
      method: 'POST',
      headers: { 'X-Filename': id + '.png' },
      body: fs.readFileSync(path.resolve(evidence, id + '.png')),
    });
    if (!response.ok) throw Error('Fixture take upload failed');
    const actual = await response.json(),
      held = project.document.clips[0].takes[i].media;
    project.document.clips[0].takes[i].media = { ...held, ...actual, id, frames: 120 };
  }
  project = await api('projects/' + project.id, { revision: project.revision, document: project.document }, 'PUT');
  const capture = {
    workflow,
    prompt: prompt('s15'),
    bindings: [{ key: 'stale-image', nodeId: '105:114', input: 'image', asset: true }],
    result: { nodeId: 'save', group: 'images', index: 0 },
    provenance: { workflowName: 'S15 incorrect setup' },
  };
  project = await api('projects/' + project.id + '/capture/shot', { revision: project.revision, capture });
  return { id: project.id };
}

// A trusted pointer drag through CDP, with a page probe sampled before, during and
// after it, so a check can assert what happened on every frame.
async function runDrag(page, evaluate, spec) {
  const target = spec.handle
    ? `document.querySelector(${JSON.stringify(spec.selector)}).querySelector('[data-trim="${spec.handle}"]')`
    : `document.querySelector(${JSON.stringify(spec.selector)})`;
  const box = await evaluate(
    `(()=>{const n=${target};if(!n)return null;n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect(),body=n.closest('[data-clip]'),c=spoolNative.state.clips.find(c=>c.id===body.dataset.clip);return {x:r.left+r.width/2,y:r.top+r.height/2,scale:body.getBoundingClientRect().width/(c.out-c.in)};})()`,
  );
  if (!box) throw Error('Drag target not found: ' + spec.selector);
  const dx = spec.moveFrames === undefined ? spec.dx : spec.moveFrames * box.scale;
  const probe = () =>
    evaluate(
      '(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const n=window.spoolNative,box=id=>{const node=document.querySelector(\'#clipLane [data-clip="\'+id+\'"]\');if(!node)return {left:0,width:0};const style=getComputedStyle(node);return {left:Math.round(parseFloat(style.left)||0),width:Math.round(parseFloat(style.width)||0)};};for(const node of document.querySelectorAll("#clipLane [data-clip]"))node.__token??=Math.random().toString(36).slice(2);return {draws:n.laneDraws,selection:(n.state.selection||[]).length,drag:n.drag?{kind:n.drag.kind,group:n.drag.group,ids:(n.drag.ids||[]).length,applied:n.drag.applied,moved:n.drag.moved}:null,box:Object.fromEntries(n.state.clips.map(c=>[c.id,box(c.id)])),tokens:[...document.querySelectorAll("#clipLane [data-clip]")].map(node=>node.dataset.clip+":"+node.__token)};})()',
    );
  const before = await probe();
  if (spec.alt) await evaluate('window.__copyOriginal=JSON.parse(JSON.stringify(spoolNative.state))');
  if (spec.shift)
    await page.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Shift',
      code: 'ShiftLeft',
      modifiers: 8,
      windowsVirtualKeyCode: 16,
    });
  let alt = !!spec.alt;
  const modifiers = () => (spec.shift ? 8 : 0) + (alt ? 1 : 0);
  if (alt)
    await page.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Alt',
      code: 'AltLeft',
      modifiers: modifiers(),
      windowsVirtualKeyCode: 18,
    });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, modifiers: modifiers() });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: box.x,
    y: box.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    modifiers: modifiers(),
  });
  const samples = [];
  for (let step = 1; step <= spec.frames; step++) {
    if (alt && step === spec.releaseAltAt) {
      alt = false;
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Alt',
        code: 'AltLeft',
        modifiers: modifiers(),
        windowsVirtualKeyCode: 18,
      });
    }
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: box.x + (dx * step) / spec.frames,
      y: box.y,
      button: 'left',
      buttons: 1,
      modifiers: modifiers(),
    });
    if (step % spec.sample === 0) samples.push(await probe());
  }
  if (spec.end === 'escape') {
    await page.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
  }
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: box.x + dx,
    y: box.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    modifiers: modifiers(),
  });
  if (alt)
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Alt',
      code: 'AltLeft',
      modifiers: 0,
      windowsVirtualKeyCode: 18,
    });
  if (spec.shift)
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Shift',
      code: 'ShiftLeft',
      modifiers: 0,
      windowsVirtualKeyCode: 16,
    });
  await sleep(200);
  const after = await probe();
  await evaluate(
    `window.__drag=${JSON.stringify({ samples, before, after, spec: { dx, frames: spec.frames, end: spec.end, alt: !!spec.alt } })}`,
  );
  return { before, samples, after };
}

async function runTakeDeleteKeys(page, evaluate) {
  // The studio accepts Ctrl and Cmd on every platform, so trusted keys use both.
  const labels = [],
    keys = await evaluate("import('/spool/ui/keys.js').then(k=>({undo:k.keyText('Ctrl+Z')}))"),
    ctrl = 2,
    cmd = 4,
    shift = 8;
  const press = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    const event = { key, code, windowsVirtualKeyCode, modifiers };
    await page.send('Input.dispatchKeyEvent', { ...event, type: 'rawKeyDown' });
    await page.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
    await evaluate('spoolNative.flush()');
  };
  const probe = () =>
    evaluate(
      `(()=>{const n=spoolNative;return {count:document.querySelectorAll('#takeList [data-take]').length,clip:JSON.stringify(n.state.clips[0]),modal:!document.getElementById('modalOverlay').hidden};})()`,
    );
  await evaluate(`(async()=>{spoolNative.selectClip('shot');await spoolNative.flush();})()`);
  const before = await probe();
  const point = await evaluate(
    `(()=>{const el=document.querySelector('[data-take="one"] [data-select-take]');el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
  );
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await press('Delete', 'Delete', 46);
  let value = await probe();
  assert.equal(value.count, 4);
  assert.equal(value.modal, false);
  labels.push('Trusted Delete on a take checkbox removes the take without opening disk deletion');
  await press('z', 'KeyZ', 90, ctrl);
  assert.equal((await probe()).clip, before.clip);
  labels.push('Trusted Ctrl+Z immediately restores the deleted take and exact clip metadata');
  await press('z', 'KeyZ', 90, cmd | shift);
  assert.equal((await probe()).count, 4);
  labels.push('Trusted Cmd+Shift+Z redoes the take removal');
  await page.send('Page.reload', { ignoreCache: true });
  let ready = false;
  for (let i = 0; i < 200; i++) {
    if (await evaluate('!!window.spoolNative')) {
      ready = true;
      break;
    }
    await sleep(50);
  }
  assert.ok(ready, 'Editor reloaded');
  assert.equal((await probe()).count, 4);
  await evaluate(`document.getElementById('editor').focus()`);
  await press('z', 'KeyZ', 90, cmd);
  assert.equal((await probe()).clip, before.clip);
  labels.push('A saved take removal retains its ' + keys.undo + ' Undo step across a browser reload');
  await evaluate(
    `(()=>{const button=document.getElementById('selectAllTakes');if(spoolNative.view.takeSelection.ids.length){button.click();button.click();}})()`,
  );
  return labels;
}

async function runTimelineInteractions(page, evaluate) {
  await evaluate(
    `(async()=>{const w=window;window.__timelineW=w;window.__timelineOriginal=JSON.parse(JSON.stringify(w.spoolNative.state));await w.spoolNative.chooseTake('shot','s04');await w.spoolNative.flush();})()`,
  );
  const probe = () =>
    evaluate(
      `(()=>{const w=__timelineW,n=w.spoolNative,s=w.document.getElementById('timelineScroll');return {left:s.scrollLeft,top:s.scrollTop,frame:n.state.frame,selected:n.state.selected,revision:n.revision,clips:JSON.stringify(n.state.clips),draws:n.laneDraws};})()`,
    );
  const zoom = async value => {
    await evaluate(
      `(()=>{const w=__timelineW,z=w.document.getElementById('zoom');z.value=${value};z.dispatchEvent(new w.Event('input',{bubbles:true}));w.document.getElementById('timelineScroll').scrollLeft=0;})()`,
    );
    await sleep(100);
  };
  const point = selector =>
    evaluate(
      `(()=>{const w=__timelineW,r=w.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),f=w===window?{left:0,top:0}:document.querySelector('#spool-dock iframe').getBoundingClientRect();const sc=w.document.getElementById('timelineScroll').getBoundingClientRect();return {x:f.left+Math.min(r.left+r.width/2,sc.right-40),y:r.top+f.top+r.height/2};})()`,
    );
  const pointer = async (from, to, button = 'left', cancel = false) => {
    const buttons = button === 'middle' ? 4 : 1;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button, buttons, clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * i) / 8,
        y: from.y + ((to.y - from.y) * i) / 8,
        button,
        buttons,
      });
      await sleep(20);
    }
    if (cancel) {
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button, buttons: 0, clickCount: 1 });
    await sleep(100);
  };
  await zoom(400);
  const panStart = await probe(),
    p = await point('#ruler');
  await pointer(p, { x: p.x - 100, y: p.y }, 'middle');
  const panEnd = await probe();
  await pointer(p, { x: p.x - 60, y: p.y }, 'middle', true);
  const panCancel = await probe();
  await zoom(160);
  await evaluate(`__timelineW.spoolNative.selectClip('shot')`);
  const moveStart = await probe(),
    from = await point('[data-clip="shot"]');
  const scale = await evaluate(
    `(()=>{const w=__timelineW,r=w.document.querySelector('[data-clip="shot"]').getBoundingClientRect();return r.width/48;})()`,
  );
  await pointer(from, { x: from.x + 84 * scale, y: from.y });
  const moveEnd = await probe();
  await evaluate(`__timelineW.spoolNative.selectClip('shot')`);
  await zoom(100);
  const take = await point('[data-view="s15"]'),
    destination = await evaluate(
      `(()=>{const w=__timelineW,d=w.document,sc=d.getElementById('timelineScroll'),r=sc.getBoundingClientRect(),f=w===window?{left:0,top:0}:document.querySelector('#spool-dock iframe').getBoundingClientRect(),lane=d.querySelector('[data-clip="following"]').getBoundingClientRect();const node=d.querySelector('[data-clip="following"]'),scale=node.getBoundingClientRect().width/48;return {x:r.left+f.left+192*scale-sc.scrollLeft,y:lane.top+f.top+lane.height/2};})()`,
    );
  let intercepted;
  page.on('Input.dragIntercepted', event => {
    intercepted = event.data;
  });
  await page.send('Input.setInterceptDrags', { enabled: true });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...take });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...take,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: take.x + 12,
    y: take.y + 8,
    button: 'left',
    buttons: 1,
  });
  for (let i = 0; i < 50 && !intercepted; i++) await sleep(20);
  if (!intercepted) throw Error('Native take drag did not start');
  for (const type of ['dragEnter', 'dragOver', 'drop'])
    await page.send('Input.dispatchDragEvent', { type, ...destination, data: intercepted });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...destination,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await page.send('Input.setInterceptDrags', { enabled: false });
  await evaluate(
    `(async()=>{const w=__timelineW,end=Date.now()+20000;while(w.document.getElementById('editor').inert||!w.spoolNative.state.clips.some(c=>c.id!=='shot'&&c.takeId==='s15')){if(Date.now()>end)throw Error('Take drop failed: '+w.document.getElementById('toast').textContent);await new Promise(r=>setTimeout(r,50));}await w.spoolNative.flush();})()`,
  );
  await evaluate(
    `window.__timelineGestures=${JSON.stringify({ panStart, panEnd, panCancel, moveStart, moveEnd, trustedTakeDrag: true })}`,
  );
}

async function runTimelineSnapping(page, evaluate) {
  await evaluate(
    `(async()=>{const w=window;window.__snapW=w;w.spoolNative.selectClip('moving');if(!w.spoolNative.state.snap)w.document.getElementById('snap').click();await w.spoolNative.flush();})()`,
  );
  const probe = () =>
    evaluate(
      `(async()=>{const w=__snapW,T=await import('/spool/ui/timeline.js');await w.spoolNative.flush();return {rows:T.layout(w.spoolNative.state).map(r=>({id:r.clip.id,start:r.start,end:r.end,in:r.clip.in,out:r.clip.out})),frame:w.spoolNative.state.frame,range:T.exportRange(w.spoolNative.state),labels:[...w.document.querySelectorAll('#exportRangeBar button')].map(b=>w.getComputedStyle(b).opacity)};})()`,
    );
  const box = selector =>
    evaluate(
      `(()=>{const w=__snapW,r=w.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),f=w===window?{left:0,top:0}:document.querySelector('#spool-dock iframe').getBoundingClientRect();return {x:f.left+r.left+r.width/2,y:f.top+r.top+r.height/2,left:f.left+r.left,top:f.top+r.top,width:r.width,height:r.height};})()`,
    );
  const move = async (from, to) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= 12; i++) {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * i) / 12,
        y: from.y + ((to.y - from.y) * i) / 12,
        button: 'left',
        buttons: 1,
      });
      await sleep(15);
    }
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: to.x,
      y: to.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await sleep(60);
  };
  const drag = async (left, offsetPixels) => {
    const from = await box('#clipLane [data-clip="moving"]'),
      scale = from.width / 48;
    await move(from, { x: from.x + (left - 240) * scale + offsetPixels, y: from.y });
    return probe();
  };
  const undo = () => evaluate('(async()=>{__snapW.spoolNative.undo();await __snapW.spoolNative.flush();})()');
  const initial = await probe(),
    trailing = await drag(48, 4);
  await undo();
  const leading = await drag(144, -4);
  await undo();
  await evaluate('__snapW.document.getElementById("snap").click()');
  const disabled = await drag(48, 4);
  await undo();
  await evaluate('__snapW.document.getElementById("snap").click()');
  const deliberate = await drag(48, 14);
  await undo();
  const away = await box('#clipLane [data-clip="moving"]');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: away.x, y: away.y });
  const hidden = await probe();
  const bar = await box('#exportRangeBar'),
    hover = { x: bar.left + 90, y: bar.top + 3 };
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hover });
  const visible = await probe();
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...hover,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...hover,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  const clicked = await probe();
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: away.x, y: away.y });
  const left = await probe();
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.left + 2, y: bar.top + 3 });
  const handle = await box('#exportRangeBar [data-export-edge="start"]');
  await move(handle, { x: handle.x + 24, y: handle.y });
  const adjusted = await probe();
  await evaluate(
    `window.__snapping=${JSON.stringify({ initial, trailing, leading, disabled, deliberate, hidden, visible, clicked, left, adjusted })}`,
  );
}

// --- run --------------------------------------------------------------------
async function libraryFixture() {
  return api('projects', {
    document: {
      project: 'Library navigation QA',
      fps: 24,
      clips: [],
      media: [],
      audioClips: [],
      importedWorkflows: [
        { id: 'custom-local', name: 'Custom local', data: { executionTarget: 'local' } },
        { id: 'custom-cloud', name: 'Custom cloud', data: { executionTarget: 'cloud' } },
      ],
    },
  });
}

async function runLibraryNavigation(page, evaluate) {
  const results = [];
  const click = async (selector, blocked = false) => {
    const point = await evaluate(
      `(async()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});await new Promise(r=>requestAnimationFrame(r));const box=el.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:!!hit?.closest(${JSON.stringify(selector)}),target:hit?.outerHTML.slice(0,150),layout:[el,document.getElementById('workflowList'),document.querySelector('.workflow-library'),document.getElementById('mediaPanel')].map(n=>({id:n.id||n.className,rect:JSON.stringify(n.getBoundingClientRect()),display:getComputedStyle(n).display,overflow:getComputedStyle(n).overflow}))};})()`,
    );
    assert.equal(
      point.hit,
      !blocked,
      'Mouse target has the expected availability: ' + selector + ' ' + JSON.stringify(point),
    );
    const { x, y } = point;
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  };
  const wait = async expression => {
    for (let i = 0; i < 300; i++) {
      if (await evaluate(expression)) return;
      await sleep(40);
    }
    throw Error('Timed out: ' + expression);
  };
  await wait('!!document.querySelector("[data-builtin]")');
  if (await evaluate('innerWidth<=1100')) {
    await click('#workspaceMenu');
    await click('#workflowLibraryToggle');
  }
  for (let i = 0; i < 20; i++) {
    const tab = i % 2 ? 'workflows' : 'media';
    await click('[data-bin-tab="' + tab + '"]');
    assert.equal(
      await evaluate('document.getElementById("mediaPanel").dataset.tab'),
      tab,
      'Library responds to each mouse click',
    );
  }
  results.push('Twenty consecutive mouse clicks switch library tabs');
  await evaluate(
    `window.__libraryFetch=window.fetch;window.fetch=(input,options)=>{if(String(input)==='/spool/api/projects/'+spoolNative.projectKey&&options?.method==='PUT'){window.__librarySaving=true;return new Promise(resolve=>window.__releaseLibrarySave=()=>{window.fetch=window.__libraryFetch;resolve(window.fetch(input,options));});}return window.__libraryFetch(input,options);};`,
  );
  try {
    await click('[data-builtin="api_ltx2_5_t2v"]');
    await wait('!!window.__librarySaving');
    await click('[data-bin-tab="media"]');
    assert.equal(
      await evaluate('document.getElementById("mediaPanel").dataset.tab'),
      'media',
      'Media tab remains usable during workflow saving',
    );
    await click('[data-bin-tab="workflows"]');
    assert.equal(
      await evaluate('document.getElementById("mediaPanel").dataset.tab'),
      'workflows',
      'Workflows tab remains usable during workflow saving',
    );
    const before = await evaluate('spoolNative.state.clips.length');
    assert.equal(
      await evaluate('document.getElementById("editor").inert'),
      false,
      'Atomic workflow saves leave the editor interactive',
    );
    await click('[data-builtin="api_ltx2_5_t2v"]');
    await wait('spoolNative.state.clips.length===' + String(before + 1));
    results.push('Tabs and workflow additions stay usable during a delayed atomic project save');
  } finally {
    await evaluate('window.__releaseLibrarySave?.()');
    if (await evaluate('!!window.__librarySaving')) await wait('!!spoolNative.state.clips.at(-1)?.workflowVersion');
    await evaluate('spoolNative.flush()');
  }
  await evaluate('window.__libraryPointerChecks=' + JSON.stringify(results));
}

async function runLibraryDrop(page, evaluate, label) {
  await evaluate(
    `document.querySelector('[data-builtin="api_ltx2_5_t2v"]').scrollIntoView({block:'center'});document.getElementById('timelineScroll').scrollLeft=0;`,
  );
  const boxes = await evaluate(
    `(()=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,right:r.right};};return {source:box(document.querySelector('[data-builtin="api_ltx2_5_t2v"]')),target:box(document.querySelector('[data-clip="drag-clip-0"]'))};})()`,
  );
  let intercepted;
  page.on('Input.dragIntercepted', event => (intercepted = event.data));
  await page.send('Input.setInterceptDrags', { enabled: true });
  try {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: boxes.source.x, y: boxes.source.y });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: boxes.source.x,
      y: boxes.source.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= 8 && !intercepted; i++)
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: boxes.source.x + ((boxes.target.x - boxes.source.x) * i) / 8,
        y: boxes.source.y + ((boxes.target.y - boxes.source.y) * i) / 8,
        button: 'left',
        buttons: 1,
      });
    for (let i = 0; i < 30 && !intercepted; i++) await sleep(50);
    assert.ok(
      intercepted?.items.some(item => item.mimeType === 'application/spool'),
      'Native drag starts with the workflow payload',
    );
    await page.send('Input.dispatchDragEvent', {
      type: 'dragEnter',
      x: boxes.target.x,
      y: boxes.target.y,
      data: intercepted,
    });
    await page.send('Input.dispatchDragEvent', {
      type: 'dragOver',
      x: boxes.target.x,
      y: boxes.target.y,
      data: intercepted,
    });
    assert.ok(
      await evaluate(
        `!document.querySelector('.library-drop-preview').hidden&&document.querySelector('.library-drop-preview').dataset.mode==='replace'`,
      ),
      'Native workflow hover shows replacement',
    );
    await page
      .send('Page.captureScreenshot', { format: 'png' })
      .then(r =>
        fs.writeFileSync(path.join(evidence, label.replace('/', '-') + '-hover.png'), Buffer.from(r.data, 'base64')),
      );
    await page.send('Input.dispatchDragEvent', {
      type: 'dragOver',
      x: boxes.target.right - 1,
      y: boxes.target.y,
      data: intercepted,
    });
    assert.ok(
      await evaluate(
        `!document.querySelector('.library-drop-preview').hidden&&document.querySelector('.library-drop-preview').dataset.mode==='insert'`,
      ),
      'Native edge hover shows insertion',
    );
    await page.send('Input.dispatchDragEvent', {
      type: 'dragCancel',
      x: boxes.target.x,
      y: boxes.target.y,
      data: intercepted,
    });
    return [
      'Native mouse drag carries the workflow payload',
      'Native body hover highlights replacement and edge hover marks insertion',
    ];
  } finally {
    await page.send('Input.setInterceptDrags', { enabled: false });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: boxes.target.x,
      y: boxes.target.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  }
}

(async () => {
  await new Promise((resolve, reject) => {
    const probe = require('node:net').createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  fs.mkdirSync(evidence, { recursive: true });
  const extensions = await fetch(base + '/extensions').then(r => r.json());
  const spoolExtension = extensions.find(name => name.endsWith('/spool.js'));
  if (!spoolExtension) throw Error('QA host has no Spool extension');
  const webPrefix = spoolExtension.slice(0, spoolExtension.lastIndexOf('/') + 1);
  const names = requested.length
    ? requested
    : Object.keys(CHECKS).filter(
        name => !['workflow-project-profile', 'workflow-capture-bundle', 'cloud-smoke'].includes(name),
      );
  for (const name of names) if (!CHECKS[name]) throw Error('Unknown check: ' + name);
  // Frontend checks can share an older CPU host. Cover new backend routes with
  // fresh Python HTTP tests, and serve this branch's new template captures here.
  const catalog = JSON.parse(
    execFileSync(
      'python',
      ['-c', 'import json;from spool.templates import CATALOG;print(json.dumps(list(CATALOG.values())))'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8' },
    ),
  );
  const hostTemplates = new Set((await api('templates')).map(row => row.id)),
    addedTemplates = new Set(catalog.filter(row => !hostTemplates.has(row.id)).map(row => row.id));
  const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '../spool/cloud_templates.json'), 'utf8'));
  const ownWorkflows = execFileSync(
    'python',
    [
      '-c',
      'import json;from spool import templates;print(json.dumps({"templates":{i:templates.own_capture(i) for i in templates.OWN}}))',
    ],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' },
  );
  let stagedImage;
  if (addedTemplates.size && names.some(name => CHECKS[name].branchTemplates)) {
    stagedImage = await uploadInput(
      'spool-library-browser-qa.png',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2kAAAAASUVORK5CYII=',
        'base64',
      ),
    );
  }
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + path.resolve(evidence, 'profile'),
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let browser;
  const summary = [];
  try {
    let version;
    for (let i = 0; i < 100; i++) {
      try {
        version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json());
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!version) throw Error('Owned Chromium did not start');
    browser = await connect(version.webSocketDebuggerUrl);

    for (const name of names) {
      const check = CHECKS[name];
      const project = await check.fixture();
      for (const mode of check.modes) {
        const target = await browser.send('Target.createTarget', { url: 'about:blank' });
        const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
        const page = await connect(targets.find(t => t.id === target.targetId).webSocketDebuggerUrl);
        const pageErrors = [];
        const label = name + '/' + mode;
        try {
          page.on('Runtime.exceptionThrown', ({ exceptionDetails }) =>
            pageErrors.push(exceptionDetails.exception?.description || exceptionDetails.text),
          );
          page.on('Fetch.requestPaused', async ({ requestId, request }) => {
            const requestUrl = new URL(request.url);
            if (
              apiBase !== base &&
              (requestUrl.pathname.startsWith('/spool/api/') || requestUrl.pathname.startsWith('/spool/media/'))
            ) {
              const headers = {
                ...Object.fromEntries(
                  Object.entries(request.headers).filter(([key]) =>
                    [
                      'content-type',
                      'x-filename',
                      'x-spool-view',
                      'x-spool-since',
                      'x-spool-revision',
                      'range',
                    ].includes(key.toLowerCase()),
                  ),
                ),
                Origin: apiBase,
              };
              const postData = request.postDataEntries?.every(entry => typeof entry.bytes === 'string')
                ? Buffer.concat(request.postDataEntries.map(entry => Buffer.from(entry.bytes, 'base64')))
                : request.postData;
              const response = await fetch(apiBase + requestUrl.pathname + requestUrl.search, {
                method: request.method,
                headers,
                body: postData,
              });
              let body = Buffer.from(await response.arrayBuffer());
              if (check.cloudOnly && requestUrl.pathname === '/spool/api/capabilities') {
                const value = JSON.parse(body);
                Object.assign(value, { connected: false, definitions: {}, configuration: null });
                body = Buffer.from(JSON.stringify(value));
              }
              const responseHeaders = [
                { name: 'Content-Type', value: response.headers.get('Content-Type') || 'application/json' },
                ...['Server-Timing', 'Content-Range', 'Accept-Ranges']
                  .filter(name => response.headers.has(name))
                  .map(name => ({ name, value: response.headers.get(name) })),
              ];
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: response.status,
                responseHeaders,
                body: body.toString('base64'),
              });
              return;
            }
            if (check.branchTemplates && new URL(request.url).pathname === '/spool/api/builtin-workflows') {
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(ownWorkflows).toString('base64'),
              });
              return;
            }
            if (check.branchTemplates && new URL(request.url).pathname === '/spool/api/templates') {
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(JSON.stringify(catalog)).toString('base64'),
              });
              return;
            }
            const templatePath = new URL(request.url).pathname.match(
              /^\/spool\/api\/templates\/([^/]+)\/(capture|webp)$/,
            );
            if (check.branchTemplates && templatePath && addedTemplates.has(templatePath[1])) {
              const [, id, extension] = templatePath;
              if (extension === 'webp') {
                const asset = await fetch(base + '/templates/' + id + '-1.webp');
                await page.send('Fetch.fulfillRequest', {
                  requestId,
                  responseCode: asset.status,
                  responseHeaders: [{ name: 'Content-Type', value: 'image/webp' }],
                  body: Buffer.from(await asset.arrayBuffer()).toString('base64'),
                });
                return;
              }
              const capture = structuredClone(bundled.templates[id]),
                row = catalog.find(row => row.id === id);
              capture.definitions = bundled.definitions;
              capture.provenance = {
                builtinTemplate: id,
                builtinTask: row.task,
                workflowName: row.family + ' · ' + row.name,
              };
              // An older backend strictly requires valid example assets for IDs
              // it does not know. The fresh route tests cover missing examples.
              for (const [nodeId, node] of Object.entries(capture.prompt))
                if (node.class_type === 'LoadImage') {
                  node.inputs.image = stagedImage;
                  capture.workflow.nodes.find(n => String(n.id) === nodeId).widgets_values[0] = stagedImage;
                }
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(JSON.stringify(capture)).toString('base64'),
              });
              return;
            }
            if (check.missingRequirements && new URL(request.url).pathname === '/spool/api/capabilities') {
              const value = await fetch(request.url).then(r => r.json());
              value.cloudExecution = false;
              value.requirements = {
                ...value.requirements,
                ffmpeg: false,
                cloudSdk: false,
                missing: ['Install ffmpeg and add it to PATH; Spool uses it to review, prepare and export media.'],
                optional: [
                  'Comfy Cloud needs the comfy-sdk Python package. Install it into the Python that runs ComfyUI (python -m pip install comfy-sdk), then restart ComfyUI.',
                ],
              };
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(JSON.stringify(value)).toString('base64'),
              });
              return;
            }
            if (check.mac && new URL(request.url).pathname === '/spool/api/capabilities') {
              // A macOS host names Finder; the page below also reports a Mac platform.
              const value = await fetch(request.url).then(r => r.json());
              value.fileManager = 'Finder';
              value.clipFolderReveal = true;
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(JSON.stringify(value)).toString('base64'),
              });
              return;
            }
            if (check.cloudOnly && new URL(request.url).pathname === '/spool/api/capabilities') {
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(
                  JSON.stringify({ connected: false, definitions: {}, cloudDefinitions: {}, cloudExecution: true }),
                ).toString('base64'),
              });
              return;
            }
            if (check.templates && request.url.includes('spoolTemplates=embedded')) {
              const html = fs
                .readFileSync(path.join(__dirname, 'template_frame_fixture.html'), 'utf8')
                .replace('__CAPTURE__', JSON.stringify(project.capture).replaceAll('<', '\\u003c'));
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
                body: Buffer.from(html).toString('base64'),
              });
              return;
            }
            if (check.offline && new URL(request.url).pathname === '/spool/api/comfy') {
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(
                  JSON.stringify({
                    state: 'unpaired',
                    error: 'Controlled disconnected Comfy',
                    settings: { startupFile: '', comfyUrl: base, autoStart: false },
                    startupFiles: [],
                  }),
                ).toString('base64'),
              });
              return;
            }
            if (check.bare && request.method === 'GET' && new URL(request.url).pathname === '/spool/api/projects') {
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(JSON.stringify(project.id ? [project] : [])).toString('base64'),
              });
              return;
            }
            const pathname = new URL(request.url).pathname;
            if (check.brokenBuiltins && pathname.endsWith('/spool/ui/builtin-captures.json')) {
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 503,
                responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
                body: Buffer.from('unavailable').toString('base64'),
              });
              return;
            }
            const file = path.join(
              pathname.startsWith(webPrefix) ? path.join(__dirname, '../web') : ui,
              pathname.split('/').at(-1),
            );
            if (fs.existsSync(file) && fs.statSync(file).isFile()) {
              await page.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [
                  { name: 'Content-Type', value: file.endsWith('.css') ? 'text/css' : 'text/javascript' },
                  { name: 'Cache-Control', value: 'no-store' },
                ],
                body: fs.readFileSync(file).toString('base64'),
              });
            } else await page.send('Fetch.continueRequest', { requestId });
          });
          await page.send('Fetch.enable', {
            patterns: [
              { urlPattern: '*/spool/ui/*' },
              { urlPattern: '*' + webPrefix + '*' },
              ...(apiBase !== base ? [{ urlPattern: '*/spool/api/*' }, { urlPattern: '*/spool/media/*' }] : []),
              ...(check.branchTemplates
                ? [{ urlPattern: '*/spool/api/templates*' }, { urlPattern: '*/spool/api/builtin-workflows' }]
                : []),
              ...(check.templates ? [{ urlPattern: '*spoolTemplates=embedded*' }] : []),
              ...(check.cloudOnly || check.missingRequirements ? [{ urlPattern: '*/spool/api/capabilities' }] : []),
              ...(check.mac ? [{ urlPattern: '*/spool/api/capabilities*' }] : []),
              ...(check.bare ? [{ urlPattern: '*/spool/api/projects' }] : []),
              ...(check.offline ? [{ urlPattern: '*/spool/api/comfy' }] : []),
            ],
          });
          await page.send('Page.enable');
          await page.send('Runtime.enable');
          await page.send('Emulation.setDeviceMetricsOverride', {
            width: check.width || 1440,
            height: check.height || 1000,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await page.send('Page.addScriptToEvaluateOnNewDocument', {
            source: 'window.__templateProfileBaseline=' + String(process.env.SPOOL_TEMPLATE_BASELINE === '1'),
          });
          if (check.mac)
            await page.send('Page.addScriptToEvaluateOnNewDocument', {
              source:
                "Object.defineProperty(Navigator.prototype,'platform',{get:()=>'MacIntel'});Object.defineProperty(Navigator.prototype,'userAgentData',{get:()=>undefined});",
            });
          if (check.pendingQueue)
            await page.send('Page.addScriptToEvaluateOnNewDocument', {
              source: `sessionStorage.setItem('spool-native-${project.id}:queue-request',JSON.stringify({operationId:'ui-queue-retry',revision:0,items:[{clipId:'shot',count:1}]}));`,
            });
          if (check.thumbnails)
            await page.send('Page.addScriptToEvaluateOnNewDocument', {
              source: `
            sessionStorage.setItem('spool-native-${project.id}:view',JSON.stringify({zoom:800,selected:'thumb-0'}));
            window.__thumbnailBaseline=${process.env.SPOOL_THUMBNAIL_BASELINE === '1'};
            window.__thumbnailProfile={encoded:0,encodingMs:0};
            const originalEncode=HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL=function(...args){const started=performance.now();try{return originalEncode.apply(this,args);}finally{window.__thumbnailProfile.encoded++;window.__thumbnailProfile.encodingMs+=performance.now()-started;}};
          `,
            });
          const url =
            base +
            '/spool/?' +
            (check.bare ? '' : 'project=' + project.id) +
            (mode === 'compact' ? '&mode=compact' : '') +
            (project.bridge ? '&bridge=' + project.bridge : '');
          await page.send('Page.navigate', { url });

          const evaluate = async expression => {
            const result = await page.send('Runtime.evaluate', {
              expression,
              awaitPromise: true,
              returnByValue: true,
              userGesture: !!check.userGesture,
            });
            if (result.exceptionDetails)
              throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
          };

          let ready = false;
          for (let i = 0; i < 300; i++) {
            ready = await evaluate('!!window.spoolNative');
            if (ready) break;
            await sleep(100);
          }
          if (!ready)
            throw Error(
              'Editor initialization failed: ' +
                (await evaluate('document.getElementById("spool-loading")?.textContent')),
            );
          await evaluate(`window.__fixtureProjectId=${JSON.stringify(project.id)}`);
          if (check.globals) await evaluate(`void Object.assign(window,${JSON.stringify(check.globals())})`);

          if (check.libraryNavigation) await runLibraryNavigation(page, evaluate);
          if (check.timelineInteractions) await runTimelineInteractions(page, evaluate);
          if (check.timelineSnapping) await runTimelineSnapping(page, evaluate);
          if (check.drag) {
            for (const id of check.drag.select || [])
              await evaluate(
                `window.spoolNative.selectClip(${JSON.stringify(id)}${check.drag.select.indexOf(id) ? ',false,{ctrlKey:true}' : ''})`,
              );
            await sleep(150);
            await runDrag(page, evaluate, check.drag);
            await evaluate('window.__drag').then(value =>
              fs.writeFileSync(
                path.join(evidence, label.replace('/', '-') + '-drag.json'),
                JSON.stringify(value, null, 2),
              ),
            );
          }

          const takeDeleteKeys = check.takeFiles ? await runTakeDeleteKeys(page, evaluate) : [];
          const result = await evaluate(fs.readFileSync(path.join(__dirname, check.file), 'utf8'));
          result.checks.push(...takeDeleteKeys);
          if (check.libraryDrop) result.checks.push(...(await runLibraryDrop(page, evaluate, label)));
          if (check.takeFiles) {
            for (const [id, files] of Object.entries(project.files))
              for (const file of Object.values(files))
                assert.equal(
                  fs.existsSync(file),
                  !result.deleted.includes(id),
                  'Permanent media/JSON deletion for ' + id,
                );
            result.checks.push(
              'Filesystem verification confirms deleted media and matching JSON are gone, with archived/kept files intact',
            );
          }
          if (check.continuation) {
            const extra = await evaluate('window.__continueWorkflowChecks?.()');
            if (extra) result.checks.push(...extra.checks);
          }
          assert.ok(result && Array.isArray(result.checks) && result.checks.length, 'Check file returned no checks');
          assert.deepEqual(pageErrors, [], 'Browser errors: ' + pageErrors.join('; '));
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          await page
            .send('Page.captureScreenshot', { format: 'png' })
            .then(r =>
              fs.writeFileSync(path.join(evidence, label.replace('/', '-') + '.png'), Buffer.from(r.data, 'base64')),
            );
          summary.push({
            check: name,
            mode,
            project: project.id,
            checks: result.checks.length,
            labels: result.checks,
            evidence: result,
          });
          console.log(label + ': ' + result.checks.length + ' checks passed');
        } catch (error) {
          const diagnostic = await page
            .send('Runtime.evaluate', {
              expression:
                '({toast:document.getElementById("toast")?.textContent,modal:document.getElementById("modal")?.textContent,inert:document.getElementById("editor")?.inert,clips:window.spoolNative?.state.clips.map(c=>({id:c.id,workflow:c.workflow,workflowVersion:c.workflowVersion})),processing:window.spoolNative?.diagnostics()})',
              returnByValue: true,
            })
            .catch(() => null);
          await page
            .send('Page.captureScreenshot', { format: 'png' })
            .then(r =>
              fs.writeFileSync(
                path.join(evidence, label.replace('/', '-') + '-failed.png'),
                Buffer.from(r.data, 'base64'),
              ),
            )
            .catch(() => {});
          summary.push({
            check: name,
            mode,
            project: project.id,
            error: error.message,
            pageErrors,
            diagnostic: diagnostic?.result?.value,
          });
          fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
          throw Error(label + ': ' + error.message);
        } finally {
          page.close();
          await browser.send('Target.closeTarget', { targetId: target.targetId });
        }
      }
    }
    fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(
      '\n' +
        summary.reduce((n, entry) => n + entry.checks, 0) +
        ' browser checks passed across ' +
        summary.length +
        ' runs',
    );
  } finally {
    if (browser) {
      await browser.send('Browser.close').catch(() => {});
      browser.close();
    } else child.kill();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
