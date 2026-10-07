import { supabase } from '../infrastructure/supabase/client.ts'
export interface CancellationOutcome {meetingStatus:'cancelled_on_time'|'late_cancellation';cancellationExempt:boolean;cancellationExemptReason:string|null;priorCompletedMeetingId:string|null}
export async function cancelMeeting(meetingId:string,cancelledBy?:string):Promise<CancellationOutcome>{
 if(!supabase)throw new Error('SUPABASE_REQUIRED')
 const{data,error}=await supabase.rpc('cancel_meeting',{p_meeting_id:meetingId,p_cancelled_by:cancelledBy??null})
 if(error)throw error
 const row=Array.isArray(data)?data[0]:data
 if(!row)throw new Error('CANCELLATION_NOT_RETURNED')
 return{meetingStatus:row.meeting_status,cancellationExempt:row.cancellation_exempt,cancellationExemptReason:row.cancellation_exempt_reason,priorCompletedMeetingId:row.prior_completed_meeting_id}
}