# P3A — Te toca: atención humana de solo lectura

Base comprobada: `d6830f7c47af4164baae0ef5715731770cea7030`, posterior a los merges #40/#41/#42. Rama aislada `feature/raxi-hq-human-attention`. PR39 no forma parte del incremento. Las diez eliminaciones JPEG del checkout original permanecen fuera del diff.

## Arquitectura y límites

`humanAttentionSelectors.ts` es una proyección pura de `RealCampaignState`/`CampaignSnapshot` y un contexto de presentación. No es otra autorización ni otro sistema de decisiones. AuthStore, RealIdeaStore y RealCampaignStore conservan identidad, sesión, admisión, recibos, versiones y conciliación. No hay nueva suscripción, store, API, RPC, tabla, adaptador, caché ni reloj de urgencia.

`RealIdeaCenter` pasa su estado ya suscrito a `RealCampaignCenter` y utiliza una key de propietario/workspace para retirar selecciones de otra cuenta. RealCampaignCenter conserva su suscripción previa y contiene el panel junto a OperationsInbox/CampaignWorkspace. Su estado local nuevo sirve exclusivamente al foco de navegación. La identidad del snapshot presentado y su versión se revalidan en el clic; un handler retenido de una lectura anterior no puede navegar asuntos nuevos.

La lista solo es vigente con fase ready, sin error, sin pending, sin sincronización requerida, ideas listas y compatibles con la lectura de campañas, sin escritura de idea pendiente y propietario/workspace coincidentes. En cualquier otro caso se oculta la lista y se muestra **No es posible confirmar los asuntos pendientes**. No se confunde un error con un cero confirmado. La fuente no desplegada sigue sin asuntos verificables ni acciones nuevas habilitadas.

Solo se admiten dos categorías:

- Handoffs REAL de ideas manuales enviadas al HQ, inequívocos y sin decisión ACCEPTED/REJECTED. Una campaña existente sin decisión coherente genera advertencia, no una propuesta pendiente inventada.
- La revisión actual IN_REVIEW de una campaña REAL PLANNING coherente con idea, handoff, decisión ACCEPTED y fecha de origen. Se reutiliza `currentStrategy`; revisiones duplicadas, con huecos o fuera de orden impiden escoger arbitrariamente una ganadora. No se usa máximo numérico para reparar datos. Dos decisiones que reclamen la misma campaña impiden seleccionarla.

El snapshot ya debe haber pasado el parser canónico del store. El selector no sustituye ni duplica las validaciones completas de admisión; añade comprobaciones de ambigüedad de relaciones que necesita la agregación. Las advertencias conservan referencias descriptivas; no corrigen datos. Las fechas son las declaradas, nunca inferencias de ejecución o vencimiento. Una Strategy aprobada no concede gasto, generación, QA ni publicación.

`HumanAttentionPanel` solo renderiza y llama a navegación. **Ver propuesta** abre la bandeja existente y enfoca su artículo, sin abrir evaluación. **Revisar estrategia** selecciona la campaña y enfoca su workspace existente con StrategyStudio. El usuario continúa decidiendo allí mediante los controles originales. No se prepara ni ejecuta APPROVE_STRATEGY desde el panel. Los únicos cambios en OperationsInbox y CampaignWorkspace son destinos accesibles de foco (data attribute/tabIndex).

No se consumen HQStore, eventos P2B, runtime, histórico Codex, TaskSnapshot.approvalRequired, QA_PASS, VISUAL_REVIEW_REQUIRED ni datos Aria. DEMO no se adapta a REAL ni sirve de fallback. No hay P3B en este incremento. Guardian, el observador histórico y la oficina P1/P2A/P2B permanecen intactos.

## Criterios EARS y verificación

| Condición | Resultado observable | Verificación |
| --- | --- | --- |
| Cuando hay lectura REAL confirmada sin asuntos | Mostrar vacío confirmado, sin invitaciones a decidir | Fixture empty y prueba de selector |
| Cuando un handoff REAL inequívoco no tiene decisión | Mostrar propuesta sin decisión registrada | Selector y montaje |
| Cuando hay decisión aceptada/rechazada o campaña contradictoria | No ofrecerla como propuesta sin decidir; advertir contradicciones | Pruebas negativas |
| Cuando la revisión actual es IN_REVIEW y campaña PLANNING coherente | Mostrar campaña, revisión y fecha | Fixture ready y selector |
| Cuando hay duplicados, revisiones obsoletas o relaciones contradictorias | No elegir una versión ganadora | Pruebas de duplicación/orden/decisión |
| Mientras hay carga, error, pending o invalidación | Ocultar asuntos previos; no afirmar cero | Tests montados y fixtures |
| Cuando cambia cuenta/workspace o llega una lectura de store retirado | No exponer asuntos de la sesión anterior | Tests montados de aislamiento y lectura tardía |
| Cuando se activa una navegación con teclado | Enfocar destino existente, sin abrir confirmación ni ejecutar comandos | Navegador y spies de repositorios |
| Si una escritura de idea queda incierta | Suspender la lista desde el estado existente del padre | Prueba con suscripción de ideas y fallo sintético |

## Validación reproducible

El usuario autorizó específicamente para P3A: **Sí, solo SQL local de la suite existente**. Las únicas operaciones SQL ejecutadas pertenecen a esa suite sintética PGlite. No se ejecutaron Docker, SQL alojado, migraciones, proveedores, workers ni despliegues. `npm ci --ignore-scripts` utilizó el lockfile existente, sin modificar dependencias.

Comandos desde `apps/raxi-hq`:

```text
npm test
node --test .validation/humanAttention.test.mjs
node --test .validation/humanAttention.test.mjs .validation/office.test.mjs .validation/officeUX.test.mjs .validation/taskBoard.test.mjs .validation/handoffTimeline.test.mjs .validation/executionObservation.test.mjs
node --test tests/stagingSafety.test.mjs
npm run typecheck
npm run build
npm audit --json
git diff --check
```

Los bundles focalizados son salidas del script existente test.mjs. No deben confundirse pruebas locales con identidad alojada o servicio operativo. Resultado final ejecutado: **767/767 pruebas de aplicación PASS**, incluyendo **43/43 nuevas P3A** y **261/261 focalizadas**; **1/1 staging guard offline PASS**, para **768 pruebas totales**, sin fallos/omitidas/canceladas. Typecheck, build, diff check, rutas protegidas y escaneo staged de secretos PASS. Auditoría: un advisory moderado preexistente de qs, cero high/critical. La ejecución previa de 766 pruebas no se reutiliza para acreditar el cambio posterior de ambigüedad de enlaces de decisión.

Fingerprints SHA-256 de registros locales ignorados en `.validation/`:

| Registro | SHA-256 |
| --- | --- |
| `p3a-full-final.log` | `53164e0eb38e9ec367d84e3cef159f915b4e295ea1c442466a201fd4251356de` |
| `p3a-focused-final.log` | `db49367cf91b3d2fea58f8243d59ed2fade997f6e53100e1a2751e68bd9be14f` |
| `p3a-office-final.log` | `79f328e0b6612ccccafc212f52cb694289b8890ace8066df889353f399201259` |
| `p3a-typecheck-final.log` | `236189c12f0a4a176be02a7e6dae4a48b84cf0bc7b101374891c5d1457577ede` |
| `p3a-build-final.log` | `83bda19a8c43b090d5d4522c3ed1f121cab41b1975f4e6f565ebca21ab3ae575` |
| `p3a-guard.log` | `ad12ca8b2565d7186828bfee8189d3c5f6d222da7108f328a7f72020ce299b13` |
| `p3a-audit.json` | `e5f34547f0af478c4918deed42013f3a55f67da8284ed208dd14059a99beb485` |

## QA de navegador: escenarios sintéticos

`tests/manual/humanAttention.html` usa los stores existentes con repositorios sintéticos. Las escrituras de prueba fallan localmente y nunca llegan a Supabase. Las fixtures completas reutilizan el reducer/contratos de campañas. Sus etiquetas REAL muestran el comportamiento del componente en ese modo; el encabezado identifica inequívocamente que no hay Auth ni persistencia alojada comprobada.

- Escritorio 1440×1000: dos categorías, origen/fechas, acciones compactas, paleta oscura/cian/lila.
- Móvil 390×844: viewport390/documento375, sin desbordamiento horizontal observado.
- Enter sobre Ver propuesta enfoca `data-human-proposal` del artículo, sin `.operations-evaluation`.
- Enter sobre Revisar estrategia enfoca `real-campaign-workspace`, sin iniciar confirmación humana.
- Empty muestra cero confirmado. Unavailable/loading/error/pending muestran desconocimiento explícito y ninguna lista vigente.
- No hay nuevas animaciones ni smooth scroll; el foco no requiere movimiento. No se certifican lectores de pantalla ni dispositivos físicos mediante este ensayo.

Capturas reales del navegador con datos sintéticos:

- [Escritorio](../output/reports/raxi-hq-human-attention/desktop-ready.jpg)
- [Servicio no desplegado](../output/reports/raxi-hq-human-attention/unavailable.jpg)
- [Móvil](../output/reports/raxi-hq-human-attention/mobile-ready.jpg)
- [Operación incierta en móvil](../output/reports/raxi-hq-human-attention/mobile-uncertain.jpg)

## Riesgos y reversión

El servicio de campañas puede seguir sin desplegar: código y fixtures no acreditan servicio operativo. No se consultó producción. La confianza se hereda de los stores existentes, no de props arbitrarias ni del panel. Los avisos de inconsistencias requieren revisión de datos en su flujo original; no se reparan ni se omiten silenciosamente.

Permanece el advisory moderado preexistente de `qs`, sin cambios de dependencias. No se aborda MemoryArchiveEffect ni otros riesgos ajenos a P3A. Un revert del incremento restaura la presentación anterior; no hay datos, SQL, infraestructura ni permisos que revertir. Mantener revisión humana antes de integración.
