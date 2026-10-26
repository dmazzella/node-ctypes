import ctypes.util
from pathlib import Path
import sys


LIBC = "msvcrt.dll" if sys.platform == "win32" else ctypes.util.find_library("c")
if LIBC is None:
    raise RuntimeError("The platform C runtime library could not be located")

SUFFIX = ".dll" if sys.platform == "win32" else ".dylib" if sys.platform == "darwin" else ".so"
FIXTURE = Path(__file__).resolve().parents[2] / "build" / "fixture" / f"ctypes_test_fixture{SUFFIX}"
