#include <testlib.h>

#define TRIM(s) s.erase(s.find_last_not_of(" \f\t\r\v\n") + 1);

void builtinCheckerLines(bool caseSensitive) {
    std::string strAnswer;

    int n = 0, ansTailingEmptyLinesCount = 0, oufTailingEmptyLinesCount = 0;
    while (!ans.eof() || !ouf.eof()) {
        std::string j, p;

        if (!ans.eof()) {
            j = ans.readLine();
            TRIM(j);
            if (j.empty())
                ansTailingEmptyLinesCount++;
            else {
                strAnswer = j;
                ansTailingEmptyLinesCount = 0;
            }
        }
        else
            ansTailingEmptyLinesCount++;

        if (!ouf.eof()) {
            p = ouf.readLine();
            TRIM(p);
            if (p.empty())
                oufTailingEmptyLinesCount++;
            else
                oufTailingEmptyLinesCount = 0;
        }
        else
            oufTailingEmptyLinesCount++;

        n++;

        bool equal;
        if (caseSensitive)
            equal = j == p;
        else {
            equal = lowerCase(j) == lowerCase(p);
        }
        
        if (!equal)
            quitf(_wa, "%d%s line differ - expected: '%s', found: '%s'", n, englishEnding(n).c_str(), compress(j).c_str(), compress(p).c_str());
    }

    int ansLines = n - ansTailingEmptyLinesCount, oufLines = n - oufTailingEmptyLinesCount;

    if (ansLines > oufLines)
        quitf(_wa, "Output is shorter than answer - expected %d lines but found %d lines", ansLines, oufLines);
    
    if (oufLines > ansLines)
        quitf(_wa, "Output is longer than answer - expected %d lines but found %d lines", oufLines, ansLines);
    
    if (ansLines == 1)
        quitf(_ok, "single line: '%s'", compress(strAnswer).c_str());
    
    quitf(_ok, "%d lines", n);
}
