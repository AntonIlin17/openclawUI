import assert from "node:assert/strict";
import {test} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DEFAULT_STOCK_SETTINGS,validateStockSettings,type PriceBar} from "../src/shared/stocks.js";
import {parseYahooChart,ProviderError} from "../src/main/stock-provider.js";
import {scheduleSlots,scheduledInstant} from "../src/main/stock-schedule.js";
import {StockStore,stockCsv} from "../src/main/stock-store.js";
import {StockService} from "../src/main/stock-service.js";
const now=new Date("2026-10-23T23:00:00Z");
function chart(){return {chart:{result:[{meta:{symbol:"AAPL",currency:"USD",instrumentType:"EQUITY",exchangeTimezoneName:"America/New_York",exchangeName:"NMS",currentTradingPeriod:{regular:{end:Date.parse("2026-10-23T20:00:00Z")/1000}}},timestamp:[Date.parse("2026-10-22T13:30:00Z")/1000,Date.parse("2026-10-23T13:30:00Z")/1000],indicators:{quote:[{open:[100,101],high:[103,104],low:[99,100],close:[102,103],volume:[1000,2000]}],adjclose:[{adjclose:[101.5,102.5]}]}}],error:null}};}
const bar:PriceBar={symbol:"AAPL",date:"2026-10-22",open:100,high:103,low:99,close:102,adjustedClose:101.5,volume:1000,currency:"USD",exchange:"Test exchange",collectedAt:now.toISOString()};
async function fixture(){const folder=fs.mkdtempSync(path.join(os.tmpdir(),"openclaw-stocks-"));const store=await StockStore.open(folder);return {folder,store,cleanup:()=>{store.close();fs.rmSync(folder,{recursive:true,force:true});}};}
test("settings normalize a bounded watchlist and reject unsafe or incomplete schedules",()=>{
 assert.deepEqual(validateStockSettings({...DEFAULT_STOCK_SETTINGS,symbols:["aapl"," AAPL ","BRK-B"]}).symbols,["AAPL","BRK-B"]);
 for(const patch of [{symbols:["../../escape"]},{symbols:[],enabled:true},{time:"25:00"},{timeZone:"not/a-zone"},{historyDays:10000}])assert.throws(()=>validateStockSettings({...DEFAULT_STOCK_SETTINGS,...patch}));
});
test("provider keeps separate adjusted close and excludes an incomplete current session",()=>{
 const raw=JSON.stringify(chart());assert.equal(parseYahooChart(raw,"AAPL",now).bars.length,2);
 const during=parseYahooChart(raw,"AAPL",new Date("2026-10-23T19:00:00Z"));assert.equal(during.bars.length,1);assert.equal(during.bars[0].close,102);assert.equal(during.bars[0].adjustedClose,101.5);
});
test("provider rejects foreign/wrong symbols and invalid OHLC without filling prices",()=>{
 const data=chart();data.chart.result[0].indicators.quote[0].close[1]=999;
 const result=parseYahooChart(JSON.stringify(data),"AAPL",now);assert.equal(result.bars.length,1);assert.match(result.warnings[0],/invalid/);
 data.chart.result[0].meta.currency="EUR";assert.throws(()=>parseYahooChart(JSON.stringify(data),"AAPL",now),/US-listed/);
 assert.throws(()=>parseYahooChart(JSON.stringify(chart()),"MSFT",now),/different ticker/);
});
test("timezone scheduling follows DST and catches up one missed weekday slot",()=>{
 assert.equal(scheduledInstant("2026-03-06","20:00","America/New_York").toISOString(),"2026-03-07T01:00:00.000Z");
 assert.equal(scheduledInstant("2026-03-09","20:00","America/New_York").toISOString(),"2026-03-10T00:00:00.000Z");
 const slots=scheduleSlots({...DEFAULT_STOCK_SETTINGS,symbols:["SPY"],enabled:true},new Date("2026-10-24T15:00:00Z"));
 assert.equal(slots.due,"2026-10-24T00:00:00.000Z");assert.equal(slots.next,"2026-10-27T00:00:00.000Z");
 assert.equal(scheduleSlots(DEFAULT_STOCK_SETTINGS,now).due,null);
});
test("SQLite upsert prevents duplicates, counts revisions, and survives reopening",async()=>{
 const f=await fixture();try{f.store.saveBars([bar]);f.store.saveBars([bar]);assert.equal(f.store.bars("AAPL").length,1);assert.equal(f.store.exportRows(["AAPL"])[0].revisions,0);
 f.store.saveBars([{...bar,close:102.5}]);assert.equal(f.store.exportRows(["AAPL"])[0].revisions,1);
 const reopened=await StockStore.open(f.folder);assert.equal(reopened.bars("AAPL")[0].close,102.5);reopened.close();
 }finally{f.cleanup();}
});
test("collection retains successes on partial failure, raw provenance and CSV metadata fields",async()=>{
 const f=await fixture();try{f.store.saveSettings({...DEFAULT_STOCK_SETTINGS,symbols:["AAPL","BAD"]});const service=new StockService(f.store,{collect:async(symbol)=>{if(symbol==="BAD")throw new ProviderError("Not found");return {bars:[bar],raw:'{"synthetic":true}',warnings:[]};}},()=>now);
 const state=await service.collect();assert.equal(state.runs[0].status,"partial");assert.equal(state.totalRows,1);assert(fs.existsSync(path.join(f.folder,"raw",state.runs[0].id,"AAPL.json.gz")));
 const csv=stockCsv(f.store.exportRows(["AAPL"]));assert.match(csv,/adjusted_close/);assert.match(csv,/"AAPL"/);assert.match(csv,/first_collected_at/);
 assert.match(stockCsv([{symbol:"=FORMULA",exchange:'a,"b'}]),/"'=FORMULA"/);
 }finally{f.cleanup();}
});
test("scheduler prevents overlaps and duplicate due-slot runs across restarts",async()=>{
 const f=await fixture();try{f.store.saveSettings({...DEFAULT_STOCK_SETTINGS,symbols:["AAPL"],enabled:true});let release!:()=>void,calls=0;
 const service=new StockService(f.store,{collect:async()=>{calls++;await new Promise<void>(resolve=>release=resolve);return {bars:[bar],raw:"{}",warnings:[]};}},()=>new Date("2026-10-24T01:00:00Z"));
 const first=service.tick();await service.tick();await assert.rejects(service.collect(),/already running/);release();await first;await service.tick();assert.equal(calls,1);
 const after=new StockService(f.store,{collect:async()=>{throw new Error("Should not run");}},()=>new Date("2026-10-24T02:00:00Z"));await after.tick();assert.equal(f.store.runs().length,1);
 }finally{f.cleanup();}
});
test("failed automatic runs retry after fifteen minutes with a bounded budget",async()=>{
 const f=await fixture();try{f.store.saveSettings({...DEFAULT_STOCK_SETTINGS,symbols:["BAD"],enabled:true});let clock=new Date("2026-10-24T01:00:00Z"),calls=0;
 const service=new StockService(f.store,{collect:async()=>{calls++;throw new ProviderError("Unknown ticker");}},()=>clock);
 await service.tick();await service.tick();assert.equal(calls,1);clock=new Date(clock.getTime()+16*60000);await service.tick();clock=new Date(clock.getTime()+16*60000);await service.tick();clock=new Date(clock.getTime()+16*60000);await service.tick();assert.equal(calls,3);assert.equal(f.store.cursor().retryAt,null);
 }finally{f.cleanup();}
});
test("reopening recovers interrupted runs and keeps previously stored prices",async()=>{
 const f=await fixture();try{f.store.saveBars([bar]);f.store.saveRun({id:"interrupted-fixture",startedAt:now.toISOString(),trigger:"scheduled catch-up",status:"running",symbols:["AAPL"],completed:0,rows:0,errors:[],warnings:[]});
 const reopened=await StockStore.open(f.folder);assert.equal(reopened.runs()[0].status,"interrupted");assert.equal(reopened.bars("AAPL").length,1);assert.equal(reopened.cursor().slot,null);reopened.close();
 }finally{f.cleanup();}
});
