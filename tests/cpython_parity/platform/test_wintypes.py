"""ctypes.wintypes aliases are importable on every platform."""

import ctypes
from ctypes import wintypes
import unittest


class TestWintypes(unittest.TestCase):
    def test_namespace(self):
        self.assertIsNotNone(wintypes)

    def test_integer_aliases(self):
        self.assertIs(wintypes.BYTE, ctypes.c_ubyte)
        self.assertIs(wintypes.WORD, ctypes.c_ushort)
        self.assertIs(wintypes.DWORD, ctypes.c_ulong)
        self.assertIs(wintypes.BOOL, ctypes.c_long)
        self.assertIs(wintypes.SHORT, ctypes.c_short)
        self.assertIs(wintypes.USHORT, ctypes.c_ushort)
        self.assertIs(wintypes.INT, ctypes.c_int)
        self.assertIs(wintypes.UINT, ctypes.c_uint)
        self.assertIs(wintypes.LONG, ctypes.c_long)
        self.assertIs(wintypes.ULONG, ctypes.c_ulong)
        self.assertIs(wintypes.ATOM, ctypes.c_ushort)
        self.assertIs(wintypes.COLORREF, ctypes.c_ulong)

    def test_handle_family(self):
        for name in ("HANDLE", "HWND", "HINSTANCE", "HMODULE", "HICON", "HCURSOR",
                     "HBRUSH", "HMENU", "HFONT", "HBITMAP", "HGDIOBJ", "HKEY",
                     "HDC", "HRGN", "LPVOID", "LPCVOID"):
            handle = getattr(wintypes, name)
            self.assertIs(handle, ctypes.c_void_p)
            self.assertEqual(ctypes.sizeof(handle), ctypes.sizeof(ctypes.c_void_p),
                             f"{name} has pointer-size")

    def test_string_pointers(self):
        self.assertIs(wintypes.LPSTR, ctypes.c_char_p)
        self.assertIs(wintypes.LPCSTR, ctypes.c_char_p)
        self.assertIs(wintypes.LPWSTR, ctypes.c_wchar_p)
        self.assertIs(wintypes.LPCWSTR, ctypes.c_wchar_p)

    def test_pointer_sized_ints(self):
        ps = ctypes.sizeof(ctypes.c_void_p)
        self.assertEqual(ctypes.sizeof(wintypes.WPARAM), ps)
        self.assertEqual(ctypes.sizeof(wintypes.LPARAM), ps)
        self.assertIs(wintypes.WPARAM, ctypes.c_size_t)
        self.assertIs(wintypes.LPARAM, ctypes.c_ssize_t)

    def test_character_types(self):
        self.assertIs(wintypes.CHAR, ctypes.c_char)
        self.assertIs(wintypes.WCHAR, ctypes.c_wchar)

    def test_pointer_types(self):
        self.assertIs(wintypes.LPDWORD, ctypes.POINTER(wintypes.DWORD))
        self.assertIs(wintypes.PDWORD, wintypes.LPDWORD)
        self.assertIs(wintypes.LPBYTE, ctypes.POINTER(wintypes.BYTE))
        self.assertIs(wintypes.PHKEY, ctypes.POINTER(wintypes.HKEY))
        self.assertIs(wintypes.LPRECT, ctypes.POINTER(wintypes.RECT))
        self.assertIs(wintypes.LPMSG, ctypes.POINTER(wintypes.MSG))
        n = wintypes.DWORD(7)
        p = ctypes.cast(ctypes.byref(n), wintypes.LPDWORD)
        self.assertEqual(p[0], 7)

    def test_structures(self):
        rect = wintypes.RECT(1, 2, 3, 4)
        self.assertEqual([rect.left, rect.bottom], [1, 4])
        self.assertEqual(ctypes.sizeof(wintypes.RECT), 4 * ctypes.sizeof(ctypes.c_long))
        self.assertIs(wintypes.tagRECT, wintypes.RECT)
        self.assertIs(wintypes.POINTL, wintypes.POINT)
        self.assertIs(wintypes.SIZEL, wintypes.SIZE)
        self.assertIsNone(wintypes.MSG().hWnd)
        self.assertEqual(wintypes.SMALL_RECT(1, 2, 3, 4).Bottom, 4)
        find = wintypes.WIN32_FIND_DATAW()
        find.cFileName = "notepad.exe"
        self.assertEqual(find.cFileName, "notepad.exe")
        self.assertEqual(wintypes.MAX_PATH, 260)
        self.assertEqual(wintypes.RGB(1, 2, 3), 0x030201)

    def test_variant_bool(self):
        v = wintypes.VARIANT_BOOL(True)
        self.assertIs(v.value, True)
        self.assertEqual(bytes(v), b"\xff\xff")
        self.assertEqual(ctypes.c_int16.from_buffer(v).value, -1)


if __name__ == "__main__":
    unittest.main()
