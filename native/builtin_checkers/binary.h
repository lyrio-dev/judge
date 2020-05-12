#include <testlib.h>

void builtinCheckerBinary() {
    // It will be slower to use testlib's readChar(), so use <cstdio> instead
    FILE *fout = fopen(ouf.name.c_str(), "rb");
    FILE *fans = fopen(ans.name.c_str(), "rb");

    fseek(fout, 0, SEEK_END);
    fseek(fans, 0, SEEK_END);

    size_t lenOut = ftell(fout), lenAns = ftell(fans);

    if (lenAns > lenOut)
        quitf(_wa, "Output is shorter than answer - expected %zu bytes but found %zu bytes", lenAns, lenOut);
    
    if (lenOut > lenAns)
        quitf(_wa, "Output is longer than answer - expected %zu bytes but found %zu bytes", lenAns, lenOut);
    
    rewind(fout);
    rewind(fans);

    const size_t BUFFER_SIZE = 2 * 1024 * 1024;
    static char bufferOut[BUFFER_SIZE], bufferAns[BUFFER_SIZE];
    size_t current = 0;
    while (!feof(fout)) {
        size_t sout = fread(bufferOut, 1, BUFFER_SIZE, fout);
        size_t sans = fread(bufferAns, 1, BUFFER_SIZE, fans);

        if (sout != sans) {
            quitf(_fail, "Read %zu bytes from output but read %zu bytes from answer", sout, sans);
        }

        for (size_t i = 0; i < sout; i++) {
            current++;
            if (bufferOut[i] != bufferAns[i])
                quitf(
                    _wa, "%zu%s byte differ - expected: '%#04x', found: '%#04x'",
                    current,
                    englishEnding(current).c_str(),
                    bufferAns[i], bufferOut[i]
                );
        }
    }

    ouf.close();
    ans.close();

    quitf(_ok, "%ld byte(s)", lenAns);
}
