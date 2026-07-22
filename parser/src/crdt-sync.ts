export interface LWWElement {
  key: string;
  value: any;
  timestamp: number;
  peerId: string;
}

export interface CRDTState {
  docId: string;
  clock: number;
  addSet: Record<string, LWWElement>;
  removeSet: Record<string, number>; // key -> timestamp
}

export class CRDTSyncEngine {
  private states: Map<string, CRDTState> = new Map();

  public getOrCreateState(docId: string): CRDTState {
    let state = this.states.get(docId);
    if (!state) {
      state = {
        docId,
        clock: 0,
        addSet: {},
        removeSet: {},
      };
      this.states.set(docId, state);
    }
    return state;
  }

  public set(docId: string, peerId: string, key: string, value: any, timestamp?: number): CRDTState {
    const state = this.getOrCreateState(docId);
    const ts = timestamp || Date.now();
    state.clock += 1;

    state.addSet[key] = {
      key,
      value,
      timestamp: ts,
      peerId,
    };

    return state;
  }

  public remove(docId: string, key: string, timestamp?: number): CRDTState {
    const state = this.getOrCreateState(docId);
    const ts = timestamp || Date.now();
    state.clock += 1;
    state.removeSet[key] = ts;
    return state;
  }

  /**
   * Deterministically merge two CRDT states using LWW (Last-Write-Wins) semantics.
   */
  public merge(local: CRDTState, remote: CRDTState): CRDTState {
    const merged: CRDTState = {
      docId: local.docId,
      clock: Math.max(local.clock, remote.clock) + 1,
      addSet: { ...local.addSet },
      removeSet: { ...local.removeSet },
    };

    // Merge AddSet (LWW per key)
    Object.entries(remote.addSet).forEach(([key, remoteElem]) => {
      const localElem = merged.addSet[key];
      if (!localElem || remoteElem.timestamp > localElem.timestamp) {
        merged.addSet[key] = remoteElem;
      }
    });

    // Merge RemoveSet
    Object.entries(remote.removeSet).forEach(([key, remoteTs]) => {
      const localTs = merged.removeSet[key] || 0;
      merged.removeSet[key] = Math.max(localTs, remoteTs);
    });

    this.states.set(merged.docId, merged);
    return merged;
  }

  /**
   * Read converged document state where AddSet timestamp > RemoveSet timestamp.
   */
  public readState(docId: string): Record<string, any> {
    const state = this.getOrCreateState(docId);
    const result: Record<string, any> = {};

    Object.entries(state.addSet).forEach(([key, elem]) => {
      const tombstoneTs = state.removeSet[key] || 0;
      if (elem.timestamp >= tombstoneTs) {
        result[key] = elem.value;
      }
    });

    return result;
  }
}
