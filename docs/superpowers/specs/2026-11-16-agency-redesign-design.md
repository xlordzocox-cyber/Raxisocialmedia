# Renovación visual de Raxi HQ (estilo agencia) — Diseño

> **Estado:** diseño APROBADO por Luis el 2026-11-16 (brainstorming Superpowers). Pendiente: confirmación visual con una maqueta de la portada Agencia antes de escribir el plan.
> **Origen:** sección 5 de `docs/RAXI_HQ_V11_CREATION_MODULE_SPEC.md`.
> **Siguiente paso:** `writing-plans` → `docs/superpowers/plans/` (plan separado del Módulo de Creación).

## 1. Decisiones tomadas en el brainstorming

| Tema | Decisión de Luis |
|---|---|
| Audiencia | Solo interna: la app privada tras el login. Sin página pública |
| Portada | Panel de agencia. La oficina animada pasa a "Estudio en vivo" |
| Estilo | Editorial de agencia: fotos protagonistas, tipografía de revista, cian solo como acento |

## 2. Estructura de la app

Hoy existe una sola ruta protegida (`/`, `AuthenticatedOffice`). Se añade navegación real:

| Sección | Contenido |
|---|---|
| Agencia (portada) | Lo que espera aprobación de Luis, producciones en curso, talento, gasto del mes contra el tope |
| Talento | Ficha profesional por modelo: look, marcas distintivas, versión de identidad, campañas |
| Producción | Series y sesiones; vista del Módulo de Creación (continuidad, costo, aprobación) |
| Equipo | Agentes como especialistas (Dirección, Creativa, Producción, QA, Copy, Distribución) y su actividad |
| Canales y resultados | Instagram y FanView con sus métricas |
| Estudio en vivo | La oficina/Campus PixiJS actual, sin cambios internos |

**Fuera de alcance:** reescribir la escena PixiJS; cambiar flujos de datos o de autorización; página pública.

## 3. Estilo: editorial de agencia

- Fotos grandes con recorte limpio y mucho aire.
- Títulos con una tipografía serif de revista; interfaz con una fuente web sans legible en cualquier plataforma. Reemplaza `'Segoe UI'` (también en los textos de la escena PixiJS solo si no exige reescribirla).
- Fondo navy oscuro; cian `#35e7ff` solo para acciones, estados activos y foco.
- Morado reservado a Ideas. Colores de estado (aprobado, pendiente, rechazado) definidos una sola vez.
- Las fuentes concretas se eligen en el plan, verificando licencia y carga (no inventar).

## 4. Sistema de diseño

- `design/tokens.css`: de 5 variables a un sistema completo (color semántico, tipografía, espaciado, radios, sombras, movimiento).
- Migrar a tokens los 215 hex únicos de `design/global.css` y `campus/campus.css`; corregir `var(--text)` (no definida, `global.css:56`).
- Componentes base: botón, tarjeta, panel, badge de estado, métrica, formulario.
- Accesibilidad: contraste AA, focos visibles, objetivos táctiles de 44 px (ya existentes).

## 5. Orden de trabajo

1. Tokens y fuentes, sin cambio de estructura.
2. Componentes base.
3. Navegación y portada Agencia.
4. Talento, Producción y Equipo.
5. Migración del resto de paneles.

Cada paso deja la app funcionando, con `npm test` y `npm run typecheck` en verde.

## 6. Pruebas

Pruebas de render de los componentes base y de las rutas nuevas (el repo ya usa `react-test-renderer`); una comprobación automática de que no quedan hex fuera de `tokens.css`; revisión visual de Luis por paso.

## 7. Fototeca y Multimedia (añadido por Luis, 2026-11-16)

**Hecho verificado:** la app actual vive en `feat/claude-team-office`, con tres rutas protegidas: `/` (oficina), `/fototeca` y `/multimedia` (`src/portfolio/`). El plan parte de esa rama, no de `main`.

**Regla:** mejorar su aspecto sin perder nada de lo que ya funciona. Solo cambia la presentación; los modelos de datos (`portfolioModel.ts`, `mediaModel.ts`), la RPC `raxi_portfolio_decide` y las pruebas existentes no se tocan y deben seguir en verde.

Lo que hoy funciona y se conserva tal cual:

- **Fototeca:** campañas con sus fotos y progreso; aprobar, corregir, descartar y volver a pendiente; "Rehacer esta foto"; paquete de publicación (texto para Instagram, hashtags, primer comentario, texto alternativo, audio sugerido) con botones de copiar; recorte 4:5 para el feed; "Marcar como publicada" con enlace de Instagram; recordatorio de la etiqueta «AI info»; "Armar video del Reel"; abrir el original.
- **Multimedia:** todas las fotos archivadas, las más nuevas primero; filtros por personaje y nivel de contenido; vínculo con campañas; detalle de la foto; solo lectura; lo no público marcado como solo para Fanvue.

Encaje en la estructura de agencia (sección 2):

| Hoy | En la versión agencia |
|---|---|
| `/fototeca` | Vive dentro de **Producción** como "Fototeca"; conserva su ruta |
| `/multimedia` | Vive dentro de **Producción** como "Archivo"; conserva su ruta |
| Navegación propia (Oficina / Fototeca / Multimedia) | Se reemplaza por la navegación común de la agencia |

Mejoras visuales: mismas fuentes, tokens y componentes base; cuadrícula editorial con fotos más grandes; estados de QA y decisión con el badge común; el paquete de publicación como panel lateral legible; sin desbordamiento horizontal en teléfono (ya corregido en el commit `18c5c53`, se mantiene).

Orden de trabajo actualizado: Fototeca y Multimedia se migran en el paso 4, junto con Producción.
