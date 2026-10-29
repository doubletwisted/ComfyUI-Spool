import * as L from './ledger.js';
import { keyText } from './keys.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createProjectDialogs({
  $,
  copy,
  esc,
  svg,
  request,
  BOOT,
  productCapabilities,
  projectKey,
  getFps,
  getWorkflowLibrary,
  getTemplateBrowser,
  builtinPreparer,
  getState,
  history,
  edits,
  projectData,
  selected,
  take,
  toast,
  preparedWorkflows,
  workflowLoads,
  importFiles,
  showModal,
  closeModal,
  importFootageDialog,
  detectClipCuts,
  getResolution,
  getNativeRecipes,
  getBridge,
  withBridge,
  getProjectEdit,
  flushNative,
  getFocusViewId,
  getComfyConnection,
  writeComfyConnection,
  renderConnection,
  ensureComfy,
  getExperimentRetry,
  submitExperiment,
  getAddGraphButton,
  renderInspector,
}) {
  function projectSettings() {
    const size = getResolution()(),
      occupied = getState().clips.length || getState().media.length || (getState().audioClips || []).length;
    showModal(
      'Project settings',
      '<label class="field"><span>Project name</span><input id="settingsName" value="' +
        esc(getState().project) +
        '"></label><label class="field"><span>Project brief</span><textarea id="settingsBrief">' +
        esc(getState().brief || '') +
        '</textarea></label><label class="field"><span>Resolution preset</span><select id="settingsPreset"><option value="custom">Custom</option><option value="960,540">960 × 540</option><option value="1280,720">HD · 1280 × 720</option><option value="1920,1080">Full HD · 1920 × 1080</option><option value="3840,2160">4K UHD · 3840 × 2160</option><option value="1080,1920">Portrait · 1080 × 1920</option></select></label><div class="two-fields"><label class="field"><span>Width</span><input type="number" min="2" step="2" id="settingsWidth" value="' +
        size.width +
        '"></label><label class="field"><span>Height</span><input type="number" min="2" step="2" id="settingsHeight" value="' +
        size.height +
        '"></label></div><label class="field"><span>Frame rate</span><input type="number" min="1" step="any" id="settingsFps" value="' +
        getFps() +
        '" ' +
        (occupied ? 'readonly' : '') +
        '></label><p class="small">Resolution sets the timeline and export size. Playback copies are prepared automatically at this size without upscaling. Export uses original footage. Workflow generation size is controlled by each workflow.</p><p class="small">' +
        (occupied
          ? 'Frame rate is fixed after media is added to preserve edit timing.'
          : 'The first video sets the frame rate unless you choose one here.') +
        '</p><p id="settingsError"></p>',
      '<button class="outline" id="settingsCancel">Cancel</button><button class="primary" id="settingsSave">Save settings</button>',
    );
    $('settingsPreset').value = [...$('settingsPreset').options].some(o => o.value === size.width + ',' + size.height)
      ? size.width + ',' + size.height
      : 'custom';
    $('settingsPreset').onchange = () => {
      const value = $('settingsPreset').value;
      if (value !== 'custom') {
        const [w, h] = value.split(',');
        $('settingsWidth').value = w;
        $('settingsHeight').value = h;
      }
    };
    for (const id of ['settingsWidth', 'settingsHeight']) $(id).oninput = () => ($('settingsPreset').value = 'custom');
    $('settingsCancel').onclick = closeModal;
    $('settingsSave').onclick = () => {
      const width = Number($('settingsWidth').value),
        height = Number($('settingsHeight').value),
        rate = Number($('settingsFps').value);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 2 ||
        height < 2 ||
        width % 2 ||
        height % 2 ||
        !Number.isFinite(rate) ||
        rate <= 0
      ) {
        $('settingsError').textContent = 'Enter positive even dimensions and a positive frame rate.';
        return;
      }
      edits.apply('Project settings', () => {
        getState().brief = $('settingsBrief').value;
        getState().project = $('settingsName').value.trim() || 'Untitled project';
        getState().resolution = { width, height };
        if (!occupied && rate !== getFps()) {
          getState().fps = rate;
          getState().fpsExplicit = true;
        }
        closeModal();
      });
      toast('Project settings saved');
    };
  }
  function showConflict() {
    showModal(
      'Project changed in another view',
      '<p>Your current edit is kept here. Download it before reloading if you want to preserve it. The server revision has not been overwritten.</p>',
      '<button class="outline" id="draftDownload">Download local edit</button><button class="primary" id="conflictReload">Reload saved project</button>',
    );
    $('draftDownload').onclick = downloadLocalDraft;
    $('conflictReload').onclick = async () => {
      try {
        await getProjectEdit().reload();
        closeModal();
        history.clear();
      } catch (error) {
        toast(error.message);
      }
    };
  }
  async function comfySettings() {
    try {
      writeComfyConnection(await request('comfy'));
      renderConnection();
      const s = getComfyConnection().settings;
      showModal(
        'Comfy settings',
        (productCapabilities.cloudExecution === false
          ? '<p class="setup-note">' +
            esc(productCapabilities.requirements?.optional?.[0] || 'Comfy Cloud is unavailable on this host.') +
            '</p>'
          : '') +
          '<p>' +
          esc(
            getComfyConnection().error ||
              { connected: 'Comfy is connected.', starting: 'Comfy is starting.', stopped: 'Comfy is stopped.' }[
                getComfyConnection().state
              ] ||
              'Check the connection.',
          ) +
          '</p>' +
          (getComfyConnection().state === 'connected'
            ? '<p><a class="download-link" href="' +
              esc(s.comfyUrl) +
              '" target="_blank" rel="noopener">Open ComfyUI</a></p>'
            : '') +
          '<label class="field"><span>Comfy Cloud API Key</span><input id="comfyApiKey" type="password" autocomplete="new-password" placeholder="' +
          (getComfyConnection().hasApiKey ? 'Key configured - leave blank to keep it' : 'comfyui-…') +
          '"></label><p class="small">Stored on this machine. Never included in project exports. Falls back to COMFY_API_KEY.</p><label><input id="comfyClearApiKey" type="checkbox"> Remove saved key</label><label class="field"><span>Startup file</span><input id="comfyStartupFile" list="comfyStartupFiles" value="' +
          esc(s.startupFile) +
          '" placeholder="Full path to your Comfy startup script or executable"><datalist id="comfyStartupFiles">' +
          (getComfyConnection().startupFiles || []).map(p => '<option value="' + esc(p) + '"></option>').join('') +
          '</datalist></label><label class="field"><span>Comfy address</span><input id="comfyAddress" value="' +
          esc(s.comfyUrl) +
          '"></label><p class="small">Use the port from your startup file. Spool starts it in its own folder and keeps the same project store.</p><label class="field"><span><input id="comfyAutoStart" type="checkbox" ' +
          (s.autoStart ? 'checked' : '') +
          '> Start Comfy automatically when standalone Spool opens</span></label><p class="small">Automatic startup is off by default. Closing Spool leaves Comfy running.</p><pre id="comfyStartupLog" hidden></pre>',
        '<button class="outline" id="comfyShowLog" ' +
          (!getComfyConnection().logAvailable ? 'disabled' : '') +
          '>Startup log</button><button class="outline" id="comfySaveSettings">Save settings</button><button class="primary" id="comfySaveStart">Save and connect</button>',
      );
      const saveSettings = async () => {
        await request(
          'comfy/settings',
          {
            startupFile: $('comfyStartupFile').value,
            comfyUrl: $('comfyAddress').value,
            autoStart: $('comfyAutoStart').checked,
            ...($('comfyApiKey').value.trim()
              ? { apiKey: $('comfyApiKey').value.trim() }
              : $('comfyClearApiKey').checked
                ? { apiKey: '' }
                : {}),
          },
          'PUT',
        ).then(result => {
          Object.assign(productCapabilities, { hasApiKey: result.hasApiKey, apiKeySource: result.apiKeySource });
          getWorkflowLibrary()?.render();
          renderInspector(); // Generate waits on the key, so it unlocks without a reload.
        });
        getTemplateBrowser()?.reset();
        builtinPreparer.reset();
        preparedWorkflows.clear();
        workflowLoads.clear();
      };
      $('comfyShowLog').onclick = async () => {
        try {
          $('comfyStartupLog').textContent = (await request('comfy/log')).text;
          $('comfyStartupLog').hidden = false;
        } catch (e) {
          toast(e.message);
        }
      };
      $('comfySaveSettings').onclick = async () => {
        try {
          await saveSettings();
          closeModal();
          toast('Comfy settings saved');
        } catch (e) {
          toast(e.message);
        }
      };
      $('comfySaveStart').onclick = async () => {
        try {
          await saveSettings();
          closeModal();
          await ensureComfy();
          toast('Comfy connected');
        } catch (e) {
          toast(e.message);
        }
      };
    } catch (error) {
      toast(error.message);
    }
  }
  async function showActivity() {
    try {
      const value = await request('projects/' + projectKey + '/events?limit=30&latest=true');
      showModal(
        'Activity',
        '<p>View ID: ' +
          esc(getFocusViewId()) +
          '</p>' +
          value.events
            .slice(-30)
            .reverse()
            .map(
              e =>
                '<p>' +
                esc(e.kind) +
                ' / ' +
                esc(e.data.actor || 'execution') +
                '</p><details><summary>Details</summary><pre>' +
                esc(JSON.stringify(e.data, null, 2)) +
                '</pre></details>',
            )
            .join(''),
        '<button class="outline" id="retryExperiment">Retry pending experiment</button>',
      );
      $('retryExperiment').disabled = !getExperimentRetry();
      $('retryExperiment').onclick = async () => {
        try {
          await submitExperiment(getExperimentRetry());
          closeModal();
        } catch (e) {
          toast(e.message);
        }
      };
    } catch (error) {
      toast(error.message);
    }
  }
  async function reset() {
    await flushNative();
    showModal(
      'New project',
      '<label>Project name<input id="newProjectName" value="Untitled Spool project"></label><label>Project folder<input id="newProjectFolder" placeholder="Leave empty to use your projects directory"></label>',
      '<button class="primary" id="createProjectFolder">Create project</button>',
    );
    $('createProjectFolder').onclick = async () => {
      try {
        const folder = $('newProjectFolder').value.trim(),
          name = $('newProjectName').value.trim() || 'Untitled Spool project';
        const created = await request('projects', {
          document: { project: name, clips: [], media: [] },
          ...(folder ? { folder } : {}),
        });
        location.href = withBridge('/spool/?project=' + created.id);
      } catch (error) {
        toast(error.message);
      }
    };
  }
  async function openProjectFolder() {
    await flushNative();
    showModal(
      'Open project folder',
      '<label>Folder containing project.spool<input id="openProjectFolderPath" placeholder="Full path to the project folder"></label>',
      '<button class="primary" id="openProjectFolderButton">Open project</button>',
    );
    $('openProjectFolderButton').onclick = async () => {
      try {
        const opened = await request('open-project', { folder: $('openProjectFolderPath').value.trim() });
        location.href = withBridge('/spool/?project=' + opened.id);
      } catch (error) {
        toast(error.message);
      }
    };
  }
  function downloadValue(value, suffix = '') {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = getState().project.replace(/[^a-z0-9]+/gi, '-') + suffix + '.spool.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function downloadLocalDraft() {
    const document = copy(projectData()),
      recipes = {};
    for (const c of document.clips)
      if (c.workflowVersion && getNativeRecipes()[c.workflowVersion])
        recipes[c.workflowVersion] = getNativeRecipes()[c.workflowVersion];
    // Evidence is stored outside the working document, so a portable draft must ask for
    // it; without it an imported draft would name graphs and probes it cannot supply.
    let evidence = {};
    try {
      evidence = await request('projects/' + projectKey + '/evidence');
    } catch (error) {
      toast('Downloading the draft without media evidence: ' + error.message);
    }
    downloadValue(
      {
        spoolVersion: 1,
        document: L.compose(document, evidence),
        recipes,
        draftOrigin: { projectId: projectKey, revision: getProjectEdit().revision, unsaved: true },
      },
      '-local-draft',
    );
  }
  async function showProjects() {
    try {
      await flushNative();
      const projects = await request('projects'),
        c = selected(),
        size = getResolution()();
      const action = (id, label, icon, disabled = false) =>
        '<button class="project-dialog-action" id="' +
        id +
        '" ' +
        (disabled ? 'disabled' : '') +
        '>' +
        svg(icon) +
        '<span>' +
        label +
        '</span></button>';
      const rows = projects
        .map(
          p =>
            '<a class="saved-project-row" ' +
            (p.id === projectKey ? 'aria-current="page"' : '') +
            ' href="' +
            esc(withBridge('/spool/?project=' + encodeURIComponent(p.id))) +
            '"><span class="saved-project-icon">' +
            svg('folder') +
            '</span><span class="saved-project-copy"><strong>' +
            esc(p.name) +
            '</strong><small>' +
            esc(
              p.unavailable
                ? 'Folder unavailable'
                : p.folder || (p.id === projectKey ? 'Current project' : 'Open project'),
            ) +
            '</small></span><span class="saved-project-arrow" aria-hidden="true">›</span></a>',
        )
        .join('');
      showModal(
        'Project',
        '<div class="project-dialog-layout"><section aria-labelledby="savedProjectsTitle"><h3 id="savedProjectsTitle">Saved projects <span>' +
          projects.length +
          '</span></h3><nav class="saved-project-list" aria-label="Saved projects">' +
          rows +
          '</nav>' +
          action('projectOpenFile', 'Open project folder…', 'folder') +
          '</section><div class="project-dialog-tools"><section class="project-dialog-group"><h3>Current project</h3><div class="project-current-name">' +
          esc(getState().project) +
          '</div><div class="project-current-meta">' +
          getState().clips.length +
          ' clips · ' +
          getFps() +
          ' fps · ' +
          size.width +
          ' × ' +
          size.height +
          '</div>' +
          action('projectSettings', 'Project settings…', 'sliders') +
          '<div class="project-folder-path">' +
          esc(BOOT.folder || '') +
          '</div>' +
          '</section><section class="project-dialog-group"><h3>Import & tools</h3>' +
          action('projectImportFootage', 'Import footage…', 'import') +
          action('projectImportVideo', 'Import video from path…', 'folder') +
          action(
            'projectAddWorkflow',
            'Add current workflow',
            'nodes',
            !getBridge() && !productCapabilities.connected,
          ) +
          action(
            'projectDetectCuts',
            'Detect cuts in selected clip…',
            'scissors',
            !c || take(c).placeholder || take(c).media.kind !== 'video',
          ) +
          '</section><section class="project-dialog-group"><h3>Connection</h3>' +
          action('projectComfySettings', 'Comfy settings…', 'settings') +
          '</section></div></div>',
        '<span>Edits save automatically. ' +
          keyText('Ctrl') +
          '+S saves now; a save check runs every minute.</span><button class="primary" id="newNativeProject">' +
          svg('plus') +
          'New project</button>',
      );
      $('modal').classList.add('project-dialog');
      $('projectOpenFile').classList.add('project-open-file');
      $('newNativeProject').onclick = () => reset().catch(error => toast(error.message));
      $('projectOpenFile').onclick = openProjectFolder;
      $('projectAddWorkflow').onclick = () => {
        closeModal();
        getAddGraphButton().click();
      };
      $('projectImportFootage').onclick = () => {
        closeModal();
        $('mediaFiles').onchange = e => importFiles(e.target.files, true);
        $('mediaFiles').click();
      };
      $('projectImportVideo').onclick = importFootageDialog;
      $('projectSettings').onclick = projectSettings;
      $('projectComfySettings').onclick = comfySettings;
      $('projectDetectCuts').onclick = () => detectClipCuts(selected().id);
    } catch (error) {
      toast(error.message);
    }
  }
  return {
    projectSettings,
    reset,
    openProjectFolder,
    downloadValue,
    showProjects,
    showActivity,
    showConflict,
    comfySettings,
  };
}
