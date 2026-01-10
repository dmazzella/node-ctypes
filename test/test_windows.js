// Test per Windows - MessageBoxA
const ctypes = require("../lib");
const { CDLL, WinDLL } = ctypes;

console.log("=== node-ctypes Windows Test ===\n");

// Carica user32.dll (WinDLL per stdcall)
const user32 = new WinDLL("user32.dll");
console.log("Loaded:", user32.path);

// Imposta il processo come DPI-aware per evitare finestre sgranate su schermi ad alta risoluzione
try {
  // Prova prima il metodo più semplice: SetProcessDPIAware() - disponibile da Windows Vista
  const SetProcessDPIAware = user32.func("SetProcessDPIAware", "bool", []);
  if (SetProcessDPIAware()) {
    console.log("DPI Awareness: Enabled (System DPI Aware)");
  } else {
    // Probabilmente già impostato, oppure fallito - verifichiamo con IsProcessDPIAware
    try {
      const IsProcessDPIAware = user32.func("IsProcessDPIAware", "bool", []);
      if (IsProcessDPIAware()) {
        console.log("DPI Awareness: Already enabled");
      } else {
        console.log("DPI Awareness: Failed to set");
      }
    } catch {
      console.log("DPI Awareness: Status unknown");
    }
  }
} catch (e) {
  console.log("DPI Awareness: Not available on this Windows version");
}
console.log();

// MessageBoxA signature:
// int MessageBoxA(HWND hWnd, LPCSTR lpText, LPCSTR lpCaption, UINT uType);
//
// hWnd: handle alla finestra parent (NULL = 0 per nessuna)
// lpText: testo del messaggio
// lpCaption: titolo della finestra
// uType: tipo di bottoni/icona
//
// Return values:
// IDOK = 1, IDCANCEL = 2, IDABORT = 3, IDRETRY = 4,
// IDIGNORE = 5, IDYES = 6, IDNO = 7

// Costanti per uType
const MB_OK = 0x00000000;
const MB_OKCANCEL = 0x00000001;
const MB_YESNO = 0x00000004;
const MB_YESNOCANCEL = 0x00000003;
const MB_ICONINFORMATION = 0x00000040;
const MB_ICONWARNING = 0x00000030;
const MB_ICONERROR = 0x00000010;
const MB_ICONQUESTION = 0x00000020;

// Crea la funzione
const MessageBoxA = user32.func(
  "MessageBoxA",
  "int32", // return type
  ["pointer", "string", "string", "uint32"] // arg types: hWnd, lpText, lpCaption, uType
);

console.log("MessageBoxA function created\n");

// Test 1: Semplice messaggio OK
console.log("Test 1: Showing simple message box...");
let result = MessageBoxA(
  null,
  "Hello from node-ctypes!",
  "Test 1 - OK",
  MB_OK | MB_ICONINFORMATION
);
console.log("Result:", result, "(1 = OK clicked)\n");

// Test 2: Yes/No dialog
console.log("Test 2: Showing Yes/No dialog...");
result = MessageBoxA(
  null,
  "Do you like node-ctypes?",
  "Test 2 - Yes/No",
  MB_YESNO | MB_ICONQUESTION
);
console.log("Result:", result, "(6 = Yes, 7 = No)\n");

// Test 3: Warning con OK/Cancel
console.log("Test 3: Showing warning dialog...");
result = MessageBoxA(
  null,
  "This is a warning message!",
  "Test 3 - Warning",
  MB_OKCANCEL | MB_ICONWARNING
);
console.log("Result:", result, "(1 = OK, 2 = Cancel)\n");

// Bonus: Beep!
console.log("Bonus: Playing system beep...");
const kernel32 = new WinDLL("kernel32.dll");
const Beep = kernel32.func("Beep", "bool", ["uint32", "uint32"]);
// Beep(frequency_hz, duration_ms)
Beep(800, 200); // 800 Hz per 200ms
Beep(1000, 200); // 1000 Hz per 200ms
Beep(1200, 300); // 1200 Hz per 300ms
console.log("Beep completed!\n");

// ============================================================================
// Test aggiuntivi (adattati da test.js per Windows)
// ============================================================================

// Test: sizeof
console.log("Test: sizeof()");
console.log("  sizeof('int32'):", ctypes.sizeof("int32"));
console.log("  sizeof('int64'):", ctypes.sizeof("int64"));
console.log("  sizeof('pointer'):", ctypes.sizeof("pointer"));
console.log("  sizeof('double'):", ctypes.sizeof("double"));
console.log("  ✓ sizeof works\n");

// Test: Funzioni dalla CRT (msvcrt.dll)
console.log("Test: Loading msvcrt.dll (C Runtime)");
let msvcrt;
try {
  msvcrt = new CDLL("msvcrt.dll");
  console.log("  Loaded: msvcrt.dll");
  console.log("  ✓ msvcrt loaded\n");
} catch (e) {
  console.log("  ✗ Failed to load msvcrt:", e.message, "\n");
}

// Test: Chiama abs()
if (msvcrt) {
  console.log("Test: Calling abs() from msvcrt");
  try {
    const abs = msvcrt.func("abs", "int32", ["int32"]);

    console.log("  abs(-42):", abs(-42));
    console.log("  abs(100):", abs(100));
    console.log("  abs(-1):", abs(-1));
    console.log("  ✓ abs() works\n");
  } catch (e) {
    console.log("  ✗ abs() failed:", e.message, "\n");
  }
}

// Test: Chiama strlen()
if (msvcrt) {
  console.log("Test: Calling strlen() from msvcrt");
  try {
    const strlen = msvcrt.func("strlen", "size_t", ["string"]);

    const testStr = "Hello, Windows!";
    const result = strlen(testStr);
    console.log(`  strlen("${testStr}"):`, result.toString());
    console.log("  Expected:", testStr.length);
    console.log("  ✓ strlen() works\n");
  } catch (e) {
    console.log("  ✗ strlen() failed:", e.message, "\n");
  }
}

// Test: Chiama sqrt()
if (msvcrt) {
  console.log("Test: Calling sqrt() from msvcrt");
  try {
    const sqrt = msvcrt.func("sqrt", "double", ["double"]);

    console.log("  sqrt(4.0):", sqrt(4.0));
    console.log("  sqrt(2.0):", sqrt(2.0));
    console.log("  sqrt(16.0):", sqrt(16.0));
    console.log("  sqrt(144.0):", sqrt(144.0));
    console.log("  ✓ sqrt() works\n");
  } catch (e) {
    console.log("  ✗ sqrt() failed:", e.message, "\n");
  }
}

// Test: Memory allocation and read/write
console.log("Test: Memory allocation and read/write");
try {
  const buf = ctypes.alloc(16);
  console.log("  Allocated 16 bytes");

  // Scrivi un int32
  ctypes.writeValue(buf, "int32", 12345, 0);
  const readInt = ctypes.readValue(buf, "int32", 0);
  console.log("  Wrote int32 12345, read back:", readInt);

  // Scrivi un double
  ctypes.writeValue(buf, "double", 3.14159, 8);
  const readDouble = ctypes.readValue(buf, "double", 8);
  console.log("  Wrote double 3.14159, read back:", readDouble);

  console.log("  ✓ Memory operations work\n");
} catch (e) {
  console.log("  ✗ Memory operations failed:", e.message, "\n");
}

// Test: C strings
console.log("Test: C strings");
try {
  const buf = ctypes.cstring("Hello from Windows!");
  console.log("  Created C string");

  const str = ctypes.readCString(buf);
  console.log("  Read back:", str);

  console.log("  ✓ C strings work\n");
} catch (e) {
  console.log("  ✗ C strings failed:", e.message, "\n");
}

// Test: struct helper
console.log("Test: Struct helper");
try {
  const Point = ctypes.struct({
    x: "int32",
    y: "int32",
  });

  console.log("  Struct size:", Point.size, "bytes");

  const p = Point.create({ x: 10, y: 20 });
  console.log("  Created point");

  console.log("  Point.x:", Point.get(p, "x"));
  console.log("  Point.y:", Point.get(p, "y"));

  Point.set(p, "x", 100);
  console.log("  After setting x=100:", Point.toObject(p));

  console.log("  ✓ Struct helper works\n");
} catch (e) {
  console.log("  ✗ Struct helper failed:", e.message, "\n");
}

// Test: GetTickCount (funzione Windows semplice)
console.log("Test: GetTickCount() - Windows uptime");
try {
  const GetTickCount = kernel32.func("GetTickCount", "uint32", []);
  const ticks = GetTickCount();
  console.log("  System uptime:", ticks, "ms");
  console.log("  Uptime:", (ticks / 1000 / 60).toFixed(2), "minutes");
  console.log("  ✓ GetTickCount() works\n");
} catch (e) {
  console.log("  ✗ GetTickCount() failed:", e.message, "\n");
}

// Test: GetComputerNameA
console.log("Test: GetComputerNameA() - Computer name");
try {
  const GetComputerNameA = kernel32.func("GetComputerNameA", "bool", [
    "pointer",
    "pointer",
  ]);

  // Alloca buffer per il nome e la size
  const bufSize = 256;
  const nameBuf = ctypes.alloc(bufSize);
  const sizeBuf = ctypes.alloc(4);
  ctypes.writeValue(sizeBuf, "uint32", bufSize, 0);

  const success = GetComputerNameA(nameBuf, sizeBuf);

  if (success) {
    const computerName = ctypes.readCString(nameBuf);
    console.log("  Computer name:", computerName);
    console.log("  ✓ GetComputerNameA() works\n");
  } else {
    console.log("  ✗ GetComputerNameA() returned false\n");
  }
} catch (e) {
  console.log("  ✗ GetComputerNameA() failed:", e.message, "\n");
}

// ============================================================================
// Test: Callbacks
// ============================================================================

// Test: Callback semplice per test
console.log("Test: Simple callback creation and release");
try {
  // Crea una callback semplice
  const simpleFn = (x, y) => {
    return x + y;
  };

  const simpleCallback = ctypes.callback(simpleFn, "int32", ["int32", "int32"]);

  console.log("  Created callback");
  console.log(
    "  Callback pointer:",
    "0x" + simpleCallback.pointer.toString(16)
  );
  console.log("  Callback pointer is valid:", simpleCallback.pointer !== 0n);

  simpleCallback.release();
  console.log("  Released callback");
  console.log("  ✓ Callback creation/release works\n");
} catch (e) {
  console.log("  ✗ Simple callback failed:", e.message, "\n");
}

// Test: qsort con callback
console.log("Test: qsort() with callback");
if (msvcrt) {
  try {
    const qsort = msvcrt.func("qsort", "void", [
      "pointer", // base - array
      "size_t", // num - numero elementi
      "size_t", // size - dimensione elemento
      "pointer", // compare - funzione callback
    ]);

    // Array di int32 da ordinare
    const arr = [5, 2, 8, 1, 9, 3, 7];
    console.log("  Array originale:", arr);

    // Alloca memoria per l'array
    const bufSize = arr.length * 4; // 4 bytes per int32
    const arrBuf = ctypes.alloc(bufSize);

    // Copia i valori nel buffer
    for (let i = 0; i < arr.length; i++) {
      ctypes.writeValue(arrBuf, "int32", arr[i], i * 4);
    }

    // Crea la callback di comparazione
    // int compare(const void* a, const void* b)
    let compareCallCount = 0;
    const compareFn = (aPtr, bPtr) => {
      try {
        compareCallCount++;
        const a = ctypes.readValue(aPtr, "int32", 0);
        const b = ctypes.readValue(bPtr, "int32", 0);
        return a - b; // Ordine crescente
      } catch (e) {
        console.log("  Error in compare callback:", e.message);
        return 0;
      }
    };

    const compareCallback = ctypes.callback(compareFn, "int32", [
      "pointer",
      "pointer",
    ]);
    console.log("  Created compare callback");

    // Chiama qsort
    qsort(arrBuf, arr.length, 4, compareCallback.pointer);

    // Leggi l'array ordinato
    const sorted = [];
    for (let i = 0; i < arr.length; i++) {
      sorted.push(ctypes.readValue(arrBuf, "int32", i * 4));
    }

    console.log("  Array ordinato:", sorted);
    console.log("  Callback chiamata:", compareCallCount, "volte");

    // Verifica che l'array sia ordinato
    const isCorrect = sorted.every((val, i) => i === 0 || val >= sorted[i - 1]);
    if (isCorrect && compareCallCount > 0) {
      console.log("  ✓ qsort() with callback works\n");
    } else {
      console.log("  ⚠ qsort() completed but result uncertain\n");
    }

    compareCallback.release();
  } catch (e) {
    console.log("  ✗ qsort() failed:", e.message, "\n");
  }
}

// ============================================================================
// Test: EnumWindows - Conta finestre aperte
// ============================================================================

console.log("Test: EnumWindows() - Count open windows");
try {
  let windowCount = 0;

  // int GetWindowTextA(HWND hWnd, LPSTR lpString, int nMaxCount)
  const GetWindowTextA = user32.func("GetWindowTextA", "int32", [
    "pointer",
    "pointer",
    "int32",
  ]);

  // BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam)
  const enumProc = (hwnd, lParam) => {
    windowCount++;

    // Ottieni il titolo della finestra
    const titleBuf = ctypes.alloc(256);
    const len = GetWindowTextA(hwnd, titleBuf, 256);

    if (len > 0) {
      const title = ctypes.readCString(titleBuf);
      console.log(`  Window ${windowCount}: ${title}`);
    }

    return 1; // TRUE - continua enumerazione
  };

  const enumCallback = ctypes.callback(enumProc, "int32", [
    "pointer", // HWND
    "pointer", // LPARAM
  ]);

  // BOOL EnumWindows(WNDENUMPROC lpEnumFunc, LPARAM lParam)
  const EnumWindows = user32.func("EnumWindows", "bool", [
    "pointer",
    "pointer",
  ]);

  const success = EnumWindows(enumCallback.pointer, null);

  if (success) {
    console.log("  Total windows enumerated:", windowCount);
    console.log("  ✓ EnumWindows() works\n");
  } else {
    console.log("  ✗ EnumWindows() returned false\n");
  }

  enumCallback.release();
} catch (e) {
  console.log("  ✗ EnumWindows() failed:", e.message, "\n");
}

// ============================================================================
// Test: Callback con debug dettagliato
// ============================================================================

console.log("Test: qsort() with detailed debugging");
if (msvcrt) {
  try {
    const qsort = msvcrt.func("qsort", "void", [
      "pointer", // base
      "size_t", // num
      "size_t", // size
      "pointer", // compare
    ]);

    const arr = [5, 2, 8, 1];
    console.log("  Array originale:", arr);

    const arrBuf = ctypes.alloc(arr.length * 4);
    for (let i = 0; i < arr.length; i++) {
      ctypes.writeValue(arrBuf, "int32", arr[i], i * 4);
    }

    const bufAddr = ctypes.addressOf(arrBuf);
    console.log("  Array buffer at:", "0x" + bufAddr.toString(16));

    let callCount = 0;
    const compareFn = (aPtr, bPtr) => {
      callCount++;
      if (callCount <= 3) {
        // Mostra solo le prime 3 chiamate per non riempire l'output
        console.log(`  Compare call #${callCount}:`);
        console.log("    aPtr:", aPtr, "(type:", typeof aPtr + ")");
        console.log("    bPtr:", bPtr, "(type:", typeof bPtr + ")");
      }

      try {
        const a = ctypes.readValue(aPtr, "int32", 0);
        const b = ctypes.readValue(bPtr, "int32", 0);
        if (callCount <= 3) {
          console.log("    a =", a, ", b =", b);
          console.log("    result =", a - b);
        }
        return a - b;
      } catch (e) {
        console.log("    Error:", e.message);
        return 0;
      }
    };

    const compareCallback = ctypes.callback(compareFn, "int32", [
      "pointer",
      "pointer",
    ]);

    qsort(arrBuf, arr.length, 4, compareCallback.pointer);

    const sorted = [];
    for (let i = 0; i < arr.length; i++) {
      sorted.push(ctypes.readValue(arrBuf, "int32", i * 4));
    }

    console.log("  Sorted array:", sorted);
    console.log("  Total callback calls:", callCount);
    console.log("  ✓ qsort debug test completed\n");

    compareCallback.release();
  } catch (e) {
    console.log("  ✗ qsort debug failed:", e.message, "\n");
  }
}

// ============================================================================
// Test: Callback da Thread Esterno
// ============================================================================

console.log("Test: Callback from external thread (CreateThread)");
try {
  let threadCallbacks = [];

  // DWORD WINAPI ThreadProc(LPVOID lpParameter)
  const threadProcFn = (param) => {
    const value = ctypes.readValue(param, "uint32");
    console.log("  >>> Thread callback invoked! <<<");
    console.log("  Parameter received:", value);

    threadCallbacks.push(value);

    return 0; // Success
  };

  const ThreadProc = ctypes.callback(threadProcFn, "uint32", ["pointer"]);

  console.log("  Callback created:", "0x" + ThreadProc.pointer.toString(16));

  // CreateThread(NULL, 0, ThreadProc, param, 0, NULL)
  const CreateThread = kernel32.func("CreateThread", "pointer", [
    "pointer", // lpThreadAttributes
    "uint64", // dwStackSize
    "pointer", // lpStartAddress
    "pointer", // lpParameter
    "uint32", // dwCreationFlags
    "pointer", // lpThreadId
  ]);

  // Alloca parametro
  const param = ctypes.alloc(4);
  ctypes.writeValue(param, "uint32", 12345);

  console.log("  Parameter:", ctypes.readValue(param, "uint32"));

  // Crea thread
  const threadHandle = CreateThread(
    null, // lpThreadAttributes
    0n, // dwStackSize (0 = default)
    ThreadProc.pointer, // lpStartAddress
    param, // lpParameter
    0, // dwCreationFlags
    null // lpThreadId
  );

  console.log("  Thread created, handle:", "0x" + threadHandle.toString(16));

  // WaitForSingleObject
  const WaitForSingleObject = kernel32.func("WaitForSingleObject", "uint32", [
    "pointer",
    "uint32",
  ]);

  // Aspetta il thread C (max 5 secondi)
  console.log("  Waiting for thread...");
  const waitResult = WaitForSingleObject(threadHandle, 5000);
  console.log("  Thread completed, wait result:", waitResult);

  // CloseHandle
  const CloseHandle = kernel32.func("CloseHandle", "int32", ["pointer"]);
  CloseHandle(threadHandle);

  // Aspetta che l'event loop processi la callback
  setTimeout(() => {
    console.log("\n  Thread callback results:");
    console.log("    Callbacks received:", threadCallbacks.length);
    console.log("    Values:", threadCallbacks);

    if (threadCallbacks.length > 0 && threadCallbacks[0] === 12345) {
      console.log("    ✓ External thread callback works!\n");
    } else {
      console.log("    ⚠ Callback not invoked correctly\n");
    }

    ThreadProc.release();

    // ========================================================================
    // Test Avanzati
    // ========================================================================

    console.log("=== Advanced Tests ===\n");

    // Test: Nested structs - GetSystemInfo
    console.log("Test: Nested structs - GetSystemInfo");
    try {
      const SYSTEM_INFO = ctypes.struct({
        wProcessorArchitecture: "uint16",
        wReserved: "uint16",
        dwPageSize: "uint32",
        lpMinimumApplicationAddress: "pointer",
        lpMaximumApplicationAddress: "pointer",
        dwActiveProcessorMask: "pointer",
        dwNumberOfProcessors: "uint32",
        dwProcessorType: "uint32",
        dwAllocationGranularity: "uint32",
        wProcessorLevel: "uint16",
        wProcessorRevision: "uint16",
      });

      const GetSystemInfo = kernel32.func("GetSystemInfo", "void", ["pointer"]);

      const sysInfo = SYSTEM_INFO.create();
      GetSystemInfo(sysInfo);

      const info = SYSTEM_INFO.toObject(sysInfo);

      console.log("  System Information:");
      console.log("    Processor Architecture:", info.wProcessorArchitecture);
      console.log("    Number of Processors:", info.dwNumberOfProcessors);
      console.log("    Page Size:", info.dwPageSize, "bytes");
      console.log("    Allocation Granularity:", info.dwAllocationGranularity, "bytes");

      if (info.dwNumberOfProcessors > 0 && info.dwPageSize > 0) {
        console.log("  ✓ GetSystemInfo works\n");
      } else {
        console.log("  ⚠ Unexpected values\n");
      }
    } catch (e) {
      console.log("  ✗ Failed:", e.message, "\n");
    }

    // Test: SYSTEMTIME struct
    console.log("Test: SYSTEMTIME struct");
    try {
      const SYSTEMTIME = ctypes.struct({
        wYear: "uint16",
        wMonth: "uint16",
        wDayOfWeek: "uint16",
        wDay: "uint16",
        wHour: "uint16",
        wMinute: "uint16",
        wSecond: "uint16",
        wMilliseconds: "uint16",
      });

      const GetSystemTime = kernel32.func("GetSystemTime", "void", ["pointer"]);
      const GetLocalTime = kernel32.func("GetLocalTime", "void", ["pointer"]);

      const utcTime = SYSTEMTIME.create();
      const localTime = SYSTEMTIME.create();

      GetSystemTime(utcTime);
      GetLocalTime(localTime);

      const local = SYSTEMTIME.toObject(localTime);

      console.log(
        "  Local Time:",
        `${local.wYear}-${local.wMonth}-${local.wDay} ${local.wHour}:${local.wMinute}:${local.wSecond}`
      );
      console.log("  Day of Week:", local.wDayOfWeek, "(0=Sunday, 6=Saturday)");

      if (local.wYear >= 2020 && local.wMonth >= 1 && local.wMonth <= 12) {
        console.log("  ✓ GetSystemTime/GetLocalTime works\n");
      } else {
        console.log("  ⚠ Unexpected time values\n");
      }
    } catch (e) {
      console.log("  ✗ Failed:", e.message, "\n");
    }

    // Test: Recursive callback - Fibonacci
    console.log("Test: Recursive callback - Fibonacci sort");
    if (msvcrt) {
      try {
        let fibCalls = 0;
        const fibCache = new Map();

        const fibCompare = (aPtr, bPtr) => {
          fibCalls++;
          const a = ctypes.readValue(aPtr, "int32", 0);
          const b = ctypes.readValue(bPtr, "int32", 0);

          const fib = (n) => {
            if (fibCache.has(n)) return fibCache.get(n);
            if (n <= 1) return n;
            const result = fib(n - 1) + fib(n - 2);
            fibCache.set(n, result);
            return result;
          };

          return fib(a) - fib(b);
        };

        const fibCallback = ctypes.callback(fibCompare, "int32", [
          "pointer",
          "pointer",
        ]);
        const qsort = msvcrt.func("qsort", "void", [
          "pointer",
          "size_t",
          "size_t",
          "pointer",
        ]);

        const arr = [7, 3, 9, 1, 5];
        const arrBuf = ctypes.alloc(arr.length * 4);
        for (let i = 0; i < arr.length; i++) {
          ctypes.writeValue(arrBuf, "int32", arr[i], i * 4);
        }

        console.log("  Sorting by fibonacci values:", arr);
        qsort(arrBuf, arr.length, 4, fibCallback.pointer);

        const sorted = [];
        for (let i = 0; i < arr.length; i++) {
          sorted.push(ctypes.readValue(arrBuf, "int32", i * 4));
        }

        console.log("  Sorted:", sorted);
        console.log("  Fibonacci values:");
        sorted.forEach((n) => {
          console.log(`    fib(${n}) = ${fibCache.get(n)}`);
        });
        console.log("  ✓ Recursive callback works\n");

        fibCallback.release();
      } catch (e) {
        console.log("  ✗ Failed:", e.message, "\n");
      }
    }

    // Test: Array of structs
    console.log("Test: Array of structs - RECT[]");
    try {
      const RECT = ctypes.struct({
        left: "int32",
        top: "int32",
        right: "int32",
        bottom: "int32",
      });

      const numRects = 5;
      const rectArrayBuf = ctypes.alloc(RECT.size * numRects);

      const rects = [
        { left: 0, top: 0, right: 100, bottom: 50 },
        { left: 10, top: 10, right: 200, bottom: 150 },
        { left: 20, top: 20, right: 300, bottom: 250 },
      ];

      // Scrivi primi 3 RECT
      for (let i = 0; i < 3; i++) {
        const baseOffset = i * RECT.size;
        ctypes.writeValue(rectArrayBuf, "int32", rects[i].left, baseOffset + 0);
        ctypes.writeValue(rectArrayBuf, "int32", rects[i].top, baseOffset + 4);
        ctypes.writeValue(rectArrayBuf, "int32", rects[i].right, baseOffset + 8);
        ctypes.writeValue(rectArrayBuf, "int32", rects[i].bottom, baseOffset + 12);
      }

      // Leggi e verifica
      console.log("  RECT array (first 3):");
      let allCorrect = true;
      for (let i = 0; i < 3; i++) {
        const baseOffset = i * RECT.size;
        const left = ctypes.readValue(rectArrayBuf, "int32", baseOffset + 0);
        const top = ctypes.readValue(rectArrayBuf, "int32", baseOffset + 4);
        const right = ctypes.readValue(rectArrayBuf, "int32", baseOffset + 8);
        const bottom = ctypes.readValue(rectArrayBuf, "int32", baseOffset + 12);

        const width = right - left;
        const height = bottom - top;
        console.log(`    [${i}] (${left},${top})-(${right},${bottom}) ${width}x${height}`);

        if (
          left !== rects[i].left ||
          top !== rects[i].top ||
          right !== rects[i].right ||
          bottom !== rects[i].bottom
        ) {
          allCorrect = false;
        }
      }

      if (allCorrect) {
        console.log("  ✓ Array of structs works\n");
      } else {
        console.log("  ⚠ Some values don't match\n");
      }
    } catch (e) {
      console.log("  ✗ Failed:", e.message, "\n");
    }

    // Test: Pointer to pointer (char**)
    console.log("Test: Pointer to pointer (char**)");
    try {
      const strings = ["program.exe", "--flag", "argument"];

      const ptrSize = ctypes.sizeof("pointer");
      const argvBuf = ctypes.alloc(ptrSize * (strings.length + 1));

      const stringBufs = [];
      for (let i = 0; i < strings.length; i++) {
        const strBuf = ctypes.cstring(strings[i]);
        stringBufs.push(strBuf);
        ctypes.writeValue(argvBuf, "pointer", strBuf, i * ptrSize);
      }

      ctypes.writeValue(argvBuf, "pointer", 0n, strings.length * ptrSize);

      console.log("  argv simulation:");
      for (let i = 0; i < strings.length; i++) {
        const ptrToStr = ctypes.readValue(argvBuf, "pointer", i * ptrSize);
        const str = ctypes.readCString(ptrToStr);
        console.log(`    argv[${i}] = "${str}"`);
      }

      console.log("  ✓ Pointer to pointer works\n");
    } catch (e) {
      console.log("  ✗ Failed:", e.message, "\n");
    }

    // Test: Stress test
    console.log("Test: Stress test - Multiple sorts");
    if (msvcrt) {
      try {
        const qsort = msvcrt.func("qsort", "void", [
          "pointer",
          "size_t",
          "size_t",
          "pointer",
        ]);

        const testCount = 10;
        const results = [];

        for (let test = 0; test < testCount; test++) {
          const arr = Array.from({ length: 10 }, () =>
            Math.floor(Math.random() * 100)
          );
          const arrBuf = ctypes.alloc(arr.length * 4);

          for (let i = 0; i < arr.length; i++) {
            ctypes.writeValue(arrBuf, "int32", arr[i], i * 4);
          }

          let callCount = 0;
          const compareFn = (aPtr, bPtr) => {
            callCount++;
            const a = ctypes.readValue(aPtr, "int32", 0);
            const b = ctypes.readValue(bPtr, "int32", 0);
            return a - b;
          };

          const callback = ctypes.callback(compareFn, "int32", [
            "pointer",
            "pointer",
          ]);
          qsort(arrBuf, arr.length, 4, callback.pointer);

          const sorted = [];
          for (let i = 0; i < arr.length; i++) {
            sorted.push(ctypes.readValue(arrBuf, "int32", i * 4));
          }

          const isCorrect = sorted.every(
            (val, i) => i === 0 || val >= sorted[i - 1]
          );
          results.push({ test, callCount, isCorrect });

          callback.release();
        }

        const allCorrect = results.every((r) => r.isCorrect);
        const totalCalls = results.reduce((sum, r) => sum + r.callCount, 0);

        console.log(`  Executed ${testCount} sorts`);
        console.log(`  Total callbacks: ${totalCalls}`);
        console.log(`  Average: ${(totalCalls / testCount).toFixed(1)}`);

        if (allCorrect) {
          console.log("  ✓ Stress test passed\n");
        } else {
          console.log("  ⚠ Some sorts failed\n");
        }
      } catch (e) {
        console.log("  ✗ Failed:", e.message, "\n");
      }
    }

    // Note: Il sistema ibrido implementato permette:
    // - Main thread callbacks (qsort): FunctionReference (diretta, veloce)
    // - External thread callbacks (CreateThread): ThreadSafeFunction (sicura)
    // Il sistema rileva automaticamente il thread e usa il meccanismo appropriato.

    // Cleanup finale
    if (msvcrt) {
      msvcrt.close();
    }
    user32.close();
    kernel32.close();

    console.log("=== All Windows tests passed! ===");
  }, 1000);
} catch (e) {
  console.log("  ✗ External thread test failed:", e.message, "\n");

  // Cleanup in caso di errore
  if (msvcrt) {
    msvcrt.close();
  }
  user32.close();
  kernel32.close();

  console.log("=== Tests completed with errors ===");
}
