#include "function_marshal.h"

#include "addon.h"
#include "array.h"

namespace ctypes {

// Memoria di un argomento staccata (transfer(), transfer list) mentre il codice
// nativo poteva usarla: è passata a un altro ArrayBuffer o è stata liberata.
// Node-API non permette di impedirlo; la chiamata lo segnala come errore.
[[nodiscard]] bool IsDetachedView(const Napi::Value& value) {
  if (!value.IsObject()) {
    return false;
  }
  Napi::ArrayBuffer buffer;
  if (value.IsTypedArray()) {
    buffer = value.As<Napi::TypedArray>().ArrayBuffer();
  } else if (value.IsDataView()) {
    buffer = value.As<Napi::DataView>().ArrayBuffer();
  } else if (value.IsArrayBuffer()) {
    buffer = value.As<Napi::ArrayBuffer>();
  } else {
    return false;
  }
  return buffer.IsDetached();
}

// Valori che non sono number (boolean, BigInt, errori): fuori dal percorso caldo.
CTYPES_NOINLINE int64_t IntegerArgSlow(const Napi::Value& val) {
  switch (val.Type()) {
    case napi_boolean:
      return val.As<Napi::Boolean>().Value() ? 1 : 0;
    case napi_bigint: {
      bool lossless;
      return static_cast<int64_t>(val.As<Napi::BigInt>().Uint64Value(&lossless));
    }
    default:
      ThrowNotNumeric(val, NumericKind::Integer);
  }
}

// Errore di conversione dell'argomento `index` come ctypes.ArgumentError di Python:
// "argument N: TypeError: <messaggio>". TypeError se la classe non è registrata.
Napi::Error ArgumentErrorFor(Napi::Env env, size_t index, const Napi::Error& cause) {
  std::string kind = "TypeError";
  Napi::Value name = cause.Value().Get("name");
  if (name.IsString()) {
    kind = name.As<Napi::String>().Utf8Value();
  }
  const std::string message = std::format("argument {}: {}: {}", index + 1, kind, cause.Message());
  CTypesAddon* addon = env.GetInstanceData<CTypesAddon>();
  if (addon != nullptr && !addon->argument_error_ctor.IsEmpty()) {
    return Napi::Error(env, addon->argument_error_ctor.New({Napi::String::New(env, message)}));
  }
  return Napi::TypeError::New(env, message);
}

// Valori che non sono number (boolean, BigInt, errori): fuori dal percorso caldo.
CTYPES_NOINLINE double DoubleArgSlow(const Napi::Value& val) {
  return RealFromJS(val);
}

Napi::Value FFIFunction::CheckArgument(Napi::Env env, size_t index, CType type, const Napi::Value& val) {
  alignas(16) std::array<uint8_t, ARG_SLOT_SIZE> slot{};
  bool memory = false;
  try {
    if (!MarshalPrimitive(val, type, slot.data(), &memory) || memory) {
      return val;
    }
  } catch (const Napi::Error& e) {
    throw ArgumentErrorFor(env, index, e);
  }
  // Il valore è nei primi byte dello slot (StoreArgument: parola estesa in
  // little-endian, il valore stesso altrimenti).
  const auto load = [&slot]<typename T>(std::type_identity<T>) {
    T value;
    memcpy(&value, slot.data(), sizeof(T));
    return value;
  };
  const auto integer = [&]<typename T>(std::type_identity<T> tag) -> Napi::Value {
    const T value = load(tag);
    if constexpr (sizeof(T) == sizeof(int64_t)) {
      if constexpr (std::is_signed_v<T>) {
        return Napi::BigInt::New(env, static_cast<int64_t>(value));
      } else {
        return Napi::BigInt::New(env, static_cast<uint64_t>(value));
      }
    } else {
      return Napi::Number::New(env, static_cast<double>(value));
    }
  };
  switch (type) {
    case CType::CTYPES_INT8:
      return integer(std::type_identity<int8_t>{});
    case CType::CTYPES_UINT8:
      return integer(std::type_identity<uint8_t>{});
    case CType::CTYPES_INT16:
      return integer(std::type_identity<int16_t>{});
    case CType::CTYPES_UINT16:
      return integer(std::type_identity<uint16_t>{});
    case CType::CTYPES_INT32:
      return integer(std::type_identity<int32_t>{});
    case CType::CTYPES_UINT32:
      return integer(std::type_identity<uint32_t>{});
    case CType::CTYPES_INT64:
      return integer(std::type_identity<int64_t>{});
    case CType::CTYPES_UINT64:
      return integer(std::type_identity<uint64_t>{});
    case CType::CTYPES_SSIZE_T:
      return integer(std::type_identity<ssize_t>{});
    case CType::CTYPES_SIZE_T:
      return integer(std::type_identity<size_t>{});
    case CType::CTYPES_LONG:
      return integer(std::type_identity<long>{});
    case CType::CTYPES_ULONG:
      return integer(std::type_identity<unsigned long>{});
    case CType::CTYPES_FLOAT:
      return Napi::Number::New(env, load(std::type_identity<float>{}));
    case CType::CTYPES_DOUBLE:
      return Napi::Number::New(env, load(std::type_identity<double>{}));
    case CType::CTYPES_BOOL:
      return Napi::Boolean::New(env, load(std::type_identity<uint8_t>{}) != 0);
    case CType::CTYPES_CHAR:
      // Il byte come intero in range(256), accettato da c_char.
      return Napi::Number::New(env, load(std::type_identity<uint8_t>{}));
    case CType::CTYPES_WCHAR:
      return Napi::Number::New(env, static_cast<double>(load(std::type_identity<wchar_t>{})));
    default:
      return val;
  }
}

namespace {

// Istanza SimpleCData passata oltre gli argtypes (variadici, o senza
// argtypes): come in Python conta il suo tipo, non quello dedotto dal valore
// (printf("%f", c_double(2.0))). Tipo e valore seguono le promozioni degli
// argomenti variadici del C, che libffi richiede: float → double, interi più
// stretti di int → int, char e wchar_t → il loro codice.
std::optional<VariadicValue> SimpleCDataArgument(const Napi::Value& val) {
  const Napi::Object object = val.As<Napi::Object>();
  const Napi::Value ctor = object.Get("constructor");
  if (!ctor.IsFunction()) {
    return std::nullopt;
  }
  const Napi::Value code = ctor.As<Napi::Object>().Get("_type");
  if (!code.IsNumber() || !ctor.As<Napi::Object>().Get("_isSimpleCData").ToBoolean()) {
    return std::nullopt;
  }
  const std::optional<CType> type = ToCType(code.As<Napi::Number>().Int32Value());
  if (!type) {
    return std::nullopt;
  }
  const Napi::Env env = val.Env();
  const Napi::Value value = object.Get("value");
  switch (*type) {
    case CType::CTYPES_FLOAT:
      return VariadicValue{CType::CTYPES_DOUBLE, value};
    case CType::CTYPES_INT8:
    case CType::CTYPES_UINT8:
    case CType::CTYPES_INT16:
    case CType::CTYPES_UINT16:
    case CType::CTYPES_BOOL:
      return VariadicValue{CType::CTYPES_INT32, value};
    case CType::CTYPES_CHAR:
      return VariadicValue{CType::CTYPES_INT32, Napi::Number::New(env, CharFromJS(value))};
    case CType::CTYPES_WCHAR:
      return VariadicValue{CType::CTYPES_INT32,
                           Napi::Number::New(env, static_cast<int32_t>(static_cast<uint32_t>(WcharFromJS(value))))};
    case CType::CTYPES_VOID:
    case CType::CTYPES_STRUCT:
    case CType::CTYPES_UNION:
    case CType::CTYPES_ARRAY:
      return std::nullopt;
    default:
      return VariadicValue{*type, value};
  }
}

}  // namespace

VariadicValue FFIFunction::InferVariadic(const Napi::Value& val) {
  // Un number (il caso comune) con una sola chiamata a V8, senza napi_typeof.
  if (double number; napi_fast::TryDouble(val, number)) {
    return {VariadicNumberType(number), val};
  }
  if (val.IsObject() && !val.IsBuffer()) {
    if (std::optional<VariadicValue> instance = SimpleCDataArgument(val)) {
      return *instance;
    }
  }
  return {InferTypeFromJS(val), val};
}

// Tipo C di un number variadico: intero in int32 → INT32 (il caso comune di
// sprintf("%d", …)), intero esatto oltre int32 (entro 2^53) → INT64, così che
// per esempio 5_000_000_000 con %lld non arrivi come double; il resto DOUBLE.
// Il range è verificato prima di qualunque cast (NaN o fuori range è UB).
CType FFIFunction::VariadicNumberType(double d) {
  if (d >= -2147483648.0 && d <= 2147483647.0 && d == std::trunc(d)) {
    return CType::CTYPES_INT32;
  }
  if (d == std::trunc(d) && std::isfinite(d) && d >= -9007199254740992.0 && d <= 9007199254740992.0) {
    return CType::CTYPES_INT64;
  }
  return CType::CTYPES_DOUBLE;
}

// ============================================================================
// InferTypeFromJS - Shared by Call() and CallAsync() for variadic inference
// ============================================================================

CType FFIFunction::InferTypeFromJS(const Napi::Value& val) {
  // Una sola napi_typeof (IsString/IsNumber/IsBigInt/... ne fanno una ciascuna).
  switch (val.Type()) {
    case napi_string:
      return CType::CTYPES_STRING;
    case napi_number:
      return VariadicNumberType(val.As<Napi::Number>().DoubleValue());
    case napi_bigint:
      return CType::CTYPES_INT64;
    case napi_object:
      // Memoria (Buffer, TypedArray, DataView, ArrayBuffer): il suo indirizzo.
      return val.IsTypedArray() || val.IsDataView() || val.IsArrayBuffer() ? CType::CTYPES_POINTER
                                                                           : CType::CTYPES_INT32;
    case napi_null:
    case napi_undefined:
      return CType::CTYPES_POINTER;
    default:
      return CType::CTYPES_INT32;  // fallback
  }
}

// ============================================================================
// ConvertReturn - Static, shared by ConvertReturnValue() and CallWorker::OnOK()
// ============================================================================

Napi::Value FFIFunction::ConvertReturn(Napi::Env env,
                                       void* return_data,
                                       CType type,
                                       const std::shared_ptr<StructInfo>& struct_info,
                                       const std::shared_ptr<ArrayInfo>& array_info,
                                       bool struct_as_buffer,
                                       bool scalar_as_buffer) {
  if (scalar_as_buffer) {
    return Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(return_data), CTypeSize(type));
  }
  // Tipi primitivi: i byte del valore restituito (ReturnValue).
  const void* rv = return_data;

  switch (type) {
    case CType::CTYPES_VOID:
      return env.Undefined();

    case CType::CTYPES_INT32:
      return napi_fast::Int32(env, LoadAs<int32_t>(rv));

    case CType::CTYPES_UINT32:
      return napi_fast::Uint32(env, LoadAs<uint32_t>(rv));

    case CType::CTYPES_INT64:
      return Napi::BigInt::New(env, LoadAs<int64_t>(rv));

    case CType::CTYPES_UINT64:
    case CType::CTYPES_SIZE_T:
      return Napi::BigInt::New(env, LoadAs<uint64_t>(rv));

    case CType::CTYPES_DOUBLE:
      return Napi::Number::New(env, LoadAs<double>(rv));

    case CType::CTYPES_FLOAT:
      return Napi::Number::New(env, static_cast<double>(LoadAs<float>(rv)));

    case CType::CTYPES_BOOL:
      return Napi::Boolean::New(env, LoadAs<uint8_t>(rv) != 0);

    case CType::CTYPES_POINTER: {
      void* const ptr = LoadAs<void*>(rv);
      if (ptr == nullptr) {
        return env.Null();
      }
      return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(ptr));
    }

    case CType::CTYPES_STRING: {
      const char* const str = LoadAs<const char*>(rv);
      if (str == nullptr) {
        return env.Null();
      }
      return Napi::String::New(env, str);
    }

    case CType::CTYPES_WSTRING: {
      const wchar_t* const str = LoadAs<const wchar_t*>(rv);
      if (str == nullptr) {
        return env.Null();
      }
      return WideToJS(env, std::wstring_view(str));
    }

    case CType::CTYPES_LONG:
      return Napi::BigInt::New(env, LoadAs<int64_t>(rv));

    case CType::CTYPES_ULONG:
      return Napi::BigInt::New(env, LoadAs<uint64_t>(rv));

    case CType::CTYPES_INT8:
      return napi_fast::Int32(env, LoadAs<int8_t>(rv));

    case CType::CTYPES_UINT8:
      return napi_fast::Uint32(env, LoadAs<uint8_t>(rv));

    case CType::CTYPES_INT16:
      return napi_fast::Int32(env, LoadAs<int16_t>(rv));

    case CType::CTYPES_UINT16:
      return napi_fast::Uint32(env, LoadAs<uint16_t>(rv));

    case CType::CTYPES_STRUCT: {
      // return_data points to the actual struct buffer (may be larger than ReturnValue)
      if (struct_info && struct_as_buffer) {
        return Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(return_data), struct_info->GetSize());
      }
      if (struct_info) {
        return struct_info->StructToJS(env, return_data);
      }
      return env.Undefined();
    }

    case CType::CTYPES_ARRAY: {
      // return_data points to the actual array buffer (may be larger than ReturnValue)
      if (array_info) {
        return array_info->ArrayToJS(env, return_data);
      }
      return env.Undefined();
    }

    default:
      return CToJS(env, return_data, type);
  }
}

// ============================================================================
// MarshalStructArg - Shared by Call() and CallAsync()
// Returns false on error (JS exception already thrown)
// ============================================================================

bool FFIFunction::MarshalStructArg(Napi::Env env,
                                   const Napi::Value& val,
                                   size_t arg_index,
                                   const std::shared_ptr<StructInfo>& struct_info,
                                   uint8_t* slot,
                                   void** arg_value_ptr,
                                   std::vector<std::vector<uint8_t>>& large_buffers,
                                   std::vector<size_t>* large_indices,
                                   std::vector<Napi::ObjectReference>* owners) {
  size_t struct_size = struct_info->GetSize();

  // Use overflow buffer if struct > slot size
  uint8_t* dest = slot;
  size_t dest_size = ARG_SLOT_SIZE;
  if (struct_size > ARG_SLOT_SIZE) {
    large_buffers.emplace_back(struct_size, uint8_t{0});
    dest = large_buffers.back().data();
    dest_size = struct_size;
    *arg_value_ptr = dest;
    if (large_indices) {
      large_indices->push_back(arg_index);
    }
  }

  if (val.IsBuffer()) {
    Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
    if (buf.Length() >= struct_size) {
      memcpy(dest, buf.Data(), struct_size);
    } else {
      Napi::TypeError::New(env, std::format("Buffer too small for struct at argument {}", arg_index))
        .ThrowAsJavaScriptException();
      return false;
    }
  } else if (val.IsObject()) {
    Napi::Object obj = val.As<Napi::Object>();
    // Single Get() invece di Has()+Get() — se la chiave manca Get() ritorna
    // undefined, che non è un Buffer, quindi il check IsBuffer copre tutto.
    Napi::Value buf_prop = obj.Get("_buffer");
    if (buf_prop.IsBuffer()) {
      if (owners) {
        owners->push_back(Napi::Persistent(buf_prop.As<Napi::Object>()));
      }
      Napi::Buffer<uint8_t> buf = buf_prop.As<Napi::Buffer<uint8_t>>();
      if (buf.Length() >= struct_size) {
        memcpy(dest, buf.Data(), struct_size);
      } else {
        Napi::TypeError::New(env, std::format("Internal buffer too small for struct at argument {}", arg_index))
          .ThrowAsJavaScriptException();
        return false;
      }
    } else {
      if (!struct_info->JSToStruct(env, obj, std::span(dest, dest_size), owners)) {
        Napi::Error::New(env, std::format("Failed to convert JS object to struct at argument {}", arg_index))
          .ThrowAsJavaScriptException();
        return false;
      }
    }
  } else {
    Napi::TypeError::New(env, std::format("Argument {} must be object or buffer for struct type", arg_index))
      .ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

// ============================================================================
// MarshalArrayArg - Shared by Call() and CallAsync()
// Returns false on error (JS exception already thrown)
// ============================================================================

bool FFIFunction::MarshalArrayArg(Napi::Env env,
                                  const Napi::Value& val,
                                  size_t arg_index,
                                  const std::shared_ptr<ArrayInfo>& array_info,
                                  uint8_t* slot,
                                  void** arg_value_ptr,
                                  std::vector<std::vector<uint8_t>>& large_buffers,
                                  std::vector<size_t>* large_indices,
                                  std::vector<Napi::ObjectReference>* owners) {
  size_t array_size = array_info->GetSize();

  // Use overflow buffer if array > slot size
  uint8_t* dest = slot;
  size_t dest_size = ARG_SLOT_SIZE;
  if (array_size > ARG_SLOT_SIZE) {
    large_buffers.emplace_back(array_size, 0);
    dest = large_buffers.back().data();
    dest_size = array_size;
    *arg_value_ptr = dest;
    if (large_indices) {
      large_indices->push_back(arg_index);
    }
  }

  if (val.IsBuffer()) {
    Napi::Buffer<uint8_t> buf = val.As<Napi::Buffer<uint8_t>>();
    if (buf.Length() >= array_size) {
      memcpy(dest, buf.Data(), array_size);
    } else {
      Napi::TypeError::New(env, std::format("Buffer too small for array at argument {}", arg_index))
        .ThrowAsJavaScriptException();
      return false;
    }
  } else {
    if (!array_info->JSToArray(env, val, std::span(dest, dest_size), owners)) {
      Napi::Error::New(env, std::format("Failed to convert JS value to array at argument {}", arg_index))
        .ThrowAsJavaScriptException();
      return false;
    }
  }
  return true;
}

}  // namespace ctypes
