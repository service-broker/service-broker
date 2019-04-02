
export class Counter {
  private map: {[key: string]: number};
  constructor() {
    this.map = {};
  }
  inc(name: string) {
    this.map[name] = (this.map[name] || 0) +1;
  }
  clear() {
    this.map = {};
  }
  toJson(): string {
    return JSON.stringify(this.map);
  }
}
