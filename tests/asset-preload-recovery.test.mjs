import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_PRELOAD_RELOAD_COOLDOWN_MS,
  ASSET_PRELOAD_RELOAD_KEY,
  installAssetPreloadRecovery,
} from '../shared/runtime/assetPreloadRecovery.ts';

function createRuntime({online=true,stored=null,now=100_000,storageError=false}={}) {
  let listener;
  let reloads=0;
  let currentTime=now;
  const storage=new Map();
  if(stored!==null)storage.set(ASSET_PRELOAD_RELOAD_KEY,String(stored));
  const runtime={
    onPreloadError(next){listener=next;return()=>{if(listener===next)listener=undefined;}},
    isOnline(){return online},
    readStorage(key){if(storageError)throw new Error('storage blocked');return storage.get(key)??null},
    writeStorage(key,value){if(storageError)throw new Error('storage blocked');storage.set(key,value)},
    reload(){reloads++},
    now(){return currentTime},
  };
  return {
    runtime,
    emit(){const event=new Event('vite:preloadError',{cancelable:true});listener?.(event);return event},
    advance(milliseconds){currentTime+=milliseconds},
    get reloads(){return reloads},
    get listener(){return listener},
  };
}

test('a failed Vite preload reloads once and prevents the stale error',()=>{
  const host=createRuntime();
  installAssetPreloadRecovery(host.runtime);
  const event=host.emit();
  assert.equal(host.reloads,1);
  assert.equal(event.defaultPrevented,true);
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
