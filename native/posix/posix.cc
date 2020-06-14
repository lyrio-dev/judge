#include <napi.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>

auto Init(Napi::Env env, Napi::Object exports) {
    exports.Set("pipe", Napi::Function::New(env, [] (const Napi::CallbackInfo &info) {
        int fd[2];
        if (pipe(fd) != 0) {
            auto err = errno;
            Napi::Error::New(info.Env(), "pipe: " + std::system_category().message(err)).ThrowAsJavaScriptException();
        }
        
        auto result = Napi::Object::New(info.Env());
        result["read"] = fd[0];
        result["write"] = fd[1];
        
        return result;
    }));

    exports.Set("close", Napi::Function::New(env, [] (const Napi::CallbackInfo &info) {
        return Napi::Number::New(info.Env(), close(info[0].As<Napi::Number>().Int32Value()));
    }));

    exports.Set("memfd_create", Napi::Function::New(env, [] (const Napi::CallbackInfo &info) {
        auto name = info[0].As<Napi::String>().Utf8Value();
        auto flags = info[1].As<Napi::Number>().Int32Value();

        auto fd = memfd_create(name.c_str(), flags);
        if (fd == -1) {
            auto err = errno;
            Napi::Error::New(info.Env(), "memfd_create: " + std::system_category().message(err)).ThrowAsJavaScriptException();
        }

        return Napi::Number::New(info.Env(), fd);
    }));

    exports.Set("ftruncate", Napi::Function::New(env, [] (const Napi::CallbackInfo &info) {
        auto fd = info[0].As<Napi::Number>().Int32Value();
        auto length = info[1].As<Napi::Number>().Int64Value();

        if (ftruncate(fd, length) != 0) {
            auto err = errno;
            Napi::Error::New(info.Env(), "ftruncate: " + std::system_category().message(err)).ThrowAsJavaScriptException();
        }
    }));

    exports.Set("fcntl_set_cloexec", Napi::Function::New(env, [] (const Napi::CallbackInfo &info) {
        auto fd = info[0].As<Napi::Number>().Int32Value();
        auto cloexec = info[1].As<Napi::Boolean>().Value();

        int retval;
        if (cloexec) {
            retval = fcntl(fd, F_SETFD, fcntl(fd, F_GETFD) | FD_CLOEXEC);
        } else {
            retval = fcntl(fd, F_SETFD, fcntl(fd, F_GETFD) & ~FD_CLOEXEC);
        }

        if (retval != 0) {
            auto err = errno;
            Napi::Error::New(info.Env(), "fcntl: " + std::system_category().message(err)).ThrowAsJavaScriptException();
        }
    }));

    return exports;
}

NODE_API_MODULE(NODE_MODULE_NAME, Init)
