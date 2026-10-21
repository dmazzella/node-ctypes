#pragma once

// Eccezioni documentate alla regola "solo node-addon-api".
//
// node-addon-api è lo standard del progetto. Qui stanno le sole chiamate N-API C
// ammesse, e solo quando:
//   1. stanno nel percorso caldo di FFIFunction::Call;
//   2. node-addon-api non ha un equivalente;
//   3. un benchmark mostra un guadagno misurabile.
// Ogni helper riceve tipi Napi::*, controlla lo stato di ritorno e segnala gli
// errori con NAPI_THROW come fa node-addon-api, così il codice chiamante resta
// in stile node-addon-api. Non sostituire queste chiamate con l'equivalente
// node-addon-api senza rimisurare.

#include "shared.h"

namespace ctypes::napi_fast {

// Copia `str` in UTF-8 dentro `dst` (capacità `cap` byte, NUL incluso) con una
// sola chiamata a V8. Napi::String::Utf8Value() ne fa due (lunghezza + copia) e
// alloca una std::string: +20-35% per chiamata con argomenti c_char_p.
//
// Ritorna i byte scritti (NUL escluso) se la stringa è entrata per intero,
// std::nullopt altrimenti: in quel caso il contenuto di `dst` va ignorato.
// V8 non spezza un carattere UTF-8 (fino a 4 byte) e N-API non segnala il
// troncamento: la copia è sicuramente completa solo se dopo l'ultimo byte
// scritto restano almeno kMaxUtf8CharBytes byte liberi (NUL escluso).
inline constexpr size_t kMaxUtf8CharBytes = 4;

inline std::optional<size_t> TryCopyUtf8Into(const Napi::String& str, char* dst, size_t cap) {
  if (cap < kMaxUtf8CharBytes + 2) {
    return std::nullopt;
  }
  size_t copied = 0;
  napi_status status = napi_get_value_string_utf8(str.Env(), str, dst, cap, &copied);
  if (status != napi_ok) {
    NAPI_THROW(Napi::Error::New(str.Env()), std::nullopt);
  }
  if (cap - 1 - copied < kMaxUtf8CharBytes) {
    return std::nullopt;
  }
  return copied;
}

}  // namespace ctypes::napi_fast
