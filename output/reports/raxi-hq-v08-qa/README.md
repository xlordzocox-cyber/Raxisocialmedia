# Raxi HQ v0.8 — QA visual del panel Aria

Inspección en Chrome headless mediante DevTools Protocol sobre una **sesión local de prueba aislada**. La campaña, la aprobación local, los fallos y los recibos de esta prueba son fixtures; no son una autorización de Luis ni una generación de Aria Studio. No se llamó a `generar_imagen` ni se consumieron créditos.

| Vista | Evidencia |
| --- | --- |
| Strategy no aprobada, bloqueo de producción a 390 px | `unapproved-390.png` |
| Strategy aprobada y formulario de preparación a 390 px | `approved-390.png` |
| Orden preparada y aviso de coste a 390 px | `order-390.png` |
| Orden autorizada solo dentro de la prueba, sin desbordamiento a 320 px | `authorized-320.png` |
| Recibo de prueba, QA pendiente y controles deshabilitados sin imagen a 320 px | `result-320.png` |
| Panel de resultado con un asset aprobado existente usado solo como fixture de visor a 1440 px | `qa-fixture-1440.png` |

La exportación se inspeccionó interceptando el clic del enlace en la sesión de prueba: el JSON contenía el mismo `jobId`, `executionApproval.status: APPROVED`, `strategy.status: APPROVED`, `model: gptimg` y `requestedCount: 1`. Chrome headless no guardó el archivo en disco; la descarga final debe verificarse manualmente en el navegador de Luis.

Se importaron manifiestos de prueba desde archivos locales: timeout con ID A; segundo fallo con ID B y otro sin ID, ambos rechazados sin borrar A; recibo con ID B rechazado; recibo con ID A aceptado y QA pendiente. Un asset público ya aprobado del repositorio se cargó en el visor para comprobar su disposición; **no** se hizo QA de una fotografía nueva de Aria. Con notas locales se probó `QA_FAIL`, sin decisión humana de aprobación. Se observó el mensaje de error cronológico al intentar una revisión anterior al recibo. La consola capturada tras habilitar DevTools no mostró errores ni warnings en la ventana observada; no representa una captura retrospectiva de toda la sesión.

Las medidas observadas de `document.documentElement.scrollWidth` coincidieron con `innerWidth` a 1440, 390 y 320 px después del ajuste CSS. Los archivos de test y capturas no contienen credenciales ni rutas personales. El flujo real con un recibo auténtico y la descarga del JSON siguen pendientes de QA manual de Luis antes de consumir créditos o aprobar una imagen.
