const { spawn, execSync } = require("child_process");
const net = require("net");

const PORT = 15420;
const HOST = "127.0.0.1";

let viteProc = null;

function cleanup() {
  if (!viteProc || viteProc.killed) return;
  const pid = viteProc.pid;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      viteProc.kill("SIGTERM");
    }
  } catch (err) {
    console.warn(`[cleanup] 终止进程 PID=${pid} 失败: ${err.message}`);
  }
  viteProc = null;
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
process.on("exit", cleanup);

function isPortListening(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitForPort(port, host, proc, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc && proc.exitCode !== null) {
      throw new Error(`vite 进程提前退出，exitCode=${proc.exitCode}`);
    }
    if (await isPortListening(port, host)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`等待 http://${host}:${port} 启动超时`);
}

(async () => {
  let serverStartedByUs = false;

  if (!(await isPortListening(PORT, HOST))) {
    viteProc = spawn(`npx vite --port ${PORT} --host ${HOST}`, {
      shell: true,
      stdio: "ignore",
      windowsHide: true,
    });
    serverStartedByUs = true;

    try {
      await waitForPort(PORT, HOST, viteProc);
    } catch (e) {
      console.error(e.message);
      cleanup();
      process.exit(1);
    }
  }

  let exitCode = 0;
  try {
    execSync("npx playwright test --grep @smoke", {
      stdio: "inherit",
      env: { ...process.env, MANAGED_SERVER: "1" },
      windowsHide: true,
    });
  } catch (e) {
    exitCode = e.status || 1;
  }

  if (serverStartedByUs) {
    cleanup();
  }

  process.exit(exitCode);
})();
