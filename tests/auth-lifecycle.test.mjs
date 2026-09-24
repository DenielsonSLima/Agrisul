import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  canApplyAccessCheck,
  planAuthSessionTransition,
  shouldRefreshAccessForMembershipChange,
} from '../shared/supabase/authLifecycle.ts';

const dataProviderSource=readFileSync(new URL('../shared/query/DataProvider.tsx',import.meta.url),'utf8');

test('same-user auth notifications preserve the mounted workspace and its drafts',()=>{
  // Supabase can report SIGNED_IN on tab refocus and TOKEN_REFRESHED in the
  // background. Both carry the same user identity.
  const transition=planAuthSessionTransition('user-a','user-a');
  assert.deepEqual(transition,{
    identityChanged:false,
    clearQueryCache:false,
    blockForAccessValidation:false,
  });
});

test('a real account change still clears cache and blocks until access is checked',()=>{
  assert.deepEqual(planAuthSessionTransition('user-a','user-b'),{
    identityChanged:true,
    clearQueryCache:true,
    blockForAccessValidation:true,
  });
});

test('sign-out clears the previous account without starting access validation',()=>{
  assert.deepEqual(planAuthSessionTransition('user-a',null),{
    identityChanged:true,
    clearQueryCache:true,
    blockForAccessValidation:false,
  });
});

test('initial signed-in session is validated before mounting the workspace',()=>{
  assert.deepEqual(planAuthSessionTransition(null,'user-a'),{
    identityChanged:true,
    clearQueryCache:true,
    blockForAccessValidation:true,
  });
});

test('only the newest access check for the current identity can update auth state',()=>{
  assert.equal(canApplyAccessCheck(3,3,'user-a','user-a'),true);
  assert.equal(canApplyAccessCheck(2,3,'user-a','user-a'),false);
  assert.equal(canApplyAccessCheck(3,3,'user-a','user-b'),false);
});

test('membership changes revalidate access only for the signed-in user',()=>{
  assert.equal(shouldRefreshAccessForMembershipChange('user-a',{
    eventType:'INSERT',
    new:{user_id:'user-a'},
    old:{},
  }),true);
  assert.equal(shouldRefreshAccessForMembershipChange('user-a',{
    eventType:'UPDATE',
    new:{user_id:'user-a'},
    old:{user_id:'user-a'},
  }),true);
  assert.equal(shouldRefreshAccessForMembershipChange('user-a',{
    eventType:'UPDATE',
    new:{user_id:'user-b'},
    old:{user_id:'user-b'},
  }),false);
});

test('membership deletes with an identifiable owner ignore unrelated users',()=>{
  assert.equal(shouldRefreshAccessForMembershipChange('user-a',{
    eventType:'DELETE',
    new:{},
    old:{user_id:'user-a'},
  }),true);
  assert.equal(shouldRefreshAccessForMembershipChange('user-a',{
    eventType:'DELETE',
    new:{},
    old:{user_id:'user-b'},
  }),false);
});

test('membership deletes without user_id conservatively revalidate access',()=>{
  // Under RLS, Supabase may expose only the primary key in payload.old.
  assert.equal(shouldRefreshAccessForMembershipChange('user-a',{
    eventType:'DELETE',
    new:{},
    old:{id:'membership-id'},
  }),true);
});

test('connection recovery revalidates data and access without access polling',()=>{
  assert.match(dataProviderSource,/const revalidateAfterConnectionRecovery=\(\)=>\{\s*invalidateAll\(\);\s*enqueueAccessRefresh\(\);\s*\};/);
  assert.match(dataProviderSource,/if\(status==='SUBSCRIBED'\)[\s\S]*?revalidateAfterConnectionRecovery\(\);/);
  assert.match(dataProviderSource,/window\.addEventListener\('online',revalidateAfterConnectionRecovery\);/);
  assert.match(dataProviderSource,/recovery=setInterval\(invalidateAll,30000\)/);
  assert.doesNotMatch(dataProviderSource,/recovery=setInterval\(revalidateAfterConnectionRecovery,30000\)/);
});
