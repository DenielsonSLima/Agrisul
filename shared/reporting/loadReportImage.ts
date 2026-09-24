import type {ReportPdfImage} from './pdfHeader';

type ReportImageOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
};

async function resizedBlob(
  source: Blob,
  bitmap: ImageBitmap,
  options: ReportImageOptions,
) {
  const maxWidth = options.maxWidth ?? bitmap.width;
  const maxHeight = options.maxHeight ?? bitmap.height;
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  if (scale === 1 || typeof OffscreenCanvas !== 'function') return source;

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({type: 'image/jpeg', quality: options.quality ?? .86});
}

export async function loadReportImage(url: string | null, options: ReportImageOptions = {}): Promise<ReportPdfImage | null> {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Não foi possível carregar a identidade visual do relatório. Tente novamente.');
  let blob = await response.blob();
  let ratio: number;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    ratio = bitmap.width / bitmap.height;
    try { blob = await resizedBlob(blob, bitmap, options); }
    finally { bitmap.close(); }
  } else {
    const localUrl = URL.createObjectURL(blob);
    try { ratio = await new Promise<number>((resolve, reject) => {const image = new Image(); image.onload = () => resolve(image.naturalWidth / image.naturalHeight); image.onerror = reject; image.src = localUrl;}); }
    finally { URL.revokeObjectURL(localUrl); }
  }
  return {bytes: new Uint8Array(await blob.arrayBuffer()), ratio, format: blob.type.includes('png') ? 'PNG' : blob.type.includes('webp') ? 'WEBP' : 'JPEG'};
}
