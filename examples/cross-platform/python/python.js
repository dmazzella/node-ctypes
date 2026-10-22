// python.js — embed CPython in Node.js with node-ctypes
//
// Loads the shared library of an installed Python (libpython3.x.so,
// Python.framework / libpython3.x.dylib, python3x.dll) and drives it through
// the Python C API, as a C extension would: run code, import modules, call
// Python objects from JavaScript and expose JavaScript functions to Python.
// Cross-platform: Windows, macOS and Linux (glibc and musl).
//
// Usage:
//   import { Python, Tuple, byReference, cancellable, kwargs } from "./python.js";
//
//   const python = Python.initialize();        // python3 / python / py on PATH
//   python.exec("def add(a, b): return a + b");
//   python.main.add(1, 2);                     // 3
//
//   const math = python.import("math");
//   math.sqrt(2);                              // 1.4142135623730951
//   python.import("json").dumps({ a: [1, 2] }, kwargs({ indent: 2 }));
//
//   python.module("node", { hello: (name) => `hello ${name}` });
//   python.exec("import node; print(node.hello('Python'))");
//
//   python.with(python.builtins.open("data.txt"), (file) => file.read());
//   python.builtins.repr(Tuple.of(1, 2));      // '(1, 2)'
//   await python.import("asyncio").sleep(1);   // coroutines are awaitable
//   python.main.fill(byReference(items));      // Python changes the JavaScript array
//
// Values:
//   - JavaScript → Python: null/undefined → None, boolean → bool, integer
//     number and BigInt → int, number → float, string → str, Buffer /
//     Uint8Array → bytes, Array → list, Tuple → tuple, plain object and Map →
//     dict, Set → set, Date → datetime (UTC), Temporal values (Node.js 26+) →
//     date / time / datetime / timedelta, function → callable (JavaScript
//     classes are instantiated, `fn.new(...)` for any constructor): by value,
//     deeply. Other typed arrays, ArrayBuffer and DataView → memoryview of
//     their memory (no copy). Other objects (class instances, promises,
//     iterators, ...) → JsProxy: a JavaScript object used by reference
//     (attributes, methods, items, len(), iteration, async for, await, dir());
//     `byReference(value)` passes arrays, plain objects, Maps and Sets as a
//     JsProxy too, and a Buffer as a writable memoryview.
//   - Python → JavaScript: None, bool, int (number, or BigInt beyond 2^53),
//     float, str and bytes (Buffer) are converted, a JsProxy is its JavaScript
//     object; every other object (list, dict, modules, instances, ...) is a
//     live PyObject proxy: attribute access, calls (`kwargs()` as last
//     argument), `obj[i]` / `obj[-1]` item access, dict keys as properties
//     (`config.name`, `config["name"] = v`, `"name" in config`, Object.keys();
//     attributes come first: `config.get` is the method), `obj.length` (len),
//     iteration, `for await` (async iterators), `String(obj)`, numbers in
//     arithmetic (`fraction * 2`), `new Date(datetime)`, JSON.stringify(),
//     `obj.toTypedArray()` (the memory of a buffer: bytearray, array, numpy),
//     `obj.toJS()` for a deep conversion (tuples become Tuple arrays,
//     datetimes Dates; with Temporal, dates PlainDates, times PlainTimes and
//     timedeltas Durations), and `obj[Symbol.dispose]()` (or `using`) to
//     release it before GC does.
//   - Python exceptions are thrown as PythonError (type, traceback, exception);
//     JavaScript errors thrown in functions called by Python are raised in
//     Python as RuntimeError (or as the original Python exception).
//
// Statements: `python.with(manager, body)` and `python.asyncWith(manager,
// body)` are Python's `with` and `async with`; `python.withTimeout(ms, fn)`
// interrupts synchronous Python code running for too long (TimeoutError).
//
// Threads: the GIL is released whenever Python is not running for JavaScript,
// so Python threads keep running while Node.js handles its event loop.
// Free-threaded builds (python3.14t) work too. One thread per process hosts
// the interpreter: the main thread or a worker_threads Worker (to keep
// CPU-bound Python code off the main thread), whichever initializes it first.
//
// asyncio: coroutines, tasks and concurrent.futures.Future objects are
// awaitable from JavaScript (`await python.main.fetch_all(urls)`, or
// `python.run(coro, { signal })` to cancel them). They run on an asyncio
// event loop in a Python thread; a node-ctypes threadSafeCallback tells
// Node.js when they complete.
//
// JavaScript functions run on the Node.js main thread. Called from other
// Python threads they return a future: awaitable in coroutines (`await
// node.read_text(path)`), a concurrent.futures.Future elsewhere (`.result()`);
// the promise of an async function is awaited, and a `cancellable(fn)` gets
// an AbortSignal aborted when Python cancels the call. Node.js runs these
// calls as soon as its event loop is free, through an unref()'d
// threadSafeCallback: like an unref()'d timer, Python activity alone does
// not keep Node.js alive, JavaScript awaiting Python code does. While the
// main thread runs Python code (e.g. Thread.join() in synchronous code), it
// runs these calls itself: SIGURG interrupts its wait (POSIX), the interrupt
// event does on Windows with Python 3.14+. Async JavaScript functions need
// the Node.js event loop, so waiting for them there is a deadlock (after 5 s
// Python warns about it), as on Windows before Python 3.14, where a blocked
// main thread cannot be woken.
//
// Diagnostics: `python.stats()` counts the objects shared by the two
// languages (to find leaks). `Python.initialize({ stdin: false })` leaves the
// process stdin to Node.js (Python would read it through its own buffer).
//
// Interpreter: `Python.initialize({ executable })`, the PYTHON environment
// variable, or python3 / python / py on PATH. Its sys.path is used, so virtual
// environments work. Its shared library is found automatically; to use another
// one of the same version pass `{ library }` or set PYTHON_LIBRARY. Python
// 3.12+ is required, built with a shared library: the default on Windows,
// macOS and most Linux distributions (Debian/Ubuntu: install libpython3.x;
// pyenv: PYTHON_CONFIGURE_OPTS=--enable-shared). Only the stable C API of
// Python is used, plus _PyOS_SigintEvent on Windows (optional). Requires
// node-ctypes 2.1+ (threadSafeCallback().unref()).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { CDLL, WinDLL, RTLD_GLOBAL, Structure, CFUNCTYPE, threadSafeCallback, addressof, byref, memmove, ptrToBuffer, string_at, c_char_p, c_wchar_p, c_void_p, c_int, c_long, c_ulong, c_int64, c_double, c_ssize_t } from "node-ctypes";

// ─── Python C API ───────────────────────────────────────────────────

const MIN_PYTHON = [3, 12];
const Py_file_input = 257;
const Py_eval_input = 258;
const METH_VARARGS = 0x0001;
const METH_KEYWORDS = 0x0002;

// PyObject *f(PyObject *self, PyObject *args, PyObject *kwargs)
const PyCFunctionWithKeywords = CFUNCTYPE(c_void_p, c_void_p, c_void_p, c_void_p);

class PyMethodDef extends Structure {
  static _fields_ = [
    ["ml_name", c_char_p],
    ["ml_meth", PyCFunctionWithKeywords],
    ["ml_flags", c_int],
    ["ml_doc", c_char_p],
  ];
}

// Functions used here (stable ABI): name → [restype, argtypes]
const API = {
  Py_InitializeEx: [null, [c_int]],
  Py_FinalizeEx: [c_int, []],
  PyEval_SaveThread: [c_void_p, []],
  PyEval_RestoreThread: [null, [c_void_p]],
  PyGILState_Ensure: [c_int, []],
  PyGILState_Release: [null, [c_int]],
  Py_CompileString: [c_void_p, [c_char_p, c_char_p, c_int]],
  PyEval_EvalCode: [c_void_p, [c_void_p, c_void_p, c_void_p]],
  PyImport_ImportModule: [c_void_p, [c_char_p]],
  PyModule_GetDict: [c_void_p, [c_void_p]],
  PyObject_GetAttrString: [c_void_p, [c_void_p, c_char_p]],
  PyObject_SetAttrString: [c_int, [c_void_p, c_char_p, c_void_p]],
  PyObject_HasAttrString: [c_int, [c_void_p, c_char_p]],
  PyObject_GetItem: [c_void_p, [c_void_p, c_void_p]],
  PyObject_SetItem: [c_int, [c_void_p, c_void_p, c_void_p]],
  PyObject_Call: [c_void_p, [c_void_p, c_void_p, c_void_p]],
  PyObject_Str: [c_void_p, [c_void_p]],
  PyObject_Repr: [c_void_p, [c_void_p]],
  PyObject_Type: [c_void_p, [c_void_p]],
  PyObject_GetIter: [c_void_p, [c_void_p]],
  PyIter_Next: [c_void_p, [c_void_p]],
  PyErr_Occurred: [c_void_p, []],
  PyErr_GetRaisedException: [c_void_p, []],
  PyErr_SetRaisedException: [null, [c_void_p]],
  PyErr_SetString: [null, [c_void_p, c_char_p]],
  PyType_GetName: [c_void_p, [c_void_p]],
  PyErr_Clear: [null, []],
  PyErr_ExceptionMatches: [c_int, [c_void_p]],
  PyThreadState_SetAsyncExc: [c_int, [c_ulong, c_void_p]],
  Py_IncRef: [null, [c_void_p]],
  Py_DecRef: [null, [c_void_p]],
  PyBool_FromLong: [c_void_p, [c_long]],
  PyLong_FromLongLong: [c_void_p, [c_int64]],
  PyLong_FromDouble: [c_void_p, [c_double]],
  PyLong_FromString: [c_void_p, [c_char_p, c_void_p, c_int]],
  PyLong_AsLongLong: [c_int64, [c_void_p]],
  PyLong_AsLongLongAndOverflow: [c_int64, [c_void_p, c_void_p]],
  PyFloat_FromDouble: [c_void_p, [c_double]],
  PyFloat_AsDouble: [c_double, [c_void_p]],
  PyUnicode_DecodeUTF8: [c_void_p, [c_void_p, c_ssize_t, c_char_p]],
  PyUnicode_AsUTF8AndSize: [c_void_p, [c_void_p, c_void_p]],
  PyBytes_FromStringAndSize: [c_void_p, [c_void_p, c_ssize_t]],
  PyBytes_AsStringAndSize: [c_int, [c_void_p, c_void_p, c_void_p]],
  PyTuple_New: [c_void_p, [c_ssize_t]],
  PyTuple_SetItem: [c_int, [c_void_p, c_ssize_t, c_void_p]],
  PyTuple_Size: [c_ssize_t, [c_void_p]],
  PyTuple_GetItem: [c_void_p, [c_void_p, c_ssize_t]],
  PyList_New: [c_void_p, [c_ssize_t]],
  PyList_SetItem: [c_int, [c_void_p, c_ssize_t, c_void_p]],
  PyList_Size: [c_ssize_t, [c_void_p]],
  PyList_GetItem: [c_void_p, [c_void_p, c_ssize_t]],
  PyDict_New: [c_void_p, []],
  PyDict_SetItem: [c_int, [c_void_p, c_void_p, c_void_p]],
  PyDict_Next: [c_int, [c_void_p, c_void_p, c_void_p, c_void_p]],
  PyDict_Size: [c_ssize_t, [c_void_p]],
  PySet_New: [c_void_p, [c_void_p]],
  PySet_Add: [c_int, [c_void_p, c_void_p]],
  PyCFunction_NewEx: [c_void_p, [c_void_p, c_void_p, c_void_p]],
};

// Type objects compared with type(obj) to convert values to JavaScript.
const TYPES = ["PyBool_Type", "PyLong_Type", "PyFloat_Type", "PyUnicode_Type", "PyBytes_Type", "PyList_Type", "PyTuple_Type", "PyDict_Type", "PySet_Type", "PyFrozenSet_Type"];

// Private helper module run inside the embedded interpreter.
const BRIDGE = `
import asyncio, collections, collections.abc, concurrent.futures, ctypes, datetime, inspect, itertools, numbers, queue, signal, sys, threading, traceback, warnings, weakref, zoneinfo

_main = threading.get_ident()
_released = collections.deque()  # JavaScript functions no longer referenced
_released_objects = collections.deque()  # JavaScript objects (JsProxy) no longer referenced

# Python and Node.js write to the same stdout and stderr: UTF-8 like Node.js
# (an embedded Python does not switch to UTF-8 in the C/POSIX locale), and
# flushed at every line to keep the output in order.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

def wrap(cfunc, fid):
    """Python function calling the JavaScript function cfunc: directly on the
    main thread; from other threads it returns a future (see _call_later)."""
    name = cfunc.__name__
    def javascript(*args, **kwargs):
        if threading.get_ident() == _main:
            return cfunc(*args, **kwargs)
        return _call_later(fid, args, kwargs, javascript)
    javascript.__name__ = javascript.__qualname__ = name
    javascript.__doc__ = f"JavaScript function {name}"
    javascript._node_ctypes_id = fid
    # new: JavaScript constructors that are not classes (function EventEmitter() {...}).
    javascript.new = lambda *args, **kwargs: _js("new", javascript, *args, **kwargs)
    weakref.finalize(javascript, _released.append, fid)
    return javascript

# Code of every wrapper made by wrap(): identifies them (functools.wraps copies attributes, not code).
JAVASCRIPT_CODE = next(c for c in wrap.__code__.co_consts if getattr(c, "co_name", None) == "javascript")

def _drain(queue):
    items = []
    while queue:
        items.append(queue.popleft())
    return items

def take_released():
    """Ids of the JavaScript functions and objects no longer referenced by Python."""
    return _drain(_released), _drain(_released_objects)

# JavaScript objects used by reference: every operation runs on the Node.js
# main thread through _op, a JavaScript function (see Python.#jsOp).
_op = None

def set_op(function):
    global _op
    _op = function

def _js(op, *args, **kwargs):
    if threading.get_ident() == _main:
        return _op(op, *args, **kwargs)
    # Other threads wait for Node.js (see _call_later).
    return _call_later(_op._node_ctypes_id, (op,) + args, kwargs, _op, awaitable=False).result()

def _js_async(op, *args):
    return _call_later(_op._node_ctypes_id, (op,) + args, {}, _op)

class JsProxy:
    """A JavaScript object used by reference: attributes, items, len(),
    iteration (also async for), await (promises), dir(), repr()."""

    __slots__ = ("_id", "__weakref__")

    def __init__(self, oid):
        object.__setattr__(self, "_id", oid)
        weakref.finalize(self, _released_objects.append, oid)

    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)  # protocols probed by Python (copy, pickle, numpy, ...)
        return _js("getattr", self, name)

    def __setattr__(self, name, value):
        _js("setattr", self, name, value)

    def __delattr__(self, name):
        _js("delattr", self, name)

    def __getitem__(self, key):
        return _js("getitem", self, key)

    def __setitem__(self, key, value):
        _js("setitem", self, key, value)

    def __delitem__(self, key):
        _js("delitem", self, key)

    def __contains__(self, value):
        return _js("contains", self, value)

    def __len__(self):
        return _js("len", self)

    def __bool__(self):
        return _js("bool", self)

    def __iter__(self):
        iterator = _js("iter", self)
        while True:
            done, value = _js("next", iterator)
            if done:
                return
            yield value

    def __aiter__(self):
        return _JsAsyncIterator(_js("aiter", self))

    def __await__(self):
        return _js_async("await", self).__await__()

    def __dir__(self):
        return _js("dir", self)

    def __repr__(self):
        return _js("repr", self)

    def __str__(self):
        return _js("str", self)

    def __eq__(self, other):
        return isinstance(other, JsProxy) and other._id == self._id

    def __hash__(self):
        return hash(self._id)

class _JsAsyncIterator:
    def __init__(self, iterator):
        self.iterator = iterator

    def __aiter__(self):
        return self

    async def __anext__(self):
        done, value = await _js_async("anext", self.iterator)
        if done:
            raise StopAsyncIteration
        return value

# Python async iterators in JavaScript (for await).
def is_async_iterable(obj):
    return hasattr(type(obj), "__aiter__")

def aiter_of(obj):
    return aiter(obj)

async def anext_of(iterator):
    try:
        return False, await anext(iterator)
    except StopAsyncIteration:
        return True, None

def aclose_of(iterator):
    close = getattr(iterator, "aclose", None)
    return close() if close else None

# Shared memory: JavaScript typed arrays as memoryviews, Python buffers as
# typed arrays, without copies.
def memory(address, size, fmt, keep):
    if not size:
        return memoryview(bytearray()).cast(fmt)
    array = (ctypes.c_char * size).from_address(address)
    array._node_ctypes_keep = keep  # the JavaScript memory lives as long as the view
    return memoryview(array).cast("B").cast(fmt)

_TYPED = {"b": "Int8Array", "B": "Uint8Array", "h": "Int16Array", "H": "Uint16Array", "i": "Int32Array", "I": "Uint32Array",
          "q": "BigInt64Array", "Q": "BigUint64Array", "e": "Float16Array", "f": "Float32Array", "d": "Float64Array"}
_SIZED = {("l", 4): "i", ("l", 8): "q", ("L", 4): "I", ("L", 8): "Q", ("n", 4): "i", ("n", 8): "q", ("N", 4): "I", ("N", 8): "Q", ("P", 8): "Q", ("P", 4): "I"}

def export_buffer(obj):
    """Typed array name, holder, address, size and copy of a buffer: the
    holder pins writable memory (shared), read-only memory is copied."""
    view = memoryview(obj)
    if not view.c_contiguous:
        raise BufferError("toTypedArray() needs a C-contiguous buffer")
    fmt = view.format
    native = "<" if sys.byteorder == "little" else ">"
    if fmt[:1] in "@=" or fmt[:1] == native:
        fmt = fmt[1:]
    fmt = _SIZED.get((fmt, view.itemsize), fmt)
    name = _TYPED.get(fmt, "Uint8Array")
    if view.readonly:
        return name, None, 0, view.nbytes, view.tobytes()
    if not view.nbytes:
        return name, None, 0, 0, None
    holder = (ctypes.c_char * view.nbytes).from_buffer(view.cast("B") if view.format != "B" else view)
    return name, holder, ctypes.addressof(holder), view.nbytes, None

# datetime ↔ Date: aware datetimes are instants; naive ones are local time.
_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)

def from_timestamp(ms):
    return _EPOCH + datetime.timedelta(milliseconds=ms)

def timestamp(obj):
    """Milliseconds since the epoch of a datetime (None for other objects)."""
    if not isinstance(obj, datetime.datetime):
        return None
    try:
        if obj.tzinfo is None:
            obj = obj.astimezone()  # local time
        return (obj - _EPOCH) // datetime.timedelta(microseconds=1) / 1000
    except (OverflowError, ValueError, OSError):
        return None  # outside the range of the platform (datetime.min, ...): stays a proxy

_MICROSECOND = datetime.timedelta(microseconds=1)

def to_js_value(obj, temporal):
    """Deep conversion of a date or duration: ("Date", ms), and with Temporal
    ("PlainDate", y, m, d), ("PlainTime", h, m, s, us), ("Duration", d, h, m,
    s, ms, us); None for other objects."""
    if isinstance(obj, datetime.datetime):
        ms = timestamp(obj)
        return None if ms is None else ("Date", ms)
    if not temporal:
        return None
    if isinstance(obj, datetime.date):
        return ("PlainDate", obj.year, obj.month, obj.day)
    if isinstance(obj, datetime.time) and obj.tzinfo is None:
        return ("PlainTime", obj.hour, obj.minute, obj.second, obj.microsecond)
    if isinstance(obj, datetime.timedelta):
        total = obj // _MICROSECOND
        sign = -1 if total < 0 else 1  # all the fields of a Temporal.Duration have the same sign
        parts = []
        rest = abs(total)
        for unit in (86_400_000_000, 3_600_000_000, 60_000_000, 1_000_000, 1000):
            value, rest = divmod(rest, unit)
            parts.append(sign * value)
        return ("Duration", *parts, sign * rest)
    return None

def from_temporal(kind, *fields):
    """A Temporal value from JavaScript."""
    if kind == "date":
        return datetime.date(*fields)
    if kind == "time":
        return datetime.time(*fields)
    if kind == "datetime":
        return datetime.datetime(*fields)
    if kind == "instant":
        return _EPOCH + fields[0] * _MICROSECOND
    if kind == "zoned":
        micros, zone, offset = fields
        try:
            tz = zoneinfo.ZoneInfo(zone)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):  # no time zone data (Windows without tzdata)
            tz = datetime.timezone(offset * _MICROSECOND)
        return (_EPOCH + micros * _MICROSECOND).astimezone(tz)
    return fields[0] * _MICROSECOND  # duration

def format_exception(exc):
    return "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))

# JavaScript property access: obj.name is an attribute; for mappings, a name
# that is not an attribute is a key (config.name is config["name"]).
def get_fallback(obj, name):
    if isinstance(obj, collections.abc.Mapping) and (name in obj or name != "length"):
        return obj[name]
    if name == "length" and hasattr(type(obj), "__len__"):
        return len(obj)
    return getattr(obj, name)  # raises the AttributeError again

def set_fallback(obj, name, value):
    if isinstance(obj, collections.abc.MutableMapping):
        obj[name] = value
    else:
        setattr(obj, name, value)

def delete_fallback(obj, name):
    if isinstance(obj, collections.abc.MutableMapping):
        del obj[name]
    else:
        delattr(obj, name)

def has(obj, name):
    return hasattr(obj, name) or is_key(obj, name)

def is_key(obj, name):
    return isinstance(obj, collections.abc.Mapping) and name in obj

def item(obj, key):
    return obj[key]

def to_primitive(obj, hint):
    """Symbol.toPrimitive: numbers (numpy scalars, Decimal, Fraction) for
    arithmetic, milliseconds for datetimes (new Date(dt)), str otherwise."""
    if hint != "string" and isinstance(obj, datetime.datetime):
        return timestamp(obj)
    if hint != "string" and isinstance(obj, numbers.Number):
        try:
            return int(obj) if isinstance(obj, numbers.Integral) else float(obj)
        except TypeError:
            pass  # complex
    return str(obj)

def keys(obj):
    """String keys of a mapping: the own properties of its JavaScript proxy."""
    if isinstance(obj, collections.abc.Mapping):
        return [key for key in obj if type(key) is str]  # str subclasses (StrEnum) are proxies in JavaScript
    return []

# python.withTimeout(): a TimeoutError raised asynchronously in the main thread.
_set_async_exc = ctypes.pythonapi.PyThreadState_SetAsyncExc
_set_async_exc.argtypes = (ctypes.c_ulong, ctypes.c_void_p)

class Watchdog:
    def __init__(self, seconds):
        message = f"Python code interrupted by python.withTimeout() after {seconds:g} s"
        self.error = type("TimeoutError", (TimeoutError,), {"__init__": lambda self: TimeoutError.__init__(self, message)})
        self.lock = threading.Lock()
        self.active = True
        self.timer = threading.Timer(seconds, self.fire)
        self.timer.daemon = True
        self.timer.start()

    def fire(self):
        with self.lock:
            if self.active:
                _set_async_exc(_main, id(self.error))
    # Stopped by JavaScript through the C API: no Python code runs in the
    # main thread, where the TimeoutError could be raised meanwhile.

# asyncio: coroutines run on an event loop in a Python thread. Node.js is
# notified through a channel, a node-ctypes threadSafeCallback notify(kind,
# token) that runs on the Node.js main thread. It is called by a notifier
# thread, never by the event loop, which keeps running meanwhile.
DONE, CALL, CANCEL = 0, 1, 2
_NOTIFY = ctypes.CFUNCTYPE(None, ctypes.c_int, ctypes.c_int)
_loop = None
_lock = threading.Lock()
_notify = None  # the channel, opened by Node.js after initialization
_events = queue.SimpleQueue()
_queued = []  # (kind, token) sent before the channel is open
_requests = {}  # token → JavaScript call waiting for Node.js
_calls = {}  # token → JavaScript call running in Node.js
_tokens = itertools.count(1)
_closing = False

def _notifier():
    while True:
        notify, kind, token = _events.get()
        notify(kind, token)  # releases the GIL; returns once Node.js handled the event

def _send(kind, token):
    with _lock:
        if _closing:
            raise RuntimeError("Python is finalizing: JavaScript cannot be called")
        if _notify is None:
            _queued.append((kind, token))
        else:
            _events.put((_notify, kind, token))

def _run_loop(ready):
    asyncio.set_event_loop(_loop)
    ready.set()
    _loop.run_forever()

def _start_loop():
    global _loop
    with _lock:
        if _loop is not None:
            return
        _loop = asyncio.new_event_loop()
    ready = threading.Event()
    threading.Thread(target=_run_loop, args=(ready,), name="asyncio", daemon=True).start()
    ready.wait()

def open_channel(address):
    global _notify
    threading.Thread(target=_notifier, name="node-ctypes-notifier", daemon=True).start()
    with _lock:
        _notify = _NOTIFY(address)
        for kind, token in _queued:
            _events.put((_notify, kind, token))
        _queued.clear()

def close_channel():
    global _notify
    with _lock:
        _notify = None

def is_awaitable(obj):
    return inspect.isawaitable(obj) or isinstance(obj, concurrent.futures.Future)

async def _await(awaitable):
    return await awaitable

def submit(awaitable, token):
    """Run an awaitable on the event loop; Node.js gets DONE, token when it completes."""
    if isinstance(awaitable, concurrent.futures.Future):
        future = awaitable
    else:
        _start_loop()
        future = asyncio.run_coroutine_threadsafe(_await(awaitable), _loop)
    future.add_done_callback(lambda _: _closing or _send(DONE, token))
    return future

# 1 while the Node.js main thread runs Python code for JavaScript (a c_int in
# JavaScript memory, see Python.#busy): it cannot run JavaScript calls then.
_main_busy = None

def set_busy_flag(address):
    global _main_busy
    _main_busy = ctypes.c_int.from_address(address)

class JsFuture(concurrent.futures.Future):
    """Result of a JavaScript call from a Python thread."""

    name = "a JavaScript function"

    def result(self, timeout=None):
        if timeout is not None or self.done():
            return super().result(timeout)
        try:
            return super().result(5)
        except TimeoutError:
            if _main_busy is not None and _main_busy.value:
                warnings.warn(
                    f"{self.name} has been waiting for 5 s while the Node.js main thread runs Python code "
                    "(a synchronous call from JavaScript). If that code waits for this thread (Thread.join(), "
                    "future.result()), this is a deadlock: an async JavaScript function needs the Node.js event "
                    "loop, and on Windows before Python 3.14 a blocked main thread cannot run JavaScript calls. Await the work from "
                    "JavaScript instead.",
                    RuntimeWarning, stacklevel=2)
        return super().result()

# A thread calling JavaScript while the main thread runs Python code (e.g.
# Thread.join() on that thread): the main thread runs the call itself, from
# inside Python. POSIX: SIGURG (unused by Node.js, ignored by default) is sent
# to the main thread; a blocking wait (join(), lock.acquire(), Event.wait(),
# sleep, I/O) is interrupted, runs the signal handler, then resumes (PEP 475).
# Windows: a pending call, run while the main thread executes bytecode and,
# from Python 3.14, also during its waits: they wait for the interrupt event
# of Ctrl+C too, which is set to wake it.
_wakeup = None  # the signal, when its handler is installed
_interrupt_event = None  # Windows, Python 3.14+

def _serve(token):
    try:
        if token in _requests:  # not served through the channel yet
            _op("serve", token)
    except BaseException:
        traceback.print_exc()  # never raised in the code the main thread runs

def _serve_waiting(*_):
    for token in list(_requests):
        _serve(token)

def install_wakeup():
    """On the main thread: the SIGURG handler, unless SIGURG is already used."""
    global _wakeup, _interrupt_event, _kernel32
    if sys.platform == "win32":
        if sys.version_info >= (3, 14):
            try:
                event = ctypes.pythonapi._PyOS_SigintEvent
                event.restype = ctypes.c_void_p
                _interrupt_event = event()
                _kernel32 = ctypes.WinDLL("kernel32")
                _kernel32.SetEvent.argtypes = _kernel32.ResetEvent.argtypes = (ctypes.c_void_p,)
            except (AttributeError, OSError):
                _interrupt_event = None
        return
    if not hasattr(signal, "pthread_kill") or not hasattr(signal, "SIGURG"):
        return
    if signal.getsignal(signal.SIGURG) not in (signal.SIG_DFL, signal.SIG_IGN, None):
        return  # another runtime (e.g. Go) uses it
    signal.signal(signal.SIGURG, _serve_waiting)
    _wakeup = signal.SIGURG

_PENDING = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p)
_add_pending_call = ctypes.pythonapi.Py_AddPendingCall
_add_pending_call.argtypes = (_PENDING, ctypes.c_void_p)
def _serve_pending(token):
    if _interrupt_event:
        _kernel32.ResetEvent(_interrupt_event)  # manual reset: it would interrupt the next waits
    _serve(token)
    return 0

_serve_pending_c = _PENDING(_serve_pending)

def _wake_main(token):
    if _wakeup is not None:
        signal.pthread_kill(_main, _wakeup)
    else:
        _add_pending_call(_serve_pending_c, token)
        if _interrupt_event:
            _kernel32.SetEvent(_interrupt_event)

def _call_later(fid, args, kwargs, function, awaitable=True):
    """Call a JavaScript function from a thread that is not the Node.js main
    thread: it runs there, and the result comes as a future. In a coroutine
    (thread with a running event loop) it is awaitable, otherwise a
    concurrent.futures.Future. Node.js is woken through the channel: calls
    made while it is closed run when JavaScript awaits Python code again."""
    future = JsFuture()
    future.name = f"JavaScript function {function.__name__}()"
    token = next(_tokens)
    _requests[token] = (fid, args, kwargs, future, function)
    try:
        _send(CALL, token)
    except BaseException:
        del _requests[token]
        raise
    if _main_busy is not None and _main_busy.value:
        _wake_main(token)  # whichever comes first serves the call: the main thread or Node.js
    # Cancelling the future aborts the AbortSignal of cancellable() functions.
    future.add_done_callback(lambda f: f.cancelled() and _cancel(token))
    if not awaitable:
        return future
    try:
        return asyncio.wrap_future(future, loop=asyncio.get_running_loop())
    except RuntimeError:
        return future

def _cancel(token):
    with _lock:
        if (CALL, token) in _queued:  # never sent to Node.js
            _queued.remove((CALL, token))
            _requests.pop(token, None)
            return
    if not _closing:
        _send(CANCEL, token)

def take_request(token):
    """The call, or None if it was cancelled or already served."""
    request = _requests.pop(token, None)
    if request is None:
        return None
    fid, args, kwargs, future, function = request
    if future.cancelled():
        return None
    _calls[token] = future, function
    return fid, args, kwargs

def settle(token, ok, value):
    future, _ = _calls.pop(token, (None, None))
    if future is None or not future.set_running_or_notify_cancel():
        return  # Python is finalizing, or the call was cancelled
    if ok:
        future.set_result(value)
    else:
        future.set_exception(value)

def shutdown():
    """Cancel the pending tasks and stop the event loop."""
    global _closing
    close_channel()
    with _lock:
        _closing = True
        _queued.clear()
    # Unblock the threads waiting for JavaScript.
    pending = [request[3] for request in _requests.values()] + [call[0] for call in _calls.values()]
    _requests.clear()
    _calls.clear()
    for future in pending:
        if future.set_running_or_notify_cancel():
            future.set_exception(RuntimeError("Node.js is exiting: the JavaScript function was not called"))
    if _loop is None or not _loop.is_running():
        return
    async def cancel():
        tasks = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await _loop.shutdown_asyncgens()
    try:
        asyncio.run_coroutine_threadsafe(cancel(), _loop).result(timeout=2)
    except Exception:
        pass
    _loop.call_soon_threadsafe(_loop.stop)
`;

// ─── Locating the interpreter ───────────────────────────────────────

const PROBE = `import json, os, sys, sysconfig
v = sysconfig.get_config_var
print(json.dumps({
    "version": sys.version.split()[0],
    "executable": sys.executable,
    "base_prefix": sys.base_prefix,
    "path": sys.path[1:],
    "libdir": v("LIBDIR"),
    "ldlibrary": v("LDLIBRARY"),
    "instsoname": v("INSTSONAME"),
    "multiarch": v("MULTIARCH"),
    "framework_prefix": v("PYTHONFRAMEWORKPREFIX"),
    "abiflags": getattr(sys, "abiflags", ""),
    "dll": "python%d%d%s.dll" % (*sys.version_info[:2], "t" if v("Py_GIL_DISABLED") else "") if os.name == "nt" else None,
}))`;

/** Run the interpreter to read its version, paths and library location. */
function probeInterpreter(executable) {
  const commands = executable ? [[executable]] : process.env.PYTHON ? [[process.env.PYTHON]] : process.platform === "win32" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  const failures = [];
  for (const [command, ...args] of commands) {
    try {
      const output = execFileSync(command, [...args, "-c", PROBE], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      return JSON.parse(output);
    } catch (error) {
      failures.push(`${[command, ...args].join(" ")}: ${error.code ?? error.message.split("\n")[0]}`);
    }
  }
  throw new Error(`Python interpreter not found (${failures.join("; ")}). Install Python 3 or pass Python.initialize({ executable }).`);
}

/** Possible paths of the Python shared library, most specific first. */
function libraryCandidates(info) {
  if (process.platform === "win32") {
    return [path.join(info.base_prefix, info.dll), path.join(path.dirname(info.executable), info.dll)];
  }
  const short = info.version.split(".").slice(0, 2).join(".") + (info.abiflags ?? ""); // "3.14t": free-threaded
  const candidates = [];
  const names = [info.instsoname, info.ldlibrary].filter((name) => name && !name.endsWith(".a"));
  if (process.platform === "darwin") {
    if (info.framework_prefix && info.ldlibrary?.includes(".framework/")) {
      candidates.push(path.join(info.framework_prefix, info.ldlibrary));
    }
    names.push(`libpython${short}.dylib`);
  } else {
    names.push(`libpython${short}.so.1.0`, `libpython${short}.so`);
  }
  const dirs = [info.libdir, info.libdir && info.multiarch ? path.join(info.libdir, info.multiarch) : null].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  return [...new Set(candidates)];
}

/** Load libpython with RTLD_GLOBAL, so that C extension modules find its symbols. */
function loadLibrary(info, library) {
  if (library) return { lib: new CDLL(library, RTLD_GLOBAL), library };

  if (process.platform === "win32") {
    // vcruntime140*.dll ship next to python3x.dll (Python: os.add_dll_directory).
    const kernel32 = new WinDLL("kernel32.dll");
    kernel32.AddDllDirectory.argtypes = [c_wchar_p];
    kernel32.AddDllDirectory.restype = c_void_p;
    kernel32.AddDllDirectory(info.base_prefix);
  }
  const candidates = libraryCandidates(info);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { lib: new CDLL(candidate, RTLD_GLOBAL), library: candidate };
  }
  // Linux: the soname may be found through the dynamic linker search path.
  if (info.instsoname) {
    try {
      return { lib: new CDLL(info.instsoname, RTLD_GLOBAL), library: info.instsoname };
    } catch {
      // not in the search path
    }
  }
  throw new Error(`The Python shared library of ${info.executable} was not found (searched: ${candidates.join(", ")}). ` + "Python must be built with --enable-shared (Debian/Ubuntu: install libpython3.x), or pass Python.initialize({ library }).");
}

// ─── Errors and keyword arguments ───────────────────────────────────

/** A Python exception raised in JavaScript. */
export class PythonError extends Error {
  /**
   * @param {string} type - Exception class name (e.g. "ZeroDivisionError")
   * @param {string} message - str(exception)
   * @param {string} traceback - Formatted Python traceback
   * @param {*} exception - The exception object (PyObject proxy)
   */
  constructor(type, message, traceback, exception) {
    super(message ? `${type}: ${message}` : type);
    this.name = "PythonError";
    this.type = type;
    Object.defineProperties(this, {
      traceback: { value: traceback, writable: true, configurable: true },
      exception: { value: exception, writable: true, configurable: true },
    });
    if (traceback) this.stack += `\n\nPython ${traceback.trimEnd()}`;
  }
}

/**
 * A Python tuple in JavaScript: tuples converted deeply (`eval()`, `toJS()`)
 * are Tuples, and Tuples are converted to tuples: `Tuple.of(1, 2)`.
 */
export class Tuple extends Array {
  static get [Symbol.species]() {
    return Array; // map(), filter(), ... return plain arrays
  }
}

class ByReference {
  constructor(value) {
    this.value = value;
  }
}

/**
 * Pass a JavaScript value to Python by reference instead of by value: objects
 * and arrays become a JsProxy (changes made by Python are seen by
 * JavaScript), a Uint8Array/Buffer a writable memoryview of its memory.
 * @param {Object} value
 */
export function byReference(value) {
  return new ByReference(value);
}

const CANCELLABLE = Symbol("cancellable");

/**
 * Mark a JavaScript function as cancellable: it gets an AbortSignal as last
 * argument, aborted when Python cancels the call (e.g. the coroutine awaiting
 * it is cancelled, or asyncio.wait_for times out).
 * @param {Function} fn
 * @returns {Function} fn
 */
export function cancellable(fn) {
  fn[CANCELLABLE] = true;
  return fn;
}

// A JavaScript error raised in Python as a specific built-in exception.
const PY_TYPE = Symbol("python exception type");
const pythonError = (type, message) => Object.assign(new Error(message), { [PY_TYPE]: type });
const isClass = (fn) => /^class[\s{]/.test(Function.prototype.toString.call(fn));
const typeName = (value) => value?.constructor?.name ?? typeof value;
// Typed array → memoryview format.
const FORMATS = { Int8Array: "b", Uint8Array: "B", Uint8ClampedArray: "B", Int16Array: "h", Uint16Array: "H", Int32Array: "i", Uint32Array: "I", Float16Array: "e", Float32Array: "f", Float64Array: "d", BigInt64Array: "q", BigUint64Array: "Q" };

class Kwargs {
  constructor(values) {
    this.values = values;
  }
}

/**
 * Keyword arguments of a Python call, as its last argument:
 * `json.dumps(data, kwargs({ indent: 2 }))` is `json.dumps(data, indent=2)`.
 * @param {Object} values
 */
export function kwargs(values) {
  return new Kwargs(values);
}

// ─── Python ─────────────────────────────────────────────────────────

const DONE = Symbol("done");
// One interpreter per process, hosted by one thread (the main thread or a
// worker). Workers do not share modules: the claim is a file created
// atomically (O_EXCL), named after the process and holding its start time (a
// file left by a dead process with the same pid is stale).
const HOST_LOCK = path.join(tmpdir(), `node-ctypes-python-${process.pid}.lock`);
const PROCESS_START = String(Math.round(Date.now() / 1000 - process.uptime()));

function claimHost() {
  // Files left by processes that died without finalizing Python.
  for (const name of readdirSync(tmpdir())) {
    const pid = Number(/^node-ctypes-python-(\d+)\.lock$/.exec(name)?.[1]);
    if (!pid || pid === process.pid) continue;
    try {
      process.kill(pid, 0); // only checks that the process exists
    } catch (error) {
      if (error.code === "ESRCH") rmSync(path.join(tmpdir(), name), { force: true });
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(HOST_LOCK, PROCESS_START, { flag: "wx" });
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = "";
      try {
        owner = readFileSync(HOST_LOCK, "utf8");
      } catch {
        // being written or removed: retry
      }
      if (attempt === 0 && owner && Math.abs(Number(owner) - Number(PROCESS_START)) > 2) {
        unlinkSync(HOST_LOCK); // stale
        continue;
      }
      throw new Error("Python is already initialized in this process by another thread (the main thread or a worker): one thread hosts the interpreter, use it from there.");
    }
  }
}

function releaseHost() {
  try {
    unlinkSync(HOST_LOCK);
  } catch {
    // already removed
  }
}
// Channel events (see BRIDGE).
const EVENT_DONE = 0;
const EVENT_CALL = 1;
const EVENT_CANCEL = 2;
const isIndex = (prop) => /^-?(0|[1-9]\d*)$/.test(prop);

// Temporal (Node.js 26+): date, time and timedelta ↔ PlainDate, PlainTime and Duration.
const { Temporal } = globalThis;
const NS_PER_US = 1000n;

/** Arguments of the bridge's from_temporal() for a Temporal value, or null. */
function temporalFields(value) {
  if (value instanceof Temporal.PlainDate) return ["date", value.year, value.month, value.day];
  if (value instanceof Temporal.PlainTime) return ["time", value.hour, value.minute, value.second, value.millisecond * 1000 + value.microsecond];
  if (value instanceof Temporal.PlainDateTime) return ["datetime", value.year, value.month, value.day, value.hour, value.minute, value.second, value.millisecond * 1000 + value.microsecond];
  if (value instanceof Temporal.Instant) return ["instant", value.epochNanoseconds / NS_PER_US];
  if (value instanceof Temporal.ZonedDateTime) return ["zoned", value.epochNanoseconds / NS_PER_US, value.timeZoneId, value.offsetNanoseconds / 1000];
  if (value instanceof Temporal.Duration) {
    if (value.years || value.months) throw new TypeError("A Temporal.Duration with years or months has no timedelta equivalent");
    const micros =
      BigInt(value.weeks * 7 + value.days) * 86_400_000_000n +
      BigInt(value.hours) * 3_600_000_000n +
      BigInt(value.minutes) * 60_000_000n +
      BigInt(value.seconds) * 1_000_000n +
      BigInt(value.milliseconds) * 1000n +
      BigInt(value.microseconds) +
      BigInt(value.nanoseconds) / NS_PER_US;
    return ["duration", micros];
  }
  return null;
}
// Function.prototype members used by JavaScript code on callables (handler.apply(this, args), fn.bind()).
const FUNCTION_MEMBERS = new Set(["apply", "call", "bind", "length", "name"]);
let instance = null;
let constructing = false;

/**
 * The embedded Python interpreter. CPython can be initialized once per
 * process: use `Python.initialize()`.
 */
export class Python {
  #api = {};
  #types = {};
  #none;
  #true;
  #runtimeError;
  #attributeError;
  #mainThread; // threading.get_ident() of the Node.js main thread
  #depth = 0; // nested JavaScript → Python calls holding the GIL
  #gilState = 0;
  #threadState = null;
  #finalized = false;
  #states = new WeakMap(); // proxy and proxy target → { ptr }
  #registry;
  #handler;
  #functions = new Map(); // id → { fn, def }
  #nextId = 1n;
  #jsErrors = new Map();
  #trampoline;
  #bridge = {}; // helper functions of BRIDGE (proxies)
  #drainScheduled = false;
  #awaits = new Map(); // token → { future, resolve, reject }
  #controllers = new Map(); // token → AbortController of a running cancellable() call
  #objects = new Map(); // id → { value, count }: JavaScript objects used by Python (JsProxy)
  #objectIds = new WeakMap(); // object → id
  #jsProxyType;
  #functionType; // types.FunctionType: JavaScript functions are wrapped in Python functions
  #javascriptCode; // code object of those wrappers
  #keep = new WeakMap(); // ArrayBuffer of Python memory → holder that pins it
  #busy = new Int32Array(1); // 1 while the main thread runs Python code (read by Python threads)
  #proxies = 0; // live PyObject proxies
  #nextToken = 1;
  #channel = null; // threadSafeCallback woken by Python threads (see #openChannel)
  #main;
  #builtins;

  /**
   * Initialize the embedded interpreter, or return the running one.
   *
   * @param {Object} [options]
   * @param {string} [options.executable] - Python interpreter whose library and environment are used (default: $PYTHON, python3, python, py)
   * @param {string} [options.library] - Explicit path of the Python shared library (default: $PYTHON_LIBRARY); same version as the interpreter
   * @param {boolean} [options.stdin=true] - false: Python does not read the process stdin (sys.stdin is None), left to Node.js
   * @returns {Python}
   */
  static initialize(options = {}) {
    if (instance) {
      if (instance.#finalized) throw new Error("Python has been finalized and cannot be initialized again in this process");
      return instance;
    }
    constructing = true;
    try {
      instance = new Python(options);
    } finally {
      constructing = false;
    }
    return instance;
  }

  constructor({ executable, library = process.env.PYTHON_LIBRARY, stdin = true } = {}) {
    if (!constructing) throw new TypeError("Use Python.initialize()");

    claimHost(); // one interpreter per process (see HOST_LOCK)
    try {
      this.#start(executable, library, stdin);
    } catch (error) {
      releaseHost();
      throw error;
    }
  }

  #start(executable, library, stdin) {
    const info = probeInterpreter(executable);
    const [pyMajor, pyMinor] = info.version.split(".").map(Number);
    if (pyMajor < MIN_PYTHON[0] || (pyMajor === MIN_PYTHON[0] && pyMinor < MIN_PYTHON[1])) {
      throw new Error(`${info.executable} is Python ${info.version}: python.js requires Python ${MIN_PYTHON.join(".")}+ (pass another interpreter with Python.initialize({ executable }) or the PYTHON environment variable).`);
    }
    const loaded = loadLibrary(info, library);

    // The library must match the interpreter that provides sys.path and home.
    const getVersion = loaded.lib.Py_GetVersion;
    getVersion.argtypes = [];
    getVersion.restype = c_char_p;
    const libraryVersion = getVersion().split(" ")[0];
    const minor = (version) => version.split(".").slice(0, 2).join(".");
    if (minor(libraryVersion) !== minor(info.version)) {
      throw new Error(
        `${loaded.library} is Python ${libraryVersion}, but ${info.executable} is Python ${info.version}: ` + "pass the matching interpreter too (Python.initialize({ executable, library }), or the PYTHON and PYTHON_LIBRARY environment variables).",
      );
    }

    // Initialized by other code in the process (another native module).
    const isInitialized = loaded.lib.Py_IsInitialized;
    isInitialized.argtypes = [];
    isInitialized.restype = c_int;
    if (isInitialized()) throw new Error("Python is already initialized in this process by other code");

    /** Python version (e.g. "3.12.8"). */
    this.version = info.version;
    /** Interpreter whose environment (sys.path, virtual environment) is used. */
    this.executable = info.executable;
    /** Loaded shared library. */
    this.library = loaded.library;

    const lib = loaded.lib;
    for (const [name, [restype, argtypes]] of Object.entries(API)) {
      const fn = lib[name];
      fn.restype = restype;
      fn.argtypes = argtypes;
      this.#api[name] = fn;
    }
    for (const name of TYPES) this.#types[name] = lib.symbol(name);
    this.#none = lib.symbol("_Py_NoneStruct");
    this.#true = lib.symbol("_Py_TrueStruct");
    this.#runtimeError = c_void_p.in_dll(lib, "PyExc_RuntimeError").value;
    this.#attributeError = c_void_p.in_dll(lib, "PyExc_AttributeError").value;

    // Without PYTHONHOME an embedded Python derives its prefix from the node
    // executable; on Windows it is found from the DLL location.
    const setHome = process.platform !== "win32" && process.env.PYTHONHOME === undefined;
    if (setHome) process.env.PYTHONHOME = info.base_prefix;
    try {
      this.#api.Py_InitializeEx(0); // 0: signals stay with Node.js
    } finally {
      if (setHome) delete process.env.PYTHONHOME;
    }

    // The GIL is held after initialization.
    this.#depth = 1;
    try {
      this.#setup(info, stdin);
    } finally {
      this.#depth = 0;
    }
    // Release the GIL: every call from JavaScript reacquires it.
    this.#threadState = this.#api.PyEval_SaveThread();

    process.once("exit", () => this.finalize());
  }

  #setup(info, stdin) {
    const api = this.#api;
    this.#registry = new FinalizationRegistry((state) => {
      if (!state.ptr || this.#finalized) return;
      this.#proxies--;
      this.#withGIL(() => api.Py_DecRef(state.ptr));
      this.#scheduleDrain(); // the object may have held JavaScript functions
    });
    this.#handler = this.#proxyHandler();
    this.#trampoline = PyCFunctionWithKeywords((self, args, kw) => this.#callJS(self, args, kw));

    this.#main = this.#import("__main__");
    this.#builtins = this.#import("builtins");
    const bridge = this.#import("types").ModuleType("_node_ctypes");
    this.#builtins.exec(this.#builtins.compile(BRIDGE, "<node-ctypes>", "exec"), bridge.__dict__);
    for (const name of [
      "wrap",
      "take_released",
      "format_exception",
      "get_fallback",
      "set_fallback",
      "delete_fallback",
      "has",
      "is_key",
      "item",
      "keys",
      "to_primitive",
      "Watchdog",
      "JsProxy",
      "JAVASCRIPT_CODE",
      "is_async_iterable",
      "aiter_of",
      "anext_of",
      "aclose_of",
      "memory",
      "export_buffer",
      "from_timestamp",
      "timestamp",
      "to_js_value",
      "from_temporal",
      "is_awaitable",
      "submit",
      "open_channel",
      "close_channel",
      "take_request",
      "settle",
      "shutdown",
      "_calls",
      "_requests",
    ]) {
      this.#bridge[name] = bridge[name];
    }
    this.#mainThread = bridge._main;
    this.#jsProxyType = this.#pointer(this.#bridge.JsProxy);
    this.#functionType = this.#typeOf(this.#pointer(this.#bridge.wrap));
    this.#javascriptCode = this.#pointer(this.#bridge.JAVASCRIPT_CODE);
    const javascript_object = (op, object, ...args) => this.#jsOp(op, object, ...args);
    bridge.set_op(javascript_object);
    bridge.set_busy_flag(addressof(Buffer.from(this.#busy.buffer)));
    bridge.install_wakeup();
    this.#openChannel();

    // The environment of the probed interpreter (virtual environment included).
    const sys = this.#import("sys");
    sys.path = ["", ...info.path];
    sys.executable = info.executable;
    sys.argv = [process.argv[1] ?? ""];
    // Python reads stdin through a buffer: what it reads is lost for Node.js.
    if (!stdin) sys.stdin = null;
  }

  // ── Public API ────────────────────────────────────────────────────

  /** The `__main__` module, where `exec` and `eval` run. */
  get main() {
    return this.#main;
  }

  /** The `builtins` module (`len`, `sorted`, `dict`, ...). */
  get builtins() {
    return this.#builtins;
  }

  /**
   * Execute Python statements in `__main__`.
   * @param {string} code
   */
  exec(code) {
    this.#withGIL(() => this.#api.Py_DecRef(this.#run(code, Py_file_input, this.#mainDict())));
  }

  /**
   * Evaluate a Python expression in `__main__` and convert the result to
   * JavaScript, deeply (lists, tuples, dicts and sets included).
   * @param {string} expression
   * @returns {*}
   */
  eval(expression) {
    return this.#withGIL(() => this.#takeDeep(this.#run(expression, Py_eval_input, this.#mainDict())));
  }

  /**
   * Import a module (Python: `import name`).
   * @param {string} name - Module name, e.g. "json" or "os.path"
   * @returns {*} Module proxy
   */
  import(name) {
    return this.#withGIL(() => this.#import(name));
  }

  /**
   * Create a module from JavaScript values and functions, importable by
   * Python code (`import name`). A dotted name is a submodule (`node.fs`:
   * `import node.fs`, `from node import fs`); missing parents are created as
   * empty packages.
   * @param {string} name - Module name
   * @param {Object} members - Module attributes
   * @returns {*} Module proxy
   */
  module(name, members) {
    return this.#withGIL(() => {
      const types = this.#import("types");
      const modules = this.#import("sys").modules;
      const module = types.ModuleType(name);
      for (const [key, value] of Object.entries(members)) module[key] = value;
      modules.__setitem__(name, module);
      // Link the module to its parent package, creating the missing ones.
      for (let child = module, childName = name; childName.includes(".");) {
        const dot = childName.lastIndexOf(".");
        const parentName = childName.slice(0, dot);
        let parent = modules.get(parentName);
        let created = false;
        if (parent === null) {
          try {
            parent = this.#import(parentName); // an existing package (json for json.extra)
          } catch (error) {
            const missing = error instanceof PythonError && error.type === "ModuleNotFoundError" ? error.exception.name : null;
            if (!(missing === parentName || parentName.startsWith(`${missing}.`))) throw error;
            parent = types.ModuleType(parentName);
            parent.__path__ = []; // a package
            modules.__setitem__(parentName, parent);
            created = true;
          }
        }
        this.#builtins.setattr(parent, childName.slice(dot + 1), child);
        if (!created) break;
        [child, childName] = [parent, parentName];
      }
      return module;
    });
  }

  /**
   * Convert a JavaScript value to a Python object, kept as a proxy (e.g. a
   * list modified by Python, or reused across calls without conversions).
   * @param {*} value
   * @returns {*} PyObject proxy
   */
  toPython(value) {
    return this.#withGIL(() => this.#wrap(this.#toPy(value)));
  }

  /**
   * Await a Python awaitable (coroutine, task, future) like `await obj`, with
   * an AbortSignal that cancels it: `python.run(coro, { signal:
   * AbortSignal.timeout(1000) })`. The promise rejects with `signal.reason`.
   *
   * @param {*} awaitable - PyObject proxy
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<*>}
   */
  run(awaitable, { signal } = {}) {
    if (!this.#states.has(awaitable)) throw new TypeError("python.run() needs a Python awaitable");
    const promise = this.#promise(awaitable);
    if (!signal) return promise;
    const state = this.#states.get(awaitable);
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (state.ptr && !this.#finalized) this.#withGIL(() => state.future?.cancel());
        reject(signal.reason);
      };
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  /**
   * Python's `with` statement: enter the context manager, run `body` with
   * the value of `__enter__()`, then exit it, passing the error thrown by
   * `body` to `__exit__()` (which may suppress it). If `body` returns a
   * promise, the context manager is exited when it settles.
   *
   * @example python.with(python.builtins.open(file), (f) => f.read())
   * @param {*} manager - Context manager (PyObject proxy)
   * @param {Function} body - Called with the value of `__enter__()`
   * @returns {*} What `body` returns (undefined if the error was suppressed)
   */
  with(manager, body) {
    const [enter, exit] = this.#withGIL(() => {
      const type = this.#builtins.type(manager);
      return [type.__enter__, type.__exit__];
    });
    const fail = (error) => {
      if (!this.#exit(exit, manager, error)) throw error;
    };
    const value = enter(manager);
    let result;
    try {
      result = body(value);
    } catch (error) {
      return fail(error);
    }
    if (typeof result?.then === "function" && !this.#states.has(result)) {
      return Promise.resolve(result).then((settled) => {
        exit(manager, null, null, null);
        return settled;
      }, fail);
    }
    exit(manager, null, null, null);
    return result;
  }

  /**
   * Python's `async with` statement for asynchronous context managers
   * (`__aenter__` / `__aexit__`), awaited on the asyncio event loop.
   *
   * @param {*} manager - Asynchronous context manager (PyObject proxy)
   * @param {Function} body - Called with the value of `__aenter__()`; may be async
   * @returns {Promise<*>} What `body` returns (undefined if the error was suppressed)
   */
  async asyncWith(manager, body) {
    const [enter, exit] = this.#withGIL(() => {
      const type = this.#builtins.type(manager);
      return [type.__aenter__, type.__aexit__];
    });
    const value = await enter(manager);
    let result;
    try {
      result = await body(value);
    } catch (error) {
      if (await this.#exit(exit, manager, error)) return undefined;
      throw error;
    }
    await exit(manager, null, null, null);
    return result;
  }

  /** Call `__exit__` / `__aexit__` with the Python version of a JavaScript error. */
  #exit(exit, manager, error) {
    return this.#withGIL(() => {
      const exc = this.#wrap(this.#exception(error));
      const result = exit(manager, this.#builtins.type(exc), exc, exc.__traceback__);
      return this.#states.has(result) && this.#bridge.is_awaitable(result) ? Promise.resolve(result).then((r) => this.#builtins.bool(r)) : this.#builtins.bool(result);
    });
  }

  /**
   * Run synchronous code with a time limit: Python code still running in the
   * Node.js main thread after `ms` milliseconds is interrupted by a
   * TimeoutError (raised between bytecodes: a long call into C code, such as
   * time.sleep(), is interrupted when it returns).
   *
   * @example python.withTimeout(1000, () => python.main.solve(puzzle))
   * @param {number} ms - Time limit in milliseconds
   * @param {Function} fn - Synchronous function calling Python
   * @returns {*} What `fn` returns
   */
  withTimeout(ms, fn) {
    const watchdog = this.#withGIL(() => this.#bridge.Watchdog(ms / 1000));
    try {
      return fn();
    } finally {
      // Only C API calls here: no Python code runs in the main thread, where
      // a TimeoutError raised meanwhile would escape.
      this.#withGIL(() => {
        const lock = watchdog.lock;
        lock.acquire();
        watchdog.active = false;
        this.#api.PyThreadState_SetAsyncExc(this.#mainThread, null); // not raised yet: discarded
        lock.release();
      });
      watchdog.timer.cancel();
    }
  }

  /**
   * Objects shared by the two languages, to find leaks: PyObject proxies
   * alive in JavaScript, JavaScript functions and objects (JsProxy) used by
   * Python, pending awaits and JavaScript calls from Python threads.
   * @returns {{ proxies: number, functions: number, objects: number, awaits: number, calls: number }}
   */
  stats() {
    const calls = this.#finalized ? 0 : this.#withGIL(() => this.#builtins.len(this.#bridge._calls) + this.#builtins.len(this.#bridge._requests));
    return { proxies: this.#proxies, functions: this.#functions.size, objects: this.#objects.size, awaits: this.#awaits.size, calls };
  }

  /**
   * Finalize the interpreter (atexit handlers, flush, waits for non-daemon
   * threads). Runs automatically when the process exits; Python cannot be
   * used afterwards.
   */
  finalize() {
    if (this.#finalized || this.#threadState === null) return;
    if (this.#depth > 0) {
      // Called while Python code runs on this thread (process.exit() in a
      // JavaScript function called by Python): the GIL is held by the Python
      // frames below, which cannot be finalized. The process is exiting.
      this.#finalized = true;
      releaseHost();
      return;
    }
    this.#api.PyEval_RestoreThread(this.#threadState);
    this.#depth = 1;
    try {
      this.#bridge.shutdown();
    } catch {
      // finalize anyway
    }
    this.#api.Py_FinalizeEx();
    releaseHost();
    this.#finalized = true;
    this.#functions.clear();
    // Pending awaits never complete, and the channel must not keep Node.js alive.
    for (const { reject } of this.#awaits.values()) reject(new Error("Python has been finalized"));
    this.#awaits.clear();
    this.#channel?.release();
    this.#channel = null;
  }

  // ── GIL ───────────────────────────────────────────────────────────

  #withGIL(fn) {
    if (this.#finalized) throw new Error("Python has been finalized");
    if (this.#depth++ === 0) {
      this.#gilState = this.#api.PyGILState_Ensure();
      this.#busy[0] = 1;
    }
    try {
      return fn();
    } finally {
      if (--this.#depth === 0) {
        this.#busy[0] = 0;
        this.#api.PyGILState_Release(this.#gilState);
      }
    }
  }

  // ── Conversions (GIL held) ────────────────────────────────────────

  #pointer(proxy) {
    const state = this.#states.get(proxy);
    if (!state?.ptr) throw new Error("Python object has been released");
    return state.ptr;
  }

  #mainDict() {
    return this.#api.PyModule_GetDict(this.#pointer(this.#main));
  }

  #check(ptr) {
    if (!ptr) throw this.#fetchError();
    return ptr;
  }

  #run(source, start, globals) {
    const api = this.#api;
    return this.#using(this.#check(api.Py_CompileString(source, "<string>", start)), (code) => this.#check(api.PyEval_EvalCode(code, globals, globals)));
  }

  #import(name) {
    return this.#take(this.#api.PyImport_ImportModule(name));
  }

  #typeOf(ptr) {
    const type = this.#api.PyObject_Type(ptr);
    this.#api.Py_DecRef(type); // type objects outlive their instances
    return type;
  }

  /** Call a Python callable with new references as arguments (stolen); returns a new reference. */
  #callRaw(callable, args) {
    const api = this.#api;
    const tuple = this.#filled(api.PyTuple_New(args.length), (t) => args.forEach((arg, i) => api.PyTuple_SetItem(t, i, arg)));
    return this.#using(tuple, (t) => this.#check(api.PyObject_Call(this.#pointer(callable), t, null)));
  }

  /** Use a new reference, then release it. */
  #using(ptr, use) {
    try {
      return use(ptr);
    } finally {
      this.#api.Py_DecRef(ptr);
    }
  }

  /** New reference → JavaScript (shallow). */
  #take(ptr) {
    return this.#using(this.#check(ptr), (p) => this.#fromPy(p, false));
  }

  /** New reference → JavaScript (deep). */
  #takeDeep(ptr) {
    return this.#using(this.#check(ptr), (p) => this.#fromPy(p, true));
  }

  /** Borrowed reference → JavaScript value or PyObject proxy. */
  #fromPy(ptr, deep) {
    const api = this.#api;
    const T = this.#types;
    if (ptr === this.#none) return null;
    const type = this.#typeOf(ptr);
    switch (type) {
      case T.PyBool_Type:
        return ptr === this.#true;
      case T.PyLong_Type: {
        const overflow = new c_int();
        const value = api.PyLong_AsLongLongAndOverflow(ptr, byref(overflow));
        if (overflow.value) return BigInt(this.#take(api.PyObject_Str(ptr)));
        return value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : value;
      }
      case T.PyFloat_Type:
        return api.PyFloat_AsDouble(ptr);
      case T.PyUnicode_Type: {
        const size = new c_ssize_t();
        const data = this.#check(api.PyUnicode_AsUTF8AndSize(ptr, byref(size)));
        return string_at(data, Number(size.value));
      }
      case T.PyBytes_Type: {
        const data = new c_void_p();
        const size = new c_ssize_t();
        if (api.PyBytes_AsStringAndSize(ptr, byref(data), byref(size)) < 0) throw this.#fetchError();
        const bytes = Buffer.alloc(Number(size.value));
        if (bytes.length) memmove(bytes, data.value, bytes.length);
        return bytes;
      }
    }
    if (type === this.#jsProxyType) {
      const id = this.#take(api.PyObject_GetAttrString(ptr, "_id"));
      return this.#objects.get(BigInt(id))?.value;
    }
    if (type === this.#functionType && this.#using(this.#check(api.PyObject_GetAttrString(ptr, "__code__")), (code) => code === this.#javascriptCode)) {
      const fn = this.#functions.get(BigInt(this.#take(api.PyObject_GetAttrString(ptr, "_node_ctypes_id"))))?.fn;
      if (fn) return fn; // a JavaScript function back in JavaScript
    }
    if (deep) {
      switch (type) {
        case T.PyList_Type:
        case T.PyTuple_Type: {
          const list = type === T.PyList_Type;
          const size = Number(list ? api.PyList_Size(ptr) : api.PyTuple_Size(ptr));
          const items = list ? new Array(size) : new Tuple(size);
          for (let i = 0; i < size; i++) items[i] = this.#fromPy(list ? api.PyList_GetItem(ptr, i) : api.PyTuple_GetItem(ptr, i), true);
          return items;
        }
        case T.PyDict_Type: {
          const entries = [];
          const pos = new c_ssize_t();
          const key = new c_void_p();
          const value = new c_void_p();
          while (api.PyDict_Next(ptr, byref(pos), byref(key), byref(value))) {
            entries.push([this.#fromPy(key.value, true), this.#fromPy(value.value, true)]);
          }
          return entries.every(([k]) => typeof k === "string") ? Object.fromEntries(entries) : new Map(entries);
        }
        case T.PySet_Type:
        case T.PyFrozenSet_Type:
          return new Set(this.#items(ptr));
      }
      api.Py_IncRef(ptr);
      const special = this.#takeDeep(this.#callRaw(this.#bridge.to_js_value, [ptr, this.#toPy(Boolean(Temporal))]));
      if (special !== null) {
        const [kind, ...f] = special;
        switch (kind) {
          case "Date":
            return new Date(f[0]);
          case "PlainDate":
            return new Temporal.PlainDate(f[0], f[1], f[2]);
          case "PlainTime":
            return new Temporal.PlainTime(f[0], f[1], f[2], Math.floor(f[3] / 1000), f[3] % 1000);
          case "Duration":
            return new Temporal.Duration(0, 0, 0, ...f);
        }
      }
    }
    api.Py_IncRef(ptr);
    return this.#wrap(ptr);
  }

  /** Items of an iterable, deeply converted. */
  #items(ptr) {
    const api = this.#api;
    return this.#using(this.#check(api.PyObject_GetIter(ptr)), (iterator) => {
      const items = [];
      for (let item = api.PyIter_Next(iterator); item; item = api.PyIter_Next(iterator)) {
        items.push(this.#using(item, (p) => this.#fromPy(p, true)));
      }
      if (api.PyErr_Occurred()) throw this.#fetchError();
      return items;
    });
  }

  /** JavaScript value → new reference. */
  #toPy(value) {
    const api = this.#api;
    if (value === null || value === undefined) {
      api.Py_IncRef(this.#none);
      return this.#none;
    }
    if (this.#states.has(value)) {
      const ptr = this.#pointer(value);
      api.Py_IncRef(ptr);
      return ptr;
    }
    switch (typeof value) {
      case "boolean":
        return this.#check(api.PyBool_FromLong(value ? 1 : 0));
      case "number":
        if (!Number.isInteger(value)) return this.#check(api.PyFloat_FromDouble(value));
        return this.#check(Number.isSafeInteger(value) ? api.PyLong_FromLongLong(value) : api.PyLong_FromDouble(value));
      case "bigint":
        return this.#check(api.PyLong_FromString(value.toString(), null, 10));
      case "string": {
        const utf8 = Buffer.from(value, "utf8");
        return this.#check(api.PyUnicode_DecodeUTF8(utf8, utf8.length, null));
      }
      case "function":
        return this.#function(value);
    }
    if (value instanceof Kwargs) throw new TypeError("kwargs() must be the last argument of a call");
    if (value instanceof ByReference) return this.#reference(value.value);
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new TypeError("Cannot convert an Invalid Date to a Python object");
      return this.#callRaw(this.#bridge.from_timestamp, [this.#toPy(value.getTime())]);
    }
    if (Temporal) {
      const fields = temporalFields(value);
      if (fields)
        return this.#callRaw(
          this.#bridge.from_temporal,
          fields.map((field) => this.#toPy(field)),
        );
    }
    if (value instanceof Uint8Array && !(value instanceof Uint8ClampedArray)) return this.#check(api.PyBytes_FromStringAndSize(value, value.byteLength));
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return this.#memoryview(value);
    if (value instanceof Tuple) {
      return this.#filled(api.PyTuple_New(value.length), (tuple) => {
        for (let i = 0; i < value.length; i++) api.PyTuple_SetItem(tuple, i, this.#toPy(value[i])); // steals the item
      });
    }
    if (Array.isArray(value)) {
      return this.#filled(api.PyList_New(value.length), (list) => {
        for (let i = 0; i < value.length; i++) api.PyList_SetItem(list, i, this.#toPy(value[i])); // steals the item
      });
    }
    if (value instanceof Set) {
      return this.#filled(api.PySet_New(null), (set) => {
        for (const item of value) this.#status(this.#using(this.#toPy(item), (p) => api.PySet_Add(set, p)));
      });
    }
    const proto = Object.getPrototypeOf(value);
    if (value instanceof Map || proto === Object.prototype || proto === null) {
      return this.#filled(api.PyDict_New(), (dict) => {
        for (const [k, v] of value instanceof Map ? value.entries() : Object.entries(value)) {
          this.#status(this.#using(this.#toPy(k), (key) => this.#using(this.#toPy(v), (item) => api.PyDict_SetItem(dict, key, item))));
        }
      });
    }
    return this.#jsProxy(value); // class instances, promises, iterators, ...
  }

  /** byReference(value) → new reference. */
  #reference(value) {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return this.#memoryview(value);
    if (value === null || typeof value !== "object" || this.#states.has(value)) return this.#toPy(value);
    return this.#jsProxy(value);
  }

  /** JsProxy of a JavaScript object (new reference). */
  #jsProxy(value) {
    let id = this.#objectIds.get(value);
    if (id === undefined) {
      id = this.#nextId++;
      this.#objectIds.set(value, id);
      this.#objects.set(id, { value, count: 0 });
    }
    const entry = this.#objects.get(id);
    entry.count++; // one per JsProxy instance: decremented by its weakref.finalize
    try {
      return this.#callRaw(this.#bridge.JsProxy, [this.#toPy(id)]);
    } catch (error) {
      this.#forgetObject(id);
      throw error;
    }
  }

  #forgetObject(id) {
    const entry = this.#objects.get(id);
    if (!entry || --entry.count > 0) return;
    this.#objects.delete(id);
    this.#objectIds.delete(entry.value);
  }

  /** memoryview sharing the memory of a typed array / ArrayBuffer / DataView (new reference). */
  #memoryview(value) {
    const view = value instanceof ArrayBuffer || value instanceof SharedArrayBuffer ? new Uint8Array(value) : value;
    const bytes = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    const format = FORMATS[view.constructor.name] ?? "B"; // DataView: bytes
    const address = bytes.length ? addressof(bytes) : 0n;
    return this.#callRaw(this.#bridge.memory, [this.#toPy(address), this.#toPy(bytes.length), this.#toPy(format), this.#jsProxy(view.buffer)]);
  }

  /** Typed array sharing the memory of a Python buffer (copied if read-only). */
  #typedArray(target) {
    return this.#withGIL(() => {
      const [name, holder, address, size, copy] = this.#bridge.export_buffer(target);
      const Type = globalThis[name] ?? Uint8Array;
      if (copy) return new Type(copy.buffer, copy.byteOffset, copy.length / Type.BYTES_PER_ELEMENT);
      if (!size) return new Type(0);
      const memory = ptrToBuffer(address, size);
      this.#keep.set(memory.buffer, holder); // pins the Python buffer while the memory is used
      return new Type(memory.buffer, memory.byteOffset, size / Type.BYTES_PER_ELEMENT);
    });
  }

  // ── JavaScript objects used by Python (JsProxy) ───────────────────

  /** An operation of a JsProxy, on the Node.js main thread (see BRIDGE). */
  #jsOp(op, object, ...args) {
    // Objects reached through a JsProxy are used by reference too.
    const ref = (value) => (value !== null && typeof value === "object" && !this.#states.has(value) && !(value instanceof Date) ? new ByReference(value) : value);
    const isMap = object instanceof Map;
    const isSequence = Array.isArray(object) || (ArrayBuffer.isView(object) && !(object instanceof DataView));
    const index = (key, insert = false) => {
      const length = object.length;
      const i = typeof key === "number" && Number.isInteger(key) ? (key < 0 ? key + length : key) : NaN;
      if (!(i >= 0 && (i < length || (insert && i === length)))) throw pythonError("IndexError", `${typeName(object)} index out of range`);
      return i;
    };
    const missing = (key) => pythonError("KeyError", typeof key === "string" ? `'${key}'` : String(key));
    const size = () => {
      if (isSequence || typeof object.length === "number") return object.length;
      if (typeof object.size === "number") return object.size;
      throw pythonError("TypeError", `object of type '${typeName(object)}' has no len()`);
    };
    const [name, value] = args;
    switch (op) {
      case "getattr": {
        if (!(name in Object(object))) throw pythonError("AttributeError", `'${typeName(object)}' JavaScript object has no attribute '${name}'`);
        const member = object[name];
        if (typeof member !== "function" || this.#states.has(member) || isClass(member)) return ref(member); // Python callables stay themselves
        const method = member.bind(object);
        if (member[CANCELLABLE]) method[CANCELLABLE] = true;
        return method;
      }
      case "setattr":
        object[name] = value;
        return null;
      case "delattr":
        if (!(name in object)) throw pythonError("AttributeError", name);
        delete object[name];
        return null;
      case "getitem":
        if (isMap) {
          if (!object.has(name)) throw missing(name);
          return ref(object.get(name));
        }
        if (isSequence) return ref(object[index(name)]);
        if (!(name in Object(object))) throw missing(name);
        return ref(object[name]);
      case "setitem":
        if (isMap) object.set(name, value);
        else if (isSequence) object[index(name, Array.isArray(object))] = value;
        else object[name] = value;
        return null;
      case "delitem":
        if (isMap) {
          if (!object.delete(name)) throw missing(name);
        } else if (Array.isArray(object)) object.splice(index(name), 1);
        else {
          if (!(name in object)) throw missing(name);
          delete object[name];
        }
        return null;
      case "contains":
        if (isMap || object instanceof Set || object instanceof WeakSet) return object.has(name);
        if (isSequence) return object.includes(name);
        return typeof name === "string" && name in object;
      case "len":
        return size();
      case "bool":
        return isSequence || isMap || object instanceof Set ? size() > 0 : true;
      case "iter": {
        if (isMap) return ref(object.keys()); // like a dict
        if (typeof object[Symbol.iterator] === "function") return ref(object[Symbol.iterator]());
        if (Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null) return ref(Object.keys(object)[Symbol.iterator]());
        throw pythonError("TypeError", `'${typeName(object)}' JavaScript object is not iterable`);
      }
      case "next": {
        const step = object.next();
        return Tuple.of(Boolean(step.done), ref(step.value));
      }
      case "aiter": {
        const iterator = object[Symbol.asyncIterator]?.() ?? object[Symbol.iterator]?.();
        if (!iterator) throw pythonError("TypeError", `'${typeName(object)}' JavaScript object is not async iterable`);
        return ref(iterator);
      }
      case "anext":
        return Promise.resolve(object.next()).then((step) => Tuple.of(Boolean(step.done), ref(step.value)));
      case "serve": // a pending call: the main thread serves a call from a Python thread
        this.#serve(object);
        return null;
      case "await":
        return object; // a promise: the call settles when it does
      case "new":
        return ref(new object(...args));
      case "dir": {
        const names = new Set();
        for (let o = object; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
          for (const key of Object.getOwnPropertyNames(o)) if (key !== "constructor") names.add(key);
        }
        return [...names].sort();
      }
      case "repr":
        return inspect(object, { depth: 2, breakLength: Infinity });
      case "str":
        return String(object);
    }
    throw new Error(`Unknown JsProxy operation ${op}`);
  }

  /** Fill a new container, releasing it if filling fails. */
  #filled(ptr, fill) {
    this.#check(ptr);
    try {
      fill(ptr);
      return ptr;
    } catch (error) {
      this.#api.Py_DecRef(ptr);
      throw error;
    }
  }

  /** Check the int status of a C API call (-1 = exception). */
  #status(result) {
    if (result < 0) throw this.#fetchError();
    return result;
  }

  // ── PyObject proxies ──────────────────────────────────────────────

  /** Proxy owning a new reference. */
  #wrap(ptr) {
    const state = { ptr };
    const target = function () {}.bind(null); // callable, constructible, without own non-configurable properties
    // util.inspect formats the target of a proxy: show repr(obj).
    target[inspect.custom] = () => (state.ptr && !this.#finalized ? this.#withGIL(() => this.#take(this.#api.PyObject_Repr(state.ptr))) : "<released Python object>");
    const proxy = new Proxy(target, this.#handler);
    this.#states.set(target, state);
    this.#states.set(proxy, state);
    this.#registry.register(proxy, state, state);
    this.#proxies++;
    return proxy;
  }

  #proxyHandler() {
    const api = this.#api;
    const live = (target) => {
      const state = this.#states.get(target);
      if (!state.ptr) throw new Error("Python object has been released");
      return state.ptr;
    };
    const str = (target) => this.#withGIL(() => this.#take(api.PyObject_Str(live(target))));
    const index = (prop, use) => this.#using(this.#toPy(Number(prop)), use);
    // After a failed attribute operation: continue only on AttributeError.
    const missingAttribute = () => {
      if (!api.PyErr_ExceptionMatches(this.#attributeError)) throw this.#fetchError();
      api.PyErr_Clear();
    };
    return {
      get: (target, prop) => {
        if (typeof prop === "symbol") {
          if (prop === inspect.custom) return target[inspect.custom];
          if (prop === Symbol.iterator) return () => this.#iterate(target);
          if (prop === Symbol.asyncIterator) return this.#states.get(target).ptr && this.#withGIL(() => this.#bridge.is_async_iterable(target)) ? () => this.#aiterate(target) : undefined;
          if (prop === Symbol.dispose) return () => this.#release(target);
          if (prop === Symbol.toPrimitive) return (hint) => this.#withGIL(() => this.#bridge.to_primitive(target, hint));
          return undefined;
        }
        switch (prop) {
          case "then": {
            // Awaitables (coroutines, tasks, futures) are thenables: `await obj`.
            const state = this.#states.get(target);
            if (!state.ptr || this.#finalized || !this.#withGIL(() => this.#bridge.is_awaitable(target))) return undefined;
            return (onFulfilled, onRejected) => this.#promise(target).then(onFulfilled, onRejected);
          }
          case "toString":
            return () => str(target);
          case "toTypedArray":
            return () => this.#typedArray(target);
          case "toJS":
          case "toJSON": // JSON.stringify()
            return () => this.#withGIL(() => this.#fromPy(live(target), true));
        }
        return this.#withGIL(() => {
          const ptr = live(target);
          if (isIndex(prop)) return index(prop, (key) => this.#take(api.PyObject_GetItem(ptr, key)));
          const value = api.PyObject_GetAttrString(ptr, prop);
          if (value) return this.#take(value);
          missingAttribute();
          try {
            return this.#bridge.get_fallback(target, prop); // mapping key, or len() for "length"
          } catch (error) {
            // Function.prototype members of callables (see FUNCTION_MEMBERS).
            if (FUNCTION_MEMBERS.has(prop) && error instanceof PythonError && error.type === "AttributeError") return Reflect.get(target, prop);
            throw error;
          }
        });
      },
      set: (target, prop, value) => {
        if (typeof prop === "symbol") return false;
        this.#withGIL(() => {
          const ptr = live(target);
          this.#using(this.#toPy(value), (item) => {
            if (isIndex(prop)) return this.#status(index(prop, (key) => api.PyObject_SetItem(ptr, key, item)));
            if (api.PyObject_SetAttrString(ptr, prop, item) === 0) return;
            missingAttribute();
            api.Py_IncRef(ptr);
            api.Py_IncRef(item);
            api.Py_DecRef(this.#callRaw(this.#bridge.set_fallback, [ptr, this.#toPy(prop), item])); // mapping key
          });
        });
        return true;
      },
      has: (target, prop) => typeof prop === "string" && this.#withGIL(() => api.PyObject_HasAttrString(live(target), prop) === 1 || this.#bridge.is_key(target, prop)),
      deleteProperty: (target, prop) => {
        this.#withGIL(() => {
          if (api.PyObject_SetAttrString(live(target), String(prop), null) === 0) return;
          missingAttribute();
          this.#bridge.delete_fallback(target, String(prop)); // mapping key
        });
        return true;
      },
      // Object.keys(), Object.entries(), { ...dict }, for...in: the string keys of mappings.
      ownKeys: (target) => [...this.#withGIL(() => this.#bridge.keys(target))],
      getOwnPropertyDescriptor: (target, prop) => {
        if (typeof prop === "string" && this.#withGIL(() => this.#bridge.is_key(target, prop))) {
          return { value: this.#withGIL(() => this.#bridge.item(target, prop)), writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
      apply: (target, _this, args) => this.#withGIL(() => this.#call(live(target), args)),
      construct: (target, args) => this.#withGIL(() => this.#call(live(target), args, true)),
    };
  }

  /** Call a Python callable; `keep`: the result stays a proxy (`new`, which must return an object). */
  #call(callable, args, keep = false) {
    const api = this.#api;
    const take = keep ? (ptr) => this.#wrap(this.#check(ptr)) : (ptr) => this.#take(ptr);
    let keywords = null;
    if (args.length > 0 && args[args.length - 1] instanceof Kwargs) {
      keywords = args[args.length - 1].values;
      args = args.slice(0, -1);
    }
    // Tuple items are stolen references.
    const tuple = this.#filled(api.PyTuple_New(args.length), (t) => args.forEach((arg, i) => api.PyTuple_SetItem(t, i, this.#toPy(arg))));
    return this.#using(tuple, () => {
      if (!keywords) return take(api.PyObject_Call(callable, tuple, null));
      return this.#using(this.#toPy(keywords), (dict) => take(api.PyObject_Call(callable, tuple, dict)));
    });
  }

  *#iterate(target) {
    const api = this.#api;
    const iterator = this.#withGIL(() => {
      const state = this.#states.get(target);
      if (!state.ptr) throw new Error("Python object has been released");
      return this.#check(api.PyObject_GetIter(state.ptr));
    });
    try {
      while (true) {
        const item = this.#withGIL(() => {
          const next = api.PyIter_Next(iterator);
          if (next) return this.#take(next);
          if (api.PyErr_Occurred()) throw this.#fetchError();
          return DONE;
        });
        if (item === DONE) return;
        yield item;
      }
    } finally {
      if (!this.#finalized) this.#withGIL(() => api.Py_DecRef(iterator));
    }
  }

  /** for await over a Python async iterator (async generators, ...). */
  async *#aiterate(target) {
    const iterator = this.#withGIL(() => this.#bridge.aiter_of(target));
    let finished = false;
    try {
      while (true) {
        const [done, value] = await this.#bridge.anext_of(iterator);
        if (done) {
          finished = true;
          return;
        }
        yield value;
      }
    } finally {
      // break / return / throw in the loop: close the async generator.
      if (!finished && !this.#finalized) {
        const close = this.#bridge.aclose_of(iterator);
        if (close !== null) await close;
      }
    }
  }

  #release(target) {
    const state = this.#states.get(target);
    if (!state.ptr || this.#finalized) return;
    const ptr = state.ptr;
    state.ptr = null;
    this.#registry.unregister(state);
    this.#proxies--;
    this.#withGIL(() => this.#api.Py_DecRef(ptr));
  }

  // ── asyncio ───────────────────────────────────────────────────────

  /** Promise of an awaitable, run once on the Python event loop. */
  #promise(target) {
    const state = this.#states.get(target);
    state.promise ??= new Promise((resolve, reject) => {
      const token = this.#nextToken++;
      this.#withGIL(() => {
        this.#awaits.set(token, { resolve, reject, future: null });
        this.#channel.ref(); // Node.js waits for Python
        try {
          state.future = this.#awaits.get(token).future = this.#bridge.submit(target, token);
        } catch (error) {
          this.#awaits.delete(token);
          this.#unrefChannel();
          throw error;
        }
      });
    });
    return state.promise;
  }

  /**
   * The channel from Python threads to Node.js. Unreferenced, like an
   * unref()'d timer: Python activity alone does not keep Node.js alive, only
   * JavaScript awaiting Python code does.
   */
  #openChannel() {
    this.#channel = threadSafeCallback((kind, token) => this.#onEvent(kind, token), null, [c_int, c_int]).unref();
    this.#bridge.open_channel(this.#channel.pointer);
  }

  #unrefChannel() {
    if (this.#awaits.size === 0 && this.#channel && !this.#finalized) this.#channel.unref();
  }

  /** Channel event, on the Node.js main thread. */
  #onEvent(kind, token) {
    if (this.#finalized) return;
    switch (kind) {
      case EVENT_DONE: {
        const entry = this.#awaits.get(token);
        if (!entry) break;
        this.#awaits.delete(token);
        this.#withGIL(() => {
          try {
            entry.resolve(entry.future.result());
          } catch (error) {
            entry.reject(error);
          }
        });
        this.#unrefChannel();
        break;
      }
      case EVENT_CALL:
        this.#serve(token);
        break;
      case EVENT_CANCEL:
        this.#controllers.get(token)?.abort(new DOMException("The call was cancelled by Python", "AbortError"));
        this.#controllers.delete(token);
        break;
    }
  }

  /** Run a JavaScript function called by a coroutine and settle its asyncio future. */
  #serve(token) {
    const settle = (ok, value) => {
      this.#controllers.delete(token);
      if (this.#finalized) return;
      this.#withGIL(() => {
        try {
          this.#bridge.settle(token, ok, ok ? value : this.#wrap(this.#exception(value)));
        } catch (error) {
          if (ok) return settle(false, error); // e.g. a value without a Python equivalent
          throw error;
        }
      });
    };
    let result;
    try {
      const call = this.#withGIL(() => {
        const request = this.#bridge.take_request(token);
        if (request === null) return null; // cancelled meanwhile
        const [fid, args, kw] = request;
        const entry = this.#functions.get(BigInt(fid));
        if (!entry) throw new Error("JavaScript function has been released");
        const jsArgs = [...args];
        if (this.#builtins.len(kw) > 0) jsArgs.push(kw.toJS());
        return [entry, jsArgs];
      });
      if (call === null) return;
      const [entry, args] = call;
      if (entry.fn[CANCELLABLE]) {
        const controller = new AbortController();
        this.#controllers.set(token, controller);
        args.push(controller.signal);
      }
      result = entry.isClass ? new entry.fn(...args) : entry.fn(...args);
    } catch (error) {
      return settle(false, error);
    }
    // Synchronous results settle now: the call may be served from inside
    // Python (a pending call), where promise reactions cannot run.
    if (typeof result?.then !== "function" || this.#states.has(result)) return settle(true, result);
    Promise.resolve(result).then(
      (value) => settle(true, value),
      (error) => settle(false, error),
    );
  }

  // ── JavaScript functions called by Python ────────────────────────

  /** Python callable running a JavaScript function (new reference). */
  #function(fn) {
    const api = this.#api;
    this.#drain();
    const id = this.#nextId++;
    const name = fn.name || "js_function";
    const def = new PyMethodDef(name, this.#trampoline, METH_VARARGS | METH_KEYWORDS, null);
    this.#functions.set(id, { fn, def, isClass: isClass(fn) }); // def must outlive the Python function
    try {
      const cfunc = this.#using(this.#check(api.PyLong_FromLongLong(id)), (self) => this.#check(api.PyCFunction_NewEx(def, self, null)));
      // Thread check and release notification: see BRIDGE.
      return this.#callRaw(this.#bridge.wrap, [cfunc, this.#toPy(id)]);
    } catch (error) {
      this.#functions.delete(id);
      throw error;
    }
  }

  /** Forget the JavaScript functions released by Python. */
  #drain() {
    const [functions, objects] = this.#takeDeep(this.#callRaw(this.#bridge.take_released, []));
    for (const id of functions) this.#functions.delete(BigInt(id));
    for (const id of objects) this.#forgetObject(BigInt(id));
  }

  #scheduleDrain() {
    if (this.#drainScheduled || (this.#functions.size === 0 && this.#objects.size === 0)) return;
    this.#drainScheduled = true;
    setImmediate(() => {
      this.#drainScheduled = false;
      if (!this.#finalized) this.#withGIL(() => this.#drain());
    }).unref();
  }

  /** PyCFunction body: runs the JavaScript function. */
  #callJS(self, args, kw) {
    const api = this.#api;
    // Called by Python code on the main thread, which holds the GIL.
    this.#depth++;
    try {
      const entry = this.#functions.get(api.PyLong_AsLongLong(self));
      if (!entry) throw new Error("JavaScript function has been released");
      const size = Number(api.PyTuple_Size(args));
      const jsArgs = new Array(size);
      for (let i = 0; i < size; i++) jsArgs[i] = this.#fromPy(api.PyTuple_GetItem(args, i), false);
      if (kw && api.PyDict_Size(kw) > 0) jsArgs.push(this.#fromPy(kw, true));
      if (entry.fn[CANCELLABLE]) jsArgs.push(new AbortController().signal); // a synchronous call is never cancelled
      const result = entry.isClass ? new entry.fn(...jsArgs) : entry.fn(...jsArgs);
      if (typeof result?.then === "function" && !this.#states.has(result)) {
        result.then(undefined, () => {}); // its outcome is lost: not an unhandled rejection
        throw new TypeError(`${entry.fn.name || "JavaScript function"}() returned a promise: await it in a coroutine`);
      }
      return this.#toPy(result);
    } catch (error) {
      this.#raise(error);
      return null;
    } finally {
      this.#depth--;
    }
  }

  /** Raise a JavaScript error in Python. */
  #raise(error) {
    const api = this.#api;
    try {
      api.PyErr_SetRaisedException(this.#exception(error)); // steals the reference
    } catch {
      api.PyErr_SetString(this.#runtimeError, String(error?.message ?? error));
    }
  }

  /** Python exception for a JavaScript error (new reference). */
  #exception(error) {
    const api = this.#api;
    if (error?.[PY_TYPE]) {
      const exc = this.#builtins[error[PY_TYPE]](error.message);
      const ptr = this.#pointer(exc);
      api.Py_IncRef(ptr);
      return ptr;
    }
    // A Python exception that went through JavaScript keeps its type.
    if (error instanceof PythonError && this.#states.get(error.exception)?.ptr) {
      const exc = this.#pointer(error.exception);
      api.Py_IncRef(exc);
      return exc;
    }
    const exc = this.#using(this.#check(api.PyUnicode_DecodeUTF8(...this.#utf8(`JavaScript ${error?.name ?? "Error"}: ${error?.message ?? String(error)}`), null)), (message) => {
      const tuple = this.#filled(api.PyTuple_New(1), (t) => {
        api.Py_IncRef(message);
        api.PyTuple_SetItem(t, 0, message);
      });
      return this.#using(tuple, (t) => this.#check(api.PyObject_Call(this.#runtimeError, t, null)));
    });
    try {
      // The original JavaScript error becomes the cause of the PythonError
      // if the exception comes back to JavaScript.
      const id = Number(this.#nextId++);
      this.#jsErrors.set(id, error);
      if (this.#jsErrors.size > 1000) this.#jsErrors.delete(this.#jsErrors.keys().next().value); // never re-raised in JavaScript
      this.#status(this.#using(this.#toPy(id), (p) => api.PyObject_SetAttrString(exc, "_node_ctypes_error", p)));
      return exc;
    } catch (e) {
      api.Py_DecRef(exc);
      throw e;
    }
  }

  #utf8(text) {
    const bytes = Buffer.from(text, "utf8");
    return [bytes, bytes.length];
  }

  /** Current Python exception → PythonError (clears the exception). */
  #fetchError() {
    const api = this.#api;
    const exc = api.PyErr_GetRaisedException(); // normalized, with its __traceback__
    if (!exc) return new Error("Python call failed without setting an exception");

    let name = "Exception";
    let message = "";
    let traceback = "";
    let cause;
    try {
      name = this.#take(api.PyType_GetName(this.#typeOf(exc)));
      message = this.#take(api.PyObject_Str(exc));
      api.Py_IncRef(exc);
      traceback = this.#take(this.#callRaw(this.#bridge.format_exception, [exc]));
      if (api.PyObject_HasAttrString(exc, "_node_ctypes_error") === 1) {
        const id = this.#take(api.PyObject_GetAttrString(exc, "_node_ctypes_error"));
        cause = this.#jsErrors.get(id);
        this.#jsErrors.delete(id);
      }
    } catch {
      api.PyErr_Clear(); // keep what could be read
    }
    const exception = this.#wrap(exc); // owns the reference
    const error = new PythonError(name, message, traceback, exception);
    if (cause !== undefined) error.cause = cause;
    return error;
  }
}
