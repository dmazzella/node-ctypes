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

// Copia `str` in UTF-8 dentro `dst` (capacità dst.size() byte, NUL incluso) con una
// sola chiamata a V8. Napi::String::Utf8Value() ne fa due (lunghezza + copia) e
// alloca una std::string: +20-35% per chiamata con argomenti c_char_p.
//
// Ritorna i byte scritti (NUL escluso) se la stringa è entrata per intero,
// std::nullopt altrimenti: in quel caso il contenuto di `dst` va ignorato.
// V8 non spezza un carattere UTF-8 (fino a 4 byte) e N-API non segnala il
// troncamento: la copia è sicuramente completa solo se dopo l'ultimo byte
// scritto restano almeno kMaxUtf8CharBytes byte liberi (NUL escluso).
inline constexpr size_t kMaxUtf8CharBytes = 4;

// Come TryCopyUtf8Into, ma `value` può non essere una stringa: in quel caso
// `is_string` è false (V8 lo verifica nella stessa chiamata, senza napi_typeof).
[[nodiscard]] inline std::optional<size_t> TryCopyUtf8IfString(const Napi::Value& value,
                                                               std::span<char> dst,
                                                               bool& is_string) {
  is_string = true;
  const size_t cap = dst.size();
  if (cap < kMaxUtf8CharBytes + 2) {
    return std::nullopt;
  }
  size_t copied = 0;
  const napi_status status = napi_get_value_string_utf8(value.Env(), value, dst.data(), cap, &copied);
  if (status == napi_string_expected) {
    is_string = false;
    return std::nullopt;
  }
  NAPI_THROW_IF_FAILED(value.Env(), status, std::nullopt);
  if (cap - 1 - copied < kMaxUtf8CharBytes) {
    return std::nullopt;
  }
  return copied;
}

// Memoria di una vista (Buffer, ogni TypedArray, DataView) con una sola
// chiamata: Node accetta qualunque ArrayBufferView in napi_get_buffer_info.
// nullptr se il valore non è una vista (o una versione di Node la rifiuta): il
// chiamante passa alla conversione generale.
// Prima di Node 20.12 napi_get_buffer_info andava in assert con un valore che
// non è una vista, invece di restituire napi_invalid_arg: impostato
// all'avvio dell'addon (Electron può includere un Node più vecchio).
inline std::atomic<bool> buffer_info_checks_type{true};

[[nodiscard]] inline void* TryViewData(const Napi::Value& value) {
  if (!buffer_info_checks_type.load(std::memory_order_relaxed) && !value.IsBuffer()) [[unlikely]] {
    return nullptr;
  }
  void* data = nullptr;
  if (napi_get_buffer_info(value.Env(), value, &data, nullptr) != napi_ok) {
    return nullptr;
  }
  return data;
}

[[nodiscard]] inline std::optional<size_t> TryCopyUtf8Into(const Napi::String& str, std::span<char> dst) {
  const size_t cap = dst.size();
  if (cap < kMaxUtf8CharBytes + 2) {
    return std::nullopt;
  }
  size_t copied = 0;
  napi_status status = napi_get_value_string_utf8(str.Env(), str, dst.data(), cap, &copied);
  if (status != napi_ok) {
    NAPI_THROW(Napi::Error::New(str.Env()), std::nullopt);
  }
  if (cap - 1 - copied < kMaxUtf8CharBytes) {
    return std::nullopt;
  }
  return copied;
}

// Valore di un argomento numerico con una sola chiamata a V8 quando è un number
// (il caso comune): Napi::Value::Type() + Napi::Number::DoubleValue() ne fanno
// due, e DoubleValue() con eccezioni C++ attive lancia per un valore non number.
// Gli interi passano dal double per distinguere i valori non interi (Python
// rifiuta i float per i tipi interi).
// false se il valore non è un number (o non è un boolean, per TryBool): il
// chiamante passa alla conversione generale (boolean, BigInt, errori).
[[nodiscard]] inline bool TryDouble(const Napi::Value& value, double& out) {
  return napi_get_value_double(value.Env(), value, &out) == napi_ok;
}

[[nodiscard]] inline bool TryBool(const Napi::Value& value, bool& out) {
  return napi_get_value_bool(value.Env(), value, &out) == napi_ok;
}

// Number da un intero a 32 bit: v8::Integer::New crea direttamente uno Smi,
// Napi::Number::New(double) passa per v8::Number::New (conversione e controllo).
[[nodiscard]] inline Napi::Value Int32(Napi::Env env, int32_t value) {
  napi_value result;
  const napi_status status = napi_create_int32(env, value, &result);
  NAPI_THROW_IF_FAILED(env, status, Napi::Value());
  return Napi::Value(env, result);
}

[[nodiscard]] inline Napi::Value Uint32(Napi::Env env, uint32_t value) {
  napi_value result;
  const napi_status status = napi_create_uint32(env, value, &result);
  NAPI_THROW_IF_FAILED(env, status, Napi::Value());
  return Napi::Value(env, result);
}

}  // namespace ctypes::napi_fast
