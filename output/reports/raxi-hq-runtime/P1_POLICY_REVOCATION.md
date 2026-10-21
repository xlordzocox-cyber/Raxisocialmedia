# PR #13 — P1: política vigente y autorización de ejecución

Base revisada: `d5231dde56408034cc65c420b66ba8976a2202ca`. Corrección local de propuesta SQL y coordinador; no aplicada ni desplegada en ningún entorno alojado.

## Cambios

- Claim compara explícitamente `simulated` del snapshot autorizado contra el valor vigente con `IS DISTINCT FROM`: ambos cambios de sentido rechazan la tarea antes de crear un run o contactar al proveedor.
- Un control común exige política existente/habilitada/no vencida, proveedor/modelo originales, confirmación humana vigente, coste autorizado y configuración económica exacta. Incluye tokens, reserva por llamada, presupuesto total, límite de tareas y vencimiento.
- `authorization_version` aumenta ante cualquier cambio de configuración. Restaurar valores antiguos o intentar escribir una versión anterior no restaura una autorización revocada. Los incrementos normales de contadores no invalidan otros trabajos autorizados. Reservas y número de tareas son acumulativos: no pueden reducirse para eludir límites.
- Tras recuperar fuentes y verificar lease, `runOne` pide un despacho persistente antes de entrar al adaptador. El despacho repite el control de política y versión, se vincula al run/token y no se admite dos veces. No crea RUNNING ni acredita que un proveedor haya respondido.
- ACK/finish siguen conservando recibos/costes de una llamada ya iniciada aunque se revoque después. Los rechazos de claim mantienen tarea, aprobación, reserva y requestKey; los rechazos posteriores conservan el run para reconciliar, sin reintento automático ni liberación de reserva.

## Semántica de revocación y límite distribuido

El último despacho es el punto de admisión transaccional: comparte el lock de la política durante el control. Una revocación confirmada antes de ese control rechaza el despacho. No se mantienen transacciones abiertas durante IA. Una revocación que coincida después de admitir el despacho no garantiza cancelar esa llamada; PostgreSQL y el HTTP del proveedor no son atómicos. Hay una ventana de transporte entre la admisión y la entrada al adaptador: no se afirma una garantía de cancelación física instantánea. No se habilita ejecución real ni se oculta este límite para autorizarla.

## Regresiones locales

Resultado: **339/339 PASS**, build y typecheck frontend/servidor PASS, npm audit cero vulnerabilidades. Son 332 pruebas anteriores y siete nuevas, incluidas dos matrices con diez cambios de política cada una.

Las matrices parten de tareas REAL y simuladas autorizadas y alteran: simulación, enabled, vencimiento, proveedor, modelo, coste por llamada en ambos sentidos, tokens, presupuesto total y máximo de tareas. Cada caso comprueba explícitamente **CERO llamadas al proveedor**, ningún run creado, reserva intacta y recuperación idempotente del mismo requestKey. El proveedor de prueba es un contador local, nunca una API de IA.

También se prueba restauración de una política revocada y prohibición de rebajar contadores; revocación/cambio de simulación entre claim y despacho en ambos sentidos; deshabilitación durante recuperación de fuentes con **CERO llamadas adicionales**, conservando el recibo del Director; y revocación después de entrar al adaptador, conservando su recibo/coste y rechazando la siguiente etapa. Las pruebas existentes conservan recorrido válido, lease insuficiente sin llamadas, sobrecoste con política deshabilitada/coste persistido, idempotencia, incertidumbre, fuentes/hash y aislamiento de cuentas.

La SQL se verifica únicamente en bases PGlite aisladas. No acredita contención entre conexiones físicas ni ejecución IA auténtica. Esas pruebas requieren el entorno de ensayo autorizado.

## Independencia de staging

PR #12 sigue en `76073c1`; la consulta remota muestra revisión Codex Running, sin reviews ni hallazgos publicados. No se incorporan cambios de staging ni su dependencia pg. Se alinea únicamente el comentario del verificador LF/CRLF para que su archivo quede idéntico al del PR #12; la normalización funcional ya existía en ambos. No hay dos mecanismos de normalización ni dependencia de integración entre ambos PR.

Sin merge, SQL desplegado, trabajadores activados, infraestructura nueva ni llamadas IA/Aria. No se modificaron datos reales.
