/** Native call dispatch and the lifetime of per-invocation arguments. */
import { activeArgumentOwners, activeOwnerStack, callbackPointer } from "./parameters.js";
import { convertArguments, needsArgumentOwners } from "./conversions.js";

const reflectApply = Reflect.apply;

export function argumentsNeedOwners(args) {
  for (let i = 0; i < args.length; i++) if (needsArgumentOwners(args[i])) return true;
  return false;
}

function allPrimitivesFrom(args, start) {
  for (let i = start; i < args.length; i++) {
    const value = args[i];
    if (value !== null && (typeof value === "object" || typeof value === "function")) return false;
  }
  return true;
}

function passesPrimitiveDirect(value) {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

function passesVoidPDirect(value) {
  if (value === null || value === undefined || typeof value === "bigint") return true;
  return typeof value === "object" && ArrayBuffer.isView(value) && !("_buffer" in value) && !("_as_parameter_" in value);
}

function isPlainStructObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && !("_buffer" in value) && !("_as_parameter_" in value);
}

function finishOwned(ffiFunc, method, sync, run) {
  const owners = [];
  activeOwnerStack.push(owners);
  let result;
  try {
    result = run(owners);
  } finally {
    activeOwnerStack.pop();
  }
  if (!sync) {
    activeArgumentOwners.add(owners);
    return result.finally(() => activeArgumentOwners.delete(owners));
  }
  return result;
}

function callWithOwner1(ffiFunc, owner, a0) {
  activeOwnerStack.push(owner);
  try {
    return ffiFunc.call(a0);
  } finally {
    activeOwnerStack.pop();
  }
}

function callWithOwner2(ffiFunc, owner, a0, a1) {
  activeOwnerStack.push(owner);
  try {
    return ffiFunc.call(a0, a1);
  } finally {
    activeOwnerStack.pop();
  }
}

function callWithOwner3(ffiFunc, owner, a0, a1, a2) {
  activeOwnerStack.push(owner);
  try {
    return ffiFunc.call(a0, a1, a2);
  } finally {
    activeOwnerStack.pop();
  }
}

// The general fallback receives the hook snapshot taken before any owner probe.
export function specializeCall(ffiFunc, method, converters, state, invoke, captureHere = true) {
  const [C0, C1, C2, C3, C4, C5] = converters;
  const [N0, N1, N2, N3, N4, N5] = converters.map((convert) => convert.needsOwners ?? needsArgumentOwners);
  const [R0, R1, R2, R3] = converters.map((convert) => convert.resolvePlain);
  const hasAdapters = converters.some((convert) => convert.requiresOwners);
  const primitivesPass = converters.every((convert) => convert.passesPrimitives === true);
  const sync = method !== "callAsync";
  const directSync = method === "call" && captureHere && !hasAdapters;
  const plainStructEligible = captureHere && !hasAdapters;
  switch (converters.length) {
    case 0:
      return function () {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 0) return invoke(arguments, checked);
        return ffiFunc[method]();
      };
    case 1:
      if (directSync && C0.passesPlainView === true) {
        return function (a0) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 1) return invoke(arguments, checked);
          if (a0 !== null && typeof a0 === "object") {
            if (ArrayBuffer.isView(a0)) {
              if (!("_buffer" in a0) && !("_as_parameter_" in a0)) return ffiFunc.call(a0);
              return callOwned1(ffiFunc, "call", C0, a0);
            }
            const ptr = a0[callbackPointer];
            if (ptr !== undefined) return callWithOwner1(ffiFunc, a0, ptr);
            return callOwned1(ffiFunc, "call", C0, a0);
          }
          if (typeof a0 === "function") return callOwned1(ffiFunc, "call", C0, a0);
          return ffiFunc.call(C0(a0));
        };
      }
      if (plainStructEligible && R0 !== undefined) {
        return function (a0) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 1) return invoke(arguments, checked);
          if (isPlainStructObject(a0)) {
            const v0 = R0(a0);
            if (typeof v0 !== "function") return ffiFunc[method](v0);
            return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0(owners)));
          }
          if (N0(a0)) return sync ? callOwned1(ffiFunc, method, C0, a0) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
          return ffiFunc[method](C0(a0));
        };
      }
      return function (a0) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 1) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0))) return sync ? callOwned1(ffiFunc, method, C0, a0) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0));
      };
    case 2:
      if (directSync && C0.passesPlainView === true) {
        const c1Primitive = C1.passesPrimitives === true;
        const c1PlainView = C1.passesPlainView === true;
        return function (a0, a1) {
          const checked = state.errcheck;
          if (checked !== null) return invoke(arguments, checked);
          const len = arguments.length;
          if (len !== 2) {
            if (len > 2 && c1Primitive && (a0 === null || a0 === undefined || typeof a0 === "bigint") && allPrimitivesFrom(arguments, 1)) {
              return reflectApply(ffiFunc.call, ffiFunc, arguments);
            }
            return invoke(arguments, checked);
          }
          if (a0 !== null && typeof a0 === "object") {
            if (ArrayBuffer.isView(a0)) {
              if (!("_buffer" in a0) && !("_as_parameter_" in a0)) {
                if ((c1Primitive && passesPrimitiveDirect(a1)) || (c1PlainView && passesVoidPDirect(a1))) {
                  return ffiFunc.call(a0, a1);
                }
                if (R1 !== undefined && isPlainStructObject(a1)) {
                  const v1 = R1(a1);
                  if (typeof v1 !== "function") return ffiFunc.call(a0, v1);
                  return finishOwned(ffiFunc, "call", true, (owners) => ffiFunc.call(a0, v1(owners)));
                }
              }
              return callOwned2(ffiFunc, "call", C0, C1, a0, a1);
            }
            const ptr = a0[callbackPointer];
            if (ptr !== undefined && !N1(a1)) return callWithOwner2(ffiFunc, a0, ptr, C1(a1));
          }
          if (N0(a0) || N1(a1)) return callOwned2(ffiFunc, "call", C0, C1, a0, a1);
          return ffiFunc.call(C0(a0), C1(a1));
        };
      }
      if (plainStructEligible && (R0 !== undefined || R1 !== undefined)) {
        return function (a0, a1) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 2) return invoke(arguments, checked);
          let v0;
          if (R0 !== undefined && isPlainStructObject(a0)) {
            v0 = R0(a0);
            if (typeof v0 === "function") return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0(owners), C1(a1, owners)));
          } else if (N0(a0)) {
            return sync ? callOwned2(ffiFunc, method, C0, C1, a0, a1) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
          } else {
            v0 = C0(a0);
          }
          if (R1 !== undefined && isPlainStructObject(a1)) {
            const v1 = R1(a1);
            if (typeof v1 !== "function") return ffiFunc[method](v0, v1);
            return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1(owners)));
          }
          if (N1(a1)) return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, C1(a1, owners)));
          return ffiFunc[method](v0, C1(a1));
        };
      }
      return function (a0, a1) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 2) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0) || N1(a1))) return sync ? callOwned2(ffiFunc, method, C0, C1, a0, a1) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1));
      };
    case 3:
      if (directSync && C0.passesPlainView === true) {
        const c1Primitive = C1.passesPrimitives === true;
        const c1PlainView = C1.passesPlainView === true;
        const c2Primitive = C2.passesPrimitives === true;
        const c2PlainView = C2.passesPlainView === true;
        return function (a0, a1, a2) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 3) return invoke(arguments, checked);
          if (a0 !== null && typeof a0 === "object") {
            if (ArrayBuffer.isView(a0)) {
              if (!("_buffer" in a0) && !("_as_parameter_" in a0) && ((c1Primitive && passesPrimitiveDirect(a1)) || (c1PlainView && passesVoidPDirect(a1))) && ((c2Primitive && passesPrimitiveDirect(a2)) || (c2PlainView && passesVoidPDirect(a2)))) {
                return ffiFunc.call(a0, a1, a2);
              }
              return callOwned3(ffiFunc, "call", C0, C1, C2, a0, a1, a2);
            }
            const ptr = a0[callbackPointer];
            if (ptr !== undefined && !N1(a1) && !N2(a2)) return callWithOwner3(ffiFunc, a0, ptr, C1(a1), C2(a2));
          }
          if (N0(a0) || N1(a1) || N2(a2)) return callOwned3(ffiFunc, "call", C0, C1, C2, a0, a1, a2);
          return ffiFunc.call(C0(a0), C1(a1), C2(a2));
        };
      }
      if (plainStructEligible && (R0 !== undefined || R1 !== undefined || R2 !== undefined)) {
        return function (a0, a1, a2) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 3) return invoke(arguments, checked);
          let v0;
          if (R0 !== undefined && isPlainStructObject(a0)) {
            v0 = R0(a0);
            if (typeof v0 === "function") return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0(owners), C1(a1, owners), C2(a2, owners)));
          } else if (N0(a0)) {
            return sync ? callOwned3(ffiFunc, method, C0, C1, C2, a0, a1, a2) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
          } else {
            v0 = C0(a0);
          }
          let v1;
          if (R1 !== undefined && isPlainStructObject(a1)) {
            v1 = R1(a1);
            if (typeof v1 === "function") return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1(owners), C2(a2, owners)));
          } else if (N1(a1)) {
            return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, C1(a1, owners), C2(a2, owners)));
          } else {
            v1 = C1(a1);
          }
          if (R2 !== undefined && isPlainStructObject(a2)) {
            const v2 = R2(a2);
            if (typeof v2 !== "function") return ffiFunc[method](v0, v1, v2);
            return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1, v2(owners)));
          }
          if (N2(a2)) return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1, C2(a2, owners)));
          return ffiFunc[method](v0, v1, C2(a2));
        };
      }
      return function (a0, a1, a2) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 3) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0) || N1(a1) || N2(a2))) return sync ? callOwned3(ffiFunc, method, C0, C1, C2, a0, a1, a2) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2));
      };
    case 4:
      if (directSync && C0.passesPlainView === true && (C1.passesPrimitives === true || C1.passesPlainView === true) && (C2.passesPrimitives === true || C2.passesPlainView === true) && (C3.passesPrimitives === true || C3.passesPlainView === true)) {
        const c1Primitive = C1.passesPrimitives === true;
        const c2Primitive = C2.passesPrimitives === true;
        const c3Primitive = C3.passesPrimitives === true;
        return function (a0, a1, a2, a3) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 4) return invoke(arguments, checked);
          if (a0 !== null && typeof a0 === "object" && ArrayBuffer.isView(a0)) {
            if (
              !("_buffer" in a0) &&
              !("_as_parameter_" in a0) &&
              (c1Primitive ? passesPrimitiveDirect(a1) : passesVoidPDirect(a1)) &&
              (c2Primitive ? passesPrimitiveDirect(a2) : passesVoidPDirect(a2)) &&
              (c3Primitive ? passesPrimitiveDirect(a3) : passesVoidPDirect(a3))
            ) {
              return ffiFunc.call(a0, a1, a2, a3);
            }
            return callWithArgumentOwners(ffiFunc, "call", arguments, converters);
          }
          if (N0(a0) || N1(a1) || N2(a2) || N3(a3)) return callWithArgumentOwners(ffiFunc, "call", arguments, converters);
          return ffiFunc.call(C0(a0), C1(a1), C2(a2), C3(a3));
        };
      }
      if (plainStructEligible && (R0 !== undefined || R1 !== undefined || R2 !== undefined || R3 !== undefined)) {
        return function (a0, a1, a2, a3) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 4) return invoke(arguments, checked);
          let v0;
          if (R0 !== undefined && isPlainStructObject(a0)) {
            v0 = R0(a0);
            if (typeof v0 === "function") return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0(owners), C1(a1, owners), C2(a2, owners), C3(a3, owners)));
          } else if (N0(a0)) {
            return callWithArgumentOwners(ffiFunc, method, arguments, converters);
          } else {
            v0 = C0(a0);
          }
          let v1;
          if (R1 !== undefined && isPlainStructObject(a1)) {
            v1 = R1(a1);
            if (typeof v1 === "function") return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1(owners), C2(a2, owners), C3(a3, owners)));
          } else if (N1(a1)) {
            return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, C1(a1, owners), C2(a2, owners), C3(a3, owners)));
          } else {
            v1 = C1(a1);
          }
          let v2;
          if (R2 !== undefined && isPlainStructObject(a2)) {
            v2 = R2(a2);
            if (typeof v2 === "function") return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1, v2(owners), C3(a3, owners)));
          } else if (N2(a2)) {
            return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1, C2(a2, owners), C3(a3, owners)));
          } else {
            v2 = C2(a2);
          }
          if (R3 !== undefined && isPlainStructObject(a3)) {
            const v3 = R3(a3);
            if (typeof v3 !== "function") return ffiFunc[method](v0, v1, v2, v3);
            return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1, v2, v3(owners)));
          }
          if (N3(a3)) return finishOwned(ffiFunc, method, sync, (owners) => ffiFunc[method](v0, v1, v2, C3(a3, owners)));
          return ffiFunc[method](v0, v1, v2, C3(a3));
        };
      }
      return function (a0, a1, a2, a3) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 4) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0) || N1(a1) || N2(a2) || N3(a3))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3));
      };
    case 5:
      return function (a0, a1, a2, a3, a4) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 5) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0) || N1(a1) || N2(a2) || N3(a3) || N4(a4))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3), C4(a4));
      };
    case 6:
      return function (a0, a1, a2, a3, a4, a5) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 6) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0) || N1(a1) || N2(a2) || N3(a3) || N4(a4) || N5(a5))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3), C4(a4), C5(a5));
      };
    default:
      return function () {
        const checked = captureHere ? state.errcheck : null;
        // Scalar parameters receiving primitives need no conversion and no
        // owners: the arguments object goes to the native call as it is.
        if (primitivesPass && checked === null && arguments.length === converters.length && allPrimitivesFrom(arguments, 0)) {
          return reflectApply(ffiFunc[method], ffiFunc, arguments);
        }
        return invoke(arguments, checked);
      };
  }
}

// Synchronous owned calls nest strictly: the owners array is a stack entry
// and the converters run without an intermediate argument array.
function callOwned1(ffiFunc, method, C0, a0) {
  const owners = [];
  activeOwnerStack.push(owners);
  try {
    return ffiFunc[method](C0(a0, owners));
  } finally {
    activeOwnerStack.pop();
  }
}

function callOwned2(ffiFunc, method, C0, C1, a0, a1) {
  const owners = [];
  activeOwnerStack.push(owners);
  try {
    return ffiFunc[method](C0(a0, owners), C1(a1, owners));
  } finally {
    activeOwnerStack.pop();
  }
}

function callOwned3(ffiFunc, method, C0, C1, C2, a0, a1, a2) {
  const owners = [];
  activeOwnerStack.push(owners);
  try {
    return ffiFunc[method](C0(a0, owners), C1(a1, owners), C2(a2, owners));
  } finally {
    activeOwnerStack.pop();
  }
}

// The native asynchronous entry: on the Executor of `call` (callOn: the
// target of this invocation only) or, without it, on the libuv pool.
function invokeAsync(ffiFunc, call, resultHandler, converted) {
  if (call === undefined) return resultHandler === undefined ? ffiFunc.callAsync(...converted) : ffiFunc._callAsyncWithErrcheck(resultHandler, ...converted);
  return resultHandler === undefined ? ffiFunc.callOn(call, ...converted) : ffiFunc._callOnWithErrcheck(call, resultHandler, ...converted);
}

// The registry is a GC root, including while another converter reenters JS.
// `call`: the callOn target of an asynchronous call.
export function callWithArgumentOwners(ffiFunc, method, args, converters, finish, call, resultHandler, checkedCall) {
  const owners = [];
  // Synchronous calls nest strictly, so a stack avoids hashing a fresh array.
  activeOwnerStack.push(owners);
  try {
    const converted = convertArguments(args, converters, owners);
    const result =
      method === "callAsync"
        ? invokeAsync(ffiFunc, call, resultHandler, converted)
        : resultHandler === undefined
          ? ffiFunc[method](...converted)
          : checkedCall === undefined
            ? ffiFunc._callWithErrcheck(resultHandler, ...converted)
            : checkedCall(resultHandler, ...converted);
    if (method === "callAsync") {
      const completed = finish === undefined ? result : result.then((value) => finish(value, args));
      activeArgumentOwners.add(owners);
      return completed.finally(() => activeArgumentOwners.delete(owners));
    }
    return finish === undefined ? result : finish(result, args);
  } finally {
    activeOwnerStack.pop();
  }
}

// Only the native entry belongs to the binding. Hook, public callable and
// original arguments belong to this invocation, even if a converter reenters.
export function createCheckedInvoker(ffiFunc, converters, hasAdapters, convertResult, publicCallable) {
  let checkedSync;
  return (method, args, checked, target) => {
    const original = Array.isArray(args) ? args : Array.prototype.slice.call(args);
    const fn = publicCallable();
    const async = method === "callAsync";
    const finish = (result) => checked(convertResult === undefined ? result : convertResult(result, async), fn, original);
    const entry = async ? undefined : (checkedSync ??= ffiFunc._makeCheckedCall());
    if (hasAdapters || argumentsNeedOwners(original)) return callWithArgumentOwners(ffiFunc, method, original, converters, undefined, target, finish, entry);
    if (entry !== undefined) return entry(finish, ...convertArguments(original, converters));
    if (async) return invokeAsync(ffiFunc, target, finish, convertArguments(original, converters));
    return ffiFunc._callWithErrcheck(finish, ...convertArguments(original, converters));
  };
}

function canUseNativeEntry(converters) {
  return converters.every((convert) => convert.passesPrimitives === true || convert.passesStrings === true);
}

function buildResultAsyncMethod(ffiFunc, converters, hasAdapters, callState, checkedCall, rawAsync, finishAsync) {
  const runFallback = (receiver, args) => (hasAdapters || argumentsNeedOwners(args) ? callWithArgumentOwners(ffiFunc, "callAsync", args, converters, finishAsync) : reflectApply(rawAsync, receiver, args).then(finishAsync));
  if (!hasAdapters && converters.length <= 2) {
    const [N0, N1] = converters.map((convert) => convert.needsOwners ?? needsArgumentOwners);
    if (converters.length === 0) {
      return function () {
        if (callState.errcheck !== null) return checkedCall("callAsync", arguments, callState.errcheck);
        if (arguments.length !== 0) return runFallback(this, arguments);
        return ffiFunc.callAsync().then(finishAsync);
      };
    }
    if (converters.length === 1) {
      const C0 = converters[0];
      return function (a0) {
        if (callState.errcheck !== null) return checkedCall("callAsync", arguments, callState.errcheck);
        if (arguments.length !== 1) return runFallback(this, arguments);
        if (N0(a0)) return callWithArgumentOwners(ffiFunc, "callAsync", arguments, converters, finishAsync);
        return ffiFunc.callAsync(C0(a0)).then(finishAsync);
      };
    }
    const [C0, C1] = converters;
    return function (a0, a1) {
      if (callState.errcheck !== null) return checkedCall("callAsync", arguments, callState.errcheck);
      if (arguments.length !== 2) return runFallback(this, arguments);
      if (N0(a0) || N1(a1)) return callWithArgumentOwners(ffiFunc, "callAsync", arguments, converters, finishAsync);
      return ffiFunc.callAsync(C0(a0), C1(a1)).then(finishAsync);
    };
  }
  return function (...args) {
    if (callState.errcheck !== null) return checkedCall("callAsync", args, callState.errcheck);
    return runFallback(this, args);
  };
}

/**
 * Shared function-binding pipeline used by both `CDLL.#wrapFunction` and
 * `CFUNCTYPE`/`WINFUNCTYPE`: builds specialized sync, async and executor
 * wrappers, errcheck handling, optional native entry and optional callback guard.
 */
export function buildFunctionBinding({ ffiFunc, converters, convertResult, trackLastCalled, entryName, guard, getErrcheckTarget }) {
  const convertAll = (args) => convertArguments(args, converters);
  const hasAdapters = converters.some((convert) => convert.requiresOwners);
  const captureHere = convertResult === undefined;
  const callState = { errcheck: null };
  const checkedCall = createCheckedInvoker(ffiFunc, converters, hasAdapters, convertResult, getErrcheckTarget);
  const ownedCall = (method, args) => callWithArgumentOwners(ffiFunc, method, args, converters);
  const invoke = (method, args, checked) => {
    if (captureHere && checked !== null) return checkedCall(method, args, checked);
    return captureHere && (hasAdapters || argumentsNeedOwners(args)) ? ownedCall(method, args) : ffiFunc[method](...convertAll(args));
  };

  let callMethod = specializeCall(ffiFunc, "call", converters, callState, (args, checked) => invoke("call", args, checked), captureHere);
  let asyncCallMethod = specializeCall(ffiFunc, "callAsync", converters, callState, (args, checked) => invoke("callAsync", args, checked), captureHere);
  let onExecutor = (target, args) => {
    if (captureHere && callState.errcheck !== null) return checkedCall("callAsync", args, callState.errcheck, target);
    if (captureHere && (hasAdapters || argumentsNeedOwners(args))) return callWithArgumentOwners(ffiFunc, "callAsync", args, converters, undefined, target);
    return ffiFunc.callOn(target, ...convertAll(args));
  };

  if (convertResult !== undefined) {
    const rawCall = callMethod;
    const rawAsync = asyncCallMethod;
    const finish = (result) => convertResult(result);
    const finishAsync = (result) => convertResult(result, true);
    callMethod = function (...args) {
      if (callState.errcheck !== null) return checkedCall("call", args, callState.errcheck);
      if (hasAdapters || argumentsNeedOwners(args)) return callWithArgumentOwners(ffiFunc, "call", args, converters, finish);
      return finish(rawCall.apply(this, args), args);
    };
    asyncCallMethod = buildResultAsyncMethod(ffiFunc, converters, hasAdapters, callState, checkedCall, rawAsync, finishAsync);
    const rawOn = onExecutor;
    onExecutor = (target, args) => {
      if (callState.errcheck !== null) return checkedCall("callAsync", args, callState.errcheck, target);
      if (hasAdapters || argumentsNeedOwners(args)) return callWithArgumentOwners(ffiFunc, "callAsync", args, converters, finishAsync, target);
      return rawOn(target, args).then(finishAsync);
    };
  }

  if (trackLastCalled !== undefined) {
    const origCall = callMethod;
    callMethod = function (...args) {
      trackLastCalled();
      return origCall.apply(this, args);
    };
    const origAsync = asyncCallMethod;
    asyncCallMethod = function (...args) {
      trackLastCalled();
      return origAsync.apply(this, args);
    };
    const origOn = onExecutor;
    onExecutor = (target, args) => {
      trackLastCalled();
      return origOn(target, args);
    };
  }

  const guarded = guard === undefined ? undefined : guard(callMethod, asyncCallMethod, onExecutor);
  const baseCall = guarded?.call ?? callMethod;
  let exposed = baseCall;
  if (guarded === undefined && convertResult === undefined && !hasAdapters && trackLastCalled === undefined && canUseNativeEntry(converters)) {
    exposed = (entryName === undefined ? ffiFunc._makeEntry(callMethod) : ffiFunc._makeEntry(callMethod, entryName)) ?? callMethod;
  }

  const errcheckDescriptor = {
    get() {
      return callState.errcheck;
    },
    set(callback) {
      callback = callback ?? null;
      if (callback !== null && typeof callback !== "function") throw new TypeError("errcheck must be a function or null");
      callState.errcheck = callback;
      if (exposed !== baseCall) ffiFunc._setEntryDefer(callback !== null);
    },
    enumerable: false,
    configurable: true,
  };

  return {
    exposed,
    asyncCallMethod: guarded?.callAsync ?? asyncCallMethod,
    onExecutor: guarded?.callOnExecutor ?? onExecutor,
    errcheckDescriptor,
    guardedProperties: guarded?.properties,
  };
}
