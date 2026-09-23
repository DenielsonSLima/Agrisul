import test from 'node:test';
import assert from 'node:assert/strict';
import {planAuthSessionTransition} from '../shared/supabase/authLifecycle.ts';

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
