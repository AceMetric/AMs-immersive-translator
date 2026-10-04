// @vitest-environment node
import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {updateStore,createSnapshotReader} from '../src/glossary-update-storage';
import {getMeta,putMeta,writeMetaBatch,putTerms,getUserTerms} from '../src/db';
import {UPDATE_STATE_KEY,type GlossarySnapshot} from '../src/glossary-update';
beforeEach(async()=>{vi.stubGlobal('crypto',webcrypto);await updateStore.commit({});});
const snapshot=(revision:string)=>({manifest:{revision},packs:{}} as GlossarySnapshot);
it('persists snapshots with their pointer while leaving user terms alone',async()=>{
 const personal={id:'personal-test',source:'mine',target:'我的译名',domain:'math',sense:'test',aliases:[],sourceUrl:'',license:'user',quality:'user',enabled:true} as const;
 await putTerms([{...personal,aliases:[]}]);const a=snapshot('a'),b=snapshot('b');
 await updateStore.commit({active:'a'},a);const reader=createSnapshotReader();expect((await reader())?.manifest.revision).toBe('a');
 await updateStore.commit({active:'b',previous:'a'},b);expect((await reader())?.manifest.revision).toBe('b');
 await updateStore.commit({active:undefined,previous:'b'},undefined,['a']);expect(await reader()).toBeUndefined();expect(await updateStore.snapshot('a')).toBeUndefined();expect(await updateStore.snapshot('b')).toEqual(b);expect((await getUserTerms()).find(t=>t.id==='personal-test')?.target).toBe(personal.target);
});
it('aborts the whole transaction on a failed snapshot write',async()=>{
 await putMeta('atomic-test','original');await expect(writeMetaBatch([{key:'atomic-test',value:'partial'},{key:'invalid-clone',value:()=>{}}])).rejects.toThrow();expect(await getMeta('atomic-test')).toBe('original');expect(await getMeta('invalid-clone')).toBeUndefined();
});
it('does not delete snapshots still referenced by rollback',async()=>{const a=snapshot('keep');await updateStore.commit({active:'keep'},a);await updateStore.commit({previous:'keep'},undefined,['keep']);expect(await updateStore.snapshot('keep')).toEqual(a);expect(await getMeta(UPDATE_STATE_KEY)).toEqual({previous:'keep'});});
