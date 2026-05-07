export class LifecycleBus {
  constructor() {
    this._handlers = new Map();
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(fn);
  }

  emit(event, data = {}) {
    const fns = this._handlers.get(event);
    if (fns) for (const fn of fns) fn(data);
  }
}
