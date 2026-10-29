import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_PRELOAD_RELOAD_COOLDOWN_MS,
  ASSET_PRELOAD_RELOAD_KEY,
  installAssetPreloadRecovery,
  isMissingNextStylesheet,
} from '../shared/runtime/assetPreloadRecovery.ts';

function createRuntime({online=true,stored=null,now=100_000,storageError=false}={}) {
  let listener;
  let rejectionListener;
  let reloads=0;
  let currentTime=now;
  const storage=new Map();
  if(stored!==null)storage.set(ASSET_PRELOAD_RELOAD_KEY,String(stored));
  const runtime={
    onPreloadError(next){listener=next;return()=>{if(listener===next)listener=undefined;}},
    onUnhandledRejection(next){rejectionListener=next;return()=>{if(rejectionListener===next)rejectionListener=undefined;}},
    isOnline(){return online},
    readStorage(key){if(storageError)throw new Error('storage blocked');return storage.get(key)??null},
    writeStorage(key,value){if(storageError)throw new Error('storage blocked');storage.set(key,value)},
    reload(){reloads++},
    now(){return currentTime},
  };
  return {
    runtime,
    emit(){const event=new Event('vite:preloadError',{cancelable:true});listener?.(event);return event},
    reject(reason){const event=new Event('unhandledrejection',{cancelable:true});Object.defineProperty(event,'reason',{value:reason});rejectionListener?.(event);return event},
    advance(milliseconds){currentTime+=milliseconds},
    get reloads(){return reloads},
    get listener(){return listener},
    get rejectionListener(){return rejectionListener},
  };
}

test('a failed Vite preload reloads once and prevents the stale error',()=>{
  const host=createRuntime();
  installAssetPreloadRecovery(host.runtime);
  const event=host.emit();
  assert.equal(host.reloads,1);
  assert.equal(event.defaultPrevented,true);
});

test('a missing Next CSS link reloads once and shares the Vite retry cooldown',()=>{
  const host=createRuntime();
  const dispose=installAssetPreloadRecovery(host.runtime);
  const event=host.reject(new Error('No link element found for chunk /_next/static/chunks/_03cjlkn._.css'));
  assert.equal(host.reloads,1);assert.equal(event.defaultPrevented,true);
  assert.equal(host.emit().defaultPrevented,false);assert.equal(host.reloads,1);
  assert.equal(host.reject(event.reason).defaultPrevented,false);assert.equal(host.reloads,1);
  host.advance(ASSET_PRELOAD_RELOAD_COOLDOWN_MS);
  assert.equal(host.reject(event.reason).defaultPrevented,true);assert.equal(host.reloads,2);
  dispose();assert.equal(host.listener,undefined);assert.equal(host.rejectionListener,undefined);
});

test('the cooldown persists in the next document rather than restarting a reload loop',()=>{
  const host=createRuntime({stored:99_999,now:100_000});installAssetPreloadRecovery(host.runtime);
  const event=host.reject(new Error('No link element found for chunk /_next/static/chunks/stale.css'));
  assert.equal(host.reloads,0);assert.equal(event.defaultPrevented,false);
});

test('only missing Next stylesheet links are recognized, including cache-busting URLs',()=>{
  for(const reason of [
    new Error('No link element found for chunk /_next/static/chunks/a.css'),
    'No link element found for chunk /_next/static/chunks/a.css?ts=100',
    {message:'No link element found for chunk https://example.com/_next/static/chunks/a.css'},
  ])assert.equal(isMissingNextStylesheet(reason),true);
  for(const reason of [undefined,null,42,{},new Error('RPC indisponível'),
    'No link element found for chunk /_next/static/chunks/a.js',
    'No link element found for chunk /api/document.css',
    'Validation failed: No link element found for chunk /_next/static/chunks/a.css',
    Object.defineProperty({},'message',{get(){throw Error('unreadable');}}),
  ]){
    assert.equal(isMissingNextStylesheet(reason),false);
    const host=createRuntime();installAssetPreloadRecovery(host.runtime);const event=host.reject(reason);
    assert.equal(host.reloads,0);assert.equal(event.defaultPrevented,false);
  }
});

test('Next CSS errors remain visible while offline or when session storage is blocked',()=>{
  for(const host of [createRuntime({online:false}),createRuntime({storageError:true})]){
    installAssetPreloadRecovery(host.runtime);
    const event=host.reject(new Error('No link element found for chunk /_next/static/chunks/a.css'));
    assert.equal(host.reloads,0);assert.equal(event.defaultPrevented,false);
  }
});

test('the session cooldown prevents a reload loop when the asset stays unavailable',()=>{
  const host=createRuntime();
  installAssetPreloadRecovery(host.runtime);
  host.emit();
  const repeated=host.emit();
  assert.equal(host.reloads,1);
  assert.equal(repeated.defaultPrevented,false);
  host.advance(ASSET_PRELOAD_RELOAD_COOLDOWN_MS);
  host.emit();
  assert.equal(host.reloads,2);
});

test('offline or storage-restricted browsers do not auto-reload',()=>{
  for(const host of [createRuntime({online:false}),createRuntime({storageError:true})]){
    const dispose=installAssetPreloadRecovery(host.runtime);
    const event=host.emit();
    assert.equal(host.reloads,0);
    assert.equal(event.defaultPrevented,false);
    dispose();
    assert.equal(host.listener,undefined);
  }
});
