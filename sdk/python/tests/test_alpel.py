import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import (
    AlpelError,
    build_context,
    evaluate,
    evaluate_bool,
    interpolate,
    register_module,
    import_module,
)


class TestAlpelPrimitives(unittest.TestCase):
    def test_numbers_and_strings(self):
        self.assertEqual(evaluate("42", {}), 42)
        self.assertEqual(evaluate("3.14", {}), 3.14)
        self.assertEqual(evaluate("'hello'", {}), "hello")
        self.assertEqual(evaluate('"world"', {}), "world")

    def test_booleans_and_null(self):
        self.assertTrue(evaluate("true", {}))
        self.assertFalse(evaluate("false", {}))
        self.assertIsNone(evaluate("null", {}))


class TestAlpelComparison(unittest.TestCase):
    def test_equality(self):
        self.assertTrue(evaluate_bool("1 == 1", {}))
        self.assertFalse(evaluate_bool("1 == 2", {}))
        self.assertTrue(evaluate_bool("'a' == 'a'", {}))
        self.assertTrue(evaluate_bool("null == null", {}))

    def test_inequality(self):
        self.assertTrue(evaluate_bool("1 != 2", {}))
        self.assertTrue(evaluate_bool("1 < 2", {}))
        self.assertTrue(evaluate_bool("2 > 1", {}))
        self.assertTrue(evaluate_bool("1 <= 1", {}))
        self.assertTrue(evaluate_bool("1 >= 1", {}))

    def test_compare_strings(self):
        self.assertTrue(evaluate_bool("'abc' < 'abd'", {}))
        self.assertFalse(evaluate_bool("'abd' < 'abc'", {}))


class TestAlpelLogical(unittest.TestCase):
    def test_and_or(self):
        self.assertTrue(evaluate_bool("true && true", {}))
        self.assertFalse(evaluate_bool("true && false", {}))
        self.assertTrue(evaluate_bool("true || false", {}))
        self.assertFalse(evaluate_bool("false || false", {}))

    def test_not(self):
        self.assertFalse(evaluate_bool("!true", {}))
        self.assertTrue(evaluate_bool("!false", {}))


class TestAlpelMath(unittest.TestCase):
    def test_add_sub_mul_div(self):
        self.assertEqual(evaluate("1 + 2", {}), 3)
        self.assertEqual(evaluate("5 - 2", {}), 3)
        self.assertEqual(evaluate("3 * 4", {}), 12)
        self.assertEqual(evaluate("10 / 2", {}), 5)

    def test_string_concat(self):
        self.assertEqual(evaluate("'a' + 'b'", {}), "ab")

    def test_div_by_zero_raises(self):
        with self.assertRaises(AlpelError):
            evaluate("1 / 0", {})


class TestAlpelPropertyAccess(unittest.TestCase):
    def setUp(self):
        self.ctx = build_context({
            "_type": "task",
            "id": "t1",
            "feature": {"name": "auth", "metadata": {"k": "v"}},
            "priority": "critical",
            "tags": ["core", "ui"],
        })

    def test_dot_access(self):
        self.assertEqual(evaluate("feature.name", self.ctx), "auth")

    def test_bracket_str_access(self):
        self.assertEqual(evaluate("feature.metadata['k']", self.ctx), "v")

    def test_bracket_num_access(self):
        self.assertEqual(evaluate("tags[0]", self.ctx), "core")
        self.assertEqual(evaluate("tags[1]", self.ctx), "ui")

    def test_leading_type_key(self):
        self.assertEqual(evaluate("task.priority", self.ctx), "critical")

    def test_unknown_identifier_raises(self):
        with self.assertRaises(AlpelError):
            evaluate("nonexistent", self.ctx)


class TestAlpelCollections(unittest.TestCase):
    def test_contains_list(self):
        self.assertTrue(evaluate_bool("contains(tags, 'core')", {"tags": ["core", "ui"]}))

    def test_in_op(self):
        self.assertTrue(evaluate_bool("'a' in ['a', 'b']", {}))
        self.assertFalse(evaluate_bool("'c' in ['a', 'b']", {}))

    def test_in_string(self):
        self.assertTrue(evaluate_bool("'ell' in 'hello'", {}))


class TestAlpelBuiltins(unittest.TestCase):
    def test_length(self):
        self.assertEqual(evaluate("length('hello')", {}), 5)

    def test_to_upper_lower(self):
        self.assertEqual(evaluate("toUpper('ab')", {}), "AB")
        self.assertEqual(evaluate("toLower('AB')", {}), "ab")

    def test_starts_with(self):
        self.assertTrue(evaluate_bool("startsWith('file.txt', 'file')", {}))

    def test_size_is_empty(self):
        self.assertEqual(evaluate("size([1, 2, 3])", {}), 3)
        self.assertTrue(evaluate_bool("isEmpty([])", {}))
        self.assertFalse(evaluate_bool("isEmpty([1])", {}))

    def test_has_status(self):
        ctx = build_context({"_type": "feature", "id": "f", "tasks": [
            {"status": "[x]"}, {"status": "[ ]"}]})
        self.assertTrue(evaluate_bool("hasStatus(tasks, '[x]')", ctx))

    def test_unknown_function_raises(self):
        with self.assertRaises(AlpelError):
            evaluate("bogus(1)", {})


class TestAlpelDateBuiltins(unittest.TestCase):
    def test_now_returns_iso_string(self):
        result = evaluate("date.now()", {})
        self.assertIsInstance(result, str)
        self.assertRegex(result, r"^\d{4}-\d{2}-\d{2}T")

    def test_format_date_iso(self):
        self.assertEqual(
            evaluate("date.formatDate('2024-01-15T10:30:00Z', 'iso')", {}),
            "2024-01-15T10:30:00Z",
        )

    def test_format_date_date(self):
        self.assertEqual(
            evaluate("date.formatDate('2024-01-15T10:30:00Z', 'date')", {}),
            "2024-01-15",
        )

    def test_format_date_time(self):
        self.assertEqual(
            evaluate("date.formatDate('2024-01-15T10:30:00Z', 'time')", {}),
            "10:30:00",
        )

    def test_parse_date(self):
        result = evaluate("date.parseDate('2024-01-15T10:30:00Z')", {})
        self.assertIsInstance(result, str)

    def test_add_days(self):
        result = evaluate("date.addDays('2024-01-15T10:30:00Z', 5)", {})
        self.assertEqual(result, "2024-01-20T10:30:00+00:00")


class TestAlpelMathBuiltins(unittest.TestCase):
    def test_round(self):
        self.assertEqual(evaluate("math.round(3.7)", {}), 4)
        self.assertEqual(evaluate("math.round(3.2)", {}), 3)

    def test_floor(self):
        self.assertEqual(evaluate("math.floor(3.7)", {}), 3)
        self.assertEqual(evaluate("math.floor(3.2)", {}), 3)

    def test_ceil(self):
        self.assertEqual(evaluate("math.ceil(3.1)", {}), 4)
        self.assertEqual(evaluate("math.ceil(3.0)", {}), 3)

    def test_min_max(self):
        self.assertEqual(evaluate("math.min(3, 7)", {}), 3)
        self.assertEqual(evaluate("math.max(3, 7)", {}), 7)

    def test_abs(self):
        self.assertEqual(evaluate("math.abs(-5)", {}), 5)
        self.assertEqual(evaluate("math.abs(5)", {}), 5)


class TestAlpelCryptoBuiltins(unittest.TestCase):
    def test_sha256(self):
        result = evaluate("crypto.sha256('hello')", {})
        self.assertIsInstance(result, str)
        self.assertEqual(len(result), 64)
        self.assertRegex(result, r"^[0-9a-f]+$")

    def test_base64(self):
        self.assertEqual(evaluate("crypto.base64('hello')", {}), "aGVsbG8=")

    def test_base64_decode(self):
        self.assertEqual(evaluate("crypto.base64Decode('aGVsbG8=')", {}), "hello")


class TestAlpelStringBuiltins(unittest.TestCase):
    def test_trim(self):
        self.assertEqual(evaluate("string.trim('  hi  ')", {}), "hi")

    def test_replace(self):
        self.assertEqual(
            evaluate("string.replace('hello world', 'world', 'universe')", {}),
            "hello universe",
        )

    def test_split(self):
        self.assertEqual(
            evaluate("string.split('a,b,c', ',')", {}),
            ["a", "b", "c"],
        )

    def test_join(self):
        self.assertEqual(
            evaluate("string.join(['a', 'b'], '-')", {}),
            "a-b",
        )

    def test_ends_with(self):
        self.assertTrue(evaluate_bool("string.endsWith('file.txt', 'txt')", {}))
        self.assertFalse(evaluate_bool("string.endsWith('file.txt', 'csv')", {}))
        self.assertTrue(evaluate_bool("string.endsWith('file.txt', '')", {}))


class TestAlpelModules(unittest.TestCase):
    def test_import_shared_module(self):
        register_module("helpers", {
            "VERSION": "1.2.3",
            "GREETING": "hi",
            "POINTS": [1, 2, 3],
        })
        self.assertEqual(evaluate("import('helpers').VERSION", {}), "1.2.3")
        self.assertEqual(evaluate("import('helpers').POINTS.size", {}), 3)
        self.assertTrue(evaluate_bool("string.endsWith(import('helpers').GREETING, 'i')", {}))

    def test_import_missing_raises(self):
        with self.assertRaises(AlpelError):
            evaluate("import('missing').x", {})

    def test_import_module_api(self):
        register_module("cfg", {"a": 1})
        self.assertEqual(import_module("cfg")["a"], 1)
        with self.assertRaises(AlpelError):
            import_module("nope")


class TestAlpelInterpolation(unittest.TestCase):
    def setUp(self):
        self.ctx = build_context({
            "_type": "project",
            "id": "p",
            "name": "ALP",
            "version": "6.6.0",
            "environment": "prod",
        })

    def test_simple_interpolation(self):
        self.assertEqual(
            interpolate("Deploying ${ project.name } to ${ project.environment }", self.ctx),
            "Deploying ALP to prod",
        )

    def test_expression_interpolation(self):
        self.assertEqual(
            interpolate("dist/build-${ toLower(project.name) }-v${ project.version }.tar.gz", self.ctx),
            "dist/build-alp-v6.6.0.tar.gz",
        )

    def test_unknown_identifier_empty(self):
        self.assertEqual(interpolate("x=${ missing }", self.ctx), "x=")


class TestAlpelExamplesFromSpec(unittest.TestCase):
    def test_if_directive_condition(self):
        ctx = build_context({"_type": "feature", "id": "f",
                             "priority": "critical", "tasks": [1, 2]})
        self.assertTrue(evaluate_bool(
            "feature.priority == 'critical' && !isEmpty(feature.tasks)", ctx))

    def test_assertion_condition(self):
        ctx = build_context({"_type": "project", "id": "p", "state": "testing"})
        self.assertTrue(evaluate_bool("project.state == 'testing'", ctx))
        self.assertFalse(evaluate_bool("project.state == 'production'", ctx))


if __name__ == "__main__":
    unittest.main()
