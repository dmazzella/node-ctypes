"""Public lifetime contracts from common/test_call_lifetime.js.

GC timing, worker scheduling, explicit close/release and buffer ownership probes
remain in node_specific/test_call_lifetime_runtime.js.
"""

import ctypes as c
import unittest

from .._support import FIXTURE, LIBC


IntPointer = c.POINTER(c.c_int32)


class Record(c.Structure):
    _fields_ = [("p", IntPointer)]


class Value(c.Union):
    _fields_ = [("p", IntPointer)]


class TestCallLifetime(unittest.TestCase):
    def setUp(self):
        self.lib = c.CDLL(str(FIXTURE))

    def test_function_keeps_library_loaded(self):
        def bind():
            library = c.CDLL(LIBC)
            function = library.abs
            function.argtypes = [c.c_int32]
            function.restype = c.c_int32
            return function

        function = bind()
        self.assertEqual(function(-3), 3)
        self.assertEqual(function(-4), 4)

    def test_prototype_keeps_library_loaded(self):
        def bind():
            library = c.CDLL(LIBC)
            return c.CFUNCTYPE(c.c_int32, c.c_int32)(("abs", library))

        function = bind()
        self.assertEqual(function(-4), 4)
        self.assertEqual(function(-3), 3)

    def test_reentrant_bsearch(self):
        libc = c.CDLL(LIBC)
        search = libc.bsearch
        search.argtypes = [c.c_char_p, c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p]
        search.restype = c.c_void_p
        base = c.create_string_buffer(b"abc", 3)
        nested = False
        inner = []

        def compare(key, element):
            nonlocal nested
            if not nested:
                nested = True
                try:
                    inner.append(search(b"z", base, 3, 1, callback))
                finally:
                    nested = False
            return c.cast(key, c.POINTER(c.c_uint8))[0] - c.cast(element, c.POINTER(c.c_uint8))[0]

        callback = c.CFUNCTYPE(c.c_int32, c.c_void_p, c.c_void_p)(compare)
        found = search(b"b", base, 3, 1, callback)
        self.assertGreater(len(inner), 0)
        self.assertTrue(all(result is None for result in inner))
        self.assertEqual(found - c.addressof(base), 1)

    def test_converted_arguments_survive_native_entry(self):
        lib = self.lib

        class Temporary(c.c_void_p):
            @staticmethod
            def from_param(value):
                owner = c.create_string_buffer(b"A" * 4096)
                return c.cast(owner, c.POINTER(c.c_uint8))

        class Nested(c.c_void_p):
            @staticmethod
            def from_param(value):
                address = lib.fixture_address
                address.argtypes = [c.c_void_p]
                address.restype = c.c_size_t
                address(c.create_string_buffer(32))
                return None

        attribute = lib.fixture_first_char_after
        attribute.argtypes = [Temporary, Nested]
        attribute.restype = c.c_int32
        independent = c.CFUNCTYPE(c.c_int32, Temporary, Nested)(
            ("fixture_first_char_after", lib)
        )
        for function in [attribute, independent]:
            self.assertEqual(function(0, None), 65)

    def test_conversion_owner_survives_errcheck(self):
        addresses = []

        class Temporary(c.c_void_p):
            @staticmethod
            def from_param(value):
                owner = c.create_string_buffer(b"A" * 4096)
                addresses.append(c.addressof(owner))
                return c.cast(owner, c.POINTER(c.c_uint8))

        function = self.lib.fixture_first_char_after
        function.argtypes = [Temporary, c.c_void_p]
        function.restype = c.c_int32
        checked = []

        def check(result, invoked, arguments):
            checked.append((result, invoked is function, c.cast(addresses[-1], c.POINTER(c.c_uint8))[0]))
            return result

        function.errcheck = check
        self.assertEqual(function(0, None), 65)
        self.assertEqual(checked, [(65, True, 65)])

    def test_reuse_after_conversion_failure(self):
        fail = True

        class Temporary(c.c_void_p):
            @staticmethod
            def from_param(value):
                return c.cast(c.create_string_buffer(b"A" * 4096), c.POINTER(c.c_uint8))

        class Later(c.c_void_p):
            @staticmethod
            def from_param(value):
                if fail:
                    raise ValueError("conversion stopped")
                return None

        function = self.lib.fixture_first_char_after
        function.argtypes = [Temporary, Later]
        function.restype = c.c_int32
        with self.assertRaisesRegex(c.ArgumentError, "conversion stopped"):
            function(0, None)
        fail = False
        self.assertEqual(function(0, None), 65)

    def test_mutable_void_pointer_owner(self):
        def escape():
            owner = c.cast(c.pointer(c.c_int32(48)), c.c_void_p)
            derived = c.cast(owner, IntPointer)
            owner.value = None
            return derived

        pointer = escape()
        self.assertEqual(pointer[0], 48)

    def test_union_pointer_overlay(self):
        class Overlay(c.Union):
            _fields_ = [("p", IntPointer), ("bits", c.c_uint64)]

        overlay = Overlay()
        overlay.p = c.pointer(c.c_int32(42))
        self.assertEqual(overlay.p[0], 42)
        overlay.bits = 0
        self.assertIsNone(c.cast(overlay.p, c.c_void_p).value)

    def test_pointer_alias_assignments(self):
        def assign():
            holder = Record()
            alias = c.cast(c.pointer(holder), c.POINTER(Record))
            alias.contents.p = c.pointer(c.c_int32(61))
            return holder

        holder = assign()
        self.assertEqual(holder.p[0], 61)
        holder.p = None
        self.assertIsNone(c.cast(holder.p, c.c_void_p).value)

    def test_pointer_slot_assignments(self):
        def assign():
            slots = (IntPointer * 1)()
            alias = c.cast(slots, c.POINTER(IntPointer))
            alias[0] = c.pointer(c.c_int32(73))
            return slots

        slots = assign()
        self.assertEqual(slots[0][0], 73)
        slots[0] = None
        self.assertIsNone(c.cast(slots[0], c.c_void_p).value)

    def test_pointer_assignment_snapshots_pointee(self):
        def escape():
            original = c.c_int32(42)
            pointer = c.pointer(original)
            holder = Record()
            holder.p = pointer
            pointer.contents = c.c_int32(7)
            return holder, pointer, original

        holder, pointer, original = escape()
        self.assertEqual(original.value, 42)
        self.assertEqual(holder.p[0], 42)
        self.assertEqual(pointer[0], 7)

    def test_escaped_pointer_owners(self):
        def escape(kind):
            pointer = c.pointer(c.c_int32(42))
            if kind == "array":
                holder = (IntPointer * 1)(pointer)
                return holder[0]
            if kind == "double pointer":
                return c.pointer(pointer)[0]
            holder = Value() if kind == "union" else Record()
            holder.p = pointer
            return holder.p

        for kind in ["structure", "union", "array", "double pointer"]:
            result = escape(kind)
            self.assertEqual(result[0], 42, kind)

    def test_address_backed_contents_owner(self):
        def escape():
            owner = c.cast(c.pointer(c.c_int32(37)), c.c_void_p)
            pointer = c.cast(owner, IntPointer)
            return pointer.contents

        value = escape()
        self.assertEqual(value.value, 37)
        value.value = 38
        self.assertEqual(value.value, 38)

    def test_double_pointer_slot_repointing(self):
        first = c.c_int32(42)
        second = c.c_int32(7)
        pointer = c.pointer(first)
        double = c.pointer(pointer)
        self.assertEqual(c.cast(double, c.c_void_p).value, c.addressof(pointer))
        self.assertEqual(double[0][0], 42)
        double[0] = c.pointer(second)
        self.assertEqual(pointer[0], 7)
        self.assertEqual(double[0][0], 7)
