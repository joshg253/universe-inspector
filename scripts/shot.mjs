// Screenshot the running dev server with headless Edge (no install; Edge ships with Windows). Waits until the world has rendered.
// usage: scripts/run.cmd node scripts/shot.mjs "<url>" <out.png> [width] [height] [waitSelector]
// SHOT_TEXT=1 also prints the text of the active left panel, to check content without reading the image.
// url params: ?skin=amiga&pack=fantasy&seed=abc&view=s0/b0&ticks=2000  (view="" is the universe)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, w = '1280', h = '820', waitSel = '.crumbs b'] = process.argv.slice(2);
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'ui-shot-'));
const proc = spawn(edge, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, `--window-size=${w},${h}`, '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) pending.get(d.id)(d);
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  let ok = false;
  for (let i = 0; i < 100; i++) {
    const r = await send('Runtime.evaluate', { expression: `!!document.querySelector(${JSON.stringify(waitSel)})`, returnByValue: true });
    if (r.result?.result?.value) { ok = true; break; }
    await sleep(150);
  }
  await sleep(600); // let the map draw after the view arrives
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  if (process.env.SHOT_TEXT) {
    const t = await send('Runtime.evaluate', { expression: "document.querySelector('.panel.active')?.innerText ?? ''", returnByValue: true });
    console.log(t.result?.result?.value);
  }
  console.log(ok ? 'ready' : 'TIMEOUT waiting for ' + waitSel, logs.length ? logs.join('\n') : 'no errors');
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
}
process.exit(0);
