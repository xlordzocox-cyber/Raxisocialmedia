# PR #20 — P2: evidencia de revocación de sesión

Hallazgo: [discussion_r4380739549](https://github.com/xlordzocox-cyber/Raxisocialmedia/pull/20#discussion_r4380739549), sobre `e4f0a8a141b688aba9bfa962033d72772e613fae`. Correctivo del 26-10-2026 en la misma rama. No se ejecutó B2 alojado.

## Problema y corrección

La prueba anterior ignoraba el error devuelto por signOut y aceptaba cualquier excepción posterior de identify. Un fallo de logout junto con indisponibilidad de Auth podía contabilizarse como revocación. La regresión reproduce esa falsa aceptación del patrón anterior con dobles locales y verifica que el nuevo procedimiento la rechaza.

El runner utiliza ahora verifyHostedSessionRevocation, compartido con sus regresiones:

1. Admite la identidad con el adaptador existente, retiene el mismo token exclusivamente en memoria y comprueba por SQL que la sesión corresponde al usuario y existe antes del logout.
2. Exige signOut({scope:local}) sin excepción y con error:null. Un error detiene el ensayo, incluso si la sesión desapareció por otro motivo.
3. Consulta de nuevo auth.sessions por el session_id, utilizando la conexión SQL previamente autorizada por B2. La fila debe haber desaparecido y la propiedad del workspace debe mantenerse.
4. Exige getClaims y getUser correctos para el mismo JWT después del logout: mismo usuario/sesión/issuer/audiencia/rol y expiración original. Comprueba que el JWT siga sin caducar durante todo el intervalo de atribución, incluida la frontera exacta.
5. Ejecuta de nuevo el adaptador existente instrumentando solo el puerto RPC. El rechazo debe alcanzar exactamente una llamada a raxi_supervised_host_identity con el mismo binding y recibir data:null, SQLSTATE 42501 y el mensaje exacto de denegación de esa función. Un error de red, permisos, función ausente o rechazo anterior de Auth no cuenta.
6. Confirma una vez más por SQL ausencia de sesión y propietario estable antes de devolver indicadores de evidencia. No devuelve ni registra JWT, UUID personales, claves, leases o errores crudos.

No se modifica el verificador Auth del host, SQL, grants, políticas, journal, proveedores ni guards B2. Es una corrección de evidencia de aceptación, no una afirmación nueva de revocación alojada.

## Pruebas y resultados finales

Desde apps/raxi-hq, sobre el correctivo:

| Comando / inspección | Resultado |
| --- | --- |
| Pruebas enfocadas supabaseSupervised.test.ts | **33/33 PASS**, incluidas 23 nuevas del P2 |
| NODE_OPTIONS=--max-old-space-size=512 npm test -- --serial | **575/575 PASS**, 0 fallos/cancelaciones/omisiones; 218349 ms |
| npm run build | PASS |
| npm run typecheck | PASS |
| node --test tests/stagingSafety.test.mjs | **1/1 PASS**, sin conexión remota |
| Total suite completa + guard separado | **576/576 PASS**; no sumar otra vez las enfocadas |
| npm audit --json | **0 vulnerabilidades** |
| Diff y escaneo de secretos staged | PASS; sin credenciales ni temporales |

Las 23 regresiones nuevas cubren: una aceptación positiva con el adaptador real de código y SQL PGlite local; reproducción del falso positivo anterior; veinte fallos cerrados (logout devuelto/throw, sesión no eliminada, SQL antes/después, claims/usuario indisponibles antes o durante identify, RPC throw/red/permisos/ausente, aceptación indebida, expiración/usuario cambiados, sesión inicialmente ausente y propietario cambiado); y JWT en la frontera exacta de vencimiento.

Los dobles de SDK NO verifican firmas JWT auténticas ni disponibilidad alojada. Las demás regresiones de A/B1, P2 journal, aprobaciones, presupuestos, recuperación, Guardian documentado y oficina/histórico siguen en la suite existente. No se realizó una ejecución del servicio Codex Security: la auditoría es revisión manual de la atribución, casos adversariales, patrones de secretos y npm audit.

El detector general `node scripts/security-scan.mjs` conserva código 1 por el falso positivo ya clasificado del literal de campo SDK `access_token:"access_token"` en el bundle index-CwjaT4br.js. No se modifica el detector ni se oculta ese resultado. El bundle no cambió respecto a B1; ninguna credencial se añadió al frontend.

Logs locales ignorados en apps/raxi-hq/.validation:

| Log | SHA-256 |
| --- | --- |
| p2-revocation-tests.log | 9a49421df0ea2c0aa01e03a8a49fa8feab8a392b4fb4a4cfefa6ba2ab519cb6d |
| p2-revocation-build.log | a0dc3c4a71f96e9c78a283ae4f29e089111f9fb7fc2622c4aabf19396a5deab3 |
| p2-revocation-typecheck.log | bbe04f6e49318f343e677d30ecba84d350ae7a6da455c741dd6ac3032ba7eb72 |
| p2-revocation-guard.log | ea9636d111651d9cc8bc5607e0ceac97f9db58c5ac72cdfb37046e8f5011947b |
| p2-revocation-audit.json | de3ed797396926da2095388a1a7b5798ea3bfd58fef3098cf052238a431ff691 |

## Límites y estado

B2 conserva todos sus consentimientos, guard de proyecto y proveedores exclusivamente simulados. El helper exportado recibe puertos confiables para pruebas; no es una autorización ni crea conexiones al importar. Las lecturas SQL de esta entrega se ejecutaron solo en PGlite o dobles; ninguna lectura/escritura fue enviada a Supabase alojado o producción.

Si GoTrue rechaza legítimamente antes de la RPC, la prueba conservadora queda no acreditada y requiere investigación B2, sin etiquetarla automáticamente como caída ni aceptación. Las sondas no hacen atómicos logout, consulta y RPC; no prometen revocación instantánea ni cancelación de llamadas iniciadas.

No hubo SQL remoto, despliegues, nuevas credenciales, usuarios reales, servicios facturables, IA/Aria o merge. Guardian, observador histórico #18 y las diez eliminaciones locales de imágenes permanecen intactos. El correctivo se entrega para nueva revisión del HEAD; no se declara resuelto el hilo ni aceptado B2 por estos tests locales.
