import os
import sys
import unittest

# Make the sdk package importable when run from this directory.
SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import load_workspace, validate_object
from alp_sdk.reader import AlpReader

REPO_ROOT = os.path.dirname(os.path.dirname(SDK_ROOT))
EXAMPLE_DIR = os.path.join(REPO_ROOT, 'examples', 'todo-app')


class TestLoadWorkspace(unittest.TestCase):
    def test_loads_nested_objects_recursively(self):
        # Regression: load_workspace must recurse into features/, workflows/,
        # rules/, etc. -- not just top-level .alp files.
        objects = load_workspace(EXAMPLE_DIR)
        self.assertGreater(len(objects), 0)

        ids = {obj.id for obj in objects}
        # Nested feature file must be discovered.
        self.assertIn('feat-user-auth', ids)
        self.assertIn('feat-task-management', ids)
        self.assertIn('todo-app', ids)

    def test_loads_all_expected_object_types(self):
        objects = load_workspace(EXAMPLE_DIR)
        types = {obj._type for obj in objects}
        for expected in ('project', 'feature', 'task', 'agent',
                         'decision', 'rule', 'memory', 'state', 'workflow'):
            self.assertIn(expected, types)


class TestValidation(unittest.TestCase):
    def test_all_example_objects_validate(self):
        objects = load_workspace(EXAMPLE_DIR)
        for obj in objects:
            # Should not raise.
            validate_object(obj._type, obj.properties)

    def test_invalid_object_raises(self):
        reader = AlpReader()
        # A task without an id is invalid.
        with self.assertRaises(Exception):
            objs = reader.parse("""
@task
  description: "Task without an ID"
""")
            for obj in objs:
                validate_object(obj._type, obj.properties)


if __name__ == '__main__':
    unittest.main()
