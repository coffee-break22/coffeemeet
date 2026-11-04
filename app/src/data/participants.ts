import type { MatchParticipant } from '../domain/matching.ts'
import type { School } from '../domain/coffeemeet.ts'
import type { NetworkingProfile } from '../domain/profile.ts'
export interface ParticipantSelection { city:string; places:string[]; days:string[]; times:string[] }
export interface StoredParticipant extends MatchParticipant { email:string; alumniEmail:string; linkedin:string; school:School; graduationYear:number; weekCode:string; networkingProfile?:NetworkingProfile; onlyNewPeople:boolean; selection:ParticipantSelection; withdrawn:boolean; participationStatus?:'pending'|'confirmed'|'withdrawn'; updatedAt:string }
const KEY='coffeemeet.participants.v1'
export function loadParticipants():StoredParticipant[]{try{return JSON.parse(localStorage.getItem(KEY)??'[]')as StoredParticipant[]}catch{return[]}}
export const saveParticipants=(items:StoredParticipant[])=>localStorage.setItem(KEY,JSON.stringify(items))
export function upsertParticipant(item:StoredParticipant){const all=loadParticipants();saveParticipants(all.some(p=>p.id===item.id)?all.map(p=>p.id===item.id?item:p):[...all,item])}
export function findParticipant(query:string){const q=query.trim().toLowerCase().replace(/\D/g,'');return loadParticipants().find(p=>p.email.toLowerCase()===query.trim().toLowerCase()||(q.length>=7&&p.phone.replace(/\D/g,'').endsWith(q.slice(-10))))}


export function setParticipantVerification(userId:string,status:StoredParticipant['verificationStatus']){const all=loadParticipants();saveParticipants(all.map(item=>item.id===userId?{...item,verificationStatus:status,updatedAt:new Date().toISOString()}:item))}
export function removeParticipant(userId:string){saveParticipants(loadParticipants().filter(item=>item.id!==userId))}




