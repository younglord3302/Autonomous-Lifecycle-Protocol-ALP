"""ALP Workspace model (v6.7.0 - Python SDK parity, spec/13).

Mirrors the TypeScript ``@alp/parser`` ``ExternalResolver`` / workspace
loading: discovers a ``@workspace`` from ``workspace.alp``, loads member
projects (local ``path``, Git ``url`` cached into ``.alp/.cache/projects``,
``glob`` discovery), resolves qualified ``-> project::object`` references
and fully-qualified ``-> ws::project::object`` cross-workspace references,
and builds the cross-project dependency supergraph (spec/13 §4–§5, §9).
"""

import os
import re
import subprocess
from typing import Any, Dict, List, Optional, Tuple

from .models import AlpObject
from .reader import AlpReader, AlpParser


QUALIFIED_RE = re.compile(r"^->\s*([a-z0-9-]+)::(.+)$")
CROSS_WORKSPACE_RE = re.compile(r"^->\s*([a-z0-9-]+)::([a-z0-9-]+)::(.+)$")

REF_FIELDS = ["depends_on", "blocked_by", "requires", "owner", "related"]


class WorkspaceError(Exception):
    """Fatal workspace load / resolution error (spec/13 §8.2)."""


class ProjectEntry:
    """A member project declaration from the workspace's ``projects`` list."""

    def __init__(
        self,
        project_id: str,
        path: Optional[str] = None,
        url: Optional[str] = None,
        glob: Optional[str] = None,
        branch: Optional[str] = None,
        commit: Optional[str] = None,
        description: Optional[str] = None,
        local_path: Optional[str] = None,
        fetched: bool = False,
    ):
        self.id = project_id
        self.path = path
        self.url = url
        self.glob = glob
        self.branch = branch
        self.commit = commit
        self.description = description
        self.local_path = local_path
        self.fetched = fetched

    def __repr__(self) -> str:
        return (
            f"ProjectEntry(id={self.id!r}, path={self.path!r}, "
            f"url={self.url!r}, glob={self.glob!r})"
        )


class CrossProjectReference:
    def __init__(
        self,
        source: str,
        raw: str,
        project: Optional[str],
        workspace: Optional[str],
        target: str,
        resolved: bool,
    ):
        self.source = source
        self.raw = raw
        self.project = project
        self.workspace = workspace
        self.target = target
        self.resolved = resolved

    def __repr__(self) -> str:
        return (
            f"CrossProjectReference(source={self.source!r}, "
            f"project={self.project!r}, target={self.target!r}, "
            f"resolved={self.resolved})"
        )


def _is_git_url(src: str) -> bool:
    return (
        src.startswith("http://")
        or src.startswith("https://")
        or src.startswith("git+http")
        or src.startswith("git@")
        or src.startswith("ssh://")
        or src.endswith(".git")
    )


def _parse_inline_map(raw: str) -> Dict[str, str]:
    """Parse an inline alp map entry such as ``{ path: "a", id: a }``.

    The Python reader keeps level-4 list items as raw strings, so member
    project declarations need this lightweight extraction (spec/13 §2.3).
    """
    inner = raw.strip()
    if inner.startswith("{"):
        inner = inner[1:]
    if inner.endswith("}"):
        inner = inner[:-1]
    out: Dict[str, str] = {}
    for part in inner.split(","):
        part = part.strip()
        if not part:
            continue
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and (
            (value.startswith('"') and value.endswith('"'))
            or (value.startswith("'") and value.endswith("'"))
        ):
            value = value[1:-1]
        out[key] = value
    return out


def _walk_alp(directory: str, parser: AlpParser) -> List[AlpObject]:
    """Recursively parse every ``.alp`` file under ``directory``."""
    out: List[AlpObject] = []
    if not os.path.isdir(directory):
        return out
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in (".runtime", ".cache")]
        for filename in files:
            if filename.endswith(".alp"):
                filepath = os.path.join(root, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        content = f.read()
                except (IsADirectoryError, PermissionError):
                    continue
                out.extend(parser.parse(content))
    return out


def _resolve_ref(raw: str) -> Tuple[Optional[str], Optional[str], str]:
    """Return ``(workspace_id, project_id, object_id)`` for a ``->`` ref.

    ``workspace_id`` is None unless the reference is fully qualified
    (``-> ws::project::object``). ``project_id`` is None for unqualified
    local references.
    """
    text = raw.strip()
    ws_match = CROSS_WORKSPACE_RE.match(text)
    if ws_match:
        return ws_match.group(1), ws_match.group(2), ws_match.group(3).strip()
    q_match = QUALIFIED_RE.match(text)
    if q_match:
        return None, q_match.group(1), q_match.group(2).strip()
    return None, None, text.replace("->", "", 1).strip()


class WorkspaceLoader:
    """Load and resolve an ALP workspace (spec/13)."""

    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self.alp_root = os.path.join(self.root, ".alp")
        self.parser = AlpParser()
        self.workspace_obj: Optional[AlpObject] = None
        self.projects: List[ProjectEntry] = []
        self.objects: Dict[str, AlpObject] = {}
        self.references: List[CrossProjectReference] = []
        self.dangling: List[CrossProjectReference] = []
        self.graph_edges: List[Tuple[str, str, str]] = []

    # ── Discovery (spec/13 §3.2) ──

    @classmethod
    def discover(cls, start_dir: str) -> Optional["WorkspaceLoader"]:
        """Walk up parent directories looking for ``.alp/workspace.alp``."""
        cur = os.path.abspath(start_dir)
        while True:
            candidate = os.path.join(cur, ".alp", "workspace.alp")
            if os.path.exists(candidate):
                return cls(cur)
            parent = os.path.dirname(cur)
            if parent == cur:
                return None
            cur = parent

    # ── Loading ──

    def load(self) -> "WorkspaceLoader":
        ws_path = os.path.join(self.alp_root, "workspace.alp")
        if not os.path.exists(ws_path):
            raise WorkspaceError(
                f"No workspace.alp found at {ws_path} (spec/13 §2.1)"
            )
        with open(ws_path, "r", encoding="utf-8") as f:
            ws_objects = self.parser.parse(f.read())
        ws = next((o for o in ws_objects if o._type == "workspace"), None)
        if ws is None:
            raise WorkspaceError("workspace.alp contains no @workspace object")
        self.workspace_obj = ws
        self._load_projects(ws)
        self._collect_objects()
        self._resolve_references()
        self._build_supergraph()
        self._validate()
        return self

    def _load_projects(self, ws: AlpObject) -> None:
        declared = ws.properties.get("projects") or []
        if not isinstance(declared, list):
            declared = [declared]
        seen_ids: set = set()
        for raw_entry in declared:
            # The reader keeps inline maps as raw strings: parse them.
            entry = _parse_inline_map(raw_entry) if isinstance(raw_entry, str) else dict(raw_entry)
            if not isinstance(entry, dict):
                continue
            pid = entry.get("id")
            path = entry.get("path")
            url = entry.get("url")
            glob = entry.get("glob")
            kinds = [k for k in (path, url, glob) if k]
            if len(kinds) != 1:
                raise WorkspaceError(
                    f"Project '{pid}' must declare exactly one of path/url/glob"
                )
            if pid in seen_ids:
                raise WorkspaceError(f"Duplicate project ID '{pid}' (spec/13 §2.3)")
            seen_ids.add(pid)

            local_path: Optional[str] = None
            fetched = False
            if path:
                local_path = os.path.join(self.root, path)
                if not os.path.exists(os.path.join(local_path, ".alp", "project.alp")):
                    raise WorkspaceError(
                        f"Member project '{pid}' has no .alp/project.alp at {local_path}"
                    )
            elif glob:
                pid = pid or f"glob:{glob}"
            else:  # url
                cache = os.path.join(self.alp_root, ".cache", "projects", str(pid))
                local_path = cache
                fetched = True
                self._fetch_repo(url, cache, entry.get("branch"), entry.get("commit"))

            self.projects.append(
                ProjectEntry(
                    project_id=str(pid),
                    path=path,
                    url=url,
                    glob=glob,
                    branch=entry.get("branch"),
                    commit=entry.get("commit"),
                    description=entry.get("description"),
                    local_path=local_path,
                    fetched=fetched,
                )
            )

    def _fetch_repo(self, url: str, cache: str, branch: Optional[str], commit: Optional[str]) -> None:
        if os.path.exists(cache):
            if not commit:
                try:
                    subprocess.run(["git", "fetch", "--quiet", "origin"], cwd=cache,
                                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    subprocess.run(["git", "reset", "--hard", branch or "origin/HEAD"], cwd=cache,
                                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except (OSError, subprocess.SubprocessError):
                    pass
            return
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        try:
            subprocess.run(["git", "clone", "--quiet", url, cache], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if commit:
                subprocess.run(["git", "checkout", "--quiet", commit], cwd=cache, check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            elif branch:
                subprocess.run(["git", "checkout", "--quiet", branch], cwd=cache, check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError) as e:
            raise WorkspaceError(f"Failed to fetch remote project '{url}': {e}")

    def _collect_objects(self) -> None:
        # Workspace-level objects (no project qualifier).
        ws_objs = _walk_alp(self.alp_root, self.parser)
        for o in ws_objs:
            if o._type in ("workspace", "repo"):
                continue
            if o.id:
                self.objects[o.id] = o

        # Member project objects, namespaced as "project::object".
        for proj in self.projects:
            if proj.local_path is None:
                continue
            proj_alp = os.path.join(proj.local_path, ".alp")
            for o in _walk_alp(proj_alp, self.parser):
                if o._type in ("workspace", "repo"):
                    continue
                key = f"{proj.id}::{o.id}"
                self.objects[key] = o

    def _resolve_references(self) -> None:
        for key, obj in self.objects.items():
            source_proj = key.split("::", 1)[0] if "::" in key else "local"
            for field in REF_FIELDS:
                value = obj.properties.get(field)
                if not value:
                    continue
                items = value if isinstance(value, list) else [value]
                for item in items:
                    raw = str(item).replace("->", "", 1).strip()
                    raw = raw.split("|", 1)[0].strip()
                    if "::" not in raw:
                        continue  # unqualified local ref — handled elsewhere
                    ws_id, proj_id, target = _resolve_ref(f"-> {raw}")
                    resolved = False
                    if ws_id:
                        # Cross-workspace: require a matching workspaces[] entry.
                        if self._known_workspace(ws_id) and f"{proj_id}::{target}" in self.objects:
                            resolved = True
                    elif proj_id:
                        if proj_id in {p.id for p in self.projects} or proj_id == source_proj:
                            resolved = f"{proj_id}::{target}" in self.objects
                        else:
                            # Unknown project qualifier is an error (spec §8.2).
                            raise WorkspaceError(
                                f"Unknown project qualifier '{proj_id}' in {raw!r} "
                                f"(workspace has no such project)"
                            )
                    ref = CrossProjectReference(
                        source=key, raw=f"-> {raw}", project=proj_id,
                        workspace=ws_id, target=target, resolved=resolved,
                    )
                    self.references.append(ref)
                    if not resolved:
                        self.dangling.append(ref)

    def _known_workspace(self, ws_id: str) -> bool:
        workspaces = self.workspace_obj.properties.get("workspaces") if self.workspace_obj else None
        if not workspaces:
            return False
        if isinstance(workspaces, list):
            return ws_id in {str(w) for w in workspaces}
        return str(workspaces) == ws_id

    def _build_supergraph(self) -> None:
        for ref in self.references:
            if not ref.resolved:
                continue
            target_key = (
                f"{ref.workspace}::{ref.project}::{ref.target}"
                if ref.workspace
                else f"{ref.project}::{ref.target}"
            )
            self.graph_edges.append((ref.source, target_key, "ref"))

    def _validate(self) -> None:
        # Cross-project cycle detection (spec/13 §5.2 step 3).
        adj: Dict[str, List[str]] = {}
        for src, tgt, _ in self.graph_edges:
            adj.setdefault(src, []).append(tgt)
        visited: set = set()
        stack: set = set()

        def dfs(node: str):
            visited.add(node)
            stack.add(node)
            for nxt in adj.get(node, []):
                if nxt not in visited:
                    dfs(nxt)
                elif nxt in stack:
                    raise WorkspaceError(
                        f"Cross-project circular dependency detected: "
                        f"{node} -> {nxt} (spec/13 §5.2)"
                    )
            stack.discard(node)

        for node in list(adj.keys()):
            if node not in visited:
                dfs(node)

    # ── Queries ──

    def get_project(self, project_id: str) -> Optional[ProjectEntry]:
        return next((p for p in self.projects if p.id == project_id), None)

    def objects_for_project(self, project_id: str) -> List[AlpObject]:
        return [o for k, o in self.objects.items() if k.startswith(f"{project_id}::")]

    def resolve(self, project_id: str, object_id: str) -> Optional[AlpObject]:
        return self.objects.get(f"{project_id}::{object_id}")
