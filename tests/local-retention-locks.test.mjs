import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireWorldLease, withInactiveWorld, withRetentionLock} from '../lib/local-retention-locks.mjs';

test('an open world cannot be selected for deletion, even with the same id in other models', async () => {
  const state=new Map();
  const old=globalThis.navigator;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{async request(name,options,callback){
    if(name.includes(':global:')) return callback({name});
    const shared=state.get(name)||0;
    if(options.mode==='exclusive' && shared) return callback(null);
    if(options.mode==='shared') state.set(name,shared+1);
    try{return await callback({name});}finally{if(options.mode==='shared')state.set(name,(state.get(name)||1)-1);}
  }}}});
  try {
    const release=await withRetentionLock(()=>acquireWorldLease('v07','same-id'));
    assert.equal(await withRetentionLock(()=>withInactiveWorld('v07','same-id',()=>true)),null);
    assert.equal(await withRetentionLock(()=>withInactiveWorld('v08','same-id',()=>true)),true);
    await release();
    assert.equal(await withRetentionLock(()=>withInactiveWorld('v07','same-id',()=>true)),true);
  } finally {Object.defineProperty(globalThis,'navigator',{configurable:true,value:old});}
});
test('missing Web Locks fails closed', async () => {
  const old=globalThis.navigator;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
  try { await assert.rejects(withRetentionLock(()=>true),{code:'RETENTION_LOCK_UNAVAILABLE'}); }
  finally {Object.defineProperty(globalThis,'navigator',{configurable:true,value:old});}
});
