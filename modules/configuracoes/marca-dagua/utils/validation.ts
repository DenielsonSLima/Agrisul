import type {WatermarkSettings} from "../types";
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export function validateSettings(data: Record<string, unknown>): Pick<WatermarkSettings,"orientation"|"opacity"|"size"> {
  if (data.orientation !== 'portrait' && data.orientation !== 'landscape') throw new Error('Escolha retrato ou paisagem.');
  if (typeof data.opacity !== 'number' || !Number.isInteger(data.opacity) || data.opacity < 0 || data.opacity > 100) throw new Error('A opacidade deve ficar entre 0 e 100%.');
  if (typeof data.size !== 'number' || !Number.isInteger(data.size) || data.size < 10 || data.size > 100) throw new Error('O tamanho deve ficar entre 10 e 100%.');
  return {orientation: data.orientation, opacity: data.opacity, size: data.size};
}
export function imageMime(bytes: Uint8Array): string | null {
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return 'image/webp';
  return null;
}
