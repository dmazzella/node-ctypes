# SoftHSM2 2.7.0 — Windows x64 portabile

Libreria PKCS#11 e `softhsm2-util` compilate con OpenSSL 3 e CRT MSVC linkati staticamente.
Dipendono solo da DLL di sistema di Windows e funzionano copiate in qualsiasi cartella.

| File | Descrizione |
|---|---|
| `softhsm2.dll` | Libreria PKCS#11 (Cryptoki 3.2, 68 export, fra cui `C_GetFunctionList` e `C_GetInterface`) |
| `softhsm2-util.exe` | Utility di gestione token |
| `LICENSE-SoftHSM2` | Licenza BSD-2-Clause di SoftHSM2 (file `LICENSE` dei sorgenti) |
| `LICENSE-OpenSSL` | Apache License 2.0 di OpenSSL (dal port vcpkg `openssl`), inclusa perché OpenSSL è linkato staticamente |

## Uso

- **`SOFTHSM2_CONF` va impostata sempre.** Il percorso predefinito compilato è `/etc/softhsm2.conf`,
  che su Windows non esiste. Esempio minimo:
  ```
  directories.tokendir = C:/percorso/tokens/
  objectstore.backend = file
  log.level = ERROR
  ```
- **`softhsm2-util.exe` carica `softhsm2.dll` dalla propria cartella.** È compilato con
  `DEFAULT_PKCS11_LIB=softhsm2.dll` (nome senza percorso), quindi `LoadLibraryA` la cerca prima nella
  cartella dell'eseguibile e i due file vanno tenuti insieme. Con `--module <percorso>` si può indicare
  un'altra libreria.
- L'OpenSSL statico, all'inizializzazione, legge un eventuale `openssl.cnf` indicato dalla
  variabile `OPENSSL_CONF`. Se sulla macchina di destinazione c'è una configurazione OpenSSL globale
  anomala (per esempio con il provider FIPS attivato), può influire anche su SoftHSM.

## Versioni

| Componente | Versione |
|---|---|
| SoftHSM2 | 2.7.0, tag `2.7.0`, commit `13e6e86b83748fef74046dbf0c91f664b7acc1c3`, più 2 patch (vedi sotto) |
| OpenSSL | 3.6.4 (port vcpkg `openssl` 3.6.4#1), statico |
| CppUnit (solo test) | 1.15.1 (port vcpkg `cppunit` 1.15.1#5), statico |
| Compilatore | MSVC 19.44.35229.0, toolset 14.44.35207, Visual Studio Professional 2022 17.14.37710.0 |
| Windows SDK | 10.0.26100.0 |
| CMake | 4.0.2, generatore `Visual Studio 17 2022`, `-A x64` |
| vcpkg | commit `dc1232a6e05dcc49703091e83743e3b4df9b9b7c` (2026-09-24), tool 2026-07-27-98d7cb0cf1f4686a3e43aa5672b6230c1d56bce8, modalità classic (senza manifest) |
| Triplet vcpkg | `x64-windows-static` (librerie statiche, CRT statico `/MT`) |
| Runtime | `CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded` (`/MT`) |

**Opzioni di OpenSSL.** Sono quelle del port vcpkg per un triplet statico: target `VC-WIN64A` con
assembler NASM 3.01 e `enable-static-engine enable-capieng no-tests no-docs no-shared no-module
no-apps no-makedepend`. Il modulo FIPS non è incluso.

**Macchina di build.** Windows 11 Pro 25H2 (10.0.26200) **ARM64**, in una VM su Apple Silicon.
I binari x64 sono stati compilati in cross con il toolset `Hostarm64\x64`. Test e verifica
funzionale sono stati eseguiti in emulazione x64 (Prism) sulla stessa macchina.

## Differenze rispetto alla ricetta upstream

Il job `windows` di `.github/workflows/ci.yml` al tag 2.7.0 usa OpenSSL **1.1.1n** come DLL
(triplet `x64-windows`, baseline vcpkg `38d1652f…`) e compila in Debug. Questa build usa invece
OpenSSL 3.6.4 statico e compila in Release. Per farla funzionare è servito quanto segue.

1. **`find_package(OpenSSL)` al posto di `include(FindOpenSSL)`** in
   `cmake/modules/CompilerOptions.cmake`. Chiamando `FindOpenSSL` direttamente si salta il
   wrapper CMake di vcpkg, e questo ha due effetti:
   - `OPENSSL_LIBRARIES` non contiene `crypt32;ws2_32`, quindi i `try_run` di rilevamento ECC ed EdDSA
     non linkano con l'OpenSSL statico e la configurazione si interrompe con
     "Cannot find P-256, P-384, or P-521";
   - viene scelto `debug/lib/libcrypto.lib` anche per la configurazione Release.
2. **Niente motore `rdrand` con OpenSSL 3** in `src/lib/crypto/OSSLCryptoFactory.cpp`. SoftHSM
   imposta il motore `rdrand` come metodo `RAND` predefinito. Nell'emulazione x64 di Windows on ARM
   il bit RDRAND del CPUID è acceso, ma l'istruzione fallisce sempre (0 successi su 100 con
   `_rdrand32_step` e `_rdrand64_step`), quindi ogni `RAND_bytes()` fallisce: 6 test su 7 falliti,
   con tutte le generazioni di chiavi in errore. Con OpenSSL 3 il DRBG predefinito, alimentato dal
   sistema operativo, è la sorgente corretta, quindi con OpenSSL ≥ 3.0 il motore non viene più
   impostato. Anche su x64 reale la casualità viene quindi dal DRBG di OpenSSL e non da RDRAND usato
   direttamente.
3. **`-DDEFAULT_PKCS11_LIB=softhsm2.dll`**, un'opzione CMake e non una patch. Il valore predefinito era
   `C:/Program Files/softhsm2/lib/softhsm/libsofthsm2.dll`, un percorso assoluto con un nome
   diverso da quello del file prodotto, per cui `softhsm2-util` falliva con `LoadLibraryA failed: 0x7E`.

Patch applicata ai sorgenti del tag 2.7.0 (sha256 `5dc3cc11587c78398bcf48805b502f64b48e7f0443b8302f3edd4f14263351a6`):

```diff
diff --git a/cmake/modules/CompilerOptions.cmake b/cmake/modules/CompilerOptions.cmake
index 151166d..322ed76 100644
--- a/cmake/modules/CompilerOptions.cmake
+++ b/cmake/modules/CompilerOptions.cmake
@@ -285,7 +285,7 @@ if(WITH_CRYPTO_BACKEND STREQUAL "botan")
 elseif(WITH_CRYPTO_BACKEND STREQUAL "openssl")
     set(WITH_OPENSSL 1)
 
-    include(FindOpenSSL)
+    find_package(OpenSSL)
     if(NOT OPENSSL_FOUND)
         message(FATAL_ERROR "Failed to find OpenSSL!")
     endif()
diff --git a/src/lib/crypto/OSSLCryptoFactory.cpp b/src/lib/crypto/OSSLCryptoFactory.cpp
index db22998..5dde889 100644
--- a/src/lib/crypto/OSSLCryptoFactory.cpp
+++ b/src/lib/crypto/OSSLCryptoFactory.cpp
@@ -142,6 +142,13 @@ OSSLCryptoFactory::OSSLCryptoFactory()
 	OpenSSL_add_all_algorithms();
 
 #ifdef WITH_ENGINES
+#if OPENSSL_VERSION_NUMBER >= 0x30000000L && !defined(LIBRESSL_VERSION_NUMBER)
+	// OpenSSL 3: keep the default DRBG (seeded by the OS) instead of
+	// making the RDRAND engine the default RAND method. Under x64
+	// emulation on Windows on ARM the CPUID RDRAND bit is set but the
+	// instruction always fails, which makes every RAND_bytes() fail.
+	rdrand_engine = NULL;
+#else
 #if !( OPENSSL_VERSION_NUMBER < 0x10100000L || defined(LIBRESSL_VERSION_NUMBER) )
 	// Make sure RDRAND is loaded first
 	ENGINE_load_rdrand();
@@ -162,6 +169,7 @@ OSSLCryptoFactory::OSSLCryptoFactory()
 			WARNING_MSG("ENGINE_set_default returned %lu\n", ERR_get_error());
 		}
 	}
+#endif
 #endif
 
 	// Initialise the one-and-only RNG
```

## Comandi (PowerShell, dalla radice dei sorgenti SoftHSMv2)

```powershell
git switch --detach 2.7.0
git apply softhsm2-2.7.0-portable.patch   # il diff riportato sopra

# vcpkg
git clone https://github.com/microsoft/vcpkg.git build\vcpkg
git -C build\vcpkg checkout dc1232a6e05dcc49703091e83743e3b4df9b9b7c
.\build\vcpkg\bootstrap-vcpkg.bat -disableMetrics
.\build\vcpkg\vcpkg.exe install openssl cppunit --triplet x64-windows-static --disable-metrics

# configurazione (gli argomenti -D con un "." vanno tra virgolette in PowerShell)
$src = (Get-Location).Path
cmake -S $src -B build\x64-static -G "Visual Studio 17 2022" -A x64 `
  "-DCMAKE_TOOLCHAIN_FILE=$src\build\vcpkg\scripts\buildsystems\vcpkg.cmake" `
  -DVCPKG_TARGET_TRIPLET=x64-windows-static `
  "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`$<`$<CONFIG:Debug>:Debug>" `
  -DWITH_CRYPTO_BACKEND=openssl -DDISABLE_NON_PAGED_MEMORY=ON -DBUILD_TESTS=ON `
  "-DDEFAULT_PKCS11_LIB=softhsm2.dll"

# build e test
cmake --build build\x64-static --config Release
$env:CTEST_OUTPUT_ON_FAILURE = '1'
cmake --build build\x64-static --config Release --target RUN_TESTS
```

Esito della configurazione: `OpenSSL: Found version 3.6.4`, `Found P-256, P-384, and P-521`,
`Found ED25519`, `Found ED448`, `RFC 3394 is supported`, `RFC 5649 is supported`,
GOST e FIPS disattivati (sono i valori predefiniti). ECC ed EdDSA sono attivi (`ENABLE_ECC=ON`, `ENABLE_EDDSA=ON`).

File prodotti: `build\x64-static\src\lib\Release\softhsm2.dll` e
`build\x64-static\src\bin\util\Release\softhsm2-util.exe`.

## Test (`RUN_TESTS`)

Test eseguiti senza variabili d'ambiente particolari (in particolare senza `OPENSSL_ia32cap`):

```
  1/7 Test #1: cryptotest .......................   Passed   14.79 sec
  2/7 Test #2: datamgrtest ......................   Passed    0.71 sec
  3/7 Test #3: handlemgrtest ....................   Passed    0.16 sec
  4/7 Test #4: objstoretest .....................   Passed    2.83 sec
  5/7 Test #5: sessionmgrtest ...................   Passed    0.40 sec
  6/7 Test #6: slotmgrtest ......................   Passed    0.69 sec
  7/7 Test #7: p11test ..........................   Passed   14.94 sec
  100% tests passed, 0 tests failed out of 7
  Total Test time (real) =  34.59 sec
```

Nota: i test sono stati eseguiti in emulazione x64 su ARM64. Prima di un rilascio conviene
rieseguirli su una macchina x64 reale.

## Dipendenze (`dumpbin /dependents`)

```
Dump of file softhsm2.dll
File Type: DLL
  Image has the following dependencies:
    KERNEL32.dll
    USER32.dll
    ADVAPI32.dll
    WS2_32.dll
    CRYPT32.dll

Dump of file softhsm2-util.exe
File Type: EXECUTABLE IMAGE
  Image has the following dependencies:
    CRYPT32.dll
    WS2_32.dll
    KERNEL32.dll
    USER32.dll
    ADVAPI32.dll
```

Machine `8664 (x64)` per entrambi. Non compaiono né il runtime MSVC (`VCRUNTIME140`, `MSVCP140`,
`api-ms-win-crt-*`) né DLL di OpenSSL.

## Verifica funzionale

I binari sono stati copiati in una cartella nuova, fuori dall'albero di build, insieme a `p11test.exe`.
`p11test.exe` è compilato dal sorgente `p11test.c` con lo stesso compilatore
(`cl /nologo /MT /W4 /I<sorgenti>\src\lib\pkcs11 p11test.c` da un ambiente `vcvarsarm64_amd64`) e
usa gli header PKCS#11 `cryptoki.h`/`pkcs11.h` di SoftHSM2. Carica la DLL per percorso con
`LoadLibraryA` e poi:
- chiama `C_GetFunctionList`, `C_Initialize(CKF_OS_LOCKING_OK)`, `C_GetSlotList`, `C_OpenSession` e `C_Login`;
- genera una coppia RSA 2048 e una coppia EC P-256 come oggetti di sessione
  (`CKA_EC_PARAMS = 06 08 2a 86 48 ce 3d 03 01 07`);
- firma e verifica con `CKM_SHA256_RSA_PKCS` e `CKM_ECDSA_SHA256`, controllando anche che un
  messaggio alterato dia `CKR_SIGNATURE_INVALID`;
- chiude la sessione e chiama `C_Finalize`.

```
> softhsm2-util --version
2.7.0
exit=0

> softhsm2-util --init-token --free --label test --pin 12345678 --so-pin 87654321
Slot 0 has a free/uninitialized token.
The token has been initialized and is reassigned to slot 119165118
exit=0

> softhsm2-util --show-slots
Available slots:
Slot 119165118
    Slot info:
        Description:      SoftHSM slot ID 0x71a50be
        Manufacturer ID:  SoftHSM project
        Hardware version: 2.7
        Firmware version: 2.7
        Token present:    yes
    Token info:
        Manufacturer ID:  SoftHSM project
        Model:            SoftHSM v2
        Hardware version: 2.7
        Firmware version: 2.7
        Serial number:    e15fef3d071a50be
        Initialized:      yes
        User PIN init.:   yes
        Label:            test
Slot 1
    Slot info:
        Description:      SoftHSM slot ID 0x1
        Manufacturer ID:  SoftHSM project
        Hardware version: 2.7
        Firmware version: 2.7
        Token present:    yes
    Token info:
        Manufacturer ID:  SoftHSM project
        Model:            SoftHSM v2
        Hardware version: 2.7
        Firmware version: 2.7
        Serial number:
        Initialized:      no
        User PIN init.:   no
        Label:
exit=0

> p11test.exe <bin>\softhsm2.dll 12345678
C_GetFunctionList                        CKR_OK (0x00000000)
C_Initialize (CKF_OS_LOCKING_OK)         CKR_OK (0x00000000)
C_GetInfo                                CKR_OK (0x00000000)
  SoftHSM                          Implementation of PKCS11         v2.7 (Cryptoki 3.2)
C_GetSlotList (token presenti)           CKR_OK (0x00000000)
  2 slot con token, uso slot 119165118
C_OpenSession (RW)                       CKR_OK (0x00000000)
C_Login (CKU_USER)                       CKR_OK (0x00000000)
C_GenerateKeyPair (RSA 2048)             CKR_OK (0x00000000)
C_SignInit (CKM_SHA256_RSA_PKCS)         CKR_OK (0x00000000)
C_Sign (CKM_SHA256_RSA_PKCS)             CKR_OK (0x00000000)
  firma: 256 byte
C_VerifyInit (CKM_SHA256_RSA_PKCS)       CKR_OK (0x00000000)
C_Verify (CKM_SHA256_RSA_PKCS)           CKR_OK (0x00000000)
C_VerifyInit (CKM_SHA256_RSA_PKCS, alterato) CKR_OK (0x00000000)
C_Verify (CKM_SHA256_RSA_PKCS, alterato) CKR_SIGNATURE_INVALID (0x000000C0) -> atteso
C_GenerateKeyPair (EC P-256)             CKR_OK (0x00000000)
C_SignInit (CKM_ECDSA_SHA256)            CKR_OK (0x00000000)
C_Sign (CKM_ECDSA_SHA256)                CKR_OK (0x00000000)
  firma: 64 byte
C_VerifyInit (CKM_ECDSA_SHA256)          CKR_OK (0x00000000)
C_Verify (CKM_ECDSA_SHA256)              CKR_OK (0x00000000)
C_VerifyInit (CKM_ECDSA_SHA256, alterato) CKR_OK (0x00000000)
C_Verify (CKM_ECDSA_SHA256, alterato)    CKR_SIGNATURE_INVALID (0x000000C0) -> atteso
C_Logout                                 CKR_OK (0x00000000)
C_CloseSession                           CKR_OK (0x00000000)
C_Finalize                               CKR_OK (0x00000000)

RISULTATO: OK (0 errori)
exit=0
```

## SHA-256

```
45fe5561a2a126b5acc704afc823ffe1a45e014a2a5db674e65dccb5aaa76f2a  softhsm2.dll
a7cba3c12da35cece8a0638380150ca28817d7538a205f084e5d5faeb6b418d0  softhsm2-util.exe
af172e236c8f88995b81f125ad77e78bbc7cbff5221e3c8bb5388240cca7f188  LICENSE-SoftHSM2
7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a  LICENSE-OpenSSL
```

La build non è riproducibile bit per bit: i binari contengono timestamp PE e i percorsi dei file
sorgente della macchina di build, che OpenSSL e SoftHSM usano nei messaggi di errore.
