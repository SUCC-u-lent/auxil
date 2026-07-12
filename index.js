const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');

const ollama = require('./ollamaserve');
const {
    init,
    stop,
    stopProcessing,
    enqueueRequest,
    dequeueRequest,
    getRequest
} = require('./client_queue');
const { ClientRequest, RequestState } = require('./utilities/request');

// Load config
const configJsonFile = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

const config = {
    model: configJsonFile.model || "gpt-3.5-turbo",
    embeddingModel: configJsonFile.embeddingModel || "nomic-embed-text",
    corsAllowedOrigins: configJsonFile.corsAllowedOrigins || ["http://localhost:8000"],
    serverPort: configJsonFile.serverPort || 3000,
    ollamaPort: configJsonFile.ollamaPort || 10434,
    serverAddress: configJsonFile.serverAddress || "localhost",
    concurrentThreads: configJsonFile.concurrentThreads || 2,
    keepModelsInMemory: configJsonFile.keepModelsInMemory || false
};

config.corsAllowedOrigins.push(`http://${config.serverAddress}:${config.serverPort}`);
config.corsAllowedOrigins.push(`http://localhost:${config.serverPort}`);

const app = express();

app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

app.use(cors({
    origin: function (origin, callback) {
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

// All requests start with /api/, this is the base path for all requests
const requestSource = "/api/";
app.post(requestSource + 'generate', (req, res) => {
    // send request to ollama server to generate text
    // check for the following content in the request body
    // model : string : required
    // prompt : string
    // suffix : string
    // format : string
    // system : string
    // stream : boolean
    // think : boolean
    // raw : boolean
    // keep_alive : string
    // options : object
    // logprobs : boolean
    // top_logprobs : integer
    const requestBody = req.body;
    const model = requestBody.model || config.model;
    const prompt = requestBody.prompt || "";
    const suffix = requestBody.suffix || "";
    const format = requestBody.format || "text";
    const system = requestBody.system || "";
    const stream = requestBody.stream || false;
    const think = requestBody.think || false;
    const raw = requestBody.raw || false;
    const keep_alive = requestBody.keep_alive || "";
    const options = requestBody.options || {};
    const logprobs = requestBody.logprobs || false;
    const top_logprobs = requestBody.top_logprobs || 0;
    const requestOptions = {
        model: model,
        prompt: prompt,
        suffix: suffix,
        format: format,
        system: system,
        stream: stream,
        think: think,
        raw: raw,
        keep_alive: keep_alive,
        options: options,
        logprobs: logprobs,
        top_logprobs: top_logprobs
    };
    const clientRequest = new ClientRequest(`http://localhost:${config.ollamaPort}/api/generate`, 'POST', requestOptions, {
        'Content-Type': 'application/json'
    });
    enqueueRequest(clientRequest);
})

app.post(requestSource + 'chat', (req, res) => {
    // send request to ollama server to generate embeddings
    // check for the following content in the request body
// model
// stringrequired
// Model name
// messages
// object[]required
// tools
// object[]
// format
// enum<string>
// options
// object
// stream
// booleandefault:true
// think
// boolean
// keep_alive
// string
// logprobs
// boolean
// top_logprobs
// integer
    const requestBody = req.body;
    const model = requestBody.model || config.model;
    const messages = requestBody.messages || [];
    const tools = requestBody.tools || [];
    const format = requestBody.format || "text";
    const options = requestBody.options || {};
    const stream = requestBody.stream || true;
    const think = requestBody.think || false;
    const keep_alive = requestBody.keep_alive || "";
    const logprobs = requestBody.logprobs || false;
    const top_logprobs = requestBody.top_logprobs || 0;
    const requestOptions = {
        model: model,
        messages: messages,
        tools: tools,
        format: format,
        options: options,
        stream: stream,
        think: think,
        keep_alive: keep_alive,
        logprobs: logprobs,
        top_logprobs: top_logprobs
    };
    const clientRequest = new ClientRequest(`http://localhost:${config.ollamaPort}/api/chat`, 'POST', requestOptions, {
        'Content-Type': 'application/json'
    });
    enqueueRequest(clientRequest);
})

app.post(requestSource + 'embed', (req, res) => {
    // send request to ollama server to generate embeddings
    // check for the following content in the request body
// model
// stringrequired
// input
// string
// required
// truncate
// booleandefault:true
// dimensions
// integer
// keep_alive
// string
// options
// object
    const requestBody = req.body;
    const model = requestBody.model || config.embeddingModel;
    const input = requestBody.input || "";
    const truncate = requestBody.truncate || true;
    const dimensions = requestBody.dimensions || 0;
    const keep_alive = requestBody.keep_alive || "";
    const options = requestBody.options || {};
    const requestOptions = {
        model: model,
        input: input,
        truncate: truncate,
        dimensions: dimensions,
        keep_alive: keep_alive,
        options: options
    };
    const clientRequest = new ClientRequest(`http://localhost:${config.ollamaPort}/api/embed`, 'POST', requestOptions, {
        'Content-Type': 'application/json'
    });
    enqueueRequest(clientRequest);
})

app.get(requestSource + 'request/status/:id', (req, res) => {
    const requestId = req.params.id;
    const clientRequest = getRequest(requestId);
    if (!clientRequest) {
        res.status(404).json({ error: 'Request not found' });
        return;
    }
    res.json({
        id: clientRequest.getId(),
        status: clientRequest.getStatus()
    });
});

app.get(requestSource + 'request/result/:id', (req, res) => {
    const requestId = req.params.id;
    const clientRequest = getRequest(requestId);
    if (!clientRequest) {
        res.status(404).json({ error: 'Request not found' });
        return;
    }
    if (clientRequest.getStatus() !== RequestState.FULFILLED) {
        res.status(400).json({ error: 'Request not fulfilled yet' });
        return;
    }
    res.json({
        id: clientRequest.getId(),
        result: clientRequest.getResult()
    });
});


app.get(requestSource + 'models', (req, res) => {
    // Send request to ollama server to get models
    http.get(`http://localhost:${config.ollamaPort}/api/tags`, (ollamaRes) => {
        let data = '';
        ollamaRes.on('data', (chunk) => {
            data += chunk;
        });
        ollamaRes.on('end', () => {
            res.json(JSON.parse(data));
        });
    }).on('error', (err) => {
        res.status(500).json({ error: 'Failed to fetch models' });
    });
});

// ===========
// START SERVER
// =========================
ollama.start(config.ollamaPort, config.keepModelsInMemory).then(() => {

    console.clear();
    console.log("Auxil started");

    app.listen(config.serverPort, config.serverAddress, () => {
        console.log(`Running on http://${config.serverAddress}:${config.serverPort}`);
    });

}).catch(err => {
    console.error("Failed to start:", err);
});