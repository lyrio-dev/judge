#define _GNU_SOURCE

#include <unistd.h>
#include <fcntl.h> 
#include <stdio.h>
#include <sys/syscall.h>

int main(int argc, char **argv) {
    int r = syscall(
        SYS_renameat2,
        AT_FDCWD, argv[1],
        AT_FDCWD, argv[2], 
        RENAME_EXCHANGE
    );
    if (r < 0) {
        perror("renameat2");
        return 1;
    }
    else return 0;
}
