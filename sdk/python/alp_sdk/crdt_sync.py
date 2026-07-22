import time
from typing import Dict, Any, Optional

class LWWElement:
    def __init__(self, key: str, value: Any, timestamp: float, peer_id: str):
        self.key = key
        self.value = value
        self.timestamp = timestamp
        self.peer_id = peer_id

class CRDTState:
    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self.clock = 0
        self.add_set: Dict[str, LWWElement] = {}
        self.remove_set: Dict[str, float] = {}

class CRDTSyncEngine:
    def __init__(self):
        self.states: Dict[str, CRDTState] = {}

    def get_or_create_state(self, doc_id: str) -> CRDTState:
        if doc_id not in self.states:
            self.states[doc_id] = CRDTState(doc_id)
        return self.states[doc_id]

    def set(self, doc_id: str, peer_id: str, key: str, value: Any, timestamp: Optional[float] = None) -> CRDTState:
        state = self.get_or_create_state(doc_id)
        ts = timestamp or time.time() * 1000
        state.clock += 1
        state.add_set[key] = LWWElement(key, value, ts, peer_id)
        return state

    def remove(self, doc_id: str, key: str, timestamp: Optional[float] = None) -> CRDTState:
        state = self.get_or_create_state(doc_id)
        ts = timestamp or time.time() * 1000
        state.clock += 1
        state.remove_set[key] = ts
        return state

    def merge(self, local: CRDTState, remote: CRDTState) -> CRDTState:
        merged = CRDTState(local.doc_id)
        merged.clock = max(local.clock, remote.clock) + 1
        merged.add_set = dict(local.add_set)
        merged.remove_set = dict(local.remove_set)

        for key, remote_elem in remote.add_set.items():
            local_elem = merged.add_set.get(key)
            if not local_elem or remote_elem.timestamp > local_elem.timestamp:
                merged.add_set[key] = remote_elem

        for key, remote_ts in remote.remove_set.items():
            local_ts = merged.remove_set.get(key, 0.0)
            merged.remove_set[key] = max(local_ts, remote_ts)

        self.states[merged.doc_id] = merged
        return merged

    def read_state(self, doc_id: str) -> Dict[str, Any]:
        state = self.get_or_create_state(doc_id)
        res = {}
        for key, elem in state.add_set.items():
            tombstone_ts = state.remove_set.get(key, 0.0)
            if elem.timestamp >= tombstone_ts:
                res[key] = elem.value
        return res
