# Raxi HQ v1.0 — validación del primer incremento

## Alcance y estado

Campañas y Strategy persistentes, con aprobación de ideas y handoff, planificación, revisiones y aprobación humana ligada a una versión. Se reutiliza la interfaz editorial existente. Código para revisión; **quinta migración y Edge Function NO desplegadas en producción**. Fototeca y ejecutores de agentes son planes separados, sin ejecución ni consumo Aria.

Base verificada: `01b7783410ec5e73e813e7c191274bcdddcdf831`. Rama: `feature/raxi-hq-v1.0-campaign-strategy-persistence`. Se preservaron los cambios locales y se creó un checkpoint antes del cierre documental. Las cuatro migraciones anteriores no se modificaron.

## Comprobaciones reproducibles

Desde `apps/raxi-hq`:

```powershell
npm ci
npm run build
npm run typecheck
npm test
npm audit --audit-level=low
```

En main: instalación reproducible, build, typecheck y **304/304 PASS**. La instalación inicial encontró archivos Rollup/esbuild bloqueados por Vite; se detuvieron únicamente los procesos verificados de este checkout y la repetición terminó correctamente. El nuevo paquete de pruebas fija `@electric-sql/pglite` a `0.5.10` en el lockfile.

En el incremento: **314/314 PASS**, build y typecheck correctos. Build y tests comprueban que el dominio compartido generado para Edge coincide exactamente con los contratos TypeScript. Los tests no cargan configuración Supabase real (`import.meta.env` aislado).

## PostgreSQL local sin Docker Desktop

Docker Desktop no estaba disponible y su arranque fue bloqueado por la revisión automática de herramientas. Se utilizó PGlite, PostgreSQL en proceso y memoria, con una base nueva por prueba, sin conexiones ni escrituras de producción.

`tests/campaignDatabase.ts` crea roles `anon`, `authenticated` y `service_role`, usuarios de fixture y funciones Auth basadas en GUC de sesión; prepara el mínimo Storage requerido por el esquema histórico. Aplica en orden los cinco archivos SQL reales del repositorio. `tests/realCampaignPersistence.test.tsx` conecta el handler Edge y el dominio generado a las RPC ejecutadas en esa base. Los datos, identidades y verificadores JWT son fixtures locales.

Se comprueban autorización del propietario, rechazo de actor falsificado, lectura con RLS, prohibición de escritura directa, replay exacto, conflicto por clave reutilizada, transiciones, auditoría, relación campaña/idea, aprobaciones con actor real y snapshot de revisión, conservación de la primera revisión al crear la segunda y triggers de inmutabilidad. Una cantidad inválida provoca un fallo a mitad de commit: versión y revisiones quedan intactas por rollback.

Límite: una conexión embebida no demuestra contención entre conexiones físicas independientes. Los verificadores locales no prueban criptografía Auth ni el alojamiento Edge. Esas pruebas y la aceptación remota requieren un despliegue de ensayo autorizado antes de producción.

## Componentes montados y recuperación

Las regresiones montan el panel y los formularios originales con React, además de probar el propietario de stores en AuthStore. Cubren formulario conservado ante fallo, confirmación exclusivamente canónica, petición activa, desmontaje/remontaje, respuesta HTTP perdida, recibo ausente o incompatible, reintento con identificadores originales, conflicto de versión, cambio de usuario, cierre de sesión y respuesta tardía ignorada. Los tests previos de App/REAL/DEMO y Strict Mode permanecen en la suite completa.

No hay guardado optimista ni fallback de REAL a fixtures. Sin RPC desplegada, la aplicación presenta el despliegue pendiente y mantiene deshabilitadas las nuevas acciones. Las métricas sin lectura canónica indican “Sin lectura confirmada”. La aprobación de Strategy no autoriza generación ni publicación.

## QA visual

Se inspeccionó la aplicación autenticada: la primera idea REAL, sus tarjetas, métricas y detalle siguen presentes, con el aviso de servicio pendiente y acciones nuevas deshabilitadas. DEMO conserva su activación explícita y sus siete ideas aisladas.

Para los estados nuevos aún no desplegados se renderizaron los componentes originales con fixtures locales y un aviso visible de QA. Se inspeccionaron escritorio y móvil (1440, 390 y 320 px), sin desbordamiento horizontal. Estas capturas acreditan diseño, no escrituras remotas:

- [Campaign Workspace — escritorio](campaign-qa-desktop.png)
- [Strategy Studio — escritorio](strategy-qa-desktop.png)
- [Strategy Studio — móvil](strategy-qa-mobile.png)
- [Campus REAL autenticado — comprobación final](real-campus-final.png)

## Seguridad y producción

Se revisaron las fronteras de confianza del diff: JWT validado en servidor, propietario derivado de Auth, RPC de commit reservada al servidor, RLS existente, validación estricta de comandos y límites de tamaño, sin proyecciones ni actor aceptados del navegador. Se revisaron archivos candidatos a commit para excluir credenciales, claves privadas, rutas de entorno privado y temporales. El escáner de la aplicación detecta un literal conocido del SDK (`access_token:"access_token"`), verificado como nombre de campo, sin valor de credencial. La auditoría de dependencias no detectó vulnerabilidades. Esto no equivale a una auditoría externa exhaustiva.

Las verificaciones remotas fueron únicamente de lectura: se conserva una idea REAL, su auditoría y las cuatro migraciones aplicadas. No se desplegaron funciones, no se aplicó el quinto SQL ni se crearon campañas de prueba en producción. La primera idea y el registro de auditoría de su creación se compararon con la evidencia previa, sin diferencias; el panel autenticado sigue mostrando la auditoría 2.

## Pendiente de autorización

Revisar la [propuesta y recuperación](../../../docs/RAXI_HQ_V10_CAMPAIGN_PERSISTENCE.md), ensayar Auth/Edge y concurrencia real, autorizar expresamente la quinta migración y el despliegue, y ejecutar aceptación remota con una idea nueva. Fototeca y motor de agentes se entregarán en PR separados. No se hizo merge.
