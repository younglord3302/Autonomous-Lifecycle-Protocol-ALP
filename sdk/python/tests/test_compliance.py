import os
import sys
import shutil
import tempfile
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import (
    AlpParser,
    AlpReader,
    DirectiveError,
    run_suite,
    HarnessResult,
)


class TestAssertDirective(unittest.TestCase):
    def test_assert_true_parses(self):
        content = (
            '@project\n'
            '  id: p\n'
            '  status: production\n'
            '\n'
            '!assert: status == "production"\n'
        )
        objs = AlpReader().parse(content)
        self.assertEqual(objs[0].id, "p")

    def test_assert_false_raises(self):
        content = (
            '@project\n'
            '  id: p\n'
            '  status: development\n'
            '\n'
            '!assert: status == "production"\n'
        )
        with self.assertRaises(DirectiveError):
            AlpReader().parse(content)


class TestIfDirective(unittest.TestCase):
    def test_if_true_includes_next_object(self):
        content = (
            '@project\n'
            '  id: p\n'
            '  status: production\n'
            '\n'
            '!if: status == "production"\n'
            '\n'
            '@task\n'
            '  id: prod-task\n'
        )
        objs = AlpReader().parse(content)
        ids = {o.id for o in objs}
        self.assertIn("prod-task", ids)

    def test_if_false_excludes_next_object(self):
        content = (
            '@project\n'
            '  id: p\n'
            '  status: development\n'
            '\n'
            '!if: status == "production"\n'
            '\n'
            '@task\n'
            '  id: prod-task\n'
        )
        objs = AlpReader().parse(content)
        ids = {o.id for o in objs}
        self.assertNotIn("prod-task", ids)
        self.assertIn("p", ids)


class TestComplianceHarness(unittest.TestCase):
    def test_bundled_suite_all_pass(self):
        results = run_suite()
        self.assertGreater(len(results), 0)
        failures = [r for r in results if not r.passed]
        self.assertEqual(failures, [], f"compliance failures: {[(r.file, r.detail) for r in failures]}")

    def test_custom_suite_dir(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        os.makedirs(os.path.join(tmp, "valid"))
        os.makedirs(os.path.join(tmp, "invalid"))
        with open(os.path.join(tmp, "valid", "ok.alp"), "w", encoding="utf-8") as f:
            f.write("@project\n  id: p\n  name: \"P\"\n  version: 1.0.0\n  state: planning\n")
        with open(os.path.join(tmp, "invalid", "bad.alp"), "w", encoding="utf-8") as f:
            f.write("@task\n  description: \"no id\"\n")
        results = run_suite(suite_dir=tmp)
        self.assertEqual(len(results), 2)
        self.assertTrue(all(r.passed for r in results))

    def test_missing_suite_raises(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        with self.assertRaises(FileNotFoundError):
            run_suite(suite_dir=os.path.join(tmp, "does-not-exist"))

    def test_invalid_fixture_accepted_is_a_failure(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        os.makedirs(os.path.join(tmp, "invalid"))
        # This fixture is actually valid, so the harness must report a failure
        # because an "invalid" fixture was accepted by the parser.
        with open(os.path.join(tmp, "invalid", "actually-valid.alp"), "w", encoding="utf-8") as f:
            f.write("@project\n  id: p\n  name: \"P\"\n  version: 1.0.0\n  state: planning\n")
        results = run_suite(suite_dir=tmp)
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0].passed)


if __name__ == "__main__":
    unittest.main()
