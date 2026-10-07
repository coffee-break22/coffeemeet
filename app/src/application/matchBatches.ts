import { runMatching,type CompletedPair,type MatchParticipant,type MatchingResult } from '../domain/matching.ts'
export type BatchStatus='draft'|'confirmed'|'superseded'
export interface MatchBatch { id:string; weekCode:string; revision:number; fingerprint:string; status:BatchStatus; result:MatchingResult; createdAt:string; confirmedAt?:string; sideEffectKeys:string[]; isTest?:boolean }
export interface BatchStore { batches:MatchBatch[] }
export interface GenerateBatchInput { weekCode:string; participants:MatchParticipant[]; history:CompletedPair[]; blockedDates:string[]; regenerate?:boolean; now?:string; isTest?:boolean }
const stable=(value:unknown):string=>{if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${stable(v)}`).join(',')}}`;return JSON.stringify(value)}
function hash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
export function batchFingerprint(input:GenerateBatchInput){return hash(stable({weekCode:input.weekCode,participants:input.participants,history:input.history,blockedDates:[...input.blockedDates].sort(),isTest:Boolean(input.isTest)}))}
export function generateMatchBatch(store:BatchStore,input:GenerateBatchInput):{store:BatchStore;batch:MatchBatch;created:boolean}{
 const fingerprint=batchFingerprint(input);const reusable=store.batches.find(b=>b.weekCode===input.weekCode&&b.fingerprint===fingerprint&&b.status!=='superseded')
 if(reusable&&!input.regenerate)return{store,batch:reusable,created:false}
 const revision=Math.max(0,...store.batches.filter(b=>b.weekCode===input.weekCode).map(b=>b.revision))+1
 const result=runMatching(input.participants,input.history,input.blockedDates);const id=`${input.weekCode}-r${revision}-${fingerprint}`
 const batch:MatchBatch={id,weekCode:input.weekCode,revision,fingerprint,status:'draft',result,createdAt:input.now??new Date().toISOString(),sideEffectKeys:[],isTest:Boolean(input.isTest)}
 const batches=store.batches.map(b=>b.weekCode===input.weekCode&&b.status==='draft'?{...b,status:'superseded' as const}:b)
 return{store:{batches:[...batches,batch]},batch,created:true}
}
export function confirmMatchBatch(store:BatchStore,batchId:string,now?:string):{store:BatchStore;batch:MatchBatch;changed:boolean}{
 const found=store.batches.find(b=>b.id===batchId);if(!found)throw new Error('MATCH_BATCH_NOT_FOUND');if(found.status==='superseded')throw new Error('MATCH_BATCH_SUPERSEDED');if(found.status==='confirmed')return{store,batch:found,changed:false}
 const sideEffectKeys=found.result.pairs.flatMap((pair,index)=>{const meeting=`${found.id}-m${index+1}-${[pair.userAId,pair.userBId].sort().join('-')}`;return[`calendar:${meeting}`,`match-whatsapp:${meeting}:${pair.userAId}`,`match-whatsapp:${meeting}:${pair.userBId}`]})
 const batch={...found,status:'confirmed' as const,confirmedAt:now??new Date().toISOString(),sideEffectKeys};return{store:{batches:store.batches.map(b=>b.id===batchId?batch:b)},batch,changed:true}
}
