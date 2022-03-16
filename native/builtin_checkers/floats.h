#include <testlib.h>

void builtinCheckerFloats(int precision) {
    double eps = pow(10, -precision);

    int n = 0;
    while (!ans.seekEof() && !ouf.seekEof()) {
        n++;
        double j = ans.readDouble();
        double p = ouf.readDouble();
        if (!doubleCompare(j, p, eps))
            quitf(_wa, "%d%s number differ - expected: '%.10f', found: '%.10f'", n, englishEnding(n).c_str(), j, p);
    }

    int extraInAnsCount = 0;

    while (!ans.seekEof()) {
        ans.readDouble();
        extraInAnsCount++;
    }
    
    int extraInOufCount = 0;

    while (!ouf.seekEof()) {
        ouf.readDouble();
        extraInOufCount++;
    }

    if (extraInAnsCount > 0)
        quitf(_wa, "Output is shorter than answer - expected %d elements but found %d elements", n + extraInAnsCount, n);
    
    if (extraInOufCount > 0)
        quitf(_wa, "Output is longer than answer - expected %d elements but found %d elements", n, n + extraInOufCount);

    quitf(_ok, "%d numbers", n);
}
