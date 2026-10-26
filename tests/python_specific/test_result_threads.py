"""Original CPython native-thread reference for the Node async result matrix.

The schedule from common/test_result_lifetime.py is deliberately not simulated
in canonical parity. Its shared ownership assertions are TestResultLifetime.
test_large_results in cpython_parity/lifetime.
"""

import ctypes as c
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import unittest

SUFFIX = ".dll" if sys.platform == "win32" else ".dylib" if sys.platform == "darwin" else ".so"
FIXTURE = Path(__file__).resolve().parents[2] / "build" / "fixture" / f"ctypes_test_fixture{SUFFIX}"


class Large(c.Structure):
    _fields_ = [("values", c.c_int32 * 96)]


class TestResultLifetime(unittest.TestCase):
    def test_large_results_from_native_threads(self):
        library = c.CDLL(str(FIXTURE))
        make = library.fixture_return_block_make
        make.restype = Large
        make.argtypes = [c.c_int32]
        with ThreadPoolExecutor(max_workers=4) as workers:
            results = list(workers.map(make, range(16)))
        for seed, result in enumerate(results):
            self.assertEqual(list(result.values), list(range(seed, seed + 96)))
        results[0].values[0] = -100
        self.assertEqual(results[1].values[0], 1)
