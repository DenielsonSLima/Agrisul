/// <reference lib="webworker" />

import type {ReportPdfBrand} from '@/shared/reporting/types';
import {
  createQuotationRequestPdf,
  type QuotationRequestSnapshot,
} from './quotationRequestPdf';

type WorkerRequest = {
  snapshot: QuotationRequestSnapshot;
  brand: ReportPdfBrand;
};

type WorkerSuccess = {
  ok: true;
  fileName: string;
  pageCount: number;
  previewBytes: ArrayBuffer;
  printBytes: ArrayBuffer;
};

type WorkerFailure = {ok: false; message: string};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', event => {
  const request = event.data as WorkerRequest;
  void createQuotationRequestPdf(request.snapshot, request.brand).then(({doc, fileName}) => {
    const pageCount = doc.getNumberOfPages();
    const previewBytes = doc.output('arraybuffer');
    doc.autoPrint();
    const printBytes = doc.output('arraybuffer');
    const response: WorkerSuccess = {ok: true, fileName, pageCount, previewBytes, printBytes};
    workerScope.postMessage(response, [previewBytes, printBytes]);
  }).catch(reason => {
    const response: WorkerFailure = {
      ok: false,
      message: (reason as Error).message || 'Não foi possível gerar o PDF.',
    };
    workerScope.postMessage(response);
  });
});

export {};
