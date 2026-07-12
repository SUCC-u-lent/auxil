class Queue<T> {
    internalQueue = [];

    enqueue(item) {
        this.internalQueue.push(item);
    }
    /** @returns {T | undefined} */
    poll()
    {
        if (this.internalQueue.length === 0) return undefined;
        return this.internalQueue.shift();
    }
    isEmpty() {
        return this.internalQueue.length === 0;
    }
    hasItems() {
        return this.internalQueue.length > 0;
    }
    includes(item) {
        return this.internalQueue.includes(item);
    }
}
module.exports = Queue;