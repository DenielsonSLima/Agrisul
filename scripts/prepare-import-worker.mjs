import {copyFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Keep the browser worker matched to the pinned PDF.js package in both runtimes.
const require = createRequire(import.meta.url);
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
await mkdir(publicDirectory, {recursive: true});
await copyFile(join(dirname(require.resolve('pdfjs-dist/package.json')), 'build/pdf.worker.min.mjs'), join(publicDirectory, 'pdf.worker.min.mjs'));
