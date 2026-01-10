# node-ctypes TODO

## Known Issues

### Memory Management
- [ ] **String cleanup**: Le stringhe passate alle funzioni C vengono allocate con `new char[]` ma non vengono sempre liberate correttamente, causando crash durante lo shutdown di Node.js
- [ ] **Library close()**: Il metodo close() può causare crash se ci sono ancora riferimenti attivi

### Features da implementare
- [ ] Supporto per funzioni variadic (printf, etc.)
- [ ] Gestione automatica dell'allineamento nelle struct
- [ ] Supporto per union
- [ ] Supporto per array a dimensione fissa nelle struct
- [ ] Supporto per enum
- [ ] Gestione automatica dei BigInt per puntatori a 64-bit
- [ ] Supporto per passare callback a funzioni come qsort (richiede fix della conversione BigInt→pointer)

### Miglioramenti
- [ ] Aggiungere TypeScript definitions
- [ ] Aggiungere più test unitari
- [ ] Benchmark vs koffi e ffi-napi
- [ ] Supporto per Windows (testato solo su Linux)
- [ ] Supporto per macOS (testato solo su Linux)
- [ ] Pre-build binaries per le piattaforme comuni

### Documentazione
- [ ] Aggiungere più esempi
- [ ] Documentazione API completa
- [ ] Tutorial passo-passo

## Architecture Notes

Il progetto segue l'architettura di Python ctypes:

```
JavaScript API (lib/index.js)
         │
         ▼
   N-API Binding (src/*.cc)
         │
         ▼
      libffi
         │
         ▼
   Funzioni C native
```

### File sorgente

- `src/ctypes.cc` - Entry point e funzioni helper
- `src/types.cc` - Sistema dei tipi e conversioni JS↔C
- `src/library.cc` - Wrapper per dlopen/dlsym
- `src/function.cc` - Wrapper per ffi_call
- `src/callback.cc` - Wrapper per ffi_closure (callback JS→C)
