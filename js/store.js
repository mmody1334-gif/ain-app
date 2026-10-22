// تخزين محلي على الجهاز (IndexedDB) مع احتياطي في الذاكرة إن مُنع التخزين.
// كل شيء يبقى في هاتفك: لا يُرفع شيء إلى أي خادم.

const DB_NAME = 'signbridge';
const DB_VER = 1;

export class Store {
  constructor() { this.db = null; this.mem = { signs: new Map(), meta: new Map() }; this.persistent = false; }

  async open() {
    if (typeof indexedDB === 'undefined') return this;
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('signs')) db.createObjectStore('signs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      });
      this.persistent = true;
    } catch (e) { this.db = null; this.persistent = false; }
    return this;
  }

  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const st = tx.objectStore(store);
      const r = fn(st);
      tx.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async allSigns() {
    if (!this.db) return [...this.mem.signs.values()];
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('signs').objectStore('signs').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async putSign(sign) {
    if (!this.db) { this.mem.signs.set(sign.id, sign); return; }
    try { await this._tx('signs', 'readwrite', (s) => s.put(sign)); } catch (e) { this.mem.signs.set(sign.id, sign); }
  }

  async deleteSign(id) {
    if (!this.db) { this.mem.signs.delete(id); return; }
    try { await this._tx('signs', 'readwrite', (s) => s.delete(id)); } catch (e) { this.mem.signs.delete(id); }
  }

  async clearSigns() {
    if (!this.db) { this.mem.signs.clear(); return; }
    try { await this._tx('signs', 'readwrite', (s) => s.clear()); } catch (e) { this.mem.signs.clear(); }
  }

  async getMeta(key, fallback = null) {
    if (!this.db) return this.mem.meta.has(key) ? this.mem.meta.get(key) : fallback;
    return new Promise((resolve) => {
      try {
        const req = this.db.transaction('meta').objectStore('meta').get(key);
        req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
        req.onerror = () => resolve(fallback);
      } catch (e) { resolve(fallback); }
    });
  }

  async setMeta(key, value) {
    if (!this.db) { this.mem.meta.set(key, value); return; }
    try { await this._tx('meta', 'readwrite', (s) => s.put(value, key)); } catch (e) { this.mem.meta.set(key, value); }
  }
}
