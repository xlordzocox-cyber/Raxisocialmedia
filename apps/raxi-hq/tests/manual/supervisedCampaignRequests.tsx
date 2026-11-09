import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RealCampaignCenter } from '../../src/persistence/RealCampaignCenter';
import { RealCampaignStore } from '../../src/persistence/realCampaignStore';
import { RealIdeaStore } from '../../src/persistence/realIdeaStore';
import { applyCampaignOperation } from '../../src/persistence/campaignCommands';
import { attentionFixture, attentionOwner as owner, attentionWorkspace as workspace } from '../humanAttentionFixture';
import '../../src/design/tokens.css';
import '../../src/design/global.css';
import '../../src/campus/campus.css';

function Workspace({ approved }: { approved: boolean }) {
  const [{ campaigns, ideas }] = useState(() => {
    const fixture = attentionFixture();
    const snapshot = approved ? applyCampaignOperation(fixture, {
      workspaceId: workspace, operationId: crypto.randomUUID(), expectedVersion: fixture.version,
      action: { type: 'APPROVE_STRATEGY', campaignId: fixture.session.campaigns[0].id, revision: 1, confirmed: true },
    }) : fixture;
    const disabled = async () => { throw Error('Fixture sin escrituras'); };
    return {
      campaigns: new RealCampaignStore({ read: async () => snapshot, execute: disabled }, owner, workspace),
      ideas: new RealIdeaStore({
        findWorkspace: async () => ({ id: workspace, ownerId: owner, name: 'raxi-hq' }),
        createWorkspace: disabled, listIdeas: async () => [], createIdea: disabled,
      }, owner),
    };
  });
  useEffect(() => { void ideas.load().then(() => campaigns.load()); }, [campaigns, ideas]);
  return <RealCampaignCenter store={campaigns} ideas={ideas} />;
}

function Lab() {
  const [approved, setApproved] = useState(true);
  return <main>
    <h1>Issue #58 · Laboratorio sintético</h1>
    <p>Repositorios locales de solo lectura. Sin sesiones ni proveedores conectados.</p>
    <label>Strategy <select value={String(approved)} onChange={event => setApproved(event.target.value === 'true')}>
      <option value="true">Aprobada</option><option value="false">En revisión</option>
    </select></label>
    <Workspace key={String(approved)} approved={approved} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
