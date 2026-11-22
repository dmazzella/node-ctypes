/** Convert the native callback's arguments to JS and its return value back to C. */
import { encodeWide } from "../memory/buffer.js";
import { mirrorsActive } from "../memory/mirror.js";
import { kFromCallbackBytes } from "../structures/Structure.js";
import { isScalarSubclass, scalarView } from "../types/scalar-protocol.js";
import { buildCallbackStructView, buildWrapper } from "../structures/helpers/wrap.js";
import { coerceObject } from "./conversions.js";

const reflectApply = Reflect.apply;

/**
 * Adapt a JS function used as a C callback to Python semantics: arguments
 * declared `POINTER(T)` are passed as pointer objects (`null` for NULL), and an
 * object returned by the function (pointer, SimpleCData instance, ...) is
 * converted like an argument.
 *
 * @param {Function} fn - JS callback
 * @param {Array} argTypes - Declared argument types
 * @returns {Function} Function to register with the native callback
 */
export function adaptCallbackFunction(fn, argTypes, returnType, native) {
  const scalarTypes = argTypes.map((type) => (isScalarSubclass(type) ? type : null));
  const hasScalars = scalarTypes.some((type) => type !== null);
  const pointerTypes = argTypes.map((t) => (t !== null && typeof t === "object" && t._pointerTo !== undefined ? t : null));
  const hasPointers = pointerTypes.some((t) => t !== null);
  // The native trampoline supplies a buffer for each by-value aggregate.
  const structViews = argTypes.map(structView);
  const hasStructs = structViews.some((view) => view !== null);
  const variantArgs = argTypes.map((type) => type?._isVariantBool === true);
  const hasVariants = variantArgs.some(Boolean);
  const variantResult = returnType?._isVariantBool === true;
  const toResult = stringResult(returnType, native);
  const convertResult = (result) => {
    if (variantResult) return returnType.from_param(result);
    if (toResult !== undefined && typeof result === "string") return toResult(result);
    if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
    return result._isSimpleCDataInstance === true ? result.value : coerceObject(result);
  };
  if (!hasScalars && !hasVariants && !hasPointers) {
    if (!hasStructs) {
      // The native trampoline passes exactly argTypes.length values with an
      // undefined receiver. Like CPython (tp_call), the handler is invoked
      // directly: own `call`/`apply` properties are not consulted.
      switch (argTypes.length) {
        case 0:
          return () => convertResult(fn());
        case 1:
          return (a0) => convertResult(fn(a0));
        case 2:
          return (a0, a1) => convertResult(fn(a0, a1));
        case 3:
          return (a0, a1, a2) => convertResult(fn(a0, a1, a2));
        default:
          return (...args) => convertResult(reflectApply(fn, undefined, args));
      }
    }
    // Arity-specialized paths for struct-only callbacks avoid rest-array
    // allocation and Reflect.apply on hot native-to-JS calls.
    switch (argTypes.length) {
      case 1: {
        const v0 = structViews[0];
        return (a0) => convertResult(fn(v0(a0)));
      }
      case 2: {
        const [v0, v1] = structViews;
        return (a0, a1) => convertResult(fn(v0 !== null ? v0(a0) : a0, v1 !== null ? v1(a1) : a1));
      }
      case 3: {
        const [v0, v1, v2] = structViews;
        return (a0, a1, a2) => convertResult(fn(v0 !== null ? v0(a0) : a0, v1 !== null ? v1(a1) : a1, v2 !== null ? v2(a2) : a2));
      }
      default:
        break;
    }
  }
  return (...args) => {
    if (hasScalars) {
      for (let i = 0; i < scalarTypes.length; i++) {
        if (scalarTypes[i] !== null) args[i] = scalarView(scalarTypes[i], args[i]);
      }
    }
    if (hasVariants) {
      for (let i = 0; i < variantArgs.length; i++) {
        if (variantArgs[i] && scalarTypes[i] === null) args[i] = args[i] !== 0;
      }
    }
    if (hasPointers) {
      for (let i = 0; i < pointerTypes.length; i++) {
        const T = pointerTypes[i];
        if (T !== null && args[i] !== null) {
          args[i] = T.fromAddress(args[i]);
        }
      }
    }
    if (hasStructs) {
      for (let i = 0; i < structViews.length; i++) {
        if (structViews[i] !== null) args[i] = structViews[i](args[i]);
      }
    }
    return convertResult(reflectApply(fn, undefined, args));
  };
}

/**
 * View of a struct/union argument of a callback (Buffer with a copy of the
 * C value): an instance of the class, or of the struct()/union() definition.
 *
 * @returns {Function|null} Converter, null for other argument types
 */
function structView(type) {
  if (typeof type === "function" && typeof type._buildStruct === "function") return type[kFromCallbackBytes].bind(type);
  if (type !== null && typeof type === "object" && type._isStructType === true) {
    if (!mirrorsActive) return buildCallbackStructView(type);
    let handler;
    return (buf) => {
      handler ??= buildWrapper(type, { instanceTag: "StructInstance", exposeAnonymous: true });
      return new Proxy(buf, handler);
    };
  }
  return null;
}

/**
 * Result of a callback whose restype is c_char_p / c_wchar_p and that returns
 * a JS string: a NUL-terminated buffer, kept alive as long as the callback
 * (Python keeps it forever, with "RuntimeWarning: memory leak in callback
 * function"). Buffers are cached by value, so a callback that returns the
 * same strings does not accumulate memory.
 *
 * @returns {Function|undefined} Converter, undefined for other restypes
 */
function stringResult(returnType, native) {
  if (native === undefined || typeof returnType !== "function" || returnType._isSimpleCData !== true) return undefined;
  const wide = returnType._type === native.CType.WSTRING;
  if (!wide && returnType._type !== native.CType.STRING) return undefined;
  const kept = new Map();
  return (value) => {
    let buf = kept.get(value);
    if (buf === undefined) {
      buf = wide ? Buffer.concat([encodeWide(value, native.WCHAR_SIZE), Buffer.alloc(native.WCHAR_SIZE)]) : Buffer.from(`${value}\0`, "utf8");
      kept.set(value, buf);
    }
    return buf;
  };
}
