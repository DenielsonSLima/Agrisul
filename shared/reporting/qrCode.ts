import {qrcodegen} from '@/vendor/qrcodegen';

/** Encode locally so document links and hashes never go to a QR image service. */
export function qrMatrix(value: string): boolean[][] {
  const code = qrcodegen.QrCode.encodeText(value, qrcodegen.QrCode.Ecc.MEDIUM);
  return Array.from({length: code.size}, (_, y) => Array.from({length: code.size}, (_, x) => code.getModule(x, y)));
}

export function qrSvgDataUrl(value: string): string {
  const matrix = qrMatrix(value), size = matrix.length + 8;
  const path = matrix.flatMap((row, y) => row.flatMap((filled, x) => filled ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
