import type {ReportPdfImage} from './pdfHeader';
export async function loadReportImage(url: string | null): Promise<ReportPdfImage | null> {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Não foi possível carregar a identidade visual do relatório. Tente novamente.');
  const blob = await response.blob();
  let ratio: number;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob); ratio = bitmap.width / bitmap.height; bitmap.close();
  } else {
    const localUrl = URL.createObjectURL(blob);
    try { ratio = await new Promise<number>((resolve, reject) => {const image = new Image(); image.onload = () => resolve(image.naturalWidth / image.naturalHeight); image.onerror = reject; image.src = localUrl;}); }
    finally { URL.revokeObjectURL(localUrl); }
  }
  return {bytes: new Uint8Array(await blob.arrayBuffer()), ratio, format: blob.type.includes('png') ? 'PNG' : blob.type.includes('webp') ? 'WEBP' : 'JPEG'};
}
