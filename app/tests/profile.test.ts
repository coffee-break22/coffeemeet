import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_NETWORKING_PROFILE,parseTags,publicProfile } from '../src/domain/profile.ts'
const owner={id:'1',fullName:'Ana',email:'ana@example.com',phone:'+573001234567',linkedin:'linkedin.com/in/ana',city:'Bogotá',school:'harvard',graduationYear:2020,networkingProfile:{...EMPTY_NETWORKING_PROFILE,visibility:{email:false,phone:false,linkedin:true}}}
test('perfil público respeta privacidad de cada contacto',()=>{const view=publicProfile(owner);assert.equal(view.email,undefined);assert.equal(view.phone,undefined);assert.equal(view.linkedin,'linkedin.com/in/ana')})
test('tags se limpian, deduplican y limitan',()=>{assert.deepEqual(parseTags(' IA, educación, IA '),['IA','educación']);assert.equal(parseTags(Array.from({length:20},(_,i)=>`t${i}`).join(',')).length,12)})
