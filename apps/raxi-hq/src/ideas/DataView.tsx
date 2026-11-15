import type { ReactNode } from 'react';

const LABELS: Record<string, string> = {
  viable: 'Viable', objetivo_trabajo: 'Objetivo del trabajo', preguntas_investigacion: 'Preguntas para investigar', criterios_exito: 'Criterios de éxito',
  riesgos: 'Riesgos', modelos: 'Modelos digitales comparables', nombre: 'Nombre', plataforma: 'Plataforma', por_que: 'Por qué', patrones: 'Patrones',
  fuentes: 'Fuentes', patrones_adaptables: 'Patrones adaptables', no_copiar: 'Qué NO copiar', hipotesis: 'Hipótesis', limitaciones: 'Limitaciones',
  decision: 'Decisión', evaluacion_investigacion: 'Evaluación de la investigación', preguntas_extra: 'Preguntas extra', estrategia: 'Estrategia',
  objetivo: 'Objetivo', audiencia: 'Audiencia', plataformas: 'Plataformas', rol: 'Rol', funnel: 'Funnel', mensajes_clave: 'Mensajes clave',
  formatos: 'Formatos', duracion: 'Duración', metrica_principal: 'Métrica principal', metricas_secundarias: 'Métricas secundarias',
  riesgo: 'Riesgo', mitigacion: 'Mitigación', concepto: 'Concepto', microhistoria: 'Microhistoria', publicaciones: 'Publicaciones',
  posicion: 'Posición', escena: 'Escena', plano: 'Plano', prompt: 'Prompt', texto: 'Texto', alt: 'Texto alternativo',
  coleccion_existente: 'Colección usada', montaje: 'Montaje', segundos: 'Segundos', texto_pantalla: 'Texto en pantalla',
  modelo_aria: 'Modelo de Aria', costo_estimado_usd: 'Costo estimado (USD)', checklist_qa: 'Checklist de QA', veredicto: 'Veredicto',
  revision: 'Revisión', punto: 'Punto', estado: 'Estado', nota: 'Nota', cambios_requeridos: 'Cambios pedidos', correcciones: 'Correcciones',
  campana: 'Campaña', cta: 'CTA', calendario: 'Calendario', dia: 'Día', publicacion: 'Publicación', hashtags: 'Hashtags', paquete: 'Paquete final',
};
const label = (k: string) => LABELS[k] ?? k.replace(/_/g, ' ');

/** Readable, safe rendering of an agent's JSON result. Only https links are clickable; nothing is executed. */
export function DataView({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (depth > 6 || value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return /^https:\/\/\S+$/.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <>{value}</>;
  if (typeof value === 'number' || typeof value === 'boolean') return <>{typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value)}</>;
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).filter((v) => v !== null && v !== '');
    if (!items.length) return null;
    return <ul className="data-list">{items.map((v, i) => <li key={i}><DataView value={v} depth={depth + 1} /></li>)}</ul>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)).slice(0, 40);
    if (!entries.length) return null;
    return <dl className="data-view">{entries.map(([k, v]) => <div key={k}><dt>{label(k)}</dt><dd><DataView value={v} depth={depth + 1} /></dd></div>)}</dl>;
  }
  return null;
}
