export function nextColombiaCutoff(now=new Date()){
 const colombiaMs=now.getTime()-5*60*60*1000;const local=new Date(colombiaMs);const daysUntilSunday=(7-local.getUTCDay())%7;const cutoffLocal=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+daysUntilSunday,23,59,59,999);let cutoff=new Date(cutoffLocal+5*60*60*1000);if(cutoff.getTime()<=now.getTime())cutoff=new Date(cutoff.getTime()+7*86400000);return cutoff
}
export function countdownParts(now:Date,cutoff:Date){const total=Math.max(0,cutoff.getTime()-now.getTime());return{total,days:Math.floor(total/86400000),hours:Math.floor(total/3600000)%24,minutes:Math.floor(total/60000)%60,seconds:Math.floor(total/1000)%60}}
