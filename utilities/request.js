enum RequestState {
    PENDING = 'pending',
    PROCESSING = 'processing',
    FULFILLED = 'fulfilled',
    REJECTED = 'rejected'
}
/**
 * A client request, it can be used to request data from the server and cancel a request
 */
class ClientRequest {
    // The http request stuff
    #headers;
    #url;
    #body;
    #method
    internalRequest;

    #id;
    /** @type {RequestState} */
    #status;
    #result;
    constructor(url, method = 'POST', body = {}, headers = {}) {
        this.#url = url;
        this.#method = method;
        this.#body = body;
        this.#headers = headers;
        this.#id = crypto.randomUUID();
        this.#status = RequestState.PENDING;
        this.#result = null;
    }
    cancel(){
        if (this.internalRequest) {
            this.internalRequest.abort();
        }
    }
    setResult(result) {
        this.#result = result;
    }
    setStatus(status) {
        this.#status = status;
    }
    getStatus() {
        return this.#status;
    }
    getId() {
        return this.#id;
    }
    getResult() {
        if (this.#status !== RequestState.FULFILLED) {
            throw new Error("Request not fulfilled yet");
        }
        return this.#result;
    }
}

module.exports = {
    ClientRequest,
    RequestState
}