import test from 'node:test'
import assert from 'node:assert/strict'
import { countdownParts,nextColombiaCutoff } from '../src/domain/schedule.ts'
test('cierre semanal es domingo 11:59:59 p.m. Colombia',()=>{const now=new Date('2026-08-28T15:00:00Z');assert.equal(nextColombiaCutoff(now).toISOString(),'2026-08-31T04:59:59.999Z')})
test('después del cierre calcula el domingo siguiente',()=>{const now=new Date('2026-08-31T05:00:00Z');assert.equal(nextColombiaCutoff(now).toISOString(),'2026-09-07T04:59:59.999Z')})
test('cuenta regresiva nunca produce valores negativos',()=>{assert.deepEqual(countdownParts(new Date(1000),new Date(0)),{total:0,days:0,hours:0,minutes:0,seconds:0})})
