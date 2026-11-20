/** Internal aggregate identity and operations, shared without modifying user declarations. */

export const structArgumentFactories = new WeakMap();
export const structResultReaders = new WeakMap();
export const structGetters = new WeakMap();

// A field may shadow the public constructor property.
export const structClass = Symbol("constructor");
