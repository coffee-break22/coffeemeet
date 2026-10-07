import type { RegistryMatch,VerificationStatus } from '../domain/coffeemeet.ts'
export interface VerificationSnapshot { fullName:string; email:string; alumniEmail?:string; phone:string; linkedin?:string; school:string; graduationYear:number }
export interface VerificationDecision { status:Exclude<VerificationStatus,'pending'>; registryId?:string; notes:string; actorId:string; decidedAt:string; automatic:boolean }
export interface VerificationRequest { id:string; userId:string; fingerprint:string; snapshot:VerificationSnapshot; status:VerificationStatus; candidateRegistryIds:string[]; suggestedRegistryId?:string; matchBasis:string; decision?:VerificationDecision; createdAt:string; updatedAt:string }
const fingerprint=(value:VerificationSnapshot)=>JSON.stringify([value.fullName.trim().toLowerCase(),(value.alumniEmail??value.email).trim().toLowerCase(),value.email.trim().toLowerCase(),value.phone.replace(/\D/g,''),value.school,value.graduationYear])
export function createVerificationRequest(existing:VerificationRequest|undefined,userId:string,snapshot:VerificationSnapshot,match:RegistryMatch,now=new Date().toISOString()):{request:VerificationRequest;changed:boolean}{
 const fp=fingerprint(snapshot);if(existing?.fingerprint===fp)return{request:existing,changed:false}
 const status:VerificationStatus='pending'
 return{changed:true,request:{id:existing?.id??crypto.randomUUID(),userId,fingerprint:fp,snapshot,status,candidateRegistryIds:match.candidates.map(c=>c.id),suggestedRegistryId:match.entry?.id,matchBasis:match.basis,createdAt:existing?.createdAt??now,updatedAt:now}}
}
export function decideVerification(request:VerificationRequest,input:{status:'approved'|'rejected';registryId?:string;notes:string;actorId:string;now?:string}){
 if(request.decision&&!request.decision.automatic&&request.decision.status===input.status&&request.decision.registryId===input.registryId)return{request,changed:false}
 const now=input.now??new Date().toISOString();return{changed:true,request:{...request,status:input.status,suggestedRegistryId:input.registryId,decision:{status:input.status,registryId:input.registryId,notes:input.notes.trim(),actorId:input.actorId,decidedAt:now,automatic:false},updatedAt:now}}
}


