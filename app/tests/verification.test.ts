import test from 'node:test'
import assert from 'node:assert/strict'
import { createVerificationRequest,decideVerification } from '../src/application/verification.ts'
import type { RegistryEntry } from '../src/domain/coffeemeet.ts'
const entry:RegistryEntry={id:'registry-1',fullName:'Ana',email:'ana@example.com',phone:'+573001234567',school:'harvard',graduationYear:2020,active:true,notes:'',source:'test',updatedAt:'2026-01-01'}
const snapshot={fullName:'Ana',email:'ana@example.com',phone:'+573001234567',school:'harvard',graduationYear:2020}
test('coincidencia única queda pendiente con vínculo sugerido',()=>{const out=createVerificationRequest(undefined,'user-1',snapshot,{basis:'email',entry,candidates:[entry]},'2026-01-01T00:00:00Z');assert.equal(out.request.status,'pending');assert.equal(out.request.suggestedRegistryId,'registry-1');assert.equal(out.request.decision,undefined)})
test('misma evidencia reutiliza solicitud sin cambios',()=>{const first=createVerificationRequest(undefined,'user-1',snapshot,{basis:'none',candidates:[]},'2026-01-01T00:00:00Z');const second=createVerificationRequest(first.request,'user-1',snapshot,{basis:'none',candidates:[]},'2026-01-02T00:00:00Z');assert.equal(second.changed,false);assert.equal(second.request.id,first.request.id)})
test('aprobar manualmente ya no exige vínculo al padrón',()=>{const pending=createVerificationRequest(undefined,'user-1',snapshot,{basis:'none',candidates:[]}).request;const out=decideVerification(pending,{status:'approved',notes:'',actorId:'admin'});assert.equal(out.request.status,'approved');assert.equal(out.request.decision?.registryId,undefined)})
test('repetir la misma decisión manual es idempotente',()=>{const pending=createVerificationRequest(undefined,'user-1',snapshot,{basis:'none',candidates:[]}).request;const first=decideVerification(pending,{status:'approved',registryId:'registry-1',notes:'Validado',actorId:'admin',now:'2026-01-01'});const second=decideVerification(first.request,{status:'approved',registryId:'registry-1',notes:'Otro texto',actorId:'admin',now:'2026-01-02'});assert.equal(second.changed,false)})

