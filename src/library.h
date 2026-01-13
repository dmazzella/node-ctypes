#ifndef CTYPES_LIBRARY_H
#define CTYPES_LIBRARY_H

#include "shared.h"

namespace ctypes
{

    // Wrapper per librerie dinamiche (dlopen/LoadLibrary)
    class Library : public Napi::ObjectWrap<Library>
    {
    public:
        static Napi::Function GetClass(Napi::Env env);

        Library(const Napi::CallbackInfo &info);
        ~Library();

        void *GetHandle() const { return handle_; }
        const std::string &GetPath() const { return path_; }

        // Ottiene un puntatore a funzione
        Napi::Value GetFunction(const Napi::CallbackInfo &info);

        // Ottiene un puntatore a simbolo (variabile globale)
        Napi::Value GetSymbol(const Napi::CallbackInfo &info);

        // Chiude la libreria
        Napi::Value Close(const Napi::CallbackInfo &info);

        // Proprietà
        Napi::Value GetPath(const Napi::CallbackInfo &info);
        Napi::Value GetIsLoaded(const Napi::CallbackInfo &info);

    private:
        void *handle_;
        std::string path_;
        bool is_loaded_;
    };

    // Helper per caricare una libreria (wrapper di livello inferiore)
    void *LoadSharedLibrary(const std::string &path, std::string &error);
    void *GetSymbolAddress(void *handle, const std::string &name, std::string &error);
    bool CloseSharedLibrary(void *handle);

} // namespace ctypes

#endif // CTYPES_LIBRARY_H
