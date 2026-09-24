import type {ReportPdfBrand} from '@/shared/reporting/types';
import type {QuotationRequestSnapshot} from './quotationRequestPdf';

type PdfWorkerOptions = {signal?: AbortSignal};
type WorkerResponse = {
  ok: true;
  fileName: string;
  pageCount: number;
  previewBytes: ArrayBuffer;
  printBytes: ArrayBuffer;
} | {
  ok: false;
  message: string;
};

export function createQuotationRequestPdfInWorker(
  snapshot: QuotationRequestSnapshot,
  brand: ReportPdfBrand,
  options: PdfWorkerOptions = {},
) {
  return new Promise<{
    blob: Blob;
    printBlob: Blob;
    fileName: string;
    pageCount: number;
  }>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Geração cancelada', 'AbortError'));
      return;
    }

    const worker = new Worker(new URL('./quotationRequestPdf.worker.ts', import.meta.url), {type: 'module'});
    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Geração cancelada', 'AbortError'));
    };

    worker.addEventListener('message', event => {
      const response = event.data as WorkerResponse;
      cleanup();
      if (!response.ok) {
        reject(new Error(response.message));
        return;
      }
      resolve({
        blob: new Blob([response.previewBytes], {type: 'application/pdf'}),
        printBlob: new Blob([response.printBytes], {type: 'application/pdf'}),
        fileName: response.fileName,
        pageCount: response.pageCount,
      });
    }, {once: true});
    worker.addEventListener('error', event => {
      cleanup();
      reject(new Error(event.message || 'Não foi possível iniciar a geração do PDF.'));
    }, {once: true});
    options.signal?.addEventListener('abort', abort, {once: true});
    worker.postMessage({snapshot, brand});
  });
}
