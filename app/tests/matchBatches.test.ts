import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmMatchBatch,generateMatchBatch } from '../src/application/matchBatches.ts'
import type { MatchParticipant } from '../src/domain/matching.ts'
const participants:MatchParticipant[]=['1','2'].map(id=>({id,fullName:id,phone:`+57300000000${id}`,email:`${id}@example.com`,city:'Bogotá',verificationStatus:'approved',blocked:false,knownPhones:[],knownEmails:[],onlyNewPeople:false,completedMeetingCount:0,slots:[{id:'v',date:'2026-09-03',time:'18:00',mode:'virtual'}]}))
const input={weekCode:'2026-W36',participants,history:[],blockedDates:[],now:'2026-08-31T13:00:00Z'}
test('generar dos veces con los mismos datos reutiliza el borrador',()=>{const first=generateMatchBatch({batches:[]},input);const second=generateMatchBatch(first.store,input);assert.equal(second.created,false);assert.equal(second.batch.id,first.batch.id);assert.equal(second.store.batches.length,1)})
test('regenerar crea revisión y reemplaza el borrador anterior',()=>{const first=generateMatchBatch({batches:[]},input);const second=generateMatchBatch(first.store,{...input,regenerate:true});assert.equal(second.batch.revision,2);assert.equal(second.store.batches.find(b=>b.id===first.batch.id)?.status,'superseded')})
test('confirmar dos veces es idempotente y conserva claves externas',()=>{const generated=generateMatchBatch({batches:[]},input);const first=confirmMatchBatch(generated.store,generated.batch.id,'2026-08-31T14:00:00Z');const second=confirmMatchBatch(first.store,generated.batch.id,'2026-08-31T15:00:00Z');assert.equal(first.changed,true);assert.equal(second.changed,false);assert.deepEqual(second.batch.sideEffectKeys,first.batch.sideEffectKeys);assert.equal(first.batch.sideEffectKeys.length,3)})
test('no permite confirmar un borrador reemplazado',()=>{const first=generateMatchBatch({batches:[]},input);const second=generateMatchBatch(first.store,{...input,regenerate:true});assert.throws(()=>confirmMatchBatch(second.store,first.batch.id),/SUPERSEDED/)})

