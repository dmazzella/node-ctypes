"""
Test structure layout - reference behavior for test_layout.js

layout_cases.json holds the cases and the expected sizes, bytes and values
checked by test_layout.js; this file checks them against Python ctypes.
"""

import ctypes
import json
import pathlib
import sys
import unittest

TYPES = {
    "u8": ctypes.c_uint8,
    "u16": ctypes.c_uint16,
    "u32": ctypes.c_uint32,
    "u64": ctypes.c_uint64,
    "i8": ctypes.c_int8,
    "i16": ctypes.c_int16,
    "i32": ctypes.c_int32,
    "i64": ctypes.c_int64,
}

CASES = json.loads((pathlib.Path(__file__).parent / "layout_cases.json").read_text())


def field_value(index, kind, bits):
    width = bits or ctypes.sizeof(TYPES[kind]) * 8
    value = (0x5A5A5A5A5A5A5A5A ^ (index * 0x0101010101010101)) & ((1 << width) - 1)
    if kind.startswith("i") and value >= 1 << (width - 1):
        value -= 1 << width
    return value


def define_case(case):
    if case.get("union"):
        kind = ctypes.BigEndianUnion if case.get("bigEndian") else ctypes.Union
    else:
        kind = ctypes.BigEndianStructure if case.get("bigEndian") else ctypes.Structure
    attrs = {}
    if "pack" in case:
        attrs["_pack_"] = case["pack"]
    if "layout" in case:
        attrs["_layout_"] = case["layout"]
    if "align" in case:
        attrs["_align_"] = case["align"]

    def fields(entries):
        return [tuple([name, TYPES[kind_name]] + rest) for name, kind_name, *rest in entries]

    parent = kind
    if "base" in case:
        parent = type("Base", (kind,), dict(attrs, _fields_=fields(case["base"])))
    cls = type("S", (parent,), dict(attrs, _fields_=fields(case["fields"])))
    return cls, case.get("base", []) + case["fields"]


class TestLayout(unittest.TestCase):
    @unittest.skipIf(sys.version_info < (3, 14), "_layout_ and _align_ require Python 3.14+")
    def test_cases(self):
        for case in CASES:
            with self.subTest(case=case["name"]):
                cls, all_fields = define_case(case)
                instance = cls()
                for index, (name, kind, *bits) in enumerate(all_fields):
                    setattr(instance, name, field_value(index, kind, bits[0] if bits else None))
                expected = case["expected"]
                self.assertEqual(ctypes.sizeof(cls), expected["size"])
                self.assertEqual(ctypes.alignment(cls), expected["align"])
                self.assertEqual(bytes(instance).hex(), expected["bytes"])
                if not case.get("union"):
                    self.assertEqual([str(int(getattr(instance, name))) for name, *_ in all_fields], expected["reads"])

    def test_inheritance(self):
        class Base(ctypes.Structure):
            _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int8)]

        class Derived(Base):
            _fields_ = [("z", ctypes.c_int8)]

        class Same(Derived):
            pass

        self.assertEqual(ctypes.sizeof(Base()), 8)
        d = Derived(1, 2, 3)
        self.assertEqual(ctypes.sizeof(Derived), 12)
        self.assertEqual([d.x, d.y, d.z], [1, 2, 3])
        self.assertEqual(Derived.z.offset, 8)
        s = Same(4, 5, 6)
        self.assertEqual(ctypes.sizeof(Same), 12)
        self.assertEqual([s.x, s.y, s.z], [4, 5, 6])

    def test_union_inheritance(self):
        class U(ctypes.Union):
            _fields_ = [("a", ctypes.c_uint16)]

        class U2(U):
            _fields_ = [("b", ctypes.c_uint64)]

        u = U2()
        u.b = 0x0102030405060708
        self.assertEqual(ctypes.sizeof(U2), 8)
        self.assertEqual(u.a, 0x0708)

    def test_full_width_bitfields(self):
        class B(ctypes.Structure):
            _fields_ = [("u", ctypes.c_uint32, 32), ("i", ctypes.c_int32, 32)]

        b = B(0xFFFFFFFF, -1)
        self.assertEqual(b.u, 0xFFFFFFFF)
        self.assertEqual(b.i, -1)

        class W(ctypes.Structure):
            _fields_ = [("wide", ctypes.c_uint64, 64), ("narrow", ctypes.c_int64, 40)]

        w = W()
        w.wide = 2**53 + 1
        w.narrow = -5
        self.assertEqual(w.wide, 2**53 + 1)
        self.assertEqual(w.narrow, -5)

    def test_struct_restype_is_instance(self):
        class DivT(ctypes.Structure):
            _fields_ = [("quot", ctypes.c_int32), ("rem", ctypes.c_int32)]

        libc = ctypes.CDLL(None) if not hasattr(ctypes, "WinDLL") else ctypes.CDLL("msvcrt.dll")
        libc.div.restype = DivT
        libc.div.argtypes = [ctypes.c_int32, ctypes.c_int32]
        r = libc.div(17, 5)
        self.assertIsInstance(r, DivT)
        self.assertEqual([r.quot, r.rem], [3, 2])

    def test_nested_keepalive(self):
        class Child(ctypes.Structure):
            _fields_ = [("text", ctypes.c_char_p)]

        class Outer(ctypes.Structure):
            _fields_ = [("id", ctypes.c_int32), ("child", Child)]

        outer = Outer()
        outer.child.text = b"kept with outer"
        self.assertEqual(outer.child.text, b"kept with outer")
        self.assertTrue(outer._objects)


if __name__ == "__main__":
    unittest.main()
