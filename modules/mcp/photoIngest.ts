import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { ClientRequest, IncomingMessage } from 'node:http';

export const PHOTO_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
export const PHOTO_MAX_EVIDENCE_BYTES = 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UNSAFE_TLDS = new Set(['localhost', 'local', 'internal', 'invalid', 'test', 'example', 'onion']);

export type ProductPhotoSource = {
  /** Direct image URL whose exact brand and product code were identified by the caller. */
  url: string;
  /** HTML page with one schema.org Product JSON-LD entity binding this exact photo. */
  evidenceUrl: string;
  brand: string;
  code: string;
};

export type IngestedProductPhoto = {
  bytes: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
  sha256: string;
  sourceSha256: string;
  sourceUrl: string;
  evidenceUrl: string;
  brand: string;
  code: string;
};

type Address = { address: string; family: number };
type DecodedPhoto = { bytes: Buffer; width: number; height: number };
type HttpsRequest = (options: RequestOptions, onResponse: (response: IncomingMessage) => void) => ClientRequest;

/** Dependency seams are for offline tests; production uses the pinned Node HTTPS transport. */
export type PhotoIngestDependencies = {
  resolveHost?: (hostname: string) => Promise<readonly Address[]>;
  request?: HttpsRequest;
  transcode?: (bytes: Buffer) => Promise<DecodedPhoto>;
};

export class PhotoIngestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PhotoIngestError';
  }
}

function reject(code: string, message: string): never {
  throw new PhotoIngestError(code, message);
}

function validateUrl(value: string, requireSpecificPath: boolean): URL {
  if (typeof value !== 'string' || value.length > 4096) reject('invalid_url', 'Invalid image evidence URL.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return reject('invalid_url', 'Invalid image evidence URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) {
    reject('invalid_url', 'A plain HTTPS URL without credentials, fragment or custom port is required.');
  }
  const host = url.hostname.toLowerCase();
  const labels = host.split('.');
  if (
    host.length > 253 || labels.length < 2 || isIP(host) !== 0 ||
    UNSAFE_TLDS.has(labels.at(-1) ?? '') ||
    labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    reject('unsafe_host', 'The image URL must use a public DNS hostname.');
  }
  if (requireSpecificPath && url.pathname === '/' && !url.search) {
    reject('invalid_evidence', 'A specific product or image evidence URL is required.');
  }
  return url;
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  return address.split('.').reduce((number, octet) => ((number << 8) | Number(octet)) >>> 0, 0);
}

function inIpv4Range(value: number, prefix: number, bits: number): boolean {
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (prefix & mask) >>> 0;
}

/** Conservative allowlist of publicly routable unicast ranges. */
export function isPublicIpAddress(address: string): boolean {
  const v4 = ipv4Number(address);
  if (v4 !== null) {
    const blocked: Array<[number, number]> = [
      [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
      [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
      [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
      [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
    ];
    return !blocked.some(([prefix, bits]) => inIpv4Range(v4, prefix, bits));
  }
  if (isIP(address) !== 6) return false;
  // IPv4-mapped, NAT64, 6to4, Teredo, ULA and link-local ranges must never
  // reach this transport. Only ordinary global IPv6 unicast is accepted.
  const normalized = address.toLowerCase();
  if (normalized.includes('.')) return false;
  const pieces = normalized.split('::');
  if (pieces.length > 2) return false;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  const expanded = pieces.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  if (expanded.length !== 8 || expanded.some(piece => !/^[0-9a-f]{1,4}$/.test(piece))) return false;
  const segments = expanded.map(piece => Number.parseInt(piece, 16));
  const first = segments[0];
  if ((first & 0xe000) !== 0x2000) return false; // 2000::/3 only
  if (first === 0x2002) return false; // 6to4
  if (first === 0x2001 && segments[1] <= 0x01ff) return false; // protocol special use
  if (first === 0x2001 && segments[1] === 0x0db8) return false; // documentation
  return true;
}

type ResourceKind = 'image' | 'evidence';

function contentTypeOf(response: IncomingMessage, kind: ResourceKind): string {
  const value = response.headers['content-type'];
  if (typeof value !== 'string') reject(kind === 'image' ? 'unsupported_media' : 'invalid_evidence', 'Remote response has no valid MIME type.');
  const type = value.split(';', 1)[0].trim().toLowerCase();
  if (kind === 'evidence' && type !== 'text/html') reject('invalid_evidence', 'Evidence must be an HTML product page.');
  if (kind === 'image' && !MIME_TYPES.has(type)) reject('unsupported_media', 'Only JPEG, PNG and WebP images are accepted.');
  return type;
}

function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function downloadResource(url: URL, deps: PhotoIngestDependencies, kind: ResourceKind): Promise<Buffer> {
  const maxBytes = kind === 'image' ? PHOTO_MAX_SOURCE_BYTES : PHOTO_MAX_EVIDENCE_BYTES;
  const resolveHost = deps.resolveHost ?? (host => lookup(host, { all: true }));
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  let addresses: readonly Address[];
  try {
    addresses = await Promise.race([
      resolveHost(url.hostname),
      new Promise<never>((_, rejectTimeout) => {
        dnsTimer = setTimeout(() => rejectTimeout(new PhotoIngestError('timeout', 'Image DNS lookup timed out.')), DOWNLOAD_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof PhotoIngestError) throw error;
    return reject('dns_failed', 'Image hostname could not be resolved.');
  } finally {
    clearTimeout(dnsTimer);
  }
  if (!Array.isArray(addresses) || addresses.length === 0 ||
    addresses.some(entry => (entry.family !== 4 && entry.family !== 6) || !isPublicIpAddress(entry.address))) {
    reject('unsafe_host', 'Image hostname resolves to an unsafe address.');
  }
  const pinned = addresses[0];
  const request = deps.request ?? httpsRequest;
  const options: RequestOptions = {
    protocol: 'https:', hostname: url.hostname, port: 443,
    path: `${url.pathname}${url.search}`, method: 'GET', agent: false,
    servername: url.hostname, rejectUnauthorized: true,
    headers: { Accept: kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'text/html', 'Accept-Encoding': 'identity' },
    lookup: ((_hostname, _options, callback) => callback(null, pinned.address, pinned.family)) as LookupFunction,
  };
  return new Promise<Buffer>((resolve, rejectPromise) => {
    let settled = false;
    let requestHandle: ClientRequest | undefined;
    const finish = (error?: Error, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        requestHandle?.destroy();
        rejectPromise(error);
      } else resolve(result!);
    };
    const timer = setTimeout(() => finish(new PhotoIngestError('timeout', 'Image download timed out.')), DOWNLOAD_TIMEOUT_MS);
    try {
      requestHandle = request(options, response => {
        try {
          if (response.statusCode !== 200) {
            finish(new PhotoIngestError(kind === 'image' ? 'download_failed' : 'invalid_evidence',
              response.statusCode && response.statusCode >= 300 && response.statusCode < 400
                ? 'Remote redirects are not accepted.' : 'Remote resource could not be downloaded.'));
            return;
          }
          const type = contentTypeOf(response, kind);
          const encoding = response.headers['content-encoding'];
          if (encoding && encoding !== 'identity') reject(kind === 'image' ? 'unsupported_media' : 'invalid_evidence', 'Compressed HTTP responses are not accepted.');
          const lengthHeader = response.headers['content-length'];
          if (lengthHeader !== undefined) {
            if (typeof lengthHeader !== 'string' || !/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maxBytes) {
              reject(kind === 'image' ? 'source_too_large' : 'invalid_evidence', 'Remote resource exceeds the download limit.');
            }
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              finish(new PhotoIngestError(kind === 'image' ? 'source_too_large' : 'invalid_evidence', 'Remote resource exceeds the download limit.'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const bytes = Buffer.concat(chunks, size);
            if (kind === 'image' && sniffImageType(bytes) !== type) {
              finish(new PhotoIngestError('unsupported_media', 'Image MIME type does not match its contents.'));
            } else finish(undefined, bytes);
          });
          response.on('error', () => finish(new PhotoIngestError('download_failed', 'Image response was interrupted.')));
          response.on('aborted', () => finish(new PhotoIngestError('download_failed', 'Image response was interrupted.')));
        } catch (error) {
          finish(error instanceof PhotoIngestError ? error : new PhotoIngestError('download_failed', 'Image could not be downloaded.'));
        }
      });
      requestHandle.on('error', () => finish(new PhotoIngestError('download_failed', 'Image could not be downloaded.')));
      requestHandle.end();
    } catch (error) {
      finish(error instanceof PhotoIngestError ? error : new PhotoIngestError('download_failed', 'Image could not be downloaded.'));
    }
  });
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findTagEnd(html: string, start: number): number {
  let quote = '';
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function tagAttribute(tag: string, key: string): string | null {
  const opening = /^<script\b/i.exec(tag);
  if (!opening) return null;
  let index = opening[0].length;
  while (index < tag.length) {
    while (/\s/.test(tag[index] ?? '')) index += 1;
    const start = index;
    while (/[a-z0-9:_-]/i.test(tag[index] ?? '')) index += 1;
    if (index === start) {
      index += 1;
      continue;
    }
    const name = tag.slice(start, index).toLowerCase();
    while (/\s/.test(tag[index] ?? '')) index += 1;
    if (tag[index] !== '=') continue;
    index += 1;
    while (/\s/.test(tag[index] ?? '')) index += 1;
    let value = '';
    const quote = tag[index] === '"' || tag[index] === "'" ? tag[index++] : '';
    if (quote) {
      const end = tag.indexOf(quote, index);
      if (end < 0) return null;
      value = tag.slice(index, end);
      index = end + 1;
    } else {
      const startValue = index;
      while (index < tag.length && !/[\s>]/.test(tag[index])) index += 1;
      value = tag.slice(startValue, index);
    }
    if (name === key) return value;
  }
  return null;
}

function closingTag(html: string, tag: string, from: number): { start: number; end: number } | null {
  const lower = html.toLowerCase();
  let start = lower.indexOf(`</${tag}`, from);
  while (start >= 0) {
    const boundary = lower[start + tag.length + 2] ?? '';
    if (!/[a-z0-9:_-]/.test(boundary)) {
      const end = findTagEnd(html, start);
      if (end >= 0) return { start, end };
    }
    start = lower.indexOf(`</${tag}`, start + tag.length + 2);
  }
  return null;
}

/** Reads real script elements while skipping comments, JS strings and escaped markup. */
function jsonLdScripts(html: string): string[] {
  const scripts: string[] = [];
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) reject('invalid_evidence', 'Evidence page contains an unclosed comment.');
      index = end + 3;
      continue;
    }
    const match = /^<(\/?)([a-z][a-z0-9:_-]*)\b/i.exec(html.slice(start, start + 80));
    if (!match) {
      index = start + 1;
      continue;
    }
    const end = findTagEnd(html, start + match[0].length);
    if (end < 0) reject('invalid_evidence', 'Evidence page contains malformed HTML.');
    const tag = match[2].toLowerCase();
    index = end + 1;
    if (match[1]) continue;
    if (tag === 'template') reject('invalid_evidence', 'Template-only product data requires manual review.');
    if (!['script', 'style', 'textarea', 'title'].includes(tag)) continue;
    const closing = closingTag(html, tag, index);
    if (!closing) reject('invalid_evidence', 'Evidence page contains an unclosed raw-text element.');
    if (tag === 'script') {
      const type = tagAttribute(html.slice(start, end + 1), 'type')?.toLowerCase().trim();
      if (type === 'application/ld+json') scripts.push(html.slice(index, closing.start));
    }
    index = closing.end + 1;
  }
  return scripts;
}

function hasSchemaContext(value: unknown): boolean {
  const stack = [value];
  let visited = 0;
  while (stack.length > 0 && visited++ < 32) {
    const entry = stack.pop();
    if (typeof entry === 'string' && /^https?:\/\/schema\.org\/?$/i.test(entry)) return true;
    if (Array.isArray(entry)) {
      if (entry.length > 32) return false;
      for (const item of entry) stack.push(item);
    } else if (isRecord(entry)) stack.push(entry['@vocab']);
  }
  return false;
}

function typeNames(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function isSchemaType(value: string, type: string): boolean {
  return value === type || value === `https://schema.org/${type}` || value === `http://schema.org/${type}`;
}

function singleProductEntity(html: string): Record<string, unknown> {
  const scripts = jsonLdScripts(html);
  if (scripts.length === 0) reject('invalid_evidence', 'Evidence page has no structured Product data. Manual review is required.');
  const products: Array<{ product: Record<string, unknown>; schema: boolean }> = [];
  let listPage = false;
  let visited = 0;
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch {
      reject('invalid_evidence', 'Evidence page contains invalid JSON-LD. Manual review is required.');
    }
    const stack: Array<{ value: unknown; schema: boolean }> = [{ value: parsed, schema: false }];
    while (stack.length > 0) {
      const entry = stack.pop()!;
      visited += 1;
      if (visited > 20_000) reject('invalid_evidence', 'Evidence page has excessive structured data.');
      if (Array.isArray(entry.value)) {
        for (const item of entry.value) stack.push({ value: item, schema: entry.schema });
        continue;
      }
      if (!isRecord(entry.value)) continue;
      const schema = '@context' in entry.value ? hasSchemaContext(entry.value['@context']) : entry.schema;
      const types = typeNames(entry.value['@type']);
      if (types.some(type => ['ItemList', 'CollectionPage', 'SearchResultsPage', 'OfferCatalog']
        .some(listType => isSchemaType(type, listType)))) listPage = true;
      if (types.some(type => isSchemaType(type, 'Product'))) {
        products.push({ product: entry.value, schema: schema || types.some(type =>
          type === 'https://schema.org/Product' || type === 'http://schema.org/Product') });
      }
      for (const [key, value] of Object.entries(entry.value)) {
        if (key !== '@context') stack.push({ value, schema });
      }
    }
  }
  if (listPage || products.length !== 1 || !products[0].schema) {
    reject('invalid_evidence', 'Evidence must identify exactly one schema.org Product outside a category or list. Manual review is required.');
  }
  return products[0].product;
}

function valuesFor(value: unknown, objectKey: string): string[] {
  const stack = [value];
  const values: string[] = [];
  let visited = 0;
  while (stack.length > 0 && visited++ < 256) {
    const entry = stack.pop();
    if (typeof entry === 'string') values.push(entry);
    else if (Array.isArray(entry)) {
      if (entry.length > 256) return [];
      for (const item of entry) stack.push(item);
    }
    else if (isRecord(entry)) stack.push(entry[objectKey]);
  }
  return stack.length > 0 ? [] : values;
}

function productImageMatches(value: unknown, imageUrl: URL, evidenceUrl: URL): boolean {
  const stack = [value];
  let visited = 0;
  while (stack.length > 0 && visited++ < 256) {
    const ref = stack.pop();
    if (Array.isArray(ref)) {
      if (ref.length > 256) return false;
      for (const item of ref) stack.push(item);
      continue;
    }
    if (isRecord(ref)) {
      stack.push(ref.url, ref.contentUrl);
      continue;
    }
    if (typeof ref !== 'string') continue;
    try {
      if (new URL(ref, evidenceUrl).href === imageUrl.href) return true;
    } catch {
      // An invalid image reference cannot prove an exact match.
    }
  }
  return false;
}

function verifyEvidencePage(bytes: Buffer, imageUrl: URL, evidenceUrl: URL, brand: string, code: string): void {
  let html: string;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    reject('invalid_evidence', 'Evidence page is not valid UTF-8 HTML.');
  }
  if (!/<html\b/i.test(html)) reject('invalid_evidence', 'Evidence URL must be an HTML product page.');
  const product = singleProductEntity(html);
  const brands = valuesFor(product.brand, 'name');
  const codes = [
    ...valuesFor(product.sku, 'name'), ...valuesFor(product.mpn, 'name'),
    ...valuesFor(product.model, 'name'), ...valuesFor(product.productID, 'name'),
  ];
  if (brands.length !== 1 || normalizeText(brands[0]) !== normalizeText(brand) ||
    !codes.some(value => normalizeText(value) === normalizeText(code)) ||
    !productImageMatches(product.image, imageUrl, evidenceUrl)) {
    reject('invalid_evidence', 'Structured Product data does not bind the exact brand, code and image URL. Manual review is required.');
  }
}

async function transcodeImage(bytes: Buffer): Promise<DecodedPhoto> {
  const { default: sharp } = await import('sharp');
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return reject('invalid_image', 'Image could not be decoded.');
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS ||
    (metadata.pages ?? 1) !== 1 || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) {
    reject('invalid_image', 'Image format, dimensions or animation are not supported.');
  }
  // Every attempt starts from the original bytes. Re-encoding drops source metadata.
  for (const [dimension, quality] of [[2048, 82], [1600, 72], [1200, 60], [800, 48]] as const) {
    try {
      const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize(dimension, dimension, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= PHOTO_MAX_OUTPUT_BYTES) return { bytes: data, width: info.width, height: info.height };
    } catch {
      return reject('invalid_image', 'Image could not be decoded.');
    }
  }
  return reject('processed_too_large', 'Image remains too large after conversion.');
}

/**
 * Accepts one schema.org Product JSON-LD entity binding brand, code and exact
 * image URL. This is source-page evidence, not independent visual verification;
 * pages without structured proof require manual review.
 */
export async function ingestExternalProductPhoto(
  source: ProductPhotoSource,
  deps: PhotoIngestDependencies = {},
): Promise<IngestedProductPhoto> {
  if (!source || typeof source !== 'object') reject('invalid_identity', 'An exact brand and product code are required.');
  const brand = typeof source.brand === 'string' ? source.brand.trim() : '';
  const code = typeof source.code === 'string' ? source.code.trim() : '';
  if (!brand || brand.length > 120 || !code || code.length > 120) {
    reject('invalid_identity', 'An exact brand and product code are required.');
  }
  const imageUrl = validateUrl(source.url, true);
  const evidenceUrl = validateUrl(source.evidenceUrl, true);
  if (imageUrl.href === evidenceUrl.href) reject('invalid_evidence', 'Evidence must be a separate HTML product page.');
  const evidence = await downloadResource(evidenceUrl, deps, 'evidence');
  verifyEvidencePage(evidence, imageUrl, evidenceUrl, brand, code);
  const original = await downloadResource(imageUrl, deps, 'image');
  const converted = await (deps.transcode ?? transcodeImage)(original);
  if (!Buffer.isBuffer(converted.bytes) || converted.bytes.length > PHOTO_MAX_OUTPUT_BYTES ||
    converted.bytes.length === 0 || !Number.isSafeInteger(converted.width) || converted.width < 1 ||
    !Number.isSafeInteger(converted.height) || converted.height < 1 ||
    sniffImageType(converted.bytes) !== 'image/webp') {
    reject('invalid_image', 'Image conversion produced invalid WebP data.');
  }
  return {
    bytes: converted.bytes, contentType: 'image/webp', width: converted.width, height: converted.height,
    sha256: createHash('sha256').update(converted.bytes).digest('hex'),
    sourceSha256: createHash('sha256').update(original).digest('hex'),
    sourceUrl: imageUrl.href, evidenceUrl: evidenceUrl.href, brand, code,
  };
}
