export class MinHeap {
  constructor() {
    this.data = [];
  }
  get size() { return this.data.length; }
  isEmpty() { return this.data.length === 0; }
  push(value, priority) {
    this.data.push({ value, priority });
    this._siftUp(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._siftDown(0);
    }
    return top.value;
  }
  _siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].priority <= this.data[i].priority) break;
      const t = this.data[i]; this.data[i] = this.data[parent]; this.data[parent] = t;
      i = parent;
    }
  }
  _siftDown(i) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.data[l].priority < this.data[smallest].priority) smallest = l;
      if (r < n && this.data[r].priority < this.data[smallest].priority) smallest = r;
      if (smallest === i) break;
      const t = this.data[i]; this.data[i] = this.data[smallest]; this.data[smallest] = t;
      i = smallest;
    }
  }
}
