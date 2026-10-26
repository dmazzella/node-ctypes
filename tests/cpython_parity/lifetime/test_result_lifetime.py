"""Owned by-value results migrated from common/test_result_lifetime."""

import ctypes as c
import unittest

from .._support import FIXTURE


class Point(c.Structure):
    _fields_ = [("x", c.c_int32), ("y", c.c_int32)]


class Polyline(c.Structure):
    _fields_ = [("count", c.c_int32), ("points", Point * 2)]


class Number(c.Union):
    _fields_ = [("scalar", c.c_int64), ("values", c.c_int32 * 2)]


class Large(c.Structure):
    _fields_ = [("values", c.c_int32 * 96)]


class TaggedValue(c.Union):
    _fields_ = [("f", c.c_float), ("i", c.c_int32)]


class Tagged(c.Structure):
    _fields_ = [("tag", c.c_int32), ("value", TaggedValue)]


class TestResultLifetime(unittest.TestCase):
    def setUp(self):
        self.library = c.CDLL(str(FIXTURE))

    def test_point_results(self):
        attribute = self.library.fixture_point_make
        attribute.argtypes = [c.c_int32, c.c_int32]
        attribute.restype = Point
        independent = c.CFUNCTYPE(Point, c.c_int32, c.c_int32)(
            ("fixture_point_make", self.library)
        )
        for make in [attribute, independent]:
            first = make(1, 2)
            self.assertIsInstance(first, Point)
            later = [make(seed, seed + 1) for seed in range(2, 34)]
            self.assertEqual([first.x, first.y], [1, 2])
            for seed, result in enumerate(later, 2):
                self.assertEqual([result.x, result.y], [seed, seed + 1])
            first.x = -100
            self.assertEqual([later[0].x, later[0].y], [2, 3])
            later[0].x = -101
            self.assertEqual([first.x, first.y], [-100, 2])
            self.assertEqual([make(100, 101).x, first.x], [100, -100])

    def test_nested_arrays(self):
        attribute = self.library.fixture_polyline_make
        attribute.argtypes = [c.c_int32]
        attribute.restype = Polyline
        independent = c.CFUNCTYPE(Polyline, c.c_int32)(("fixture_polyline_make", self.library))
        for make in [attribute, independent]:
            first = make(1)
            later = [make(seed) for seed in range(2, 34)]
            self.assertIsInstance(first, Polyline)
            self.assertEqual(
                [first.count, first.points[0].x, first.points[0].y, first.points[1].x, first.points[1].y],
                [2, 1, 2, 3, 4],
            )
            for seed, result in enumerate(later, 2):
                self.assertEqual(
                    [result.count, result.points[0].x, result.points[0].y, result.points[1].x, result.points[1].y],
                    [2, seed, seed + 1, seed + 2, seed + 3],
                )
            first.points[0].x = -100
            self.assertEqual(later[0].points[0].x, 2)
            later[0].points[0].x = -101
            self.assertEqual(first.points[0].x, -100)
            self.assertEqual(make(100).points[0].x, 100)
            self.assertEqual(first.points[0].x, -100)

    def test_union_arrays(self):
        attribute = self.library.fixture_return_union_make
        attribute.argtypes = [c.c_int32, c.c_int32]
        attribute.restype = Number
        independent = c.CFUNCTYPE(Number, c.c_int32, c.c_int32)(
            ("fixture_return_union_make", self.library)
        )
        for make in [attribute, independent]:
            first = make(1, 2)
            later = [make(seed, seed + 1) for seed in range(2, 34)]
            special = make(90, 91)
            self.assertIsInstance(first, Number)
            self.assertEqual(list(first.values), [1, 2])
            for seed, result in enumerate(later, 2):
                self.assertEqual(list(result.values), [seed, seed + 1])
            first.values[0] = -100
            self.assertEqual(list(special.values), [90, 91])
            self.assertEqual(list(later[0].values), [2, 3])
            later[0].values[0] = -101
            self.assertEqual(list(first.values), [-100, 2])
            self.assertEqual(list(make(100, 101).values), [100, 101])
            self.assertEqual(list(first.values), [-100, 2])

    def test_large_results(self):
        attribute = self.library.fixture_return_block_make
        attribute.argtypes = [c.c_int32]
        attribute.restype = Large
        independent = c.CFUNCTYPE(Large, c.c_int32)(("fixture_return_block_make", self.library))
        for make in [attribute, independent]:
            results = [make(seed) for seed in range(34)]
            for seed, result in enumerate(results):
                self.assertIsInstance(result, Large)
                self.assertEqual(list(result.values), list(range(seed, seed + 96)))
            results[0].values[0] = -100
            self.assertEqual(results[1].values[0], 1)
            self.assertEqual(list(make(100).values), list(range(100, 196)))
            self.assertEqual(results[0].values[0], -100)

    def test_tagged_union_results(self):
        attribute = self.library.fixture_tagged_make
        attribute.argtypes = [c.c_int32, c.c_int32]
        attribute.restype = Tagged
        independent = c.CFUNCTYPE(Tagged, c.c_int32, c.c_int32)(
            ("fixture_tagged_make", self.library)
        )
        for make in [attribute, independent]:
            first = make(0, 1)
            later = [make(0, seed) for seed in range(2, 34)]
            self.assertIsInstance(first, Tagged)
            self.assertEqual([first.tag, first.value.i], [0, 1])
            for seed, result in enumerate(later, 2):
                self.assertEqual([result.tag, result.value.i], [0, seed])
            first.value.i = -100
            self.assertEqual(later[0].value.i, 2)
            later[0].value.i = -101
            self.assertEqual(first.value.i, -100)
            self.assertEqual(make(0, 100).value.i, 100)

    def test_reentrant_errcheck(self):
        attribute = self.library.fixture_polyline_make
        attribute.argtypes = [c.c_int32]
        attribute.restype = Polyline
        independent = c.CFUNCTYPE(Polyline, c.c_int32)(("fixture_polyline_make", self.library))
        for make in [attribute, independent]:
            nested = []

            def check(result, function, arguments):
                if not nested:
                    nested.append(None)
                    nested[0] = function(90)
                return result

            make.errcheck = check
            first = make(1)
            self.assertEqual(first.points[0].x, 1)
            self.assertEqual(nested[0].points[0].x, 90)
            self.assertEqual(make(200).points[0].x, 200)
            self.assertEqual(first.points[0].x, 1)

    def test_paramflags_errcheck_results(self):
        make = c.CFUNCTYPE(Polyline, c.c_int32)(
            ("fixture_polyline_make", self.library), ((1, "seed"),)
        )
        make.errcheck = lambda result, function, arguments: result
        first = make(1)
        second = make(90)
        self.assertEqual(first.points[0].x, 1)
        self.assertEqual(second.points[0].x, 90)
        self.assertEqual(make(200).points[0].x, 200)
        self.assertEqual(first.points[0].x, 1)

    def test_nested_view_ownership(self):
        make = self.library.fixture_polyline_make
        make.argtypes = [c.c_int32]
        make.restype = Polyline

        def escape():
            return make(1).points

        points = escape()
        later = [make(seed) for seed in range(2, 34)]
        self.assertEqual([points[0].x, points[1].y], [1, 4])
        points[0].x = -100
        self.assertEqual(later[0].points[0].x, 2)
        self.assertEqual(points[0].x, -100)

    def test_long_string_results(self):
        make = self.library.fixture_point_make_tail
        make.argtypes = [c.c_int32, c.c_int32, c.c_char_p]
        make.restype = Point
        nested = []

        def check(result, function, arguments):
            if not nested:
                nested.append(None)
                nested[0] = function(90, 91, b"x" * 16384)
            return result

        make.errcheck = check
        first = make(1, 2, b"x" * 16384)
        self.assertEqual([first.x, first.y], [1, 2])
        self.assertEqual([nested[0].x, nested[0].y], [90, 91])
