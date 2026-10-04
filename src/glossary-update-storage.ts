import { getMeta, writeMetaBatch } from './db';
import { UPDATE_STATE_KEY, snapshotKey, type GlossarySnapshot, type UpdateState, type UpdateStore } from './glossary-update';
export const updateStore:UpdateStore={
  state:async()=>await getMeta<UpdateState>(UPDATE_STATE_KEY)??{},
  snapshot:revision=>getMeta<GlossarySnapshot>(snapshotKey(revision)),
  commit:async(state,snapshot,remove=[])=>{
    const writes:{key:string;value:unknown}[]=[{key:UPDATE_STATE_KEY,value:state}];
    if(snapshot)writes.push({key:snapshotKey(snapshot.manifest.revision),value:snapshot});
    const keep=new Set([state.active,state.previous]);
    await writeMetaBatch(writes,remove.filter(r=>!keep.has(r)).map(snapshotKey));
  },
};
export function createSnapshotReader(){let revision:string|undefined,snapshot:GlossarySnapshot|undefined;
  return async()=>{const state=await updateStore.state();if(revision!==state.active){snapshot=state.active?await updateStore.snapshot(state.active):undefined;revision=state.active;}return snapshot;};
}
