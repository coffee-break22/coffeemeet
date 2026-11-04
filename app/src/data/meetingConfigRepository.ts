import type { MeetingConfig } from './meetingConfig.ts'
import { advanceMeetingConfig,DEFAULT_CONFIG } from './meetingConfig.ts'
import { supabase } from '../infrastructure/supabase/client.ts'
export async function loadRemoteMeetingConfig():Promise<MeetingConfig>{if(!supabase)return DEFAULT_CONFIG;const[{data,error},{data:blocked,error:blockedError}]=await Promise.all([supabase.from('meeting_config').select('value').eq('key','current').maybeSingle(),supabase.from('blocked_dates').select('meeting_date,reason')]);if(error)throw error;if(blockedError)throw blockedError;if(!data?.value)return DEFAULT_CONFIG;const config=advanceMeetingConfig(data.value as MeetingConfig);const blockedByDate=new Map((blocked??[]).map(row=>[row.meeting_date,row.reason??'']));return{...config,days:config.days.map(day=>blockedByDate.has(day.date)?{...day,blocked:true,reason:blockedByDate.get(day.date)??''}:day)}}
export async function saveRemoteMeetingConfig(config:MeetingConfig){if(!supabase)return;const clean={...config,days:config.days.map(day=>({...day,blocked:false,reason:''}))};const{error}=await supabase.from('meeting_config').upsert({key:'current',value:clean,updated_at:new Date().toISOString()});if(error)throw error;const configuredDates=config.days.map(day=>day.date);if(configuredDates.length){const{error:deleteError}=await supabase.from('blocked_dates').delete().in('meeting_date',configuredDates);if(deleteError)throw deleteError}const dates=config.days.filter(day=>day.blocked).map(day=>({meeting_date:day.date,reason:day.reason}));if(dates.length){const{error:insertError}=await supabase.from('blocked_dates').insert(dates);if(insertError)throw insertError}}

export interface MeetingConfigChangeImpact{affectedParticipants:number;participantsRequiringUpdate:number}
export async function loadMeetingConfigChangeImpact(config:MeetingConfig):Promise<MeetingConfigChangeImpact>{
 if(!supabase)return{affectedParticipants:0,participantsRequiringUpdate:0}
 const clean={...config,days:config.days.map(day=>({...day,blocked:false,reason:''}))}
 const{data,error}=await supabase.rpc('get_meeting_config_change_impact',{p_config:clean})
 if(error)throw error
 const value=(data??{})as Record<string,unknown>
 return{affectedParticipants:Number(value.affectedParticipants??0),participantsRequiringUpdate:Number(value.participantsRequiringUpdate??0)}
}

