# Raxi HQ v0.9 — primera persistencia real

Actualización correctiva de PR #10: [reconciliación del comando pendiente](P2_PENDING_RECONCILIATION.md). Suite actual: **294/294 PASS**; las cifras siguientes conservan el contexto de la validación inicial.

Guardado inicial verificado el 19 de octubre de 2026 y recuperación/validación final el 20 de octubre de 2026 en `jrkefsylpfriiqefcmzq`. Rama: `feature/raxi-hq-v0.9-supabase-persistence`. Se conservaron los cambios locales de REAL/DEMO y la especificación existentes. El Auth anterior estaba en otra copia del workspace; se incorporó al checkout Git sin descartar esa copia.

## Resultado operativo

La idea **Primera idea real de Raxi HQ** se creó desde el formulario REAL usando la sesión existente de Luis. El workspace se creó mediante el botón explícito y la operación autenticada con RLS. El navegador no envió ni eligió un ID de propietario.

- ID PostgreSQL: `fc7fb46d-6c0a-42b8-9b1c-372d9ba40c13`.
- ID externo conservado: `IDEA-REAL-530fecaf-6e0e-44bd-9cad-62c372e41a1a`.
- Estado: `PROPOSED`. Procedencia: `MANUAL_LUIS`.
- Creada: 19 de octubre de 2026, 17:19:43, America/Mexico_City. La precisión completa de PostgreSQL está en `persisted-record.json`.
- Auditoría: `2`, acción `IDEA_MANUAL_CREATED`, origen `edge:create-real-idea`. Su actor coincide con el propietario del workspace.

El salto de secuencia anterior a la auditoría 2 corresponde a una prueba transaccional revertida. No es una segunda auditoría persistida.

## Pruebas de aceptación

**A — Persistencia:** guardado real desde la UI, confirmación canónica y consulta directa en PostgreSQL PASS. Recarga completa y recuperación del mismo ID, texto, fecha y auditoría PASS. Luis completó el nuevo login tras cerrar sesión y confirmó la recuperación. Después de los reinicios, la sesión autenticada y otra recarga recuperaron la misma idea desde Supabase. La comparación profunda del payload y auditoría contra la captura anterior pasó. No se recreó el workspace ni se añadió una segunda idea de producción durante la recuperación.

**B — Protección:** PASS contra el esquema remoto. La Edge Function sin JWT respondió HTTP 401 (`anonymous-edge.json`). Las pruebas PostgreSQL ejercitaron roles reales `anon`, `authenticated` y `service_role`, un sujeto JWT distinto del propietario, lectura RLS, RPC de lectura ajena, propiedad falsificada, escritura directa incluso por el propietario, ejecución del RPC restringida al servidor, conflictos de idempotencia, ID externo duplicado y estado de aprobación inyectado. Las filas de prueba se revirtieron. `protection.json` recoge el resultado.

Repetir el comando original de la idea persistida devolvió el mismo UUID; permanecen una idea y una auditoría (`idempotency.json`). La prueba de aislamiento usa otro sujeto JWT en PostgreSQL; no se creó una segunda cuenta Auth ni se afirmó haber iniciado sesión como ella.

**C — Integridad:** PASS. La consulta remota confirmó una idea REAL, una auditoría de creación, cero ideas con IDs ajenos a `IDEA-REAL-` y cero eventos de agentes. Las siete ideas de `mockIdeas.ts` no se importaron. La UI REAL muestra cero agentes y cero actividad cuando Munder está desconectado. Las pruebas de frontend verifican que una escritura fallida conserva campos, muestra error y no publica un éxito ni una idea optimista; las respuestas tardías de una sesión cerrada se ignoran.

## Validación local y secretos

- `npm run build` y TypeScript: PASS.
- `npm test`: 276/276 PASS tras el segundo reinicio, incluidos Auth, frontera Edge, adaptador, formulario fallido, refresco tras guardado, selección y persistencia de UI, además de la suite existente.
- La prueba intermitente de Aria espera la existencia real del preview tras WebCrypto/decodificación. Pasó la suite completa y cinco ejecuciones adicionales dirigidas. Los controles de aprobación de producción permanecen intactos.
- `git diff --check`: PASS.
- Instalación de dependencias: auditoría npm con cero vulnerabilidades reportadas. Supabase y router fijados a versiones exactas con lockfile.
- `.env.local` está ignorado por Git. Solo contiene configuración publicable. No hay `SUPABASE_SERVICE_ROLE_KEY` ni valores con forma de clave secreta en `src/` o el bundle de producción.
- El escáner local existente emitió un falso positivo en el bundle del SDK: el literal de nombre de campo `access_token: "access_token"`, no una credencial. Revisado por igualdad exacta del literal. No se alteró ni silenció el escáner.
- Advisors remotos: ninguna incidencia de tablas/RLS/funciones en este cambio; advertencia de configuración Auth por protección de contraseñas filtradas desactivada. No se cambió esa configuración ajena al flujo.

## Esquema y despliegue

Se recuperaron con CLI las tres migraciones existentes (`20261019030541`, `20261019030659`, `20261019030808`) sin reejecutarlas. `supabase/schema-baseline.json` registra 18 tablas con RLS, el bucket privado y hashes de los SQL exportados. La cuarta versión, `20261019231655`, contiene únicamente el nuevo flujo de ideas: dos índices únicos de auditoría y cuatro funciones `SECURITY INVOKER`.

El SQL nuevo se validó transaccionalmente mediante `db query`. Tras las pruebas y advisors se registró su versión una vez con `migration repair --status applied`; el listado local/remoto coincide en las cuatro versiones. No se realizó reset, merge, seeding ni otro baseline duplicado. La Edge Function `create-real-idea` está desplegada y validó una escritura real con JWT.

No se generaron imágenes, no se invocó Aria Studio, no se consumieron créditos de generación y no se publicó contenido. Campañas, fotografías, aprobaciones, agentes autónomos y Realtime no se integraron.

## Centro de Ideas compartido y revisión visual

REAL adapta los registros canónicos al `IdeaCenterPanel` original compartido con DEMO: métricas, tarjetas, detalle y formulario compacto integrado. El guardado conserva el servicio anterior, refresca la lista desde Supabase y selecciona el registro creado. Si el guardado ya fue aceptado pero falla el refresco, muestra la confirmación canónica y una advertencia de lectura diferenciada. Las pruebas verifican este caso y que una escritura fallida nunca muestra éxito.

La UI REAL conserva ID externo, texto, fecha, procedencia y auditoría. No muestra porcentajes inventados: usa **Pendiente de evaluación**. Revisar, aprobar, archivar y enviar permanecen deshabilitados. Los UUID técnicos están en un bloque plegado por defecto. La selección se conserva al cerrar/reabrir y recuerda solo el ID externo, bajo una clave de sesión separada por propietario/workspace.

Revisión en navegador autenticado: escritorio 1440 px, móvil 320 y 390 px, sin desbordamiento horizontal (anchos de documento 1425, 305 y 375 px respectivamente, con scrollbar). Se inspeccionaron formulario, detalle, fechas, evaluación pendiente y trazabilidad expandida. Cierre/reapertura conservó la selección. DEMO mostró siete tarjetas tras activación explícita; volver a REAL y recargar mostró únicamente la idea persistida. Las capturas son evidencia de UI, no fotografías generadas.

- [Escritorio](real-desktop-overview.png)
- [Formulario móvil](real-mobile-form-viewport.png)
- [Detalle móvil](real-mobile-detail.png)

El flujo de creación de una idea adicional y selección tras guardado se comprobó con el repositorio de pruebas; no se atribuye a una segunda escritura en producción. La escritura real inicial y su auditoría ya están verificadas arriba.

La arquitectura futura está en `docs/RAXI_HQ_REAL_AGENTS_ARCHITECTURE.md`: Director y ejecutores en servidor, autorización humana, eventos verificables, reconciliación y Munder complementario. Es documentación; no activa agentes ni Realtime.

## Alcance de la revisión de seguridad

Revisión manual de las fronteras cambiadas y pruebas automatizadas: validación Auth en servidor, aislamiento por propietario/RLS, RPC de escritura reservado al servidor, validación de comandos, transacción idea/auditoría, idempotencia, errores sin credenciales y ausencia de claves privilegiadas en frontend/bundle. Las pruebas remotas de protección se repitieron el 20 de octubre con PASS y rollback de todas las filas de prueba. No se realizó un escaneo exhaustivo de todo el repositorio.

El checkpoint de recuperación es `0b11335`; conserva los cambios antes de la revisión visual. v0.8 sigue fuera de main, por lo que el PR separado de v0.9 usa su rama como base para mostrar únicamente este incremento. No se hizo merge ni rebase.
