#include <napi.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <pwd.h>
#include <grp.h>
#include <unistd.h>
#include <filesystem>

using ReturnValueMaker = std::function<Napi::Value (Napi::Env env)>;
using OperationExecuter = std::function<ReturnValueMaker ()>;
using OperationHandler = std::function<OperationExecuter (const Napi::CallbackInfo &info)>;

class AsyncFileSystemOperationWorker : public Napi::AsyncWorker {
private:
    OperationExecuter operationExecuter;
    ReturnValueMaker returnValueMaker;
    Napi::Promise::Deferred deferred;

public:
    AsyncFileSystemOperationWorker(
        Napi::Env env,
        OperationExecuter operationExecuter
    ) : Napi::AsyncWorker(env), operationExecuter(operationExecuter), deferred(Napi::Promise::Deferred::New(env)) {}

    Napi::Promise getPromise() const {
        return deferred.Promise();
    }

    void Execute() {
        try {
            returnValueMaker = operationExecuter();
        } catch (std::exception &ex) {
            SetError(ex.what());
        }
    }

    void OnOK() {
        Napi::Value returnValue;
        try {
            returnValue = returnValueMaker(Env());
        } catch (std::exception &ex) {
            SetError(ex.what());
            deferred.Reject(Napi::Error::New(Env(), ex.what()).Value());
            return;
        }

        deferred.Resolve(returnValue);
    }

    void OnError(const Napi::Error &error) {
        deferred.Reject(error.Value());
    }
};

void traverse(const std::string &path, std::function<void (const std::string &)> onEntry) {
    onEntry(path);
    if (std::filesystem::is_directory(path))
        for (const auto &entry : std::filesystem::recursive_directory_iterator(path))
            onEntry(entry.path());
};

auto Init(Napi::Env env, Napi::Object exports) {
    auto defineOperation = [&] (const std::string &name, OperationHandler handler) {
        // Async version
        exports.Set(name, Napi::Function::New(env, [=] (const Napi::CallbackInfo &info) -> Napi::Value {
            OperationExecuter executer;
            try {
                executer = handler(info);
            } catch (std::exception &ex) {
                Napi::Error::New(info.Env(), ex.what()).ThrowAsJavaScriptException();
                return info.Env().Undefined();
            }

            auto worker = new AsyncFileSystemOperationWorker(info.Env(), executer);
            worker->Queue();

            return worker->getPromise();
        }));

        // Sync version
        exports.Set(name + "Sync", Napi::Function::New(env, [=] (const Napi::CallbackInfo &info) {
            try {
                OperationExecuter executer = handler(info);
                ReturnValueMaker returnValueMaker = executer();
                return returnValueMaker(info.Env());
            } catch (std::exception &ex) {
                Napi::Error::New(info.Env(), ex.what()).ThrowAsJavaScriptException();
                return info.Env().Undefined();
            }
        }));
    };

    defineOperation("remove", [] (const Napi::CallbackInfo &info) {
        std::string path = info[0].As<Napi::String>().Utf8Value();

        return [=] () {
            std::filesystem::remove_all(path);

            return [=] (Napi::Env env) {
                return env.Undefined();
            };
        };
    });

    defineOperation("copy", [] (const Napi::CallbackInfo &info) {
        std::string src = info[0].As<Napi::String>().Utf8Value(),
                    dst = info[1].As<Napi::String>().Utf8Value();

        return [=] () {
            std::filesystem::copy(
                src,
                dst,
                std::filesystem::copy_options::recursive
              | std::filesystem::copy_options::overwrite_existing
              | std::filesystem::copy_options::copy_symlinks
            );

            return [=] (Napi::Env env) {
                return env.Undefined();
            };
        };
    });

    defineOperation("exists", [] (const Napi::CallbackInfo &info) {
        std::string path = info[0].As<Napi::String>().Utf8Value();

        return [=] () {
            bool result = std::filesystem::exists(path);

            return [=] (Napi::Env env) {
                return Napi::Boolean::New(env, result);
            };
        };
    });

    defineOperation("ensureDir", [] (const Napi::CallbackInfo &info) {
        std::string path = info[0].As<Napi::String>().Utf8Value();

        return [=] () {
            std::filesystem::create_directories(path);

            return [=] (Napi::Env env) {
                return env.Undefined();
            };
        };
    });

    defineOperation("emptyDir", [] (const Napi::CallbackInfo &info) {
        std::string path = info[0].As<Napi::String>().Utf8Value();

        return [=] () {
            for (const auto &entry : std::filesystem::directory_iterator(path)) 
                std::filesystem::remove_all(entry.path());

            return [=] (Napi::Env env) {
                return env.Undefined();
            };
        };
    });

    // std::filesystem doesn't support file_size() on directories well, so use POSIX APIs instead.
    defineOperation("calcSize", [] (const Napi::CallbackInfo &info) {
        std::string path = info[0].As<Napi::String>().Utf8Value();

        return [=] () {
            uintmax_t result = 0;

            // Get size with lstat for each entry
            traverse(path, [&] (const std::string &entryPath) {
                struct stat lstatResult;
                int status = lstat(entryPath.c_str(), &lstatResult);
                if (status != 0) {
                    int err = errno;
                    throw std::filesystem::filesystem_error(
                        "lstat(" + entryPath + ")",
                        std::error_code(err, std::system_category())
                    );
                }

                result += lstatResult.st_size;
            });

            return [=] (Napi::Env env) {
                return Napi::Number::From(env, result);
            };
        };
    });

    defineOperation("chmodown", [] (const Napi::CallbackInfo &info) {
        std::string path = info[0].As<Napi::String>().Utf8Value();
        auto parameters = info[1].As<Napi::Object>();
        
        auto parameterMode = parameters.Get("mode"),
             parameterOwner = parameters.Get("owner"),
             parameterGroup = parameters.Get("group");
        bool changeMode = !(parameterMode.IsNull() || parameterMode.IsUndefined()),
             changeOwner = !(parameterOwner.IsNull() || parameterOwner.IsUndefined()),
             changeGroup = !(parameterGroup.IsNull() || parameterGroup.IsUndefined());

        mode_t mode;
        uid_t owner;
        gid_t group;

        if (changeMode) {
            mode = parameterMode.As<Napi::Number>().Int64Value();
        }

        struct passwd pwd, *pwdResult;
        long bufferSize = sysconf(_SC_GETPW_R_SIZE_MAX);
        if (bufferSize == -1) {
            int err = errno;
            throw std::filesystem::filesystem_error(
                "sysconf(_SC_GETPW_R_SIZE_MAX)",
                std::error_code(err, std::system_category())
            );
        }
        char buffer[bufferSize];

        if (changeOwner) {
            if (parameterOwner.IsNumber()) {
                owner = parameterOwner.As<Napi::Number>().Int64Value();
            } else if (parameterOwner.IsString()) {
                std::string name = parameterOwner.As<Napi::String>().Utf8Value();
                if (getpwnam_r(name.c_str(), &pwd, buffer, bufferSize, &pwdResult) == 0) {
                    if (!pwdResult)
                        throw std::invalid_argument("No such user by name: " + name);
                } else {
                    int err = errno;
                    throw std::filesystem::filesystem_error(
                        "getpwnam_r(" + name + ")",
                        std::error_code(err, std::system_category())
                    );
                }

                owner = pwd.pw_uid;
            } else {
                throw std::invalid_argument("Invalid type of parameter owner");
            }
        }

        if (!changeOwner)
            owner = -1;

        if (changeGroup) {
            if (parameterGroup.IsNumber()) {
                group = parameterGroup.As<Napi::Number>().Int64Value();
            } else if (parameterGroup.IsString()) {
                std::string name = parameterOwner.As<Napi::String>().Utf8Value();

                struct group grp, *grpResult;
                long bufferSize = sysconf(_SC_GETGR_R_SIZE_MAX);
                if (bufferSize == -1) {
                    int err = errno;
                    throw std::filesystem::filesystem_error(
                        "sysconf(_SC_GETGR_R_SIZE_MAX)",
                        std::error_code(err, std::system_category())
                    );
                }
                char buffer[bufferSize];

                if (getgrnam_r(name.c_str(), &grp, buffer, bufferSize, &grpResult) == 0) {
                    if (!pwdResult)
                        throw std::invalid_argument("No such group by name: " + name);
                } else {
                    int err = errno;
                    throw std::filesystem::filesystem_error(
                        "getgrnam_r(" + name + ")",
                        std::error_code(err, std::system_category())
                    );
                }

                group = grp.gr_gid;
            } else if (parameterGroup.IsBoolean()) {
                if (parameterGroup.As<Napi::Boolean>().Value()) {
                    // Use the group of user
                    if (!changeOwner)
                        throw std::invalid_argument("The owner is not specfied.");

                    if (!pwdResult) {
                        if (getpwuid_r(owner, &pwd, buffer, bufferSize, &pwdResult) == 0) {
                            if (!pwdResult)
                                throw std::invalid_argument("No such user by uid: " + std::to_string(owner));
                        } else {
                            int err = errno;
                            throw std::filesystem::filesystem_error(
                                "getpwuid_r(" + std::to_string(owner) + ")",
                                std::error_code(err, std::system_category())
                            );
                        }
                    }

                    group = pwd.pw_gid;
                } else
                    changeGroup = false;
            } else {
                throw std::invalid_argument("Invalid type of parameter group");
            }
        }

        if (!changeGroup)
            group = -1;

        return [=] () {
            traverse(path, [=] (const std::string &entryPath) {
                if (changeMode) {
                    if (chmod(path.c_str(), mode) != 0) {
                        int err = errno;
                        throw std::filesystem::filesystem_error(
                            "chmod(" + path + ")",
                            std::error_code(err, std::system_category())
                        );
                    }
                }

                if (changeOwner || changeGroup) {
                    if (chown(path.c_str(), owner, group) != 0) {
                        int err = errno;
                        throw std::filesystem::filesystem_error(
                            "chown(" + path + ")",
                            std::error_code(err, std::system_category())
                        );
                    }
                }
            });

            return [=] (Napi::Env env) {
                return env.Undefined();
            };
        };
    });

    return exports;
}

NODE_API_MODULE(NODE_MODULE_NAME, Init)
