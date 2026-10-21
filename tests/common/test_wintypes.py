"""
ctypes.wintypes alias check — Python baseline.

Esercita la stessa semantica di tests/common/test_wintypes.js:
verifica che gli alias Win32 comuni (BYTE, WORD, DWORD, HANDLE, HWND,
LPARAM, ...) puntino al tipo primitivo corretto.

`ctypes.wintypes` esiste cross-platform anche se le API Win32 sono
ovviamente utili solo su Windows — gli alias sono importabili ovunque.
"""

import ctypes
from ctypes import wintypes
import unittest


class TestWintypes(unittest.TestCase):
    def test_integer_aliases(self):
        self.assertIs(wintypes.BYTE, ctypes.c_ubyte)
        self.assertIs(wintypes.WORD, ctypes.c_ushort)
        self.assertIs(wintypes.DWORD, ctypes.c_ulong)
        # BOOL è typedef int → c_long su Win (LLP64), c_int su altre platform.
        # Python ctypes.wintypes.BOOL = c_int. Accettiamo entrambi.
        self.assertIn(wintypes.BOOL, (ctypes.c_int, ctypes.c_long))
        self.assertIs(wintypes.SHORT, ctypes.c_short)
        self.assertIs(wintypes.USHORT, ctypes.c_ushort)
        self.assertIs(wintypes.INT, ctypes.c_int)
        self.assertIs(wintypes.UINT, ctypes.c_uint)
        self.assertIs(wintypes.LONG, ctypes.c_long)
        self.assertIs(wintypes.ULONG, ctypes.c_ulong)

    def test_handle_family(self):
        # Tutti gli HANDLE-like in Python ctypes.wintypes sono sottotipi
        # di c_void_p (alcune versioni li espongono come subclass distinte,
        # ma con size pari a c_void_p).
        for name in ("HANDLE", "HWND", "HMODULE", "HICON", "HBRUSH", "HDC", "HKEY"):
            handle = getattr(wintypes, name)
            self.assertEqual(ctypes.sizeof(handle), ctypes.sizeof(ctypes.c_void_p),
                             f"{name} has pointer-size")

    def test_string_pointers(self):
        self.assertIs(wintypes.LPCSTR, ctypes.c_char_p)
        self.assertIs(wintypes.LPCWSTR, ctypes.c_wchar_p)

    def test_pointer_sized_ints(self):
        # WPARAM/LPARAM sono UINT_PTR/LONG_PTR cioè pointer-sized.
        # NB: Python ctypes.wintypes non espone `LRESULT` direttamente
        # (lo fa node-ctypes come estensione per comodità Win API); qui
        # testiamo solo i nomi presenti nello stdlib.
        ps = ctypes.sizeof(ctypes.c_void_p)
        self.assertEqual(ctypes.sizeof(wintypes.WPARAM), ps)
        self.assertEqual(ctypes.sizeof(wintypes.LPARAM), ps)

    def test_character_types(self):
        self.assertIs(wintypes.CHAR, ctypes.c_char)
        self.assertIs(wintypes.WCHAR, ctypes.c_wchar)

    def test_pointer_types(self):
        self.assertIs(wintypes.LPDWORD._type_, wintypes.DWORD)
        self.assertIs(wintypes.PDWORD, wintypes.LPDWORD)
        self.assertIs(wintypes.LPBYTE._type_, wintypes.BYTE)
        self.assertIs(wintypes.PHKEY._type_, wintypes.HKEY)
        self.assertIs(wintypes.LPRECT._type_, wintypes.RECT)
        self.assertIs(wintypes.LPMSG._type_, wintypes.MSG)
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


if __name__ == "__main__":
    unittest.main()
