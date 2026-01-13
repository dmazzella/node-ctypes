#include "addon.h"

Napi::Object InitAll(Napi::Env env, Napi::Object exports)
{
    dotenv::init("node-ctypes.env");

    std::string path_env = dotenv::getenv("NODE_CTYPES_LOG_PATH", "");
    if (!path_env.empty() && std::filesystem::exists(path_env) && std::filesystem::is_directory(path_env))
    {
        std::string level_env = dotenv::getenv("NODE_CTYPES_LOG_LEVEL", "error");
        spdlog::level::level_enum logger_level = spdlog::level::from_str(level_env);
        constexpr std::size_t max_file_size = 10 * 1024 * 1024;
        std::filesystem::path log_path = std::filesystem::path(path_env) / "node-ctypes.log";

        std::shared_ptr<spdlog::logger> rotating_logger = spdlog::rotating_logger_mt("node-ctypes", log_path.string(), max_file_size, 1, false);
        rotating_logger->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] [%P] [%t] [%n] %v");
        rotating_logger->set_level(logger_level);
        rotating_logger->flush_on(logger_level);
        spdlog::set_default_logger(rotating_logger);
        spdlog::set_level(logger_level);
    }
    else
    {
        std::shared_ptr<spdlog::logger> null_logger = spdlog::null_logger_mt("node-ctypes");
        spdlog::set_default_logger(null_logger);
        spdlog::set_level(spdlog::level::off);
    }

    ctypes::CTypesAddon::Init(env, exports);

    return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, InitAll)
