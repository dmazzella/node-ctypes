/** Native call dispatch and the lifetime of per-invocation arguments. */
import { activeArgumentOwners, activeOwnerStack } from "./parameters.js";
import { convertArguments, needsArgumentOwners } from "./conversions.js";

const reflectApply = Reflect.apply;

export function argumentsNeedOwners(args) {
  for (let i = 0; i < args.length; i++) if (needsArgumentOwners(args[i])) return true;
  return false;
}

// The general fallback receives the hook snapshot taken before any owner probe.
export function specializeCall(ffiFunc, method, converters, state, invoke, captureHere = true) {
  const [C0, C1, C2, C3, C4, C5] = converters;
  const [N0, N1, N2, N3, N4, N5] = converters.map((convert) => convert.needsOwners ?? needsArgumentOwners);
  const hasAdapters = converters.some((convert) => convert.requiresOwners);
  const primitivesPass = converters.every((convert) => convert.passesPrimitives === true);
  const sync = method !== "callAsync";
  switch (converters.length) {
    case 0:
      return function () {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 0) return invoke(arguments, checked);
        return ffiFunc[method]();
      };
    case 1:
      if (method === "call" && captureHere && !hasAdapters) {
        return function (a0) {
          const checked = state.errcheck;
          if (checked !== null || arguments.length !== 1) return invoke(arguments, checked);
          if (N0(a0)) return callOwned1(ffiFunc, "call", C0, a0);
          return ffiFunc.call(C0(a0));
        };
      }
      return function (a0) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 1) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0))) return sync ? callOwned1(ffiFunc, method, C0, a0) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0));
      };
    case 2:
      return function (a0, a1) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 2) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0) || N1(a1))) return sync ? callOwned2(ffiFunc, method, C0, C1, a0, a1) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1));
      };
    case 3:
      return function (a0, a1, a2) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 3) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || N0(a0) || N1(a1) || N2(a2))) return sync ? callOwned3(ffiFunc, method, C0, C1, C2, a0, a1, a2) : callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2));
      };
    case 4:
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
        if (primitivesPass && checked === null && arguments.length === converters.length) {
          let primitive = true;
          for (let i = 0; i < arguments.length; i++) {
            const value = arguments[i];
            if (value !== null && (typeof value === "object" || typeof value === "function")) {
              primitive = false;
              break;
            }
          }
          if (primitive) return reflectApply(ffiFunc[method], ffiFunc, arguments);
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
