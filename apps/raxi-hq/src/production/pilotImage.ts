export const MAX_PILOT_IMAGE_BYTES = 20_000_000;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface PilotImageFile {
  readonly type: string;
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface PilotImagePixels {
  width: number;
  height: number;
  visiblePixels: boolean;
}

function matchingSignature(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

/** A filename, MIME label or object URL alone never proves that pixels were decoded. */
export async function inspectPilotImageFile(file: PilotImageFile, decode: (file: PilotImageFile) => Promise<PilotImagePixels>): Promise<PilotImagePixels> {
  if (!allowedTypes.has(file.type) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PILOT_IMAGE_BYTES)
    throw new Error('Selecciona una imagen PNG, JPEG o WebP de hasta 20 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchingSignature(file.type, bytes)) throw new Error('El archivo no coincide con un formato de imagen admitido.');
  let pixels: PilotImagePixels;
  try { pixels = await decode(file); }
  catch { throw new Error('No se pudo decodificar la imagen.'); }
  if (!Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height) || pixels.width < 1 || pixels.height < 1 ||
      pixels.width * pixels.height > 32_000_000 || !pixels.visiblePixels) throw new Error('La imagen no contiene píxeles visualizables.');
  return pixels;
}

/** Decode and sample bounded pixels before displaying a local QA preview. */
export async function decodePilotImage(file: PilotImageFile): Promise<PilotImagePixels> {
  const bitmap = await createImageBitmap(file as Blob);
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > 32_000_000)
      return { width: bitmap.width, height: bitmap.height, visiblePixels: false };
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(bitmap.width, 64);
    canvas.height = Math.min(bitmap.height, 64);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas no disponible.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visiblePixels = false;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) { visiblePixels = true; break; }
    }
    return { width: bitmap.width, height: bitmap.height, visiblePixels };
  } finally { bitmap.close(); }
}
