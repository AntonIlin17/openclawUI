import type {StockSettings} from "../shared/stocks.js";
function localDate(now:Date,zone:string):string {return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);}
export function scheduledInstant(day:string,time:string,zone:string):Date {
  const target=Date.parse(`${day}T${time}:00Z`);let candidate=target;let previous=target;
  for(let i=0;i<6;i++) {
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(candidate));
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const next=candidate+target-represented;
    if(next===candidate)return new Date(candidate);
    if(next===previous)return new Date(Math.max(next,candidate));
    previous=candidate;candidate=next;
  }
  return new Date(candidate);
}
export function scheduleSlots(settings:StockSettings,now:Date):{due:string|null;next:string|null} {
  if(!settings.enabled||!settings.symbols.length)return {due:null,next:null};
  const anchor=Date.parse(localDate(now,settings.timeZone)+"T12:00:00Z");
  let due:string|null=null,next:string|null=null;
  for(let offset=-8;offset<=8;offset++){
    const day=new Date(anchor+offset*86400000);if([0,6].includes(day.getUTCDay()))continue;
    const instant=scheduledInstant(day.toISOString().slice(0,10),settings.time,settings.timeZone);
    if(instant<=now)due=instant.toISOString();else if(!next)next=instant.toISOString();
  }
  return {due,next};
}
