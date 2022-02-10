import child_process from "child_process";

/**
 * Start judge service and restart it when connection lost.
 *
 * Exit code = 100 means connection lost.
 */

while (true) {
  const child = child_process.fork("./src/index");

  child.on("error", error => {
    console.error(error);
    child.kill("SIGKILL");
    process.exit(-1);
  });

  await new Promise(resolve => {
    child.on("exit", code => {
      // 100: Disconnected
      if (code === 100) {
        // Restart child
        return resolve();
      }
  
      process.exit(code);
    });
  });
};
