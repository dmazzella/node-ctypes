"""Finalization on captured incomplete fields and materialized values."""

import unittest
from ctypes import Structure, Union, alignment, c_int32, c_int64, sizeof


class TestDescriptorFinalization(unittest.TestCase):
    def test_nested_incomplete_field_is_final(self):
        for base in [Structure, Union]:
            for child_base in [Structure, Union]:
                class Child(child_base):
                    pass

                class Parent(base):
                    _fields_ = [("child", Child)]

                # JS class definitions are lazy; sizeof is the shared materialization point.
                self.assertEqual(sizeof(Parent), 0)
                with self.assertRaisesRegex(AttributeError, "final"):
                    Child._fields_ = [("x", c_int32)]
                self.assertEqual(sizeof(Parent), 0)

    def test_materialized_incomplete_value_is_final(self):
        for base in [Structure, Union]:
            class Value(base):
                pass

            value = Value()
            with self.assertRaisesRegex(AttributeError, "final"):
                Value._fields_ = [("x", c_int32)]
            self.assertEqual(sizeof(value), 0)

    def test_defined_fields_are_final(self):
        for base in [Structure, Union]:
            class Value(base):
                _fields_ = [("x", c_int32)]

            self.assertEqual(sizeof(Value), 4)
            fields = Value._fields_
            with self.assertRaisesRegex(AttributeError, "final"):
                Value._fields_ = fields
            with self.assertRaisesRegex(AttributeError, "final"):
                Value._fields_ = [("y", c_int64)]
            value = Value(7)
            self.assertEqual(value.x, 7)
            self.assertEqual(sizeof(value), 4)

    def test_layout_queries_leave_incomplete_fields_open(self):
        for base in [Structure, Union]:
            class Value(base):
                pass

            self.assertEqual(sizeof(Value), 0)
            alignment(Value)
            Value._fields_ = [("x", c_int32)]
            self.assertEqual(sizeof(Value), 4)
            self.assertEqual(Value(7).x, 7)

    def test_subclass_fields_extend_final_base(self):
        class Base(Structure):
            _fields_ = [("x", c_int32)]

        self.assertEqual(sizeof(Base), 4)

        class Derived(Base):
            pass

        self.assertEqual(sizeof(Derived), 4)
        Derived._fields_ = [("y", c_int32)]
        self.assertEqual(sizeof(Derived), 8)
        value = Derived(1, 2)
        self.assertEqual([value.x, value.y], [1, 2])
        with self.assertRaisesRegex(AttributeError, "final"):
            Base._fields_ = [("z", c_int64)]

    def test_inherited_layout_instance_is_final(self):
        for base in [Structure, Union]:
            class Parent(base):
                _fields_ = [("x", c_int32)]

            class Value(Parent):
                pass

            value = Value(7)
            with self.assertRaisesRegex(AttributeError, "final"):
                Value._fields_ = [("y", c_int64)]
            self.assertEqual(value.x, 7)
            self.assertEqual(sizeof(value), 4)

    def test_exposed_field_list_mutation_does_not_change_layout(self):
        for base in [Structure, Union]:
            class Value(base):
                _fields_ = [("x", c_int32)]

            value = Value(7)
            Value._fields_[0] = ("y", c_int64)
            Value._fields_.append(("z", c_int64))
            self.assertEqual(sizeof(Value), 4)
            self.assertEqual(value.x, 7)
            self.assertFalse(hasattr(value, "y"))
            self.assertFalse(hasattr(value, "z"))
            next_value = Value()
            next_value.x = 8
            self.assertEqual(next_value.x, 8)


if __name__ == "__main__":
    unittest.main()
