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


if __name__ == "__main__":
    unittest.main()
