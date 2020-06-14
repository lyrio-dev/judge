#include <testlib.h>
#include <napi.h>
#include <signal.h>
#include <sys/wait.h>
#include <cstdio>

#include "integers.h"
#include "floats.h"
#include "lines.h"
#include "binary.h"

// Node.js does some clean-ups with atexit(), we need to register another atexit() handler
// in the child process to be called before Node.js's handler to exit immediately.
void preventNodejsCleanup() {
    fflush(stderr);
    _exit(0);
}

class BuiltinCheckerWorker : public Napi::AsyncWorker {
private:
    std::string outputFile, answerFile;
    std::function<void ()> checkerFunction;

    std::string message;

public:
    BuiltinCheckerWorker(
        Napi::Function &&callback,
        std::string &&outputFile,
        std::string &&answerFile,
        std::function<void ()> checkerFunction
    ) : Napi::AsyncWorker(callback), outputFile(outputFile), answerFile(answerFile), checkerFunction(checkerFunction) {}

    void Execute() {
        pid_t pid = 0;
        try {
            int pipeFd[2];
            if (pipe(pipeFd) != 0) {
                throw std::system_error(errno, std::system_category(), "pipe");
            }

            pid = fork();
            if (pid == -1) {
                // Failed
                close(pipeFd[0]);
                close(pipeFd[1]);
                throw std::system_error(errno, std::system_category(), "fork");
            } else if (pid == 0) {
                // Child
                atexit(preventNodejsCleanup);

                close(STDIN_FILENO);
                close(STDOUT_FILENO);

                setpgid(0, 0);

                dup2(pipeFd[1], STDERR_FILENO);
                close(pipeFd[0]);
                registerTestlib(3, "/dev/null", outputFile.c_str(), answerFile.c_str());
                checkerFunction();
                
                exit(0); // Won't reach here
            }

            // Parent
            close(pipeFd[1]);

            const size_t BUFFER_SIZE = 64 * 1024;
            char buffer[BUFFER_SIZE];

            size_t size;
            while ((size = read(pipeFd[0], buffer, BUFFER_SIZE)) > 0) {
                message.append(buffer, size);
            }

            if (size == -1) {
                close(pipeFd[0]);
                throw std::system_error(errno, std::system_category(), "read");
            }
        }
        catch (std::exception &ex) {
            SetError(ex.what());
        }
        catch (...) {
            SetError("Unknown error");
        }

        kill(pid, SIGKILL);
        waitpid(pid, NULL, 0);
    }

    void OnOK() {
        auto env = Env();
        Callback().Call({env.Undefined(), Napi::String::New(env, message)});
    }
};

void runBuiltinChecker(const Napi::CallbackInfo &info, std::function<void ()> checkerFunction) {
    auto worker = new BuiltinCheckerWorker(
        info[3].As<Napi::Function>(),
        info[0].As<Napi::String>().Utf8Value(),
        info[1].As<Napi::String>().Utf8Value(),
        checkerFunction
    );
    worker->Queue();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("runBuiltinChecker", Napi::Function::New(env, [] (const Napi::CallbackInfo &info) {
        const auto config = info[2].As<Napi::Object>();
        auto type = config.Get("type").As<Napi::String>().Utf8Value();
        if (type == "integers")
            runBuiltinChecker(info, builtinCheckerIntegers);
        else if (type == "floats") {
            const int precision = config.Get("precision").As<Napi::Number>().Int32Value();
            runBuiltinChecker(info, std::bind(builtinCheckerFloats, precision));
        } else if (type == "lines") {
            const bool caseSensitive = config.Get("caseSensitive").As<Napi::Boolean>().Value();
            runBuiltinChecker(info, std::bind(builtinCheckerLines, caseSensitive));
        } else
            runBuiltinChecker(info, builtinCheckerBinary);
    }));
    return exports;
}

NODE_API_MODULE(NODE_MODULE_NAME, Init)
