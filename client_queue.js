const Queue = require("./utilities/queue");
const {ClientRequest} = require("./utilities/request");

/** @type {ClientRequest | undefined} */
const processingRequest = undefined;

/** @type {Queue<ClientRequest>} */
const requestQueue = new Queue();

const requestQueueLock = new AsyncLock();

const requestCode = async () => {
    if (processingRequest) return;
    if (requestQueue.isEmpty()) return;
    const nextRequest = requestQueue.poll();
    if (!nextRequest) return;
    processingRequest = nextRequest;
    if (nextRequest.getMethod() === 'POST') {
        try {
            const response = fetch(nextRequest.getUrl(), {
                method: 'POST',
                headers: nextRequest.getHeaders(),
                body: JSON.stringify(nextRequest.getBody())
            });
            nextRequest.internalRequest = response;
            await response;
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            nextRequest.setResult(result);
            nextRequest.setStatus('fulfilled');
        } catch (error) {
            nextRequest.setStatus('rejected');
            nextRequest.setResult(error);
        } finally {
            processingRequest = undefined;
        }
    } else if (nextRequest.getMethod() === 'GET') {
        try {
            const response = fetch(nextRequest.getUrl(), {
                method: 'GET',
                headers: nextRequest.getHeaders()
            });
            nextRequest.internalRequest = response;
            await response;
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            nextRequest.setResult(result);
            nextRequest.setStatus('fulfilled');
        } catch (error) {
            nextRequest.setStatus('rejected');
            nextRequest.setResult(error);
        } finally {
            processingRequest = undefined;
        }
    }
}

let loop = null;

function stopProcessing() {
    if (!processingRequest) return;
    processingRequest.cancel();
}

function init() {
    if (loop != null) return;
    loop = setInterval(requestCode, 100);
}

function stop() {
    if (loop == null) return;
    clearInterval(loop);
    loop = null;
}

/**
 * @param {ClientRequest} request  
 */
function enqueueRequest(request) {
    requestQueue.enqueue(request);
}

/**
 * @param {ClientRequest} request  
 */
function dequeueRequest(request) {
    if (processingRequest && processingRequest.getId() === request.getId()) {
        stopProcessing();
    } else if (requestQueue.includes(request)) {
        // Remove from queue
        const newQueue = new Queue();
        while (!requestQueue.isEmpty()) {
            const req = requestQueue.poll();
            if (req.getId() !== request.getId()) {
                newQueue.enqueue(req);
            }
        }
        requestQueue.internalQueue = newQueue.internalQueue;
    }
}

/**
 * @param {number} requestId  
 * @returns {ClientRequest | undefined} 
 */
function getRequest(requestId) {
    if (processingRequest && processingRequest.getId() === requestId) {
        return processingRequest;
    } else {
        for (const req of requestQueue.internalQueue) {
            if (req.getId() === requestId) {
                return req;
            }
        }
    }
    return undefined;
}

module.exports = {
    init,
    stop,
    stopProcessing,
    enqueueRequest,
    dequeueRequest,
    getRequest
}