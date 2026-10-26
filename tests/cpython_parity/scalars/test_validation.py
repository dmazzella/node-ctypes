"""Validation through the public ctypes memory and cast APIs."""

import ctypes as c
import unittest


class TestValidation(unittest.TestCase):
    def test_empty_field_name(self):
        class Record(c.Structure):
            _fields_ = [("", c.c_int32)]
        record = Record()
        self.assertEqual(c.sizeof(Record), c.sizeof(c.c_int32))
        self.assertEqual(getattr(record, ""), 0)
        setattr(record, "", 7)
        self.assertEqual(getattr(record, ""), 7)

    def test_inherited_empty_field_names(self):
        for base in [c.Structure, c.Union, c.BigEndianStructure, c.BigEndianUnion]:
            for name in ["", " ", "\t"]:
                class Parent(base):
                    _fields_ = [(name, c.c_int32)]
                class Inherited(Parent):
                    pass
                class Child(Inherited):
                    _fields_ = [("extra", c.c_int32)]
                parent, inherited, child = Parent(3), Inherited(4), Child(5, 6)
                self.assertEqual(getattr(parent, name), 3)
                self.assertEqual(getattr(inherited, name), 4)
                self.assertEqual(getattr(child, name), 6 if issubclass(base, c.Union) else 5)
                setattr(child, name, 7)
                self.assertEqual(getattr(child, name), 7)
                self.assertEqual(child.extra, 7 if issubclass(base, c.Union) else 6)
                self.assertEqual(getattr(parent, name), 3)
                self.assertEqual(getattr(Inherited.from_buffer(inherited), name), 4)

    def test_inherited_prototype_field_names(self):
        for base in [c.Structure, c.Union]:
            for name in ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "toObject"]:
                class Parent(base):
                    _fields_ = [(name, c.c_int32)]
                class Inherited(Parent):
                    pass
                class Child(Inherited):
                    _fields_ = [("extra", c.c_int32)]
                parent, inherited, child = Parent(3), Inherited(4), Child(5, 6)
                self.assertEqual(getattr(parent, name), 3)
                self.assertEqual(getattr(inherited, name), 4)
                self.assertEqual(getattr(child, name), 6 if base is c.Union else 5)
                setattr(child, name, 7)
                self.assertEqual(getattr(child, name), 7)
                self.assertEqual(getattr(parent, name), 3)
                view = Parent.from_buffer(parent)
                self.assertEqual(getattr(view, name), 3)
                pointer = c.cast(c.byref(parent), c.POINTER(Parent))
                setattr(pointer.contents, name, 8)
                self.assertEqual(getattr(parent, name), 8)
                array = (Inherited * 1)()
                setattr(array[0], name, 9)
                self.assertEqual(getattr(array[0], name), 9)

    def test_anonymous_empty_field_name(self):
        class Item(c.Structure):
            _fields_ = [("value", c.c_int32)]
        for base in [c.Structure, c.Union, c.BigEndianStructure, c.BigEndianUnion]:
            class Parent(base):
                _anonymous_ = [""]
                _fields_ = [("", Item)]
            class Inherited(Parent):
                pass
            record = Inherited()
            record.value = 11
            self.assertEqual(getattr(record, "").value, 11)
            getattr(record, "").value = 12
            self.assertEqual(record.value, 12)

    def test_structure_from_buffer_size(self):
        class Point(c.Structure):
            _fields_ = [("x", c.c_int32), ("y", c.c_int32)]
        with self.assertRaises(ValueError):
            Point.from_buffer(c.create_string_buffer(4))

    def test_from_buffer_negative_offset(self):
        buffer = c.create_string_buffer(8)
        with self.assertRaises(ValueError):
            c.c_int32.from_buffer(buffer, -1)

    def test_from_buffer_read_bounds(self):
        buffer = c.create_string_buffer(4)
        with self.assertRaises(ValueError):
            c.c_int32.from_buffer(buffer, 2).value

    def test_from_buffer_write_bounds(self):
        buffer = c.create_string_buffer(4)
        with self.assertRaises(ValueError):
            c.c_int32.from_buffer(buffer, 2).value = 42
        self.assertEqual(c.c_int32.from_buffer(buffer).value, 0)

    def test_cast_arguments(self):
        with self.assertRaises(TypeError):
            c.cast(None, c.c_int32)
        with self.assertRaises(TypeError):
            c.cast(c.create_string_buffer(4), None)


if __name__ == "__main__":
    unittest.main()
