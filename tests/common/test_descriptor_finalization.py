"""Reference finalization on captured fields and materialized values."""

import ctypes as c
import unittest


class TestDescriptorFinalization(unittest.TestCase):
    def test_nested_incomplete_field_is_final(self):
        for base in [c.Structure, c.Union]:
            class Child(c.Structure):
                pass
            class Parent(base):
                _fields_ = [("child", Child)]
            with self.assertRaisesRegex(AttributeError, "final"):
                Child._fields_ = [("x", c.c_int32)]
            self.assertEqual(c.sizeof(Parent), 0)

    def test_materialized_incomplete_value_is_final(self):
        class Value(c.Structure):
            pass
        value = Value()
        with self.assertRaisesRegex(AttributeError, "final"):
            Value._fields_ = [("x", c.c_int32)]
        self.assertEqual(c.sizeof(value), 0)


if __name__ == "__main__":
    unittest.main()
