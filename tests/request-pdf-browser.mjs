import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function inspectRequestPdf(bytes) {
  const source = bytes.toString('latin1'), streams = [];
  for (const match of source.matchAll(/\bstream\r?\n/g)) {
    const start = match.index + match[0].length, end = source.indexOf('\nendstream', start);
    if (end < 0) continue;
    const dictionary = source.slice(source.lastIndexOf('<<', match.index), match.index);
    if (dictionary.includes('/Subtype /Image')) continue;
    let data = bytes.subarray(start, end);
    try {if (dictionary.includes('/FlateDecode')) data = inflateSync(data);} catch {continue;}
    streams.push(data.toString('latin1'));
  }
  return {source, streams, text: streams.join('\n'), pages: (source.match(/\/Type \/Page\b/g) || []).length};
}

export async function readRequestPreviewPdf(evaluate, wait) {
  await wait("document.querySelector('.request-preview-modal iframe')?.src.startsWith('blob:')", 'generated PDF preview');
  const encoded = await evaluate(`(async()=>{const frame=document.querySelector('.request-preview-modal iframe');const response=await fetch(frame.src.split('#')[0]);const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)})()`);
  const bytes = Buffer.from(encoded, 'base64');
  assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  return {bytes, ...inspectRequestPdf(bytes)};
}

// Render the actual exported bytes in Chrome's PDF renderer. This checks the
// output independently of the editable HTML page used by the model editor.
export async function captureRequestPdfPages({cdpUrl, filename, output, prefix, pages}) {
  if (pages.length > 1) {
    for (const page of pages) await captureRequestPdfPages({cdpUrl, filename, output, prefix, pages: [page]});
    return;
  }
  const tab = await (await fetch(`${cdpUrl}/json/new?about:blank`, {method: 'PUT'})).json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl), jobs = new Map();let sequence = 0;
  await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once: true});socket.addEventListener('error', reject, {once: true});});
  socket.addEventListener('message', event => {const message = JSON.parse(event.data), job = jobs.get(message.id);if (job) {jobs.delete(message.id);clearTimeout(job.timer);if (message.error) job.reject(Error(message.error.message));else job.resolve(message.result);}});
  const send = (method, params = {}) => new Promise((resolve, reject) => {const id = ++sequence, timer = setTimeout(() => {jobs.delete(id);reject(Error('CDP PDF timeout: ' + method));}, 45000);jobs.set(id, {resolve, reject, timer});socket.send(JSON.stringify({id, method, params}));});
  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 940, height: 1210, deviceScaleFactor: 1, mobile: false});
    for (const page of pages) {
      await send('Page.navigate', {url: pathToFileURL(resolve(filename)).href + `#page=${page}&toolbar=0&navpanes=0&zoom=100`});
      await new Promise(resolve => setTimeout(resolve, 1700));
      const screenshot = await send('Page.captureScreenshot', {format: 'png'});
      writeFileSync(resolve(output, `${prefix}-pagina-${page}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  } finally {
    try {await send('Page.close');} finally {socket.close();for (const job of jobs.values()) clearTimeout(job.timer);}
  }
}
