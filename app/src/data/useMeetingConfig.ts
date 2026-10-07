import { useEffect,useState } from 'react'
import { loadMeetingConfig,saveMeetingConfig,type MeetingConfig } from './meetingConfig.ts'
import { loadRemoteMeetingConfig } from './meetingConfigRepository.ts'

export function useMeetingConfig(remoteEnabled:boolean){
 const[config,setConfig]=useState<MeetingConfig>(loadMeetingConfig),[loading,setLoading]=useState(remoteEnabled),[error,setError]=useState('')
 useEffect(()=>{if(!remoteEnabled)return;let active=true;void loadRemoteMeetingConfig().then(value=>{if(!active)return;setConfig(value);saveMeetingConfig(value);setError('')}).catch(()=>{if(active)setError('No se pudo actualizar la configuración semanal.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[remoteEnabled])
 return{config,loading,error}
}