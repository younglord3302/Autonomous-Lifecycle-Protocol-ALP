import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import AlpReader, AlpParser, load_workspace, validate_object
from alp_sdk.error import SyntaxError as AlpSyntaxError, IndentationError as AlpIndentationError

REPO_ROOT = os.path.dirname(os.path.dirname(SDK_ROOT))
EXAMPLE_DIR = os.path.join(REPO_ROOT, "examples", "todo-app")


class TestReaderBasics(unittest.TestCase):
    def setUp(self):
        self.reader = AlpReader()

    def test_parses_top_level_object(self):
        objs = self.reader.parse("@project\n  id: demo\n  name: \"Demo\"\n")
        self.assertEqual(len(objs), 1)
        self.assertEqual(objs[0]._type, "project")
        self.assertEqual(objs[0].id, "demo")
        self.assertEqual(objs[0].properties["name"], "Demo")

    def test_parses_nested_blocks_and_lists(self):
        content = (
            "@task\n"
            "  id: t1\n"
            "  @accept\n"
            "    - alice\n"
            "    - bob\n"
            "  steps:\n"
            "    - step one\n"
            "    - step two\n"
        )
        objs = self.reader.parse(content)
        self.assertEqual(objs[0].properties["accept"], ["alice", "bob"])
        self.assertEqual(objs[0].properties["steps"], ["step one", "step two"])

    def test_directive_properties_normalized(self):
        objs = self.reader.parse("@task\n  id: t1\n  !fail-strategy: rollback\n")
        self.assertEqual(objs[0].properties["fail_strategy"], "rollback")

    def test_numeric_nested_properties(self):
        objs = self.reader.parse("@agent\n  id: a1\n  limits:\n    max_retries: 3\n")
        self.assertEqual(objs[0].properties["limits"]["max_retries"], 3)


class TestReaderStrictness(unittest.TestCase):
    """Parity with the TS @alp/parser reader (v5)."""

    def setUp(self):
        self.reader = AlpReader()

    def test_rejects_tabs(self):
        with self.assertRaises(AlpIndentationError):
            self.reader.parse("@project\n\tid: demo\n")

    def test_rejects_odd_indentation(self):
        with self.assertRaises(AlpIndentationError):
            self.reader.parse("@project\n   id: demo\n")  # 3 spaces
        with self.assertRaises(AlpIndentationError):
            self.reader.parse("@project\n id: demo\n")  # 1 space

    def test_rejects_unexpected_even_indent(self):
        with self.assertRaises(AlpIndentationError):
            self.reader.parse("@project\n      id: demo\n")  # 6 spaces, beyond level 2

    def test_rejects_uppercase_marker(self):
        with self.assertRaises(AlpSyntaxError):
            self.reader.parse("@Task\n  id: t1\n")

    def test_rejects_invalid_property(self):
        with self.assertRaises(AlpSyntaxError):
            self.reader.parse("@project\n  id demo no colon\n")

    def test_rejects_unclosed_string(self):
        with self.assertRaises(AlpSyntaxError):
            self.reader.parse("@project\n  name: \"Unclosed\n")

    def test_rejects_indent_outside_block(self):
        with self.assertRaises(AlpIndentationError):
            self.reader.parse("  stray: value\n")

    def test_error_carries_line_number(self):
        try:
            self.reader.parse("@project\n\tid: demo\n")
            self.fail("expected IndentationError")
        except AlpIndentationError as e:
            self.assertEqual(e.line, 2)


class TestAlpParser(unittest.TestCase):
    def test_parse_and_validate_accepts_valid(self):
        parser = AlpParser()
        objs = parser.parse_and_validate("@task\n  id: t1\n  description: \"x\"\n")
        self.assertEqual(len(objs), 1)

    def test_parse_and_validate_rejects_invalid(self):
        parser = AlpParser()
        with self.assertRaises(Exception):
            # A task without an id is invalid against its schema.
            parser.parse_and_validate("@task\n  description: \"no id\"\n")


class TestWorkspaceExamples(unittest.TestCase):
    """Conformance: the canonical example workspace parses and validates."""

    def test_examples_parse_and_validate(self):
        objects = load_workspace(EXAMPLE_DIR)
        self.assertGreater(len(objects), 0)
        ids = {obj.id for obj in objects}
        self.assertIn("todo-app", ids)
        self.assertIn("feat-user-auth", ids)
        for obj in objects:
            validate_object(obj._type, obj.properties)  # must not raise

    def test_examples_object_types_present(self):
        objects = load_workspace(EXAMPLE_DIR)
        types = {obj._type for obj in objects}
        for expected in ("project", "feature", "task", "agent", "decision", "rule", "memory", "state", "workflow"):
            self.assertIn(expected, types)


if __name__ == "__main__":
    unittest.main()
