# Raxi HQ v0.9 — primera persistencia real

Verificado el 19 de octubre de 2026 en `jrkefsylpfriiqefcmzq`. Rama: `feature/raxi-hq-v0.9-supabase-persistence`. Se conservaron los cambios locales de REAL/DEMO y la especificación existentes. El Auth anterior estaba en otra copia del workspace; se incorporó al checkout Git sin descartar esa copia.

## Resultado operativo

La idea **Primera idea real de Raxi HQ** se creó desde el formulario REAL usando la sesión existente de Luis. El workspace se creó mediante el botón explícito y la operación autenticada con RLS. El navegador no envió ni eligió un ID de propietario.

- ID PostgreSQL: `fc7fb46d-6c0a-42b8-9b1c-372d9ba40c13`.
- ID externo conservado: `IDEA-REAL-530fecaf-6e0e-44bd-9cad-62c372e41a1a`.
- Estado: `PROPOSED`. Procedencia: `MANUAL_LUIS`.
- Creada: 19 de octubre de 2026, 17:19:43, America/Mexico_City. La precisión completa de PostgreSQL está en `persisted-record.json`.
- Auditoría: `2`, acción `IDEA_MANUAL_CREATED`, origen `edge:create-real-idea`. Su actor coincide con el propietario del workspace.

El salto de secuencia anterior a la auditoría 2 corresponde a una prueba transaccional revertida. No es una segunda auditoría persistida.

## Pruebas de aceptación

**A — Persistencia:** guardado real desde la UI, confirmación canónica y consulta directa en PostgreSQL PASS. Recarga completa y recuperación del mismo ID, texto, fecha y auditoría PASS. Cierre de sesión ejecutado; recuperación tras el nuevo login pendiente de completar por Luis en el formulario.

**B — Protección:** PASS contra el esquema remoto. La Edge Function sin JWT respondió HTTP 401 (`anonymous-edge.json`). Las pruebas PostgreSQL ejercitaron roles reales `anon`, `authenticated` y `service_role`, un sujeto JWT distinto del propietario, lectura RLS, RPC de lectura ajena, propiedad falsificada, escritura directa incluso por el propietario, ejecución del RPC restringida al servidor, conflictos de idempotencia, ID externo duplicado y estado de aprobación inyectado. Las filas de prueba se revirtieron. `protection.json` recoge el resultado.

Repetir el comando original de la idea persistida devolvió el mismo UUID; permanecen una idea y una auditoría (`idempotency.json`). La prueba de aislamiento usa otro sujeto JWT en PostgreSQL; no se creó una segunda cuenta Auth ni se afirmó haber iniciado sesión como ella.

**C — Integridad:** PASS. La consulta remota confirmó una idea REAL, una auditoría de creación, cero ideas con IDs ajenos a `IDEA-REAL-` y cero eventos de agentes. Las siete ideas de `mockIdeas.ts` no se importaron. La UI REAL muestra cero agentes y cero actividad cuando Munder está desconectado. Las pruebas de frontend verifican que una escritura fallida conserva campos, muestra error y no publica un éxito ni una idea optimista; las respuestas tardías de una sesión cerrada se ignoran.

## Validación local y secretos

- `npm run build` y TypeScript: PASS.
- `npm test`: 272/272 PASS, incluidos Auth, frontera Edge, adaptador y persistencia de UI, además de la suite existente.
- `git diff --check`: PASS.
- Instalación de dependencias: auditoría npm con cero vulnerabilidades reportadas. Supabase y router fijados a versiones exactas con lockfile.
- `.env.local` está ignorado por Git. Solo contiene configuración publicable. No hay `SUPABASE_SERVICE_ROLE_KEY` ni valores con forma de clave secreta en `src/` o el bundle de producción.
- El escáner local existente emitió un falso positivo en el bundle del SDK: el literal de nombre de campo `access_token: "access_token"`, no una credencial. Revisado por igualdad exacta del literal. No se alteró ni silenció el escáner.
- Advisors remotos: ninguna incidencia de tablas/RLS/funciones en este cambio; advertencia de configuración Auth por protección de contraseñas filtradas desactivada. No se cambió esa configuración ajena al flujo.

## Esquema y despliegue

Se recuperaron con CLI las tres migraciones existentes (`20261019030541`, `20261019030659`, `20261019030808`) sin reejecutarlas. `supabase/schema-baseline.json` registra 18 tablas con RLS, el bucket privado y hashes de los SQL exportados. La cuarta versión, `20261019231655`, contiene únicamente el nuevo flujo de ideas: dos índices únicos de auditoría y cuatro funciones `SECURITY INVOKER`.

El SQL nuevo se validó transaccionalmente mediante `db query`. Tras las pruebas y advisors se registró su versión una vez con `migration repair --status applied`; el listado local/remoto coincide en las cuatro versiones. No se realizó reset, merge, seeding ni otro baseline duplicado. La Edge Function `create-real-idea` está desplegada y validó una escritura real con JWT.

No se generaron imágenes, no se invocó Aria Studio, no se consumieron créditos de generación y no se publicó contenido. Campañas, fotografías, aprobaciones, agentes autónomos y Realtime no se integraron.
