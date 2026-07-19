"""ALP graph engine (v6.4.0 - Python SDK parity).

Mirrors the TypeScript ``@alp/parser`` ``AlpGraph``: builds a DAG from parsed
ALP objects, resolves ``-> ref`` edges, detects cycles, and supports
topological sort plus impact/blocker queries.
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from .models import AlpObject


class GraphNode:
    def __init__(self, id: str, type: str, object: AlpObject):
        self.id = id
        self.type = type
        self.object = object

    def __repr__(self) -> str:
        return f"GraphNode(id={self.id!r}, type={self.type!r})"


class GraphEdge:
    TYPES = ("blocks", "requires", "extends", "uses", "implements", "references")

    def __init__(self, source: str, target: str, type: str):
        self.source = source
        self.target = target
        self.type = type

    def __repr__(self) -> str:
        return f"GraphEdge({self.source} -{self.type}-> {self.target})"


def _infer_edge_type(key: str) -> str:
    if key in ("depends_on", "blocked_by"):
        return "blocks"
    if key == "requires":
        return "requires"
    if key == "extends":
        return "extends"
    if key == "uses":
        return "uses"
    if key == "implements":
        return "implements"
    return "references"


class AlpGraph:
    """Build and query the ALP dependency graph."""

    def __init__(self) -> None:
        self.nodes: Dict[str, GraphNode] = {}
        self.edges: List[GraphEdge] = []

    def build_graph(self, objects: List[AlpObject]) -> None:
        self.nodes.clear()
        self.edges = []

        for obj in objects:
            if obj.id:
                self.nodes[obj.id] = GraphNode(obj.id, obj._type, obj)

        for obj in objects:
            if not obj.id:
                continue
            for key, value in obj.properties.items():
                if key in ("_type", "id"):
                    continue
                if isinstance(value, str) and value.startswith("-> "):
                    target = value[3:].strip()
                    self.edges.append(
                        GraphEdge(obj.id, target, _infer_edge_type(key))
                    )
                elif isinstance(value, list):
                    etype = _infer_edge_type(key)
                    for item in value:
                        if isinstance(item, str) and item.startswith("-> "):
                            target = item[3:].strip()
                            self.edges.append(GraphEdge(obj.id, target, etype))

    def detect_cycles(self) -> None:
        """Raise ``ValueError`` if a cycle exists among blocks/requires edges."""
        visited: Set[str] = set()
        stack: Set[str] = set()
        path: List[str] = []

        def dfs(node_id: str) -> None:
            visited.add(node_id)
            stack.add(node_id)
            path.append(node_id)
            for edge in self.edges:
                if edge.source == node_id and edge.type in ("blocks", "requires"):
                    if edge.target not in visited:
                        dfs(edge.target)
                    elif edge.target in stack:
                        start = path.index(edge.target)
                        cycle = path[start:] + [edge.target]
                        raise ValueError(
                            "Dependency cycle detected: " + " → ".join(cycle)
                        )
            path.pop()
            stack.discard(node_id)

        for node_id in list(self.nodes.keys()):
            if node_id not in visited:
                dfs(node_id)

    def topological_sort(self) -> List[GraphNode]:
        """Return nodes in execution order (Kahn's algorithm)."""
        ordering = [e for e in self.edges if e.type in ("blocks", "requires")]
        out_degree: Dict[str, int] = {nid: 0 for nid in self.nodes}
        for edge in ordering:
            if edge.source in out_degree:
                out_degree[edge.source] += 1

        queue: List[str] = [nid for nid, deg in out_degree.items() if deg == 0]
        sorted_nodes: List[GraphNode] = []
        while queue:
            current = queue.pop(0)
            node = self.nodes.get(current)
            if node:
                sorted_nodes.append(node)
            for edge in ordering:
                if edge.target == current and edge.source in out_degree:
                    out_degree[edge.source] -= 1
                    if out_degree[edge.source] == 0:
                        queue.append(edge.source)
        return sorted_nodes

    def get_impact(self, node_id: str) -> List[GraphNode]:
        """All downstream nodes affected by a change to ``node_id``."""
        impacted: Set[str] = set()
        queue = [node_id]
        while queue:
            current = queue.pop(0)
            for edge in self.edges:
                if edge.target == current and edge.source != node_id:
                    if edge.source not in impacted:
                        impacted.add(edge.source)
                        queue.append(edge.source)
        return [n for n in (self.nodes.get(i) for i in impacted) if n is not None]

    def get_blockers(self, node_id: str) -> List[GraphNode]:
        """All upstream nodes that must complete before ``node_id``."""
        blockers: Set[str] = set()
        queue = [node_id]
        while queue:
            current = queue.pop(0)
            for edge in self.edges:
                if edge.source == current and edge.type in ("blocks", "requires"):
                    if edge.target != node_id and edge.target not in blockers:
                        blockers.add(edge.target)
                        queue.append(edge.target)
        return [n for n in (self.nodes.get(i) for i in blockers) if n is not None]

    def to_text_tree(self) -> str:
        lines: List[str] = []
        for node in self.topological_sort():
            status = node.object.properties.get("status", "")
            lines.append(f"{status} @{node.type} {node.id}")
            for edge in self.edges:
                if edge.source == node.id:
                    lines.append(f"    → {edge.target} ({edge.type})")
        return "\n".join(lines)
