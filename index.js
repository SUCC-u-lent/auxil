const express = require('express');
const cors = require('cors');

const ollama = require('./ollamaserve');
const http = require('http');

// Load configuration
const configJsonFile = JSON.parse(require('fs').readFileSync('config.json', 'utf-8'));
const config = {
    corsAllowedOrigins: configJsonFile.corsAllowedOrigins || ["http://localhost:8000"],
    serverPort: configJsonFile.serverPort || 3000,
    ollamaPort: configJsonFile.ollamaPort || 10434,
    serverAddress: configJsonFile.serverAddress || "localhost",
    concurrentThreads: configJsonFile.concurrentThreads || 2 // No generations are triggered beyond this.
}
config.corsAllowedOrigins.push(`http://${config.serverAddress}:${config.serverPort}`); // Ensure the server's own address is allowed for CORS
config.corsAllowedOrigins.push(`http://localhost:${config.serverPort}`); // Ensure the server's own address is allowed for CORS

const app = express();
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like curl, Postman)
    if (!origin) return callback(null, true);

    if (config.corsAllowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
    optionsSuccessStatus: 200
}));
app.use(express.json());

const queue = [];
let activeThreads = 0;

const ollamaPort = config.ollamaPort; // Ensure this matches the port used in ollamaserve.js

const port = config.serverPort;
const ipAdress = config.serverAddress;

app.get('/', async (req, res) => {
    // Send the index.html
    res.sendFile(__dirname + '/index.html');
});

// Check if Ollama server is running and responding properly.
app.get('/api/ollama/status', async (req, res) => {
    const promise = new Promise((resolve,reject) => {
        http.get(`http://localhost:${ollamaPort}`, (ollamaRes) => {
            if (ollamaRes.statusCode === 200) {
                resolve('Ollama is running and responding properly.');
            } else {
                reject(`Ollama responded with status code: ${ollamaRes.statusCode}`);
            }
        }).on('error', (err) => {reject(err)});
    });
    try {
        const status = await promise;
        res.send(status);
    } catch (e) {
        res.status(500).send(e);
    }
});

// Check if this server is running.
app.get("/api/status", async (req, res) => {
    res.send('Auxil server is running and responding properly.');
});

app.get("/api/models", async (req, res) => {
    http.get(`http://localhost:${ollamaPort}/api/tags`, (ollamaRes) => {
        if (ollamaRes.statusCode !== 200) {
            res.status(ollamaRes.statusCode).send(`Ollama API responded with status code: ${ollamaRes.statusCode}`);
            return;
        }
        let data = '';
        ollamaRes.on('data', (chunk) => {
            data += chunk;
        });
        ollamaRes.on('end', () => {
            try {
                const json = JSON.parse(data);
                const models = json.models.map(m => m.name);
                res.json({ models });
            } catch (e) {
                res.status(500).send('Ollama API responded with invalid JSON.');
            }
        });
    }).on('error', (err) => {
        res.status(500).send('Ollama API is not responding properly.');
    });
})

async function isModelLoaded(modelName)
{
    const prm = new Promise((resolve, reject) => {
        http.get(`http://localhost:${ollamaPort}/api/ps`, (ollamaRes) => {
            if (ollamaRes.statusCode !== 200) {
                reject(`Ollama API responded with status code: ${ollamaRes.statusCode}`);
                return;
            }
            let data = '';
            ollamaRes.on('data', (chunk) => {
                data += chunk;
            })
            ollamaRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const isLoaded = json.models.some(p => p.model === modelName);
                    resolve(isLoaded);
                } catch (e) {
                    reject('Ollama API responded with invalid JSON.');
                }
            })
        }).on('error', (err) => {
            reject('Ollama API is not responding properly.');
        });
    });
    try{
        return await prm;
    }catch(e){return false;}
}

app.post("/api/load",async (req,res)=>{
    const model = req.body.model
    const prompt = req.body.prompt
    const options = req.body.options || {};
    const format = req.body.format || undefined;    
    if (!model) {
        res.status(400).json({ error: 'Missing model in request body' });
        return;
    }
    try {
        const loaded = await isModelLoaded(model);  
        if (loaded) {
            res.json({ message: `Model '${model}' is already loaded.` });
        } else {
            const result = await generate(model, prompt || "Hello, load this model!", options, format);
            if (result.error) {
                res.status(result.status || 500).json({ error: `Failed to load model '${model}'`, details: result.details });
            } else {
                res.json({ message: `Model '${model}' loaded successfully.`, details: result });
            }
        }     
    } catch (err) {
        res.status(500).json({ error: 'Failed to load model', details: err });
    }
})

async function generate(model,prompt,options, format = undefined)
{
    if (!model || !prompt) {
        return { error: 'Missing model or prompt', status: 400 };
    }

    const callOllama = (path, payload) => {
        return new Promise((resolve, reject) => {
            const request = http.request(
                `http://localhost:${ollamaPort}${path}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    }
                },
                (ollamaRes) => {
                    let data = "";

                    ollamaRes.on("data", chunk => data += chunk);

                    ollamaRes.on("end", () => {
                        if (ollamaRes.statusCode === 404) {
                            return reject({ type: "NOT_FOUND" });
                        }

                        try {
                            resolve(JSON.parse(data));
                        } catch {
                            reject({ type: "INVALID_JSON", data });
                        }
                    });
                }
            );

            request.on("error", reject);
            request.write(JSON.stringify(payload));
            request.end();
        });
    };

    try {
        let result;

        // 1️⃣ Try /api/generate
        try {
            result = await callOllama("/api/generate", {
                model,
                prompt,
                stream: false,
                options,
                format: format
            });
        } catch (err) {
            if (err.type !== "NOT_FOUND") throw err;

            // 2️⃣ fallback to /api/chat
            result = await callOllama("/api/chat", {
                model,
                messages: [
                    { role: "user", content: prompt }
                ],
                stream: false,
                options,
                format: format
            });
        }

        return typeof result === "string" ? JSON.parse(result) : result

    } catch (err) {
		console.error(err)
        return { error: 'Failed to generate response from Ollama', details: err, status: 500 };
    }
}

app.post("/api/generate", async (req, res) => {
    const model = req.body.model;
    const prompt = req.body.prompt;
    const options = req.body.options || {};
    const format = req.body.format || undefined;

    const promise = new Promise((resolve) => {
        queue.push(async () => {
            activeThreads++;
            try {
                const result = await generate(model, prompt, options, format);
                resolve(result);
            } catch (err) {
                resolve({ error: 'Failed to process generation task', details: err, status: 500 });
            } finally {
                activeThreads--;
                onTaskAdded();
            }
        });
        onTaskAdded();
    });
    const result = await promise;
    if (result.error) {
        res.status(result.status || 500).json({ error: result.error, details: result.details });
    } else {
        res.json(result);
    }
});

ollama.start(ollamaPort).then(()=>{
    console.clear();
    console.log('Configuration loaded:');
    console.log(`CORS Allowed Origins: ${config.corsAllowedOrigins.join(', ')}`);
    console.log(`Server Port: ${config.serverPort}`);
    console.log(`Ollama Port: ${config.ollamaPort}`);
    console.log(`Server Address: ${config.serverAddress}`);
    console.log()
    console.log('Ollama server started successfully.');
    app.listen(port, ipAdress, () => {
        console.log(`Server is running on http://${ipAdress}:${port}`);
    });
})
.catch((err)=>{
    console.error('Failed to start Ollama server:', err);
    console.error('Please ensure that Ollama is installed and properly configured.');
    console.error('Auxil will now exit. Please fix the issue and restart Auxil.');
    process.exit(1);
});

function onTaskAdded()
{
    while (activeThreads < config.concurrentThreads && queue.length > 0) {
        const task = queue.shift();
        task();
    }
}