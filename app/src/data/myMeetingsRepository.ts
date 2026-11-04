import { supabase } from '../infrastructure/supabase/client.ts'
import { cancelMeeting,type CancellationOutcome } from './meetingCancellationRepository.ts'
export type MyMeetingStatus='confirmed'|'cancelled_on_time'|'late_cancellation'|'attendance_pending'|'completed'|'no_show'|'attendance_disputed'
export interface MyMeeting {id:string;weekCode:string;slotId:string;status:MyMeetingStatus;meetLink:string|null;scheduledAt:string;partner:{id:string;name:string;email:string;phone:string;linkedin:string|null};cancelledBy:string|null;cancellationExempt:boolean}
export async function loadMyMeetings():Promise<MyMeeting[]>{
 if(!supabase)return[]
 const{data,error}=await supabase.rpc('get_my_meetings')
 if(error)throw error
 return(data??[]).map((row:any)=>({id:row.id,weekCode:row.week_code,slotId:row.slot_id,status:row.status,meetLink:row.meet_link,scheduledAt:row.scheduled_at,partner:{id:row.partner_id,name:row.partner_name,email:row.partner_email,phone:row.partner_phone,linkedin:row.partner_linkedin},cancelledBy:row.cancelled_by,cancellationExempt:row.cancellation_exempt}))
}
export async function cancelMyMeeting(id:string):Promise<CancellationOutcome>{return cancelMeeting(id)}