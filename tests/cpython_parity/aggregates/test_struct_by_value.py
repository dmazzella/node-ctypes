"""
struct-by-value come argtype/restype — Python ctypes baseline.

Esercita lo stesso pattern dell'adiacente test_struct_by_value.js usando
`libc.div` (POSIX / C standard):
    div_t div(int numer, int denom);
    struct div_t { int quot; int rem; };
"""

import ctypes
import unittest
from ctypes import CDLL, CFUNCTYPE, Structure, c_int

from .._support import LIBC


class DivT(Structure):
    _fields_ = [("quot", c_int), ("rem", c_int)]


class TestStructByValue(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.libc = CDLL(LIBC)
        cls.div = cls.libc.div
        cls.div.argtypes = [c_int, c_int]
        cls.div.restype = DivT

    def test_div_returns_struct(self):
        r = self.div(17, 5)
        self.assertEqual(r.quot, 3)
        self.assertEqual(r.rem, 2)

    def test_div_negative_numerator(self):
        r = self.div(-17, 5)
        # C standard: truncation toward zero → quot=-3, rem=-2
        self.assertEqual(r.quot, -3)
        self.assertEqual(r.rem, -2)

    def test_div_multiple_calls(self):
        a = self.div(100, 7)
        b = self.div(42, 6)
        self.assertEqual((a.quot, a.rem), (14, 2))
        self.assertEqual((b.quot, b.rem), (7, 0))


class TestStructByValueCompositeFields(unittest.TestCase):
    """Layout check per struct con field non-triviali (array, bitfield,
    array-di-Structure). Queste forme sono accettabili come argtype/restype
    in Python ctypes e il layout segue l'ABI C. I prototipi non vengono
    invocati: queste forme non dichiarano la firma di un simbolo C estraneo."""

    def test_array_field(self):
        IntArr4 = c_int * 4

        class S(Structure):
            _fields_ = [("n", c_int), ("items", IntArr4)]

        # Layout: 4 (n) + 16 (items) = 20
        self.assertEqual(ctypes.sizeof(S), 20)
        prototype = CFUNCTYPE(c_int, S)
        self.assertTrue(callable(prototype))

    def test_bitfield_field(self):
        class Flags(Structure):
            _fields_ = [("low", ctypes.c_uint32, 16), ("high", ctypes.c_uint32, 16)]

        self.assertEqual(ctypes.sizeof(Flags), 4)
        f = Flags()
        f.low = 0xAAAA
        f.high = 0xBBBB
        self.assertEqual(f.low, 0xAAAA)
        self.assertEqual(f.high, 0xBBBB)
        prototype = CFUNCTYPE(ctypes.c_uint32, Flags)
        self.assertTrue(callable(prototype))

    def test_array_of_struct_field(self):
        class Point(Structure):
            _fields_ = [("x", c_int), ("y", c_int)]

        PointArr3 = Point * 3

        class Polyline(Structure):
            _fields_ = [("count", c_int), ("pad", c_int), ("points", PointArr3)]

        # Layout: 4 + 4 + 3*8 = 32
        self.assertEqual(ctypes.sizeof(Polyline), 32)
        prototype = CFUNCTYPE(c_int, Polyline)
        self.assertTrue(callable(prototype))


if __name__ == "__main__":
    unittest.main()
