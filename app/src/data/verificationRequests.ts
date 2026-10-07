import type { VerificationRequest } from '../application/verification.ts'
const KEY='coffeemeet.verification-requests.v1'
export function loadVerificationRequests():VerificationRequest[]{try{return JSON.parse(localStorage.getItem(KEY)??'[]')as VerificationRequest[]}catch{return[]}}
export const saveVerificationRequests=(items:VerificationRequest[])=>localStorage.setItem(KEY,JSON.stringify(items))
export function upsertVerificationRequest(item:VerificationRequest){const all=loadVerificationRequests();saveVerificationRequests(all.some(r=>r.id===item.id)?all.map(r=>r.id===item.id?item:r):[...all,item])}
