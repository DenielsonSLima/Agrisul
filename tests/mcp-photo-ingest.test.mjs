import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }));
// The existing checkout shares an older node_modules tree. A fresh install will
// resolve the new direct dependency from the package root.
const sharpPath = (() => {
  try { return require.resolve('sharp'); }
  catch { return require.resolve('sharp', { paths: [require.resolve('wrangler')] }); }
})();
const sharp = require(sharpPath);
const temp = await mkdtemp(join(tmpdir(), 'agrisul-photo-ingest-'));

function transport(config = {}) {
  const calls = [];
  const request = (options, onResponse) => {
    const { status = 200, headers = {}, chunks = [], interrupt = false } = typeof config === 'function' ? config(options) : config;
    calls.push(options);
    const client = new EventEmitter();
    client.destroy = () => { client.destroyed = true; };
    client.end = () => queueMicrotask(() => {
      if (client.destroyed) return;
      const response = new PassThrough();
      response.statusCode = status;
      response.headers = headers;
      onResponse(response);
      queueMicrotask(() => {
        if (client.destroyed) return;
        for (const chunk of chunks) response.write(chunk);
        if (interrupt) response.emit('aborted');
        else response.end();
      });
    });
    return client;
  };
  return { request, calls };
}

try {
  const outfile = join(temp, 'photo-ingest.mjs');
  await build({
    entryPoints: ['modules/mcp/photoIngest.ts'], outfile,
    bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'installed-sharp', setup(builder) {
      builder.onResolve({ filter: /^sharp$/ }, () => ({ path: sharpPath, external: true }));
    } }],
  });
  const api = await import(pathToFileURL(outfile));
  const source = { url: 'https://images.vendor.com/product/ABC-123.png', evidenceUrl: 'https://vendor.com/products/ABC-123', brand: 'Vendor', code: 'ABC-123' };
  const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];
  const png = await sharp({ create: { width: 8, height: 5, channels: 3, background: '#e52b50' } }).png().toBuffer();
  const product = overrides => ({ '@context': 'https://schema.org', '@type': 'Product', brand: { '@type': 'Brand', name: 'Vendor' }, sku: 'ABC-123', image: source.url, ...overrides });
  const jsonLd = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
  const productPage = (structured, body = `<h1>Vendor ABC-123</h1><img src="${source.url}">`) =>
    `<!doctype html><html><head>${jsonLd(structured)}</head><body>${body}</body></html>`;
  const validPage = productPage(product());
  const pageResponse = html => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, chunks: [Buffer.from(html)] });
  const imageResponse = { headers: { 'content-type': 'image/png', 'content-length': String(png.length) }, chunks: [png] };
  const withImageResponse = image => transport(options => options.hostname === 'vendor.com' ? pageResponse(validPage) : image);
  const validTransport = () => withImageResponse(imageResponse);

  for (const address of ['0.0.0.0', '10.0.0.1', '100.64.1.1', '127.0.0.1', '169.254.169.254', '172.20.1.2', '192.168.1.2', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '64:ff9b::a00:1', '2002:c0a8:0101::1', '2001:db8::1']) {
    assert.equal(api.isPublicIpAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(api.isPublicIpAddress(address), true, address);
  }

  for (const url of [
    'http://images.vendor.com/p.png', 'https://127.0.0.1/p.png',
    'https://[::1]/p.png', 'https://localhost/p.png', 'https://asset.local/p.png',
    'https://example.test/p.png', 'https://user:pass@images.vendor.com/p.png',
    'https://images.vendor.com:8443/p.png', 'https://images.vendor.com/p.png#fragment',
  ]) {
    await assert.rejects(api.ingestExternalProductPhoto({ ...source, url }), api.PhotoIngestError, url);
  }
  for (const invalid of [
    { ...source, brand: '' }, { ...source, code: '' },
    { ...source, evidenceUrl: 'https://vendor.com/' },
    { ...source, evidenceUrl: 'http://vendor.com/products/ABC-123' },
    { ...source, evidenceUrl: source.url },
  ]) {
    await assert.rejects(api.ingestExternalProductPhoto(invalid), api.PhotoIngestError);
  }

  for (const addresses of [
    [{ address: '10.1.2.3', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }],
    [], [{ address: 'not-an-ip', family: 4 }],
  ]) {
    const t = validTransport();
    await assert.rejects(api.ingestExternalProductPhoto(source, { resolveHost: async () => addresses, request: t.request }), error => error.code === 'unsafe_host');
    assert.equal(t.calls.length, 0, 'unsafe DNS must never reach HTTP transport');
  }

  for (const [testCase, expectedCode] of [
    [{ status: 302, headers: { location: 'http://localhost/admin' } }, 'download_failed'],
    [{ status: 200, headers: { 'content-type': 'text/html' }, chunks: [png] }, 'unsupported_media'],
    [{ status: 200, headers: { 'content-type': 'image/jpeg' }, chunks: [png] }, 'unsupported_media'],
    [{ status: 200, headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' }, chunks: [png] }, 'unsupported_media'],
    [{ status: 200, headers: { 'content-type': 'image/png', 'content-length': String(api.PHOTO_MAX_SOURCE_BYTES + 1) } }, 'source_too_large'],
    [{ status: 200, headers: { 'content-type': 'image/png' }, chunks: [Buffer.alloc(api.PHOTO_MAX_SOURCE_BYTES + 1)] }, 'source_too_large'],
    [{ status: 200, headers: { 'content-type': 'image/png' }, chunks: [png], interrupt: true }, 'download_failed'],
  ]) {
    const t = withImageResponse(testCase);
    await assert.rejects(api.ingestExternalProductPhoto(source, { resolveHost: publicDns, request: t.request }), error => error.code === expectedCode);
    assert.equal(t.calls.length, 2);
  }

  for (const [page, expectedCode] of [
    [{ status: 302, headers: { location: 'http://localhost/admin' } }, 'invalid_evidence'],
    [{ headers: { 'content-type': 'image/png' }, chunks: [png] }, 'invalid_evidence'],
    [pageResponse('<html><body><h1>Vendor ABC-123</h1><img src="https://images.vendor.com/product/OTHER.png"></body></html>'), 'invalid_evidence'],
    [pageResponse('<html><body><h1>Vendor ABC-123</h1><img src="https://other.vendor.com/product/ABC-123.png"></body></html>'), 'invalid_evidence'],
    [pageResponse('<html><body><h1>Vendor ABC-123</h1><img src="/product/ABC-123.png"></body></html>'), 'invalid_evidence'],
    [pageResponse('<html><body><h1>Vendor ABC-123</h1><p>https://images.vendor.com/product/ABC-123.png</p></body></html>'), 'invalid_evidence'],
    [pageResponse('<html><body><h1>Vendor</h1><img src="https://images.vendor.com/product/ABC-123.png"></body></html>'), 'invalid_evidence'],
    [pageResponse('<html><body><h1>ABC-123</h1><img src="https://images.vendor.com/product/ABC-123.png"></body></html>'), 'invalid_evidence'],
    [pageResponse('<html><body><div id="app"></div><script>const product = "Vendor ABC-123 https://images.vendor.com/product/ABC-123.png";</script></body></html>'), 'invalid_evidence'],
    [pageResponse(productPage(product({ sku: 'XYZ-999' }))), 'invalid_evidence'],
    [pageResponse(productPage({ ...product(), '@context': 'https://unrelated.example.org' })), 'invalid_evidence'],
    [pageResponse(productPage(product({ brand: { '@type': 'Brand', name: 'Other' } }))), 'invalid_evidence'],
    [pageResponse(productPage(product({ image: 'https://other.vendor.com/product/ABC-123.png' }))), 'invalid_evidence'],
    [pageResponse(productPage({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: [
      product({ image: 'https://images.vendor.com/product/OTHER.png' }),
      product({ brand: 'Other', sku: 'XYZ-999', image: source.url }),
    ] }, `<article>Vendor ABC-123</article><article><img src="${source.url}"></article>`)), 'invalid_evidence'],
    [pageResponse(productPage({ '@context': 'https://schema.org', '@graph': [product(), product()] })), 'invalid_evidence'],
    [pageResponse(productPage({ '@context': 'https://schema.org', '@type': 'CollectionPage', mainEntity: product() })), 'invalid_evidence'],
    [pageResponse(`<html><body><!-- ${jsonLd(product())} --><h1>Vendor ABC-123</h1><img src="${source.url}"></body></html>`), 'invalid_evidence'],
    [pageResponse(`<html><body><pre>&lt;script type="application/ld+json"&gt;${JSON.stringify(product())}&lt;/script&gt;</pre><h1>Vendor ABC-123</h1><img src="${source.url}"></body></html>`), 'invalid_evidence'],
    [pageResponse(`<html><body><script>const markup = '<script type="application/ld+json">${JSON.stringify(product())}';</script><h1>Vendor ABC-123</h1><img src="${source.url}"></body></html>`), 'invalid_evidence'],
    [pageResponse(`<html><body><div data-template='${jsonLd(product())}'></div><h1>Vendor ABC-123</h1><img src="${source.url}"></body></html>`), 'invalid_evidence'],
    [{ headers: { 'content-type': 'text/html', 'content-length': String(api.PHOTO_MAX_EVIDENCE_BYTES + 1) } }, 'invalid_evidence'],
    [{ headers: { 'content-type': 'text/html' }, chunks: [Buffer.alloc(api.PHOTO_MAX_EVIDENCE_BYTES + 1)] }, 'invalid_evidence'],
  ]) {
    const evidenceTransport = transport(options => options.hostname === 'vendor.com' ? page : imageResponse);
    await assert.rejects(api.ingestExternalProductPhoto(source, { resolveHost: publicDns, request: evidenceTransport.request }), error => error.code === expectedCode);
    assert.equal(evidenceTransport.calls.length, 1, 'unverified evidence must prevent image download');
  }

  const t = validTransport();
  const result = await api.ingestExternalProductPhoto(source, { resolveHost: publicDns, request: t.request });
  assert.equal(result.contentType, 'image/webp');
  assert.equal(result.width, 8);
  assert.equal(result.height, 5);
  assert.ok(result.bytes.length <= api.PHOTO_MAX_OUTPUT_BYTES);
  assert.equal((await sharp(result.bytes).metadata()).format, 'webp');
  assert.equal(result.sourceUrl, source.url);
  assert.equal(result.evidenceUrl, source.evidenceUrl);
  assert.equal(result.brand, source.brand);
  assert.equal(result.code, source.code);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(t.calls.length, 2);
  for (const [index, hostname] of [[0, 'vendor.com'], [1, 'images.vendor.com']]) {
    assert.equal(t.calls[index].protocol, 'https:');
    assert.equal(t.calls[index].hostname, hostname);
    assert.equal(t.calls[index].servername, hostname);
    assert.equal(t.calls[index].rejectUnauthorized, true);
    assert.equal(t.calls[index].agent, false);
    t.calls[index].lookup(hostname, {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, '8.8.8.8');
      assert.equal(family, 4);
    });
  }

  const relativePage = pageResponse(productPage(product({ image: '/product/ABC-123.png' }), '<h1>Vendor ABC-123</h1><img src="/product/ABC-123.png">'));
  const relativeTransport = transport(options => options.path === '/products/ABC-123' ? relativePage : imageResponse);
  assert.equal((await api.ingestExternalProductPhoto({ ...source, url: 'https://vendor.com/product/ABC-123.png' }, { resolveHost: publicDns, request: relativeTransport.request })).contentType, 'image/webp');

  const structuredOnly = productPage({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [] }, product(),
  ] }, '<div id="app"></div>');
  const structuredTransport = transport(options => options.hostname === 'vendor.com' ? pageResponse(structuredOnly) : imageResponse);
  assert.equal((await api.ingestExternalProductPhoto(source, { resolveHost: publicDns, request: structuredTransport.request })).contentType, 'image/webp');

  for (const field of ['mpn', 'model', 'productID']) {
    const structured = product({ sku: undefined, [field]: field === 'model' ? { name: 'ABC-123' } : 'ABC-123',
      image: { '@type': 'ImageObject', contentUrl: source.url } });
    const evidence = transport(options => options.hostname === 'vendor.com' ? pageResponse(productPage(structured)) : imageResponse);
    assert.equal((await api.ingestExternalProductPhoto(source, { resolveHost: publicDns, request: evidence.request })).contentType, 'image/webp');
  }

  for (const [contentType, bytes] of [
    ['image/jpeg', await sharp(png).jpeg().toBuffer()],
    ['image/webp', await sharp(png).webp().toBuffer()],
  ]) {
    const variant = withImageResponse({ headers: { 'content-type': contentType }, chunks: [bytes] });
    const converted = await api.ingestExternalProductPhoto(source, { resolveHost: publicDns, request: variant.request });
    assert.equal((await sharp(converted.bytes).metadata()).format, 'webp');
    assert.equal(converted.contentType, 'image/webp');
  }

  const corrupt = withImageResponse({ headers: { 'content-type': 'image/png' }, chunks: [Buffer.concat([png.subarray(0, 8), Buffer.from('corrupt')])] });
  await assert.rejects(api.ingestExternalProductPhoto(source, { resolveHost: publicDns, request: corrupt.request }), error => error.code === 'invalid_image');

  console.log('Passed: single Product JSON-LD brand/code/image binding, category and fake markup rejection, private IP/DNS rejection, pinned HTTPS, redirect/MIME/size limits, real PNG/JPEG/WebP conversion and corrupt decode rejection.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
