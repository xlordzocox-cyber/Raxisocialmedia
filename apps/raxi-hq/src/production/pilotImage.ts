export const MAX_PILOT_IMAGE_BYTES = 20_000_000;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface PilotImageFile {
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PilotImagePixels {
  width: number;
  height: number;
  visiblePixels: boolean;
}

export interface PilotImageIdentity {
  jobId: string;
  ariaImageId: string;
  imageSha256?: string;
}

export interface PilotImageInspection extends PilotImagePixels {
  jobId: string;
  ariaImageId: string;
  sha256: string;
  previewLoaded: boolean;
}

export function validPilotSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function inspectionMatchesReceipt(inspection: PilotImageInspection | undefined, receipt: PilotImageIdentity | undefined): boolean {
  return Boolean(inspection?.previewLoaded && inspection.visiblePixels && Number.isSafeInteger(inspection.width) && Number.isSafeInteger(inspection.height) &&
    inspection.width > 0 && inspection.height > 0 && inspection.width * inspection.height <= 32_000_000 && receipt?.imageSha256 &&
    inspection.jobId === receipt.jobId && inspection.ariaImageId === receipt.ariaImageId && inspection.sha256 === receipt.imageSha256);
}

function matchingSignature(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

/** Hash the original, bounded file bytes; a manifest hash alone never authenticates the provider. */
export async function inspectPilotImageFile(file: PilotImageFile, receipt: PilotImageIdentity,
  decode: (file: PilotImageFile) => Promise<PilotImagePixels> = decodePilotImage): Promise<PilotImageInspection> {
  if (!allowedTypes.has(file.type) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PILOT_IMAGE_BYTES)
    throw new Error('Selecciona una imagen PNG, JPEG o WebP de hasta 20 MB.');
  if (!validPilotSha256(receipt.imageSha256)) throw new Error('El recibo no contiene una huella SHA-256 verificable; QA permanece pendiente.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) throw new Error('El archivo cambió durante la lectura.');
  const bytes = new Uint8Array(buffer);
  if (!matchingSignature(file.type, bytes)) throw new Error('El archivo no coincide con un formato de imagen admitido.');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== receipt.imageSha256) throw new Error('La huella del archivo no coincide con el resultado de Aria.');
  let pixels: PilotImagePixels;
  try { pixels = await decode(file); }
  catch { throw new Error('No se pudo decodificar la imagen.'); }
  if (!Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height) || pixels.width < 1 || pixels.height < 1 ||
      pixels.width * pixels.height > 32_000_000 || !pixels.visiblePixels) throw new Error('La imagen no contiene píxeles visualizables.');
  return { ...pixels, jobId: receipt.jobId, ariaImageId: receipt.ariaImageId, sha256: digest, previewLoaded: false };
}

/** Ignore success or failure from a previous file selection after a replacement or receipt change. */
export function createPilotImageSelection() {
  let current = 0;
  return {
    invalidate: () => { current++; },
    inspect: async (file: PilotImageFile, receipt: PilotImageIdentity,
      decode: (file: PilotImageFile) => Promise<PilotImagePixels> = decodePilotImage): Promise<PilotImageInspection | undefined> => {
      const selection = ++current;
      try {
        const inspected = await inspectPilotImageFile(file, receipt, decode);
        return selection === current ? inspected : undefined;
      } catch (cause) {
        if (selection !== current) return undefined;
        throw cause;
      }
    },
  };
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
