import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketFeedGroups,marketSnapshotKey,mergeMarketFeed,parseMarketFeed,parseMarketHistory,readMarketSnapshot,saveMarketSnapshot} from './marketSnapshot.mjs';

const checkedAt='2026-10-29T12:00:00.000Z';
const quote=(id='usd',extra={})=>({id,value:'5.1234',date:'2026-10-29',observedAt:checkedAt,changePercent:'-0.1250',source:'Fonte pública',sourceUrl:'https://example.org/reference',note:'Referência publicada',status:'available',...extra});
const feed=(quotes=[quote()],extra={})=>({quotes,checkedAt,refreshSeconds:60,...extra});
test('comparison metadata survives snapshots and malformed bases or duplicate history days are rejected',()=>{
 const reference={changeBasis:'previous-publication',previousValue:'5',previousDate:'2026-10-28',previousSourceUrl:'https://example.org/previous'};
 assert.deepEqual(parseMarketFeed(feed([quote('usd',reference)]),'currency').quotes[0],quote('usd',reference));
 for(const extra of [{previousValue:'0'},{previousDate:'2026-10-29'},{previousSourceUrl:'javascript:bad'},{changeBasis:'guessed'}])assert.equal(parseMarketFeed(feed([quote('usd',{...reference,...extra})]),'currency'),null);
 const history={id:'usd',days:[{day:'2026-10-29',value:'5.1234',date:'2026-10-28',capturedAt:checkedAt,source:'Official daily'}]};assert.deepEqual(parseMarketHistory(history,'usd'),history);assert.equal(parseMarketHistory({...history,days:[...history.days,...history.days]},'usd'),null);assert.equal(parseMarketHistory(history,'eur'),null);
});
function memoryStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
test('group validation keeps exact decimal strings and source dates without mixing provider groups',()=>{
  assert.deepEqual(parseMarketFeed(feed(),'currency'),feed());
  assert.equal(parseMarketFeed(feed(),'agriculture'),null);
  assert.equal(parseMarketFeed(feed(),'cane'),null);
  assert.equal(parseMarketFeed(feed(),'__proto__'),null);
  assert.equal(parseMarketFeed(feed([quote(),quote()]),'currency'),null);
  assert.equal(parseMarketFeed(feed([quote('eur')]),'currency').quotes[0].value,'5.1234');
  assert.equal(parseMarketFeed(feed([quote('soy')]),'agriculture').refreshSeconds,600);
  assert.equal(parseMarketFeed(feed([quote('cane')]),'cane').refreshSeconds,600);
  assert.equal(marketFeedGroups.currency.refreshSeconds,60);
  assert.equal(marketFeedGroups.exchange.refreshSeconds,60);
  for(const id of ['ibovespa','sp500','gold']){
    assert.equal(parseMarketFeed(feed([quote(id)]),'exchange').quotes[0].id,id);
    assert.equal(parseMarketFeed(feed([quote(id)]),'currency'),null);
  }
});
test('malformed decimal, calendar dates, timestamps, URLs and feed fields are rejected',()=>{
  const invalid=[{value:'NaN'},{value:'Infinity'},{value:'5,12'},{value:'-1'},{value:'0'},{value:5.12},{date:'2026-02-31'},{date:null},{status:'bogus'},{status:'stale',value:null},{status:'unavailable'},
    {changePercent:'NaN'},{changePercent:'1e4'},{observedAt:'2026-02-31T12:00:00Z'},{observedAt:'2026-10-29T24:00:00Z'},
    {sourceUrl:'javascript:alert(1)'},{sourceUrl:'http://example.org'},{sourceUrl:'https://user:password@example.org'},{source:''},{note:null}];
  for(const change of invalid)assert.equal(parseMarketFeed(feed([quote('usd',change)]),'currency'),null,JSON.stringify(change));
  for(const change of [{checkedAt:'invalid'},{checkedAt:'2026-02-31T00:00:00Z'},{refreshSeconds:Infinity},{refreshSeconds:0},{quotes:[]},{quotes:null}])assert.equal(parseMarketFeed(feed(undefined,change),'currency'),null);
});
test('snapshots are scoped by user and group, remain stale, and preserve original publication metadata',()=>{
  const storage=memoryStorage();saveMarketSnapshot(storage,'owner-a','currency',feed());
  const saved=readMarketSnapshot(storage,'owner-a','currency');
  assert.equal(saved.quotes[0].status,'stale');assert.equal(saved.quotes[0].value,'5.1234');assert.equal(saved.quotes[0].observedAt,checkedAt);assert.equal(saved.checkedAt,checkedAt);
  assert.equal(readMarketSnapshot(storage,'owner-b','currency'),undefined);assert.equal(readMarketSnapshot(storage,'owner-a','agriculture'),undefined);
  storage.setItem(marketSnapshotKey('owner-b','currency'),storage.getItem(marketSnapshotKey('owner-a','currency')));
  assert.equal(readMarketSnapshot(storage,'owner-b','currency'),undefined,'An envelope copied across account keys is rejected');
  storage.setItem(marketSnapshotKey('owner-a','cane'),storage.getItem(marketSnapshotKey('owner-a','currency')));
  assert.equal(readMarketSnapshot(storage,'owner-a','cane'),undefined);
  assert.equal(marketSnapshotKey('','currency'),null);assert.equal(marketSnapshotKey('owner-a','unknown'),null);
});
test('storage failures and damaged snapshots are ignored without replacing valid prices',()=>{
  const storage=memoryStorage(),key=marketSnapshotKey('owner','currency');
  for(const raw of ['{','null','[]',JSON.stringify({version:2,userId:'owner',group:'currency',feed:feed()})]){storage.setItem(key,raw);assert.equal(readMarketSnapshot(storage,'owner','currency'),undefined);}
  const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('quota');}};
  assert.equal(readMarketSnapshot(broken,'owner','currency'),undefined);assert.doesNotThrow(()=>saveMarketSnapshot(broken,'owner','currency',feed()));
  saveMarketSnapshot(storage,'owner','currency',feed());const previous=storage.getItem(key);
  saveMarketSnapshot(storage,'owner','currency',feed([quote('usd',{value:'invalid'})]));assert.equal(storage.getItem(key),previous);
});
test('unavailable or older API publications retain last valid prices per ID while fresh references recover',()=>{
  const old=feed([quote(),quote('eur',{value:'6.1234'})]);
  const unavailable=quote('usd',{status:'unavailable',value:null,date:null});
  const merged=mergeMarketFeed(old,feed([unavailable,quote('eur',{value:'6.2345'})],{checkedAt:'2026-10-29T12:01:00.000Z'}),'currency');
  assert.equal(merged.quotes[0].value,'5.1234');assert.equal(merged.quotes[0].status,'stale');assert.equal(merged.quotes[0].date,'2026-10-29');assert.equal(merged.quotes[0].observedAt,checkedAt);
  assert.equal(merged.quotes[1].status,'available');assert.equal(merged.quotes[1].value,'6.2345');assert.equal(old.quotes[0].status,'available');
  const regressed=mergeMarketFeed(old,feed([quote('usd',{date:'2026-10-28',observedAt:'2026-10-28T12:00:00.000Z'})]),'currency');
  assert.equal(regressed.quotes[0].status,'stale');assert.equal(regressed.quotes[0].value,'5.1234');assert.equal(regressed.quotes[1].status,'stale','Missing indicators preserve the last per-ID publication');
  const recovered=mergeMarketFeed(merged,feed([quote('usd',{value:'5.2345',observedAt:'2026-10-29T12:02:00.000Z'})]),'currency');
  assert.equal(recovered.quotes[0].status,'available');assert.equal(recovered.quotes[0].value,'5.2345');
});
test('failed server publications cannot overwrite a persisted valid quote; cold failures create no snapshot',()=>{
  const storage=memoryStorage(),unavailable=feed([quote('usd',{status:'unavailable',value:null,date:null})]);
  saveMarketSnapshot(storage,'cold','currency',unavailable);assert.equal(readMarketSnapshot(storage,'cold','currency'),undefined);
  saveMarketSnapshot(storage,'owner','currency',feed());saveMarketSnapshot(storage,'owner','currency',unavailable);
  const cached=readMarketSnapshot(storage,'owner','currency');assert.equal(cached.quotes[0].value,'5.1234');assert.equal(cached.quotes[0].status,'stale');assert.equal(cached.quotes[0].observedAt,checkedAt);
});
