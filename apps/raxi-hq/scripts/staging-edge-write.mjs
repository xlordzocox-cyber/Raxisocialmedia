import assert from 'node:assert/strict';
import { applyCampaignOperation } from '../../../supabase/functions/_shared/campaign-domain.js';

// Only authenticated Edge transport may execute this operation. read() is canonical RPC readback.
export async function verifyFreshEdgeWrite({ read, send, command }) {
 const before=await read();
 assert.equal(before.receipts.filter(r=>r.operationId===command.operationId).length,0,'Fresh Edge operation must have no prior receipt');
 applyCampaignOperation(before,command); // Validate the fresh transition before any effect.
 // Compare JSON wire values; domain validators may materialize optional undefined fields.
 const state=s=>{const {serverTime,...rest}=s;return JSON.parse(JSON.stringify(rest));};
 const receipt=s=>s.receipts.filter(r=>r.operationId===command.operationId);
 const check=s=>{
  assert.equal(s.version,before.version+1,'Edge must commit exactly one transition');
  assert.equal(s.receipts.length,before.receipts.length+1,'Edge must add exactly one receipt');
  assert.equal(receipt(s).length,1,'Fresh Edge receipt missing or duplicated');
  assert.deepEqual(receipt(s)[0].command,command,'Edge receipt must bind the original command');
  // Recompute against the confirmed transition clock, including approvedAt/updatedAt.
  // Never ignore arbitrary changed fields to accommodate a different server read time.
  const target=s.ideas.find(i=>i.id===command.action.ideaId);
  assert.ok(target,'Edge target missing');
  assert.ok(Number.isFinite(Date.parse(target.updatedAt)),'Edge timestamp invalid');
  assert.ok(Date.parse(target.updatedAt)>=Date.parse(before.serverTime),'Edge timestamp regressed');
  const expected=applyCampaignOperation({...before,serverTime:target.updatedAt},command);
  assert.deepEqual(state(s),state(expected),'Canonical Edge result differs from the single requested transition');
 };
 const lost=await send(command);
 assert.ok(lost.ok,`Fresh Edge write failed: HTTP ${lost.status}`);
 // Discard without decoding; this simulates lost body, not a severed HTTP connection.
 await lost.body?.cancel();
 const saved=await read();check(saved);
 const replay=await send(command);assert.ok(replay.ok,`Edge replay failed: HTTP ${replay.status}`);
 assert.deepEqual(state(await replay.json()),state(saved),'Replay returned a different canonical result');
 assert.deepEqual(state(await read()),state(saved),'Replay repeated an effect');
 const changed={...command,action:{...command.action,confirmed:false}};
 const conflict=await send(changed);assert.equal(conflict.status,409,'Changed payload must conflict');
 await conflict.body?.cancel();
 const final=await read();check(final);
 assert.deepEqual(state(final),state(saved),'Conflict changed canonical state');
 return final;
}
