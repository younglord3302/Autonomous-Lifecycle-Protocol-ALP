"""ALP MemoryMeshEngine — Agentic Memory Mesh & Distributed Knowledge Graph (v38.0.0 — Python SDK parity).

Provides cross-agent memory storage, sync, recency decay scoring,
and federated semantic retrieval across autonomous swarms.
"""
from __future__ import annotations

import math
import time
from typing import Any, Dict, List, Optional, Set


class MemoryNode:
    def __init__(
        self,
        node_id: str,
        agent_id: str,
        key: str,
        content: str,
        tags: Optional[List[str]] = None,
        vector: Optional[List[float]] = None,
        timestamp: Optional[float] = None,
        access_count: int = 1,
    ):
        self.id = node_id
        self.agent_id = agent_id
        self.key = key
        self.content = content
        self.tags = tags or []
        self.timestamp = timestamp or time.time()
        self.access_count = access_count
        self.last_accessed = time.time()
        self.vector = vector

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "agentId": self.agent_id,
            "key": self.key,
            "content": self.content,
            "tags": self.tags,
            "timestamp": self.timestamp,
            "accessCount": self.access_count,
            "lastAccessed": self.last_accessed,
            "vector": self.vector,
        }


class MemoryQueryResult:
    def __init__(self, node: MemoryNode, score: float, decay_factor: float):
        self.node = node
        self.score = score
        self.decay_factor = decay_factor

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node": self.node.to_dict(),
            "score": self.score,
            "decayFactor": self.decay_factor,
        }


class MemoryMeshStats:
    def __init__(self, total_memories: int, active_agents: int, tag_counts: Dict[str, int], average_age_hours: float):
        self.total_memories = total_memories
        self.active_agents = active_agents
        self.tag_counts = tag_counts
        self.average_age_hours = average_age_hours

    def to_dict(self) -> Dict[str, Any]:
        return {
            "totalMemories": self.total_memories,
            "activeAgents": self.active_agents,
            "tagCounts": self.tag_counts,
            "averageAgeHours": self.average_age_hours,
        }


class MemoryMeshEngine:
    def __init__(self):
        self.memories: Dict[str, MemoryNode] = {}
        self.decay_rate = 0.0000001

    def store_memory(
        self,
        node_id: str,
        agent_id: str,
        key: str,
        content: str,
        tags: Optional[List[str]] = None,
        vector: Optional[List[float]] = None,
    ) -> MemoryNode:
        now = time.time()
        existing = self.memories.get(node_id)
        node = MemoryNode(
            node_id=node_id,
            agent_id=agent_id,
            key=key,
            content=content,
            tags=tags or [],
            vector=vector,
            timestamp=existing.timestamp if existing else now,
            access_count=(existing.access_count + 1) if existing else 1,
        )
        self.memories[node_id] = node
        return node

    def query_memory_mesh(
        self, query: str, agent_id: Optional[str] = None, tag: Optional[str] = None, top_k: Optional[int] = None
    ) -> List[MemoryQueryResult]:
        now = time.time()
        query_lower = query.lower()
        keywords = [kw for kw in query_lower.split() if kw]
        results: List[MemoryQueryResult] = []

        for node in self.memories.values():
            if agent_id and node.agent_id != agent_id:
                continue
            if tag and tag not in node.tags:
                continue

            content_lower = f"{node.key} {node.content} {' '.join(node.tags)}".lower()
            match_score = sum(1.0 for kw in keywords if kw in content_lower)

            if match_score > 0:
                age_ms = (now - node.timestamp) * 1000
                decay_factor = math.exp(-self.decay_rate * age_ms)
                final_score = match_score * decay_factor * (1 + math.log(node.access_count))

                node.last_accessed = now
                node.access_count += 1

                results.append(
                    MemoryQueryResult(
                        node=node,
                        score=round(final_score, 3),
                        decay_factor=round(decay_factor, 3),
                    )
                )

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k] if top_k else results

    def sync_node_memories(self, target_agent_id: str, memory_nodes: List[MemoryNode]) -> int:
        synced = 0
        for node in memory_nodes:
            existing = self.memories.get(node.id)
            if not existing or existing.timestamp < node.timestamp:
                node.agent_id = target_agent_id
                self.memories[node.id] = node
                synced += 1
        return synced

    def get_mesh_stats(self) -> MemoryMeshStats:
        now = time.time()
        agents: Set[str] = set()
        tag_counts: Dict[str, int] = {}
        total_age_s = 0.0

        for node in self.memories.values():
            agents.add(node.agent_id)
            total_age_s += now - node.timestamp
            for t in node.tags:
                tag_counts[t] = tag_counts.get(t, 0) + 1

        count = len(self.memories)
        avg_age_hours = (total_age_s / count) / 3600.0 if count > 0 else 0.0

        return MemoryMeshStats(
            total_memories=count,
            active_agents=len(agents),
            tag_counts=tag_counts,
            average_age_hours=round(avg_age_hours, 2),
        )
