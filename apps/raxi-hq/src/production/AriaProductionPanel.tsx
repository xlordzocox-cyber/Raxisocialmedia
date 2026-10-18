import { useEffect, useRef, useState } from 'react';
import type { CampaignRecord } from '../campaigns/campaignContracts';
import type { CampaignStrategyRevision } from '../campaigns/strategyContracts';
import { authorizeAriaPilot, createSerialAriaImports, isAriaPilotOrderCurrent, prepareAriaPilot, recordAriaPilotReview, validateAriaPilotFailure, validateAriaPilotReceipt, type AriaPilotFailure, type AriaPilotOrder, type AriaPilotReceipt, type AriaPilotReview } from './ariaPilot';
import { createPilotImageSelection, inspectionMatchesReceipt, type PilotImageInspection } from './pilotImage';

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AriaProductionPanel({ campaign, strategy, order, receipt, failure, review, onOrder, onReceipt, onFailure, onReview }: {
  campaign: CampaignRecord; strategy?: CampaignStrategyRevision; order?: AriaPilotOrder; receipt?: AriaPilotReceipt; failure?: AriaPilotFailure; review?: AriaPilotReview;
  onOrder: (value: AriaPilotOrder) => void; onReceipt: (value: AriaPilotReceipt) => void; onFailure?: (value: AriaPilotFailure) => void; onReview?: (value: AriaPilotReview | undefined) => void;
}) {
  const rows = strategy?.status === 'APPROVED' ? strategy.deliverables.filter(item => item.format === 'PHOTO' && item.channel === 'INSTAGRAM_FEED' && item.contentLevel === 'PUBLIC_SOCIAL') : [];
  const currentOrder = order ? isAriaPilotOrderCurrent(order, campaign, strategy) : false;
  const [rowId, setRowId] = useState('');
  const [scene, setScene] = useState('');
  const [sources, setSources] = useState('');
  const [confirmCost, setConfirmCost] = useState(false);
  const [message, setMessage] = useState<string>();
  const [imageFile, setImageFile] = useState<string>();
  const [imageReady, setImageReady] = useState(false);
  const [imageInspection, setImageInspection] = useState<PilotImageInspection>();
  const [imageError, setImageError] = useState<string>();
  const [qaNotes, setQaNotes] = useState('');
  const imageSelectionRef = useRef(createPilotImageSelection());
  const activeImageUrlRef = useRef<string | undefined>(undefined);
  const pendingImageRef = useRef<PilotImageInspection | undefined>(undefined);
  const verifiedImageRef = useRef<PilotImageInspection | undefined>(undefined);
  const receiptKey = receipt ? `${receipt.jobId}|${receipt.ariaImageId}|${receipt.imageSha256 ?? ''}` : '';
  const receiptKeyRef = useRef(receiptKey);
  receiptKeyRef.current = receiptKey;
  const imageVerified = imageReady && inspectionMatchesReceipt(imageInspection, receipt);
  const importQueueRef = useRef(createSerialAriaImports());
  useEffect(() => { return () => { if (imageFile) URL.revokeObjectURL(imageFile); }; }, [imageFile]);
  const act = (fn: () => void) => { try { fn(); setMessage(undefined); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Operación inválida.'); } };
  const prepare = () => act(() => {
    if (order) throw new Error('Ya existe una orden para este piloto; no crear duplicados.');
    const item = rows.find(value => value.id === rowId) ?? rows[0];
    if (!item) throw new Error('Se requiere Strategy aprobada con PHOTO para Instagram público.');
    onOrder(prepareAriaPilot(campaign, strategy, item.id, scene, sources ? sources.split(',').map(value => value.trim()) : [], new Date().toISOString()));
  });
  const authorize = () => act(() => {
    if (!order || !currentOrder || !confirmCost) throw new Error('Confirma una orden vigente, su ejecución real y su coste.');
    onOrder(authorizeAriaPilot(order, new Date().toISOString()));
    setConfirmCost(false);
  });
  const importReceipt = (file?: File) => {
    if (!file) return;
    void importQueueRef.current(async () => {
      try {
        if (!order || !currentOrder) throw new Error('Falta una orden vigente.');
        if (file.size > 16_384) throw new Error('Manifiesto de resultado demasiado grande.');
        const parsed: unknown = JSON.parse(await file.text());
        if (parsed !== null && typeof parsed === 'object' && 'state' in parsed && (parsed.state === 'FAILED' || parsed.state === 'TIMED_OUT')) {
          onFailure?.(validateAriaPilotFailure(parsed, order));
        } else onReceipt(validateAriaPilotReceipt(parsed, order));
        setMessage(undefined);
      } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Resultado inválido.'); }
    });
  };
  const resetImageInspection = () => {
    imageSelectionRef.current.invalidate();
    activeImageUrlRef.current = undefined;
    pendingImageRef.current = undefined;
    verifiedImageRef.current = undefined;
    setImageReady(false);
    setImageInspection(undefined);
    setImageFile(undefined);
    setImageError(undefined);
    setQaNotes('');
    if (review?.humanDecision === 'PENDING') onReview?.(undefined);
  };
  useEffect(() => { resetImageInspection(); }, [receiptKey]);
  const chooseImage = async (file?: File) => {
    if (review && review.humanDecision !== 'PENDING') return;
    resetImageInspection();
    if (!file) return;
    try {
      if (!receipt) throw new Error('Falta resultado real.');
      const inspected = await imageSelectionRef.current.inspect(file, receipt);
      if (!inspected || receiptKeyRef.current !== receiptKey) return;
      const url = URL.createObjectURL(file);
      pendingImageRef.current = inspected;
      activeImageUrlRef.current = url;
      setImageFile(url);
    } catch (cause) {
      if (receiptKeyRef.current === receiptKey)
        setImageError(cause instanceof Error ? cause.message : 'Imagen inválida.');
    }
  };
  const imageLoadError = () => {
    activeImageUrlRef.current = undefined;
    pendingImageRef.current = undefined;
    verifiedImageRef.current = undefined;
    setImageReady(false);
    setImageInspection(undefined);
    setImageError('La vista previa no pudo cargar la imagen.');
    if (review?.humanDecision === 'PENDING') onReview?.(undefined);
  };
  const reviewAction = (action: 'QA_PASS' | 'QA_FAIL' | 'HUMAN_APPROVE' | 'HUMAN_REJECT') => act(() => {
    if (!receipt) throw new Error('Falta resultado real.');
    if (!inspectionMatchesReceipt(verifiedImageRef.current, receipt)) throw new Error('La imagen debe cargarse y coincidir con el recibo antes de continuar.');
    onReview?.(recordAriaPilotReview(receipt, review, action, new Date().toISOString(), qaNotes, verifiedImageRef.current));
  });
  return <section className="aria-production" aria-label="Producción Aria Studio">
    <span className="campus-eyebrow">PRODUCCIÓN v0.8 · CODEX MCP · HANDOFF CONTROLADO</span>
    <h5>Fotografía real · Aria Studio</h5>
    <p>Esta pantalla prepara la orden. La generación ocurre únicamente en Codex tras otra confirmación de Luis; no existe conexión automática desde React.</p>
    <dl><div><dt>Campaña</dt><dd>{campaign.title} · {campaign.id}</dd></div><div><dt>Strategy</dt><dd>{strategy?.status ?? 'No iniciada'} · revisión {strategy?.revision ?? '—'}</dd></div><div><dt>Proveedor</dt><dd>Aria Studio · perfil existente Raxi</dd></div><div><dt>Agente</dt><dd>Creativa, ejecutada por Codex MCP</dd></div></dl>
    {!order && <div className="aria-form">
      {rows.length === 0 ? <p role="status">Se requiere una Strategy APPROVED con un entregable PHOTO para Instagram público. Ninguna campaña mock equivale a aprobación.</p> : <>
        <label>Entregable aprobado<select value={rowId} onChange={event => setRowId(event.target.value)}><option value="">Seleccionar</option>{rows.map(item => <option key={item.id} value={item.id}>{item.id} · {item.purpose} · plan {item.quantity}</option>)}</select></label>
        <label>Fotografía solicitada<textarea value={scene} maxLength={1500} onChange={event => setScene(event.target.value)} placeholder="Una escena concreta, vestuario, expresión, luz y microhistoria; sin redefinir la identidad de Raxi." /></label>
        <label>Asset IDs públicos aprobados (referencias editoriales, no adjuntos; separados por coma)<input value={sources} onChange={event => setSources(event.target.value)} placeholder="B-BLUE-DUELIST" /></label>
        <p>Alcance fijo de este piloto: 1 imagen · Instagram Feed · PUBLIC_SOCIAL · modelo gptimg · std · 3:4.</p>
        <button type="button" onClick={prepare}>Preparar orden para Jefe → Creativa</button>
      </>}
    </div>}
    {order && <div className="aria-order"><h6>Orden {order.jobId}</h6><p>Estado: {receipt ? 'RESULTADO IMPORTADO · QA PENDIENTE' : failure?.state ?? order.state} · Entregable {order.deliverableId}</p><p className="idea-multiline">{order.scene}</p>
      {!currentOrder && <p role="alert">La campaña o su Strategy actual cambió. Esta orden quedó obsoleta en la sesión; no la ejecutes.</p>}
      {order.executionApproval.status === 'PENDING' ? <><p>Precio observado en la consulta MCP: USD 0.039 para gptimg/std. Debe revalidarse en Codex antes de consumir créditos. No se ha generado ninguna imagen.</p><label className="aria-confirm"><input type="checkbox" checked={confirmCost} onChange={event => setConfirmCost(event.target.checked)} /> Soy Luis y autorizo preparar una única generación real con coste, sujeta a confirmar el precio en Codex.</label><button type="button" disabled={!confirmCost || !currentOrder} onClick={authorize}>Autorizar esta orden</button></> : <><p>Autorización local de Luis: {order.executionApproval.at}. Antes de invocar MCP, Codex debe confirmar el precio actualizado y recibir aprobación explícita para esta ejecución.</p><button type="button" disabled={!currentOrder} onClick={() => downloadJson(`${order.jobId}.json`, order)}>Exportar orden y snapshot aprobado</button><p>Entrega este JSON a Codex. La importación posterior valida su forma, pero la autenticidad del proveedor se coteja con el ID real de Aria en Codex.</p>
        {!receipt && currentOrder && <label className="aria-file">Importar manifiesto de resultado o fallo de Codex<input type="file" accept="application/json,.json" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; importReceipt(file); }} /></label>}</>}
    </div>}
    {failure && !receipt && <p role="status">{failure.state} · {failure.errorCode} · {failure.ariaImageId ?? 'sin ID Aria'}. Reconciliar en Aria antes de cualquier reintento; se puede importar un resultado posterior del mismo trabajo sin lanzar otra generación.</p>}
    {receipt && <div className="aria-result">
      <h6>Resultado informado por Codex</h6>
      <p>Aria ID: <code>{receipt.ariaImageId}</code> · {receipt.model} · USD {receipt.priceUsd.toFixed(4)} · {receipt.completedAt}</p>
      <p>SHA-256 declarado por Codex: <code>{receipt.imageSha256 ?? 'No disponible · QA pendiente'}</code>. Se comprueba al cargar el archivo.</p>
      <p>La URL del proveedor es temporal. El digest comprueba integridad de bytes, pero el JSON no autentica su procedencia: coteja ID e imagen directamente con la ejecución real en Aria.</p>
      <a href={receipt.imageUrl} target="_blank" rel="noopener noreferrer">Abrir imagen temporal del proveedor</a>
      <label className="aria-file">Cargar copia local para inspección visual<input type="file" accept="image/png,image/jpeg,image/webp" disabled={review?.humanDecision !== undefined && review.humanDecision !== 'PENDING'} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void chooseImage(file); }} /></label>
      {imageFile && <img src={imageFile} alt="Resultado de Aria cargado para QA visual" onLoad={event => {
        if (activeImageUrlRef.current !== imageFile) return;
        const pending = pendingImageRef.current;
        if (!pending || event.currentTarget.naturalWidth < 1 || event.currentTarget.naturalHeight < 1 ||
            !inspectionMatchesReceipt({ ...pending, previewLoaded: true }, receipt)) { imageLoadError(); return; }
        const verified = { ...pending, previewLoaded: true };
        verifiedImageRef.current = verified;
        pendingImageRef.current = undefined;
        setImageInspection(verified);
        setImageReady(true);
        setImageError(undefined);
      }} onError={() => { if (activeImageUrlRef.current === imageFile) imageLoadError(); }} />}
      {imageError && <p role="alert">{imageError}</p>}
      {imageFile && !imageVerified && !imageError && <p role="status">Huella verificada; esperando carga visible de la vista previa.</p>}
      {imageVerified && <p role="status">Archivo local verificado para {receipt.ariaImageId} · SHA-256 coincidente.</p>}
      <label>Observaciones de Calidad<textarea value={qaNotes} maxLength={1500} onChange={event => setQaNotes(event.target.value)} /></label>
      <div className="aria-actions"><button type="button" disabled={!imageVerified || !qaNotes.trim() || review?.humanDecision !== undefined && review.humanDecision !== 'PENDING'} onClick={() => reviewAction('QA_PASS')}>QA visual PASS</button><button type="button" disabled={!imageVerified || !qaNotes.trim() || review?.humanDecision !== undefined && review.humanDecision !== 'PENDING'} onClick={() => reviewAction('QA_FAIL')}>QA visual FAIL</button></div>
      <p>Calidad: {review?.qaStatus ?? 'VISUAL_REVIEW_REQUIRED'}. {!review && 'No hay aprobación automática.'}</p>
      {review?.qaStatus === 'PASS' && review.humanDecision === 'PENDING' && <div className="aria-actions"><button type="button" disabled={!imageVerified} onClick={() => reviewAction('HUMAN_APPROVE')}>Luis: aprobar fotografía</button><button type="button" disabled={!imageVerified} onClick={() => reviewAction('HUMAN_REJECT')}>Luis: rechazar fotografía</button></div>}
      {review?.qaStatus === 'FAIL' && review.humanDecision === 'PENDING' && <button type="button" disabled={!imageVerified} onClick={() => reviewAction('HUMAN_REJECT')}>Luis: rechazar fotografía</button>}
      <p>Decisión humana: {review?.humanDecision ?? 'PENDING'}. Sin publicación automática ni registro APPROVED en catálogo.</p>
      {review && <button type="button" onClick={() => downloadJson(`${receipt.jobId}-review.json`, review)}>Exportar revisión y decisión</button>}
    </div>}
    {message && <p role="alert" className="idea-form-error">{message}</p>}
  </section>;
}
