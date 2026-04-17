const { spawn } = require('child_process');
const http = require('http');

let ollamaProcess = null;
let shuttingDown = false;

function waitForOllama(port) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      http
        .get(`http://localhost:${port}`, () => {
          clearInterval(interval);
          resolve();
        })
        .on('error', () => {});
    }, 500);
  });
}

function start(port = 11434) {
  if (ollamaProcess) {
    return Promise.resolve(); // already running
  }

  ollamaProcess = spawn('ollama', ['serve'], {
    stdio: 'inherit',
    detached: false,
    env: {
      ...process.env,
      OLLAMA_HOST: `127.0.0.1:${port}` // ensures correct port
    }
  });

  ollamaProcess.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`Ollama exited unexpectedly (${code || signal})`);
    }
    ollamaProcess = null;
  });

  setupShutdown();

  return waitForOllama(port);
}

function stop() {
  if (!ollamaProcess) return;

  shuttingDown = true;

  try {
    ollamaProcess.kill('SIGTERM');

    if (ollamaProcess.pid) {
      process.kill(ollamaProcess.pid, 'SIGTERM');
    }
  } catch (e) {
    // ignore if already dead
  }

  ollamaProcess = null;
}

function setupShutdown() {
  const shutdown = () => {
    stop();
    process.exit();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('exit', stop);
}

module.exports = {
  start,
  stop
};