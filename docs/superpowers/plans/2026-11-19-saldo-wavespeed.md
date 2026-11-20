# Saldo de WaveSpeed visible en Raxi HQ — Plan de implementación

> **Para quien ejecute esto (Claude Code):** usa `superpowers:subagent-driven-development` (o `executing-plans`), en orden y con TDD: prueba en rojo, código, verde. Respeta `AGENTS.md`.
> **Estado:** PLAN PROPUESTO (2026-11-19), pedido por Luis. Requiere su visto bueno antes de ejecutarse y su autorización para desplegar en staging. Producción no se toca.

## Objetivo

Que Luis vea **arriba, en todas las páginas de Raxi HQ**, una barra fija con:

1. **Saldo real de WaveSpeed**, en dólares, consultado a la API de WaveSpeed.
2. **Gasto del mes en Raxi HQ** frente al tope de $10.
3. **Fotos que quedan aproximadamente**. Se calcula con el menor de dos topes (el saldo y lo que queda del tope del mes) dividido entre el costo de una foto típica de Recrear: $0.036 con 2 entradas.

Ejemplo de la barra: «WaveSpeed: $7.42 · Este mes: $1.36 de $10 · ≈ 206 fotos».

## Hechos verificados (2026-11-19)

- WaveSpeed documenta un endpoint de saldo que devuelve `data.balance` en USD.
  - [Balance API](https://wavespeed.ai/docs/docs-common-api/balance): `GET https://api.wavespeed.ai/api/v3/balance`, con `Authorization: Bearer <clave>`.
  - Otra página, [Check balance](https://wavespeed.ai/docs/check-balance), muestra la ruta `GET /api/v3/account/balance`.
  - **Las dos páginas no coinciden.** Hay que probar las dos rutas y quedarse con la que responda 200; anotar el resultado aquí.
- WaveSpeed documenta también un historial de cobros: `GET /api/v3/account/billings`, filtrable con `?type=topup`. Fuera de alcance por ahora.
- Raxi HQ ya tiene:
  - el gasto del mes (RPC `raxi_sheet_month_spend`);
  - la clave de WaveSpeed guardada en Conexiones (RPC `raxi_connection_secret`), que solo se lee en el servidor.

## Reglas
- **La clave nunca sale del servidor.** El saldo se pide desde una Edge Function y el navegador solo recibe el número.
- Sin clave conectada, la barra dice «Conecta WaveSpeed en Conexiones» y no da error.
- Si WaveSpeed falla, la barra muestra «Saldo no disponible» y la hora del último dato bueno. Nunca muestra un número inventado.
- Se guarda en caché unos 5 minutos para no consultar la API en cada página. Hay un botón para actualizar.
- Cuando el saldo baja de $2, o el gasto pasa de $8 de $10, la barra cambia a color de aviso.

## Tareas

### Tarea 1 — Acción `WAVESPEED_BALANCE` en el servidor (TDD)
- [ ] Probar en la función `provider-connection` o en `sheet-creator`. Elegir la que ya lee la clave de Conexiones y justificarlo aquí.
- [ ] Pruebas, con WaveSpeed simulado:
  1. Devuelve `{ balanceUsd, monthSpendUsd, capUsd: 10, photosLeft, fetchedAt }`.
  2. Sin clave conectada responde `{ connected: false }`.
  3. Si WaveSpeed devuelve un error o un timeout, responde `{ available: false }` sin propagar el mensaje crudo.
  4. Ninguna respuesta ni ningún registro contiene la clave.
  5. `photosLeft` se calcula con el menor de los dos topes y se redondea hacia abajo.
- [ ] Implementar; las pruebas pasan a verde. Commit.

### Tarea 2 — Barra de saldo en la interfaz (piloto de Astryx)

**Decisión de Luis (2026-11-19): esta barra es la pantalla piloto de Astryx**, el sistema de diseño de Meta (React, licencia MIT, beta pública desde el 28-jun-2026, con CLI y servidor MCP). Si el piloto sale bien, se migran las demás pantallas poco a poco, en una rama aparte. **El MCP no se retrasa por esto.**

- [ ] Antes de instalar:
  - comprobar en el repositorio oficial (`meta/astryx`) la versión actual y que sea compatible con React 19, Vite 7 y el `tsconfig` de `apps/raxi-hq`;
  - fijar la versión exacta en `package.json` (sin `^`), porque está en beta;
  - anotar aquí lo comprobado.
- [ ] Ejecutar `astryx init --agent claude` y **mostrarle a Luis el bloque que escribe** en CLAUDE.md antes de hacer commit. No debe contradecir `AGENTS.md`.
- [ ] Conectar su servidor MCP en Claude Code para consultar los componentes reales y no inventar propiedades.
- [ ] Crear un tema propio con `defineTheme`, con la paleta del rediseño «editorial de agencia». Sin colores por defecto de Meta.
- [ ] Pasar `astryx doctor` sin errores.
- [ ] Si algo no es compatible, **parar**: hacer la barra con los estilos actuales y anotar el motivo aquí.
- [ ] Componente `CreditsBar` en el encabezado común de Raxi HQ, visible en todas las páginas tras iniciar sesión.
- [ ] Estados a probar con `react-test-renderer`: cargando, normal, aviso, sin conexión y no disponible.
- [ ] Estilo coherente con el rediseño «editorial de agencia». En el móvil se lee en una línea, o se abre con un toque.
- [ ] `npm run typecheck` y `node scripts/test.mjs` en verde. Commit.

### Tarea 3 — Despliegue en staging (autorización de Luis)
- [ ] Desplegar la función con **todos** sus archivos y verificarla contra el repo con `get_edge_function`.
- [ ] Comprobar en el preview de Vercel que el saldo coincide con el panel de WaveSpeed de Luis.
- [ ] Commit y push.

## Fuera de alcance (ideas para después, sin decidir)
- **Historial de recargas y gastos de WaveSpeed** (`/account/billings`).
- **Módulo de video en Raxi HQ con WaveSpeed**, para dejar de depender de Magnific. Requiere su propio diseño: modelo, costo por segundo y tope mensual, porque un video de Seedance 2.5 consume buena parte de los $10.
