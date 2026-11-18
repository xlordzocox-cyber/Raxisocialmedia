// Especificidad fotográfica (Luis, 2026-11-18): "ser muy muy específico en todos los detalles".
// One checklist shared by the Recrear prompter, the campaign Creative Director and the Director's review.
// Pilot 2026-11-18 (A/B test, bridge scene): with no outfit written, Seedream copied the sheet's black underwear
// from the face reference. Nothing may be left for the image model to fill in. Pure, no imports.

/** [key, label, what must be written]. Keys are the prompter's JSON checklist fields. */
export const PHOTO_SPEC: readonly (readonly [string, string, string])[] = [
  ['vestuario', 'Vestuario', 'cada prenda visible con tipo, color, material y ajuste, y el calzado si se ve; nunca sin definir'],
  ['accesorios', 'Accesorios', 'joyas, bolso, gafas u objetos en las manos, o "ninguno"'],
  ['pelo_maquillaje', 'Pelo y maquillaje', 'cómo está el pelo (suelto, recogido, mojado, movido por el viento) y el maquillaje, sin cambiar su color ni sus rasgos'],
  ['pose', 'Pose', 'postura, reparto del peso, qué hace cada mano y hacia dónde mira'],
  ['expresion', 'Expresión', 'un gesto concreto (no solo "sexy" o "bonita")'],
  ['lugar', 'Lugar', 'sitio concreto, hora del día y elementos del fondo'],
  ['luz', 'Luz', 'fuente, dirección, dureza y color o temperatura'],
  ['camara', 'Cámara', 'quién toma la foto (selfie, espejo, otra persona o trípode), distancia, ángulo y altura, lente o focal aproximada y profundidad de campo'],
  ['encuadre', 'Encuadre', 'qué partes del cuerpo entran en cuadro y si es vertical u horizontal'],
];
export const PHOTO_SPEC_KEYS = PHOTO_SPEC.map(([k]) => k);

/** Spanish instruction for any agent that writes a photo prompt. */
export const PHOTO_SPEC_ES = 'Cada prompt de foto especifica, sin dejar nada a la imaginación del modelo de imagen: ' +
  PHOTO_SPEC.map(([, label, what]) => `${label.toLowerCase()} (${what})`).join('; ') +
  '. Si algo no se define, el modelo lo copia de la referencia o lo inventa.';

/** English guard added to every public generation prompt. */
export const PUBLIC_OUTFIT_GUARD = "Her outfit is only what this prompt describes: never the clothing of the reference image. " +
  'If no outfit is described, she is fully dressed in everyday clothes that fit the scene.';
