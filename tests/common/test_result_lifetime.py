"""Owned by-value results, independently checked against the C fixture."""

import ctypes as c
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import unittest

SUFFIX = ".dll" if sys.platform == "win32" else ".dylib" if sys.platform == "darwin" else ".so"
FIXTURE = Path(__file__).resolve().parents[2] / "build" / "fixture" / f"ctypes_test_fixture{SUFFIX}"


class Point(c.Structure):
    _fields_ = [("x", c.c_int32), ("y", c.c_int32)]


class Polyline(c.Structure):
    _fields_ = [("count", c.c_int32), ("points", Point * 2)]


class Number(c.Union):
    _fields_ = [("scalar", c.c_int64), ("values", c.c_int32 * 2)]


class Large(c.Structure):
    _fields_ = [("values", c.c_int32 * 96)]


@unittest.skipUnless(FIXTURE.exists(), "native fixture not built")
class TestResultLifetime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library = c.CDLL(str(FIXTURE))

    def test_nested_arrays(self):
        make = self.library.fixture_polyline_make
        make.restype = Polyline
        make.argtypes = [c.c_int32]
        first = make(1)
        later = [make(seed) for seed in range(2, 20)]
        self.assertEqual(first.points[0].x, 1)
        first.points[0].x = -100
        self.assertEqual(later[0].points[0].x, 2)

    def test_union_arrays(self):
        make = self.library.fixture_return_union_make
        make.restype = Number
        make.argtypes = [c.c_int32, c.c_int32]
        first = make(1, 2)
        later = make(90, 91)
        self.assertEqual(list(first.values), [1, 2])
        first.values[0] = -100
        self.assertEqual(list(later.values), [90, 91])

    def test_large_results_from_native_threads(self):
        make = self.library.fixture_return_block_make
        make.restype = Large
        make.argtypes = [c.c_int32]
        with ThreadPoolExecutor(max_workers=4) as workers:
            results = list(workers.map(make, range(16)))
        for seed, result in enumerate(results):
            self.assertEqual(list(result.values), list(range(seed, seed + 96)))
        results[0].values[0] = -100
        self.assertEqual(results[1].values[0], 1)

    def test_reentrant_errcheck(self):
        make = self.library.fixture_polyline_make
        make.restype = Polyline
        make.argtypes = [c.c_int32]
        nested = []

        def check(result, function, arguments):
            if not nested:
                nested.append(None)
                nested[0] = function(90)
            return result

        make.errcheck = check
        try:
            first = make(1)
            self.assertEqual(first.points[0].x, 1)
            self.assertEqual(nested[0].points[0].x, 90)
        finally:
            del make.errcheck


if __name__ == "__main__":
    unittest.main()
