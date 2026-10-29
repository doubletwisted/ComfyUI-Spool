// Dependency-free installed Chromium checks through CDP. Uses only CPU QA 8195.
// node tests/run_generation.cjs CHROMIUM_EXECUTABLE PROJECT_ID EVIDENCE_DIRECTORY
const fs = require('node:fs'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  assert = require('node:assert/strict');
const [executable, project, evidence = '.native-test/generation-browser'] = process.argv.slice(2),
  base = process.env.SPOOL_BROWSER_BASE || 'http://127.0.0.1:8195',
  port = Number(process.env.SPOOL_BROWSER_PORT || 9228);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
  const socket = new WebSocket(url),
    pending = new Map();
  let serial = 0;
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = event => {
    const value = JSON.parse(event.data),
      entry = pending.get(value.id);
    if (entry) {
      pending.delete(value.id);
      value.error ? entry.reject(Error(value.error.message)) : entry.resolve(value.result);
    }
  };
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}
(async () => {
  await new Promise((resolve, reject) => {
    const probe = require('node:net').createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  fs.mkdirSync(evidence, { recursive: true });
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
    const results = [];
    for (const compact of [false]) {
      const target = await browser.send('Target.createTarget', { url: 'about:blank' }),
        targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()),
        page = await connect(targets.find(t => t.id === target.targetId).webSocketDebuggerUrl);
      const evaluate = async expression => {
        const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      try {
        await page.send('Page.enable');
        await page.send('Emulation.setDeviceMetricsOverride', {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.send('Page.navigate', { url: base + (compact ? '/?spoolProject=' : '/spool/?project=') + project });
        let ready = false;
        for (let i = 0; i < 200; i++) {
          ready = await evaluate(
            compact
              ? "!!document.querySelector('#spool-dock iframe')?.contentWindow?.spoolNative"
              : '!!window.spoolNative',
          );
          if (ready) break;
          await sleep(100);
        }
        if (!ready) throw Error('Editor did not initialize');
        if (compact) {
          await evaluate('if(!window.spoolDock.visible)window.spoolDock.toggle()');
          for (let i = 0; i < 100; i++) {
            if (await evaluate("document.querySelector('#spool-dock iframe').getBoundingClientRect().width>0")) break;
            await sleep(50);
          }
        }
        await evaluate("window.spoolNative.selectClip('shot')");
        const geometry = await evaluate(
          "(()=>{const w=window,d=w.document,s=d.querySelector('.seed-controls'),c=d.getElementById('inspectorContent');return {width:s.getBoundingClientRect().width,contentWidth:c.clientWidth,overflow:c.scrollWidth>c.clientWidth};})()",
        );
        assert.ok(geometry.width > 180 && !geometry.overflow, 'Visible generation summary fits the actual editor');
        const result = await evaluate(fs.readFileSync(path.join(__dirname, 'generation_browser_checks.js'), 'utf8'));
        result.geometry = geometry;
        results.push(result);
        await page
          .send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
          .then(r =>
            fs.writeFileSync(path.join(evidence, compact ? 'compact.png' : 'full.png'), Buffer.from(r.data, 'base64')),
          );
        console.log(JSON.stringify({ compact, checks: result.checks.length, geometry }));
      } finally {
        page.close();
        await browser.send('Target.closeTarget', { targetId: target.targetId });
      }
    }
    fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify(results, null, 2));
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
