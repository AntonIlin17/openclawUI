import {EventEmitter} from "node:events";
import {randomUUID} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {gzipSync} from "node:zlib";
import type {StockRun,StockSettings,StockState} from "../shared/stocks.js";
import {validateStockSettings} from "../shared/stocks.js";
import {StockStore} from "./stock-store.js";
import {ProviderError,YahooDailyProvider,type StockProvider} from "./stock-provider.js";
import {scheduleSlots} from "./stock-schedule.js";

export class StockService extends EventEmitter {
  active:StockRun|null=null;
  private controller:AbortController|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private storageError:string|undefined;
  constructor(readonly store:StockStore,private provider:StockProvider=new YahooDailyProvider(),private now:()=>Date=()=>new Date()){super();}
  state():StockState{
    const settings=this.store.settings(),cursor=this.store.cursor(),slots=scheduleSlots(settings,this.now());
    const summaries=this.store.summaries(settings.symbols);
    const retry=cursor.retryAt&&Date.parse(cursor.retryAt)>this.now().getTime()?cursor.retryAt:null;
    return {settings,summaries,runs:this.store.runs(),active:this.active,nextRun:settings.enabled?(retry??(cursor.slot!==slots.due?slots.due:slots.next)):null,dataFolder:this.store.folder,totalRows:summaries.reduce((n,s)=>n+s.count,0),...(this.storageError?{storageError:this.storageError}:{})};
  }
  start():void {if(this.timer)return;this.timer=setInterval(()=>void this.tick().catch(error=>this.failStorage(error)),30000);void this.tick().catch(error=>this.failStorage(error));}
  stop():void {if(this.timer)clearInterval(this.timer);this.timer=null;this.controller?.abort();}
  cancel():void{this.controller?.abort();}
  private changed():void {this.emit("changed",this.state());}
  private failStorage(error:unknown):void{this.storageError=`Local storage needs attention: ${error instanceof Error?error.message:String(error)}. Collection is paused; existing files have been retained.`;if(this.timer)clearInterval(this.timer);this.timer=null;this.emit("storage-error",this.storageError);this.changed();}
  saveSettings(input:StockSettings):StockState {
    if(this.active)throw new Error("Wait for the current collection to finish or stop it before changing the watchlist.");
    if(this.storageError)throw new Error(this.storageError);
    const settings=validateStockSettings(input);const old=this.store.settings();
    const changed=JSON.stringify(old)!==JSON.stringify(settings);
    this.store.saveSettings(settings);
    // Enabling/changing a task starts with a catch-up, rather than silently waiting a day.
    if(changed)this.store.setMeta("cursor",{slot:null,retryAt:null,attempts:0});
    this.changed();return this.state();
  }
  async tick():Promise<void>{
    if(this.active||this.storageError)return;
    const settings=this.store.settings(),cursor=this.store.cursor(),{due}=scheduleSlots(settings,this.now());
    if(!due)return;
    const retry=cursor.slot===due&&cursor.retryAt&&Date.parse(cursor.retryAt)<=this.now().getTime();
    if(cursor.slot===due&&!retry)return;
    await this.collect(cursor.slot===due?"retry":"scheduled catch-up",due);
  }
  async collect(trigger="manual",slot?:string):Promise<StockState>{
    if(this.active)throw new Error("A collection is already running.");
    if(this.storageError)throw new Error(this.storageError);
    const settings=this.store.settings();if(!settings.symbols.length)throw new Error("Add at least one ticker to your watchlist.");
    this.controller=new AbortController();const signal=this.controller.signal;
    const run:StockRun={id:randomUUID(),startedAt:this.now().toISOString(),trigger,status:"running",symbols:[...settings.symbols],completed:0,rows:0,errors:[],warnings:[]};
    this.active=run;
    try{
      this.store.saveRun(run);
      if(slot){const cursor=this.store.cursor();this.store.setMeta("cursor",{slot,retryAt:null,attempts:cursor.slot===slot?cursor.attempts+1:1});}
      this.changed();
      for(const symbol of settings.symbols){
        if(signal.aborted)break;
        try{
          let result;
          for(let attempt=0;attempt<2;attempt++){
            try{result=await this.provider.collect(symbol,settings.historyDays,signal,this.now());break;}
            catch(error){if(!(error instanceof ProviderError)||!error.retryable||attempt===1||signal.aborted)throw error;await this.pause(2000,signal);}
          }
          if(signal.aborted)break;
          if(!result)throw new Error("No result received.");
          const rawFolder=path.join(this.store.folder,"raw",run.id);fs.mkdirSync(rawFolder,{recursive:true});
          fs.writeFileSync(path.join(rawFolder,symbol+".json.gz"),gzipSync(result.raw));
          this.store.saveBars(result.bars);run.rows+=result.bars.length;run.warnings.push(...result.warnings);
        }catch(error){
          if(signal.aborted)break;
          if(!(error instanceof ProviderError)){this.failStorage(error);throw error;}
          run.errors.push({symbol,message:error.message});
        }
        run.completed++;this.store.saveRun(run);this.changed();
        if(run.completed<settings.symbols.length)await this.pause(500,signal).catch(()=>{});
      }
      run.status=signal.aborted?"interrupted":run.errors.length?(run.rows?"partial":"failed"):"success";
      if(signal.aborted)run.errors.push({symbol:"Collection",message:"Collection stopped. Completed ticker data was retained."});
      run.finishedAt=this.now().toISOString();this.store.saveRun(run);
      if(slot){const cursor=this.store.cursor();const retryAt=["failed","partial"].includes(run.status)&&cursor.attempts<3?new Date(this.now().getTime()+15*60000).toISOString():null;this.store.setMeta("cursor",{...cursor,retryAt});}
      this.pruneRaw(settings.rawRetentionDays);
    }catch(error){
      run.status="failed";run.finishedAt=this.now().toISOString();run.errors.push({symbol:"Storage",message:error instanceof Error?error.message:String(error)});
      try{this.store.saveRun(run);}catch{}this.failStorage(error);
    }finally{this.active=null;this.controller=null;this.changed();this.emit("finished",run);}
    return this.state();
  }
  private pause(ms:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{if(signal.aborted){reject(new Error("Stopped"));return;}const done=()=>{signal.removeEventListener("abort",abort);resolve();};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);reject(new Error("Stopped"));};signal.addEventListener("abort",abort,{once:true});});}
  private pruneRaw(days:number):void{
    const root=path.join(this.store.folder,"raw");if(!fs.existsSync(root))return;
    for(const name of fs.readdirSync(root)){
      if(!/^[0-9a-f-]{36}$/.test(name))continue;
      const target=path.resolve(root,name);if(!target.startsWith(path.resolve(root)+path.sep))continue;
      if(fs.statSync(target).mtimeMs<this.now().getTime()-days*86400000)fs.rmSync(target,{recursive:true,force:true});
    }
  }
}
