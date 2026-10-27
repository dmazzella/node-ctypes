# SoftHSM2 2.7.0 — macOS arm64 portabile

Libreria PKCS#11 e `softhsm2-util` compilate con OpenSSL 3 linkato staticamente, per macOS 11.0 o
successivo su Apple Silicon. Dipendono solo da `libSystem` e `libc++` di sistema e funzionano copiate
in qualsiasi cartella, anche su un Mac senza Homebrew, vcpkg o OpenSSL.

| File | Descrizione |
|---|---|
| `libsofthsm2.dylib` | Libreria PKCS#11 (Cryptoki 3.2, 68 funzioni `C_*` esportate, fra cui `C_GetFunctionList`) |
| `softhsm2-util` | Utility di gestione token |
| `LICENSE-SoftHSM2` | Licenza BSD-2-Clause di SoftHSM2 (file `LICENSE` dei sorgenti) |
| `LICENSE-OpenSSL` | Apache License 2.0 di OpenSSL (dal port vcpkg `openssl`), inclusa perché OpenSSL è linkato staticamente |

## Uso

- **`SOFTHSM2_CONF` va impostata sempre.** Il percorso predefinito compilato è `/etc/softhsm2.conf`,
  che su macOS di norma non esiste. Esempio minimo:
  ```
  directories.tokendir = /percorso/tokens/
  objectstore.backend = file
  log.level = ERROR
  ```
- **`softhsm2-util` carica `libsofthsm2.dylib` dalla propria cartella.** È compilato con
  `DEFAULT_PKCS11_LIB=@executable_path/libsofthsm2.dylib`. `src/bin/common/library.cpp` passa la
  stringa così com'è a `dlopen`, e dyld sostituisce `@executable_path` con la cartella
  dell'eseguibile, quindi i due file vanno tenuti insieme. Se la dylib manca, l'errore è
  `dlopen(@executable_path/libsofthsm2.dylib, 0x0006): tried: '<cartella>/libsofthsm2.dylib' (no such file)`.
  Con `--module <percorso>` si può indicare un'altra libreria.
- **Quarantena (`com.apple.quarantine`).** I binari hanno solo la firma ad hoc, non una firma
  Developer ID né la notarizzazione. Se hanno l'attributo di quarantena, Gatekeeper interviene:
  macOS blocca `softhsm2-util` e può rifiutare il caricamento della dylib. L'attributo viene
  impostato da chi scarica o riceve file tramite le API di quarantena: browser (Safari, Chrome,
  Firefox…), allegati di Mail e Messaggi, AirDrop. Anche Utility Archivio lo propaga ai file estratti
  da uno zip o tar scaricato. Non viene impostato da `cp`, `scp`, `rsync`, `curl`, `git clone`, né
  copiando da una cartella condivisa di rete o da un disco esterno. Attenzione però: `cp` e Finder
  copiano gli attributi estesi, quindi un attributo già presente si porta dietro. Per controllarlo
  e rimuoverlo:
  ```
  xattr -lr <cartella>                       # elenca gli attributi, cercare com.apple.quarantine
  xattr -dr com.apple.quarantine <cartella>  # lo rimuove da tutti i file della cartella
  ```
- **Hardened runtime.** Un'applicazione firmata con hardened runtime e library validation
  (per esempio un'app notarizzata) non può caricare una dylib con firma ad hoc, anche senza
  quarantena. In quel caso serve che l'app abbia l'entitlement
  `com.apple.security.cs.disable-library-validation`, oppure che la dylib venga rifirmata con la
  stessa identità (Team ID) dell'app.
- L'OpenSSL statico, all'inizializzazione, legge il file di configurazione indicato dalla
  variabile `OPENSSL_CONF`, oppure `/etc/ssl/openssl.cnf` (`--openssldir=/etc/ssl`, il valore del
  port vcpkg). Su macOS quel file esiste, appartiene a LibreSSL di sistema e contiene solo sezioni
  `[req]`, che non influiscono su SoftHSM. Se sulla macchina di destinazione c'è una configurazione
  OpenSSL anomala (per esempio con il provider FIPS attivato), può influire anche su SoftHSM.

## Versioni

| Componente | Versione |
|---|---|
| SoftHSM2 | 2.7.0, tag `2.7.0`, commit `13e6e86b83748fef74046dbf0c91f664b7acc1c3`, più 2 patch (vedi sotto) |
| OpenSSL | 3.6.4 (port vcpkg `openssl` 3.6.4#1, "OpenSSL 3.6.4 25 Aug 2026"), statico |
| CppUnit (solo test) | non compilato, vedi "Test" |
| Compilatore | Apple clang 21.0.0 (clang-2100.3.34.2), target `arm64-apple-darwin27.0.0`, linker `ld-27037.1` |
| Strumenti | Command Line Tools for Xcode 27.0 (`com.apple.pkg.CLTools_Executables` 27.0.0.0.1788430756), senza Xcode |
| SDK | macOS SDK 27.0 (26A425), `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk` |
| Deployment target | macOS 11.0 (`minos 11.0`), sia OpenSSL sia SoftHSM |
| CMake | 4.4.3 (Homebrew), generatore `Unix Makefiles` (GNU make di Homebrew) |
| vcpkg | commit `dc1232a6e05dcc49703091e83743e3b4df9b9b7c` (2026-09-24), tool 2026-07-27-98d7cb0cf1f4686a3e43aa5672b6230c1d56bce8, modalità classic (senza manifest) |
| Triplet vcpkg | `arm64-osx-11` (overlay): copia di `arm64-osx` con `VCPKG_OSX_DEPLOYMENT_TARGET 11.0`; librerie statiche, CRT dinamico (`libSystem`/`libc++` di sistema) |

Il triplet overlay `build/triplets/arm64-osx-11.cmake`:

```cmake
set(VCPKG_TARGET_ARCHITECTURE arm64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)

set(VCPKG_CMAKE_SYSTEM_NAME Darwin)
set(VCPKG_OSX_ARCHITECTURES arm64)
set(VCPKG_OSX_DEPLOYMENT_TARGET 11.0)
```

**Opzioni di OpenSSL.** Sono quelle del port vcpkg per un triplet statico su macOS, dal file
`buildtrees/openssl/arm64-osx-11-rel/configdata.pm`:

```
perl Configure darwin64-arm64 enable-static-engine enable-capieng no-tests no-docs
  enable-ec_nistp_64_gcc_128 no-shared no-module no-apps --openssldir=/etc/ssl --libdir=lib
  --prefix=<vcpkg>/installed/arm64-osx-11
CFLAGS=-fPIC -mmacosx-version-min=11.0 -O3   (più -DNDEBUG in CC)
```

L'assembler (`asm`) è attivo. Rispetto a Windows c'è in più `enable-ec_nistp_64_gcc_128`
(implementazioni a 64 bit di P-224/P-256/P-521). Il modulo FIPS non è incluso. Tutti i 1052 file
oggetto di `libcrypto.a` hanno `minos 11.0`. Perl usato da vcpkg: 5.44.0 (Homebrew).

**Macchina di build.** Mac14,7 (Apple M2), macOS 27.0 (26A428), arm64 nativo, senza Rosetta.

## Differenze rispetto alla ricetta upstream

Il job `macos` di `.github/workflows/ci.yml` al tag 2.7.0 compila con autotools su `macos-14`,
usando OpenSSL **1.1** e CppUnit di Homebrew linkati dinamicamente. Questa build usa invece CMake,
OpenSSL 3.6.4 statico da vcpkg e un deployment target di macOS 11.0. I sorgenti sono gli stessi della
build Windows x64, con le stesse 2 patch.

1. **`find_package(OpenSSL)` al posto di `include(FindOpenSSL)`** in
   `cmake/modules/CompilerOptions.cmake`. Serve su Windows, dove chiamando `FindOpenSSL` direttamente
   si salta il wrapper CMake di vcpkg: le librerie di sistema necessarie all'OpenSSL statico non
   vengono aggiunte e per la Release viene scelta la libreria debug. Su macOS il wrapper sceglie
   `installed/arm64-osx-11/lib` (non `debug/lib`) e i `try_run` di ECC ed EdDSA linkano.
2. **Niente motore `rdrand` con OpenSSL 3** in `src/lib/crypto/OSSLCryptoFactory.cpp`. La modifica
   è necessaria per l'emulazione x64 su Windows on ARM. Su arm64 RDRAND non esiste, quindi la patch
   non cambia il comportamento, ma i sorgenti restano identici a quelli della build Windows. La
   casualità viene dal DRBG predefinito di OpenSSL, alimentato dal sistema operativo.
3. **`-DDEFAULT_PKCS11_LIB=@executable_path/libsofthsm2.dylib`**, un'opzione CMake e non una patch. Il
   valore predefinito sarebbe `/usr/local/lib/softhsm/libsofthsm2.dylib`, un percorso assoluto di
   installazione.
4. **`-DBUILD_TESTS=OFF`**: vedi "Test".

Patch applicata ai sorgenti del tag 2.7.0 (sha256 `5dc3cc11587c78398bcf48805b502f64b48e7f0443b8302f3edd4f14263351a6`,
lo stesso file della build Windows):

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

## Comandi (zsh, dalla radice dei sorgenti SoftHSMv2)

```sh
git switch --detach 2.7.0
git apply build/from_windows/softhsm2-2.7.0-portable.patch   # il diff riportato sopra

# vcpkg
git clone https://github.com/microsoft/vcpkg.git build/vcpkg
git -C build/vcpkg checkout dc1232a6e05dcc49703091e83743e3b4df9b9b7c
build/vcpkg/bootstrap-vcpkg.sh -disableMetrics

# triplet overlay: arm64-osx + deployment target 11.0
mkdir -p build/triplets
cp build/vcpkg/triplets/arm64-osx.cmake build/triplets/arm64-osx-11.cmake
echo 'set(VCPKG_OSX_DEPLOYMENT_TARGET 11.0)' >> build/triplets/arm64-osx-11.cmake

# solo openssl: cppunit richiede autoconf-archive, non installato (vedi "Test")
build/vcpkg/vcpkg install openssl --triplet arm64-osx-11 \
  --overlay-triplets=build/triplets --disable-metrics

# configurazione
cmake -S . -B build/arm64 -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=$PWD/build/vcpkg/scripts/buildsystems/vcpkg.cmake \
  -DVCPKG_TARGET_TRIPLET=arm64-osx-11 -DVCPKG_OVERLAY_TRIPLETS=$PWD/build/triplets \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
  -DWITH_CRYPTO_BACKEND=openssl -DBUILD_TESTS=OFF \
  -DDEFAULT_PKCS11_LIB=@executable_path/libsofthsm2.dylib

# build
cmake --build build/arm64 -j

# pacchetto
D=build/dist/softhsm2/darwin-arm64
mkdir -p $D
cp build/arm64/src/lib/libsofthsm2.dylib build/arm64/src/bin/util/softhsm2-util $D/
cp LICENSE $D/LICENSE-SoftHSM2
cp build/vcpkg/installed/arm64-osx-11/share/openssl/copyright $D/LICENSE-OpenSSL
```

Esito della configurazione: `Found OpenSSL: .../build/vcpkg/installed/arm64-osx-11/lib/libcrypto.a
(found version "3.6.4")`, `OpenSSL: Found P-256, P-384, and P-521`, `OpenSSL: Found ED25519`,
`OpenSSL: Found ED448`, `RFC 3394 is supported`, `RFC 5649 is supported`, GOST e FIPS disattivati (sono i
valori predefiniti). ECC ed EdDSA sono attivi (`WITH_ECC 1`, `WITH_EDDSA 1` in `config.h`). Nella cache
CMake non compaiono librerie di Homebrew o di `/usr/local`: ci sono solo gli strumenti (`cmake`,
`gmake`, `pkg-config`) e il valore predefinito di `CMAKE_INSTALL_PREFIX`, che non viene usato.

Esito della build: nessun errore. Ci sono 254 warning `-Wdeprecated-declarations` (API OpenSSL
deprecate in 3.0), 1 `-Wunused-variable` e un `ld: warning: ignoring duplicate libraries` per
`libssl.a`/`libcrypto.a`/`-ldl`, tutti innocui.

File prodotti: `build/arm64/src/lib/libsofthsm2.dylib` e `build/arm64/src/bin/util/softhsm2-util`.

## Test

**I test unitari non sono stati eseguiti.** Il port vcpkg `cppunit` 1.15.1#5 rigenera il `configure`
con autotools e richiede le macro m4 di `autoconf-archive`, che su questo Mac non sono installate:

```
CMake Error at installed/arm64-osx/share/vcpkg-make/vcpkg_make.cmake:108 (message):
  cppunit currently requires the following programs from the system package
  manager:
      autoconf autoconf-archive automake libtoolize
...
error: building cppunit:arm64-osx-11 failed with: BUILD_FAILED
```

con, nel log del controllo (`aclocal-arm64-osx-11-err.log`), `System package autoconf-archive is missing.`
Invece di installare `autoconf-archive` si è scelto di compilare con `-DBUILD_TESTS=OFF`. Il
funzionamento è coperto solo dalla verifica funzionale più sotto. Prima di un rilascio conviene
rieseguire le 7 suite (`cryptotest`, `datamgrtest`, `handlemgrtest`, `objstoretest`, `sessionmgrtest`,
`slotmgrtest`, `p11test`) con `-DBUILD_TESTS=ON` e `ctest --test-dir build/arm64 --output-on-failure`.

## Dipendenze (`otool -L`)

```
libsofthsm2.dylib:
	@rpath/libsofthsm2.dylib (compatibility version 0.0.0, current version 0.0.0)
	/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1359.0.0)
	/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 2200.27.0)

softhsm2-util:
	/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1359.0.0)
	/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 2200.27.0)
```

La prima riga di `libsofthsm2.dylib` è il suo install name (`LC_ID_DYLIB`), non una dipendenza.
Nessuno dei due file ha `LC_RPATH`. `softhsm2-util` non linka la dylib ma la carica con `dlopen`.
Non compaiono librerie di OpenSSL né percorsi `/opt/homebrew`, `/usr/local` o `build/`.

`LC_BUILD_VERSION` (`otool -l | grep -A4 LC_BUILD_VERSION`), identico per entrambi:

```
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 11.0
      sdk 27.0
```

`lipo -archs`: `arm64` per entrambi.

**Simboli esportati.** La dylib esporta 7544 simboli globali: le 68 funzioni `C_*` di SoftHSM (tutte
quelle di Cryptoki 2.40; SoftHSM 2.7.0 non implementa `C_GetInterface` né `C_GetInterfaceList`), più i
simboli di OpenSSL e quelli interni di SoftHSM. Su macOS, a differenza di Windows, i simboli globali
sono esportati per impostazione predefinita. Con il two-level namespace di dyld i riferimenti
interni della dylib sono risolti al link, quindi un altro OpenSSL presente nello stesso processo non
dovrebbe interferire.

## Firma (`codesign -dv --verbose=4`)

Entrambi i file hanno la firma ad hoc applicata dal linker (`adhoc,linker-signed`), che su arm64 basta
per l'esecuzione. Non è stato necessario rifirmarli. `codesign --verify --strict` restituisce
`valid on disk` e `satisfies its Designated Requirement` per entrambi.

```
Executable=.../darwin-arm64/libsofthsm2.dylib
Identifier=libsofthsm2.dylib
Format=Mach-O thin (arm64)
CodeDirectory v=20400 size=43690 flags=0x20002(adhoc,linker-signed) hashes=1362+0 location=embedded
VersionPlatform=1
VersionMin=720896
VersionSDK=1769472
Hash type=sha256 size=32
CandidateCDHash sha256=2bd72e60b7ca7f3dcf48a4fb5917317be0a3bc23
CandidateCDHashFull sha256=2bd72e60b7ca7f3dcf48a4fb5917317be0a3bc23090c53792c4fb20282c83a04
Hash choices=sha256
CMSDigest=2bd72e60b7ca7f3dcf48a4fb5917317be0a3bc23090c53792c4fb20282c83a04
CMSDigestType=2
Executable Segment base=0
Executable Segment limit=2838420
Executable Segment flags=0x0
Page size=4096
CDHash=2bd72e60b7ca7f3dcf48a4fb5917317be0a3bc23
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none
Internal requirements=none

Executable=.../darwin-arm64/softhsm2-util
Identifier=softhsm2-util
Format=Mach-O thin (arm64)
CodeDirectory v=20400 size=40870 flags=0x20002(adhoc,linker-signed) hashes=1274+0 location=embedded
VersionPlatform=1
VersionMin=720896
VersionSDK=1769472
Hash type=sha256 size=32
CandidateCDHash sha256=48a7a5811a0dc2ffb8302f1173005e5cbd470175
CandidateCDHashFull sha256=48a7a5811a0dc2ffb8302f1173005e5cbd470175a4708e44c0856e1d466bfa6d
Hash choices=sha256
CMSDigest=48a7a5811a0dc2ffb8302f1173005e5cbd470175a4708e44c0856e1d466bfa6d
CMSDigestType=2
Executable Segment base=0
Executable Segment limit=2602976
Executable Segment flags=0x1
Page size=4096
CDHash=48a7a5811a0dc2ffb8302f1173005e5cbd470175
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none
Internal requirements=none
```

`VersionMin=720896` è `0x0B0000`, cioè macOS 11.0.

## Verifica funzionale

I binari sono stati copiati in una cartella nuova creata con `mktemp -d`, fuori dall'albero di build
(`<tmp>` = `/var/folders/jv/kbj3n3g91hs0q90s3wcct5500000gn/T/tmp.LA9ihchpUB`), insieme a `p11test`.
`softhsm2-util` è stato eseguito senza `--module`, per verificare `@executable_path`.
`p11test` è compilato dal sorgente `p11test.c` della build Windows con lo stesso compilatore:

```
clang -arch arm64 -mmacosx-version-min=11.0 -Wall -Wextra -I <sorgenti>/src/lib/pkcs11 -o p11test p11test.c
```

La compilazione non dà warning. Il programma usa gli header PKCS#11 `cryptoki.h`/`pkcs11.h` di
SoftHSM2 e carica la dylib per percorso con `dlopen(RTLD_NOW | RTLD_LOCAL)`. Poi:
- chiama `C_GetFunctionList`, `C_Initialize(CKF_OS_LOCKING_OK)`, `C_GetSlotList`, `C_OpenSession` e `C_Login`;
- genera una coppia RSA 2048 e una coppia EC P-256 come oggetti di sessione
  (`CKA_EC_PARAMS = 06 08 2a 86 48 ce 3d 03 01 07`);
- firma e verifica con `CKM_SHA256_RSA_PKCS` e `CKM_ECDSA_SHA256`, controllando anche che un
  messaggio alterato dia `CKR_SIGNATURE_INVALID`;
- chiude la sessione e chiama `C_Finalize`.

```
$ cat <tmp>/softhsm2.conf
directories.tokendir = <tmp>/tokens/
objectstore.backend = file
log.level = ERROR

$ export SOFTHSM2_CONF=<tmp>/softhsm2.conf

$ ./softhsm2-util --version
2.7.0
exit=0

$ ./softhsm2-util --init-token --free --label test --pin 12345678 --so-pin 87654321
Slot 0 has a free/uninitialized token.
The token has been initialized and is reassigned to slot 1221278752
exit=0

$ ./softhsm2-util --show-slots
Available slots:
Slot 1221278752
    Slot info:
        Description:      SoftHSM slot ID 0x48cb3c20
        Manufacturer ID:  SoftHSM project
        Hardware version: 2.7
        Firmware version: 2.7
        Token present:    yes
    Token info:
        Manufacturer ID:  SoftHSM project
        Model:            SoftHSM v2
        Hardware version: 2.7
        Firmware version: 2.7
        Serial number:    d33466d048cb3c20
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

$ ./p11test <tmp>/libsofthsm2.dylib 12345678
Libreria caricata: <tmp>/libsofthsm2.dylib
C_GetFunctionList                        CKR_OK (0x00000000)
C_Initialize (CKF_OS_LOCKING_OK)         CKR_OK (0x00000000)
C_GetInfo                                CKR_OK (0x00000000)
  SoftHSM                          Implementation of PKCS11         v2.7 (Cryptoki 3.2)
C_GetSlotList (token presenti)           CKR_OK (0x00000000)
  2 slot con token, uso slot 1221278752
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

Controprova su `@executable_path`. Con `DYLD_PRINT_LIBRARIES=1`, `softhsm2-util --show-slots` carica
`<tmp>/libsofthsm2.dylib`. Copiato da solo in un'altra cartella nuova, senza la dylib, fallisce così:

```
ERROR: Could not load the PKCS#11 library/module: dlopen(@executable_path/libsofthsm2.dylib, 0x0006): tried: '/private/var/folders/jv/kbj3n3g91hs0q90s3wcct5500000gn/T/tmp.sHgyYPRKwT/libsofthsm2.dylib' (no such file)
ERROR: Please check log files for additional information.
exit=1
```

## SHA-256

```
72324bd413922c6a54adaf97bf4a18bf63442a9b6a32676d151f9f47208610b7  libsofthsm2.dylib
bf96ac253b7bfe4f1c64782ea0f9b529af2150091566c504de8290e799a80944  softhsm2-util
230cab7102816e99f7ce03ef476352fcad09d742fcbc6580d44393db6280b64c  LICENSE-SoftHSM2
7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a  LICENSE-OpenSSL
```

`LICENSE-OpenSSL` è identico a quello della build Windows. `LICENSE-SoftHSM2` ha lo stesso contenuto
ma fine riga LF invece di CRLF. Convertito in CRLF dà `af172e23…f188`, lo sha256 della versione
Windows.

La build non è riproducibile bit per bit: i binari contengono i percorsi assoluti dei file sorgente
della macchina di build (`/Users/…/SoftHSMv2/src/lib/…` e `…/build/vcpkg/…`), che OpenSSL e SoftHSM
usano nei messaggi di errore.
