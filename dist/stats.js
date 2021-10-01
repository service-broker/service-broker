"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Counter = void 0;
class Counter {
    constructor() {
        this.map = {};
    }
    inc(name) {
        this.map[name] = (this.map[name] || 0) + 1;
    }
    clear() {
        this.map = {};
    }
    toJson() {
        return JSON.stringify(this.map);
    }
}
exports.Counter = Counter;
