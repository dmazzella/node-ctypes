"""Synchronous hook snapshots from common/test_errcheck_lifetime.js."""

import ctypes as c
import sys
import unittest

from .._support import FIXTURE


class TestErrcheckLifetime(unittest.TestCase):
    def setUp(self):
        self.lib = c.CDLL(str(FIXTURE))

    def test_replacement_during_callback(self):
        attribute = self.lib.fixture_first_char_after
        attribute.argtypes = [c.c_char_p, c.c_void_p]
        attribute.restype = c.c_int32
        independent = c.CFUNCTYPE(c.c_int32, c.c_char_p, c.c_void_p)(
            ("fixture_first_char_after", self.lib)
        )
        for function in [attribute, independent]:
            identities = []
            nested = []

            def next_check(result, invoked, arguments):
                identities.append(invoked is function)
                return 202

            def old_check(result, invoked, arguments):
                identities.append(invoked is function)
                return 101

            def replace():
                function.errcheck = next_check
                nested.append(function(b"B", None))

            callback = c.CFUNCTYPE(None)(replace)
            for text in [b"A", b"A" * 2048]:
                function.errcheck = old_check
                self.assertEqual(function(text, c.cast(callback, c.c_void_p)), 101)
                self.assertEqual(nested[-1], 202)
                self.assertEqual(function(b"A", None), 202)
            self.assertEqual(identities, [True] * 6)

    def test_snapshot_precedes_from_param(self):
        function = None

        class Input:
            value = b"A"

        def next_check(result, invoked, arguments):
            return 202

        class Adapted(c.c_char_p):
            @staticmethod
            def from_param(value):
                function.errcheck = next_check
                return value.value

        attribute = self.lib.fixture_first_char_after
        attribute.argtypes = [Adapted, c.c_void_p]
        attribute.restype = c.c_int32
        independent = c.CFUNCTYPE(c.c_int32, Adapted, c.c_void_p)(
            ("fixture_first_char_after", self.lib)
        )
        for function in [attribute, independent]:
            value = Input()
            received = []

            def check(result, invoked, arguments):
                received.append((invoked is function, arguments[0] is value))
                return 101

            function.errcheck = check
            self.assertEqual(function(value, None), 101)
            self.assertEqual(function(value, None), 202)
            self.assertEqual(received, [(True, True)])
            del function.errcheck
            self.assertEqual(function(value, None), 65)

    def test_invalid_hook_preserves_current(self):
        attribute = self.lib.fixture_first_char_after
        attribute.argtypes = [c.c_char_p, c.c_void_p]
        attribute.restype = c.c_int32
        independent = c.CFUNCTYPE(c.c_int32, c.c_char_p, c.c_void_p)(
            ("fixture_first_char_after", self.lib)
        )
        for function in [attribute, independent]:
            function.errcheck = lambda result, invoked, arguments: 101
            with self.assertRaises(TypeError):
                function.errcheck = {}
            self.assertEqual(function(b"A", None), 101)

    def test_checked_variadic_arguments(self):
        function = self.lib.fixture_variadic_sum
        function.argtypes = [c.c_void_p, c.c_int32]
        function.restype = c.c_int32
        values = [None, 8, 1, 2, 3, 4, 5, 6, 7, 8]
        received = []

        def check(result, invoked, arguments):
            received.append((invoked is function, list(arguments)))
            return result

        function.errcheck = check
        self.assertEqual(function(*values), 36)
        self.assertEqual(received, [(True, values)])

    def test_paramflags_binding_independence(self):
        shared = self.lib.fixture_divmod
        shared.argtypes = [c.c_int32, c.c_int32, c.POINTER(c.c_int32)]
        shared.restype = c.c_int32
        shared.errcheck = lambda result, invoked, arguments: 303
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32))
        function = prototype(
            ("fixture_divmod", self.lib), ((1, "a"), (1, "b"), (2, "remainder"))
        )
        received = []

        def check(result, invoked, arguments):
            received.append((result, invoked is function, arguments[0], arguments[1]))
            return arguments

        function.errcheck = check
        self.assertEqual(function(17, 5), 2)
        output = c.c_int32()
        self.assertEqual(shared(17, 5, c.byref(output)), 303)
        self.assertEqual(output.value, 2)
        self.assertEqual(received, [(3, True, 17, 5)])

    def test_paramflags_output_instances(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32))
        function = prototype(
            ("fixture_divmod", self.lib), ((1, "a"), (1, "b"), (2, "remainder"))
        )
        received = []

        def check(result, invoked, arguments):
            received.append(
                (result, invoked is function, isinstance(arguments[2], c.c_int32), arguments[2].value)
            )
            return arguments

        function.errcheck = check
        self.assertEqual(function(17, 5), 2)
        self.assertEqual(received, [(3, True, True, 2)])

    def test_paramflags_hook_replacement(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32))
        function = prototype(
            ("fixture_divmod", self.lib), ((1, "a"), (1, "b"), (2, "remainder"))
        )

        def check(result, invoked, arguments):
            function.errcheck = lambda result, invoked, arguments: 202
            return arguments

        function.errcheck = check
        self.assertEqual(function(17, 5), 2)
        self.assertEqual(function(17, 5), 202)

    def test_paramflags_temporary_ownership(self):
        class Temporary(c.c_void_p):
            @staticmethod
            def from_param(value):
                return c.cast(c.create_string_buffer(b"A" * 4096), c.POINTER(c.c_uint8))

        function = c.CFUNCTYPE(c.c_size_t, Temporary)(
            ("fixture_address", self.lib), ((1, "value"),)
        )
        received = []

        def check(result, invoked, arguments):
            received.append((invoked is function, c.cast(result, c.POINTER(c.c_uint8))[0]))
            return result

        function.errcheck = check
        self.assertGreater(function(0), 0)
        self.assertEqual(received, [(True, 65)])

    @unittest.skipUnless(sys.platform == "win32", "OleDLL/HRESULT requires Windows")
    def test_hresult_precedes_errcheck(self):
        library = c.OleDLL(str(FIXTURE))
        function = c.WINFUNCTYPE(c.HRESULT, c.c_int32, c.c_int32, c.POINTER(c.c_int32))(
            ("fixture_divmod", library), ((1, "a"), (1, "b"), (2, "remainder"))
        )
        checks = []

        def check(result, invoked, arguments):
            checks.append(result)
            return arguments

        function.errcheck = check
        with self.assertRaises(OSError):
            function(-7, 2)
        self.assertEqual(checks, [])
        self.assertEqual(function(17, 5), 2)
        self.assertEqual(checks, [3])
