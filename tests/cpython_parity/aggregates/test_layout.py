"""Structure layouts, bitfields, inheritance and nested pointer ownership."""

import json
from pathlib import Path
import sys
import unittest
from ctypes import (
    Structure, Union, BigEndianStructure, BigEndianUnion, CDLL, sizeof, alignment, addressof, string_at,
    c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_char_p,
)

from .._support import LIBC


TYPES = {
    "u8": c_uint8, "u16": c_uint16, "u32": c_uint32, "u64": c_uint64,
    "i8": c_int8, "i16": c_int16, "i32": c_int32, "i64": c_int64,
}
CASES = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "layout_cases.json").read_text())


class TestLayout(unittest.TestCase):
    @unittest.skipIf(sys.version_info < (3, 14), "_layout_ and _align_ require Python 3.14+")
    def test_cases(self):
        for case in CASES:
            with self.subTest(case=case["name"]):
                if case.get("union"):
                    kind = BigEndianUnion if case.get("bigEndian") else Union
                else:
                    kind = BigEndianStructure if case.get("bigEndian") else Structure
                parent = kind
                if case.get("base"):
                    class Base(kind):
                        pass

                    if "pack" in case:
                        Base._pack_ = case["pack"]
                    if "layout" in case:
                        Base._layout_ = case["layout"]
                    if "align" in case:
                        Base._align_ = case["align"]
                    Base._fields_ = [(name, TYPES[kind_name], *bits) for name, kind_name, *bits in case["base"]]
                    parent = Base

                class S(parent):
                    pass

                if "pack" in case:
                    S._pack_ = case["pack"]
                if "layout" in case:
                    S._layout_ = case["layout"]
                if "align" in case:
                    S._align_ = case["align"]
                S._fields_ = [(name, TYPES[kind_name], *bits) for name, kind_name, *bits in case["fields"]]
                all_fields = case.get("base", []) + case["fields"]
                instance = S()
                for index, (name, kind_name, *bits) in enumerate(all_fields):
                    width = bits[0] if bits else sizeof(TYPES[kind_name]) * 8
                    value = (0x5A5A5A5A5A5A5A5A ^ (index * 0x0101010101010101)) & ((1 << width) - 1)
                    if kind_name.startswith("i") and value >= 1 << (width - 1):
                        value -= 1 << width
                    setattr(instance, name, value)
                expected = case["expected"]
                self.assertEqual(sizeof(S), expected["size"])
                self.assertEqual(alignment(S), expected["align"])
                self.assertEqual(string_at(addressof(instance), sizeof(instance)).hex(), expected["bytes"])
                if not case.get("union"):
                    self.assertEqual([str(int(getattr(instance, name))) for name, *_ in all_fields], expected["reads"])

    def test_inheritance(self):
        class Base(Structure):
            _fields_ = [("x", c_int32), ("y", c_int8)]

        class Derived(Base):
            _fields_ = [("z", c_int8)]

        class Same(Derived):
            pass

        self.assertEqual(sizeof(Base()), 8)
        d = Derived(1, 2, 3)
        self.assertEqual(sizeof(Derived), 12)
        self.assertEqual([d.x, d.y, d.z], [1, 2, 3])
        self.assertEqual(Derived.z.offset, 8)
        s = Same(4, 5, 6)
        self.assertEqual(sizeof(Same), 12)
        self.assertEqual([s.x, s.y, s.z], [4, 5, 6])

    def test_union_inheritance(self):
        class U(Union):
            _fields_ = [("a", c_uint16)]

        class U2(U):
            _fields_ = [("b", c_uint64)]

        u = U2()
        u.b = 0x0102030405060708
        self.assertEqual(sizeof(U2), 8)
        self.assertEqual(u.a, 0x0708)

    def test_full_width_bitfields(self):
        class B(Structure):
            _fields_ = [("u", c_uint32, 32), ("i", c_int32, 32)]

        b = B(0xFFFFFFFF, -1)
        self.assertEqual(b.u, 0xFFFFFFFF)
        self.assertEqual(b.i, -1)

        class W(Structure):
            _fields_ = [("wide", c_uint64, 64), ("narrow", c_int64, 40)]

        w = W()
        w.wide = 2**53 + 1
        w.narrow = -5
        self.assertEqual(w.wide, 2**53 + 1)
        self.assertEqual(w.narrow, -5)

    def test_struct_restype_is_instance(self):
        class DivT(Structure):
            _fields_ = [("quot", c_int32), ("rem", c_int32)]

        libc = CDLL(LIBC)
        libc.div.restype = DivT
        libc.div.argtypes = [c_int32, c_int32]
        r = libc.div(17, 5)
        self.assertIsInstance(r, DivT)
        self.assertEqual([r.quot, r.rem], [3, 2])
        self.assertEqual(sizeof(r), 8)

    def test_nested_keepalive(self):
        class Child(Structure):
            _fields_ = [("text", c_char_p)]

        class Outer(Structure):
            _fields_ = [("id", c_int32), ("child", Child)]

        outer = Outer()
        outer.child.text = b"kept with outer"
        self.assertEqual(outer.child.text, b"kept with outer")

    def test_bitfield_truncation(self):
        class B(Structure):
            _fields_ = [("v", c_uint32, 3)]

        self.assertEqual(B(15).v, 7)
        self.assertEqual(B(-1).v, 7)

    def test_copy_nested_keepalive(self):
        class Child(Structure):
            _fields_ = [("text", c_char_p)]

        class Outer(Structure):
            _fields_ = [("id", c_int32), ("child", Child)]

        source = Child(b"copied")
        outer = Outer()
        outer.child = source
        self.assertEqual(outer.child.text, b"copied")

    def test_self_assignment_keepalive(self):
        class Child(Structure):
            _fields_ = [("text", c_char_p)]

        class Outer(Structure):
            _fields_ = [("child", Child)]

        outer = Outer()
        outer.child.text = b"self"
        outer.child = outer.child
        self.assertEqual(outer.child.text, b"self")

    def test_array_keepalive_transfer(self):
        Strings = c_char_p * 2

        class Record(Structure):
            _fields_ = [("items", Strings)]

        class Value(Union):
            _fields_ = [("items", Strings)]

        source = Strings(b"one", b"two")
        for target in [Record(), Value()]:
            target.items = source
            self.assertEqual(list(target.items), [b"one", b"two"])
        nested = (Strings * 2)()
        nested[1] = source
        self.assertEqual(list(nested[1]), [b"one", b"two"])


if __name__ == "__main__":
    unittest.main()
