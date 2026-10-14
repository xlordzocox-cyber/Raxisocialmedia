# QA Capabilities

## Visual QA

Visual QA requiere acceso real a la imagen. No marques una imagen o campaña como `APPROVED` visualmente si no has visto el asset.

Si el entorno no permite inspección visual, usa:

- `VISUAL_REVIEW_REQUIRED`

Visual QA revisa:

- consistencia de rostro e identidad;
- anatomía, manos y reflejos;
- vestuario, iluminación y escenario;
- texto extraño u objetos imposibles;
- realismo y coherencia de microhistoria;
- ajuste entre imagen, plataforma y nivel de contenido.

## Editorial and Strategic QA

Editorial/Strategic QA puede revisar sin inspección visual completa:

- copy;
- hooks;
- caption;
- CTA;
- funnel;
- calendario;
- plataforma;
- tono de Raxi;
- lógica de campaña;
- riesgos de distribución.

## Final Approval Rule

Una campaña solo puede quedar en `APPROVED` final cuando:

- Visual QA = `PASS`;
- Editorial QA = `PASS`.

Si solo pasa la revisión editorial o estratégica, el estado final debe ser `VISUAL_REVIEW_REQUIRED`.
