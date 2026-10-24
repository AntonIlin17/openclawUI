import type {PriceBar} from "../shared/stocks.js";

export type ProviderResult = {bars: PriceBar[]; raw: string; warnings: string[]};
export interface StockProvider { collect(symbol:string, historyDays:number, signal:AbortSignal, now?:Date):Promise<ProviderResult> }
export class ProviderError extends Error {
  constructor(message:string, readonly retryable=false) {super(message);}
}
const dateAt = (seconds:number, timeZone:string) => new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(seconds*1000));

export function parseYahooChart(raw:string, symbol:string, now = new Date()):ProviderResult {
  const payload=JSON.parse(raw);
  if(payload.chart?.error) throw new ProviderError(payload.chart.error.description ?? "Ticker unavailable.");
  const data=payload.chart?.result?.[0];
  if(!data?.meta || !Array.isArray(data.timestamp)) throw new ProviderError("No daily history returned. Check the ticker.");
  const meta=data.meta;
  if(meta.currency!=="USD" || !["EQUITY","ETF"].includes(meta.instrumentType) || !String(meta.exchangeTimezoneName).startsWith("America/"))
    throw new ProviderError("This collector supports US-listed USD stocks and ETFs. Choose a US ticker.");
  if(String(meta.symbol).toUpperCase()!==symbol) throw new ProviderError("The provider returned a different ticker; nothing was saved.");
  const quote=data.indicators?.quote?.[0];
  if(!quote) throw new ProviderError("Daily price fields are missing.");
  const adjusted=data.indicators?.adjclose?.[0]?.adjclose ?? [];
  const bars:PriceBar[]=[]; const warnings:string[]=[]; const dates=new Set<string>(); let skipped=0;
  const today=dateAt(now.getTime()/1000,meta.exchangeTimezoneName);
  for(let i=0;i<data.timestamp.length;i++) {
    const timestamp=data.timestamp[i];
    if(!Number.isFinite(timestamp)) {skipped++;continue;}
    const date=dateAt(timestamp,meta.exchangeTimezoneName);
    // Exclude the still-forming current session, including the feed's closing grace period.
    const regularEnd=meta.currentTradingPeriod?.regular?.end;
    if(date>today || (date===today && (!Number.isFinite(regularEnd) || now.getTime()/1000 < regularEnd+3600))) continue;
    const [open,high,low,close,volume]=[quote.open?.[i],quote.high?.[i],quote.low?.[i],quote.close?.[i],quote.volume?.[i]];
    if(![open,high,low,close,volume].every(Number.isFinite) || Math.min(open,high,low,close)<=0 || volume<0 || !Number.isSafeInteger(volume) || high<Math.max(open,close,low) || low>Math.min(open,close,high) || dates.has(date)) {skipped++;continue;}
    const adj=adjusted[i];
    bars.push({symbol,date,open,high,low,close,volume,adjustedClose:Number.isFinite(adj)&&adj>0?adj:null,currency:"USD",exchange:String(meta.fullExchangeName??meta.exchangeName??"US"),collectedAt:now.toISOString()}); dates.add(date);
  }
  if(skipped) warnings.push(`${symbol}: skipped ${skipped} incomplete or invalid daily records.`);
  if(!bars.length) throw new ProviderError("No completed, valid trading sessions returned yet. Try again after market close.");
  bars.sort((a,b)=>a.date.localeCompare(b.date));
  // These are potential gaps, not assumed missing trading sessions: holidays, halts and IPOs vary.
  for(let i=1;i<bars.length;i++) if(Date.parse(bars[i].date)-Date.parse(bars[i-1].date)>7*86400000) {
    warnings.push(`${symbol}: a gap longer than seven calendar days was reported. Review the saved dates.`);break;
  }
  if(Date.parse(today)-Date.parse(bars.at(-1)!.date)>7*86400000) warnings.push(`${symbol}: latest provider session is more than seven days old.`);
  return {bars,raw,warnings};
}

export class YahooDailyProvider implements StockProvider {
  async collect(symbol:string, historyDays:number, signal:AbortSignal, now=new Date()):Promise<ProviderResult> {
    const url=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.search=new URLSearchParams({period1:String(Math.floor(now.getTime()/1000)-historyDays*86400),period2:String(Math.floor(now.getTime()/1000)),interval:"1d",events:"div,splits",includeAdjustedClose:"true"}).toString();
    let response:Response;
    try {response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),headers:{"User-Agent":"OpenClawDesktop/0.3.0 personal-research","Accept":"application/json"}});}
    catch(error) {if(signal.aborted) throw error;throw new ProviderError("Could not reach Yahoo Finance. Check your internet connection and retry.",true);}
    if(!response.ok) throw new ProviderError(response.status===429?"Yahoo Finance is rate limiting requests. Collection will retry later.":`Yahoo Finance returned HTTP ${response.status}. ${response.status===404?"Check the ticker symbol.":"Try again later."}`,response.status===429||response.status>=500);
    const raw=await response.text();
    if(raw.length>8_000_000) throw new ProviderError("Provider response exceeded the supported size.");
    try{return parseYahooChart(raw,symbol,now);}catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError("Yahoo Finance returned an unreadable response. No prices were invented or saved.");}
  }
}
