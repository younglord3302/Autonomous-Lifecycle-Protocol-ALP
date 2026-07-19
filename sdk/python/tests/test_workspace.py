import os
import sys
import shutil
import tempfile
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import WorkspaceLoader, WorkspaceError, ProjectEntry
from alp_sdk.models import AlpObject


def _write(root, rel, content):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _obj(_type, oid, **props):
    data = {"_type": _type, "id": oid}
    data.update(props)
    return AlpObject.from_dict(data)


class TestWorkspaceLoader(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # Workspace root.
        _write(self.tmp, ".alp/workspace.alp", """
@workspace
  id: healthcare-platform
  name: "Healthcare Platform"
  projects:
    - { path: "services/auth-service", id: auth-service }
    - { path: "services/patient-service", id: patient-service }
""")
        # auth-service member project.
        _write(self.tmp, "services/auth-service/.alp/project.alp", """
@project
  id: auth-service
  name: "Auth Service"
""")
        _write(self.tmp, "services/auth-service/.alp/features/auth.alp", """
@task
  id: task-auth-api
  depends_on:
    - -> patient-service::task-patient-api | blocks
""")
        # patient-service member project.
        _write(self.tmp, "services/patient-service/.alp/project.alp", """
@project
  id: patient-service
  name: "Patient Service"
""")
        _write(self.tmp, "services/patient-service/.alp/features/patients.alp", """
@task
  id: task-patient-api
""")
        # Workspace-level shared agent.
        _write(self.tmp, ".alp/agents.alp", """
@agent
  id: agent-devops
  name: "DevOps"
""")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_discovers_and_loads(self):
        loader = WorkspaceLoader.discover(self.tmp)
        self.assertIsNotNone(loader)
        loader = loader.load()
        self.assertEqual(loader.workspace_obj.id, "healthcare-platform")
        self.assertEqual({p.id for p in loader.projects}, {"auth-service", "patient-service"})

    def test_namespaces_member_project_objects(self):
        loader = WorkspaceLoader(self.tmp).load()
        self.assertIsNotNone(loader.resolve("auth-service", "task-auth-api"))
        self.assertIsNotNone(loader.resolve("patient-service", "task-patient-api"))

    def test_workspace_level_objects_unqualified(self):
        loader = WorkspaceLoader(self.tmp).load()
        self.assertIn("agent-devops", loader.objects)

    def test_resolves_qualified_cross_project_reference(self):
        loader = WorkspaceLoader(self.tmp).load()
        # auth-service::task-auth-api -> patient-service::task-patient-api
        ref = next(
            r for r in loader.references
            if r.source == "auth-service::task-auth-api"
        )
        self.assertTrue(ref.resolved)
        self.assertEqual(ref.project, "patient-service")
        self.assertEqual(ref.target, "task-patient-api")

    def test_supergraph_edges_built(self):
        loader = WorkspaceLoader(self.tmp).load()
        edge = next(
            e for e in loader.graph_edges
            if e[0] == "auth-service::task-auth-api"
        )
        self.assertEqual(edge[1], "patient-service::task-patient-api")

    def test_objects_for_project(self):
        loader = WorkspaceLoader(self.tmp).load()
        auth_objs = loader.objects_for_project("auth-service")
        self.assertTrue(any(o.id == "task-auth-api" for o in auth_objs))

    def test_unknown_project_qualifier_raises(self):
        _write(self.tmp, "services/auth-service/.alp/features/auth.alp", """
@task
  id: task-auth-api
  depends_on:
    - -> ghost-project::task-x | blocks
""")
        with self.assertRaises(WorkspaceError):
            WorkspaceLoader(self.tmp).load()


class TestWorkspaceErrors(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_project_alp_raises(self):
        _write(self.tmp, ".alp/workspace.alp", """
@workspace
  id: ws
  name: "WS"
  projects:
    - { path: "missing", id: missing }
""")
        with self.assertRaises(WorkspaceError):
            WorkspaceLoader(self.tmp).load()

    def test_duplicate_project_id_raises(self):
        _write(self.tmp, ".alp/workspace.alp", """
@workspace
  id: ws
  name: "WS"
  projects:
    - { path: "a", id: dup }
    - { path: "b", id: dup }
""")
        _write(self.tmp, "a/.alp/project.alp", "@project\n  id: a\n")
        _write(self.tmp, "b/.alp/project.alp", "@project\n  id: b\n")
        with self.assertRaises(WorkspaceError):
            WorkspaceLoader(self.tmp).load()

    def test_no_workspace_alp_raises(self):
        with self.assertRaises(WorkspaceError):
            WorkspaceLoader(self.tmp).load()

    def test_discover_returns_none_without_workspace(self):
        self.assertIsNone(WorkspaceLoader.discover(self.tmp))


class TestCrossProjectCycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        _write(self.tmp, ".alp/workspace.alp", """
@workspace
  id: ws
  name: "WS"
  projects:
    - { path: "a", id: a }
    - { path: "b", id: b }
""")
        _write(self.tmp, "a/.alp/project.alp", "@project\n  id: a\n")
        _write(self.tmp, "a/.alp/t.alp", """
@task
  id: t-a
  depends_on:
    - -> b::t-b | blocks
""")
        _write(self.tmp, "b/.alp/project.alp", "@project\n  id: b\n")
        _write(self.tmp, "b/.alp/t.alp", """
@task
  id: t-b
  depends_on:
    - -> a::t-a | blocks
""")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_cycle_raises(self):
        with self.assertRaises(WorkspaceError):
            WorkspaceLoader(self.tmp).load()


if __name__ == "__main__":
    unittest.main()
