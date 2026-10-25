// ربط الأجهزة بكود الغرفة — BroadcastChannel (نفس الجهاز) + WebSocket (أجهزة مختلفة عبر الإنترنت)
export const ROOM_EVENTS = { SIGN: 'sign', SOS: 'sos', MSG: 'msg', JOIN: 'join', LEAVE: 'leave', PONG: 'pong' };

class RoomClient extends EventTarget {
  constructor() {
    super();
    this.roomCode = null;
    this.deviceId = (() => {
      try {
        let id = localStorage.getItem('ain_device_id');
        if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('ain_device_id', id); }
        return id;
      } catch (_) { return Math.random().toString(36).slice(2, 10); }
    })();
    this.ws = null; this.bc = null; this.peers = new Set();
    this.reconnectTimer = null; this.reconnectDelay = 2000; this.active = false;
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN; }
  get peerCount() { return this.peers.size; }

  async join(code) {
    if (this.roomCode) await this.leave();
    this.roomCode = String(code).slice(0, 6).toUpperCase();
    this.active = true;
    this._connectBC();
    this._connectWS();
    return this.roomCode;
  }

  async leave() {
    if (this.roomCode) this._send({ type: ROOM_EVENTS.LEAVE, from: this.deviceId, room: this.roomCode });
    this.active = false; this.roomCode = null; this.peers.clear();
    clearTimeout(this.reconnectTimer);
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    if (this.bc) { try { this.bc.close(); } catch (_) {} this.bc = null; }
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, peers: 0 } }));
  }

  _connectBC() {
    if (!('BroadcastChannel' in window)) return;
    try {
      this.bc = new BroadcastChannel('ain-room-' + this.roomCode);
      this.bc.onmessage = (e) => { const m = e.data; if (m && m.from !== this.deviceId) this._handleMsg(m); };
    } catch (_) {}
  }

  _connectWS() {
    if (!this.roomCode || !this.active) return;
    try {
      // خادم WebSocket مجاني عام — نضع الغرفة في كل رسالة لتصفيتها
      this.ws = new WebSocket('wss://echo.websocket.events/.ws');
      this.ws.onopen = () => {
        this.reconnectDelay = 2000;
        this._wsSend({ type: ROOM_EVENTS.JOIN, from: this.deviceId, room: this.roomCode });
        this.dispatchEvent(new CustomEvent('status', { detail: { connected: true, peers: this.peers.size, code: this.roomCode } }));
      };
      this.ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m && m.room === this.roomCode && m.from !== this.deviceId) this._handleMsg(m);
        } catch (_) {}
      };
      this.ws.onclose = () => {
        this.ws = null;
        this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, peers: this.peers.size, code: this.roomCode } }));
        if (this.active) {
          this.reconnectDelay = Math.min(30000, this.reconnectDelay * 1.5);
          this.reconnectTimer = setTimeout(() => this._connectWS(), this.reconnectDelay);
        }
      };
      this.ws.onerror = () => { try { this.ws?.close(); } catch (_) {} };
    } catch (_) {}
  }

  _wsSend(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ ...msg, room: this.roomCode })); } catch (_) {}
    }
  }
  _bcSend(msg) { try { this.bc?.postMessage(msg); } catch (_) {} }
  _send(msg) { this._wsSend(msg); this._bcSend(msg); }

  _handleMsg(msg) {
    if (msg.type === ROOM_EVENTS.JOIN) {
      this.peers.add(msg.from);
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true, peers: this.peers.size, code: this.roomCode } }));
      this.dispatchEvent(new CustomEvent('peer_join', { detail: msg }));
      this._send({ type: ROOM_EVENTS.PONG, from: this.deviceId, room: this.roomCode });
    } else if (msg.type === ROOM_EVENTS.LEAVE) {
      this.peers.delete(msg.from);
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: this.connected, peers: this.peers.size, code: this.roomCode } }));
    } else if (msg.type === ROOM_EVENTS.PONG) {
      this.peers.add(msg.from);
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true, peers: this.peers.size, code: this.roomCode } }));
    } else {
      this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    }
  }

  /** إرسال لكل الأجهزة في الغرفة */
  send(type, data = {}) { this._send({ type, from: this.deviceId, data, at: Date.now(), room: this.roomCode }); }
  sendSign(word, id) { this.send(ROOM_EVENTS.SIGN, { word, id }); }
  sendSOS(message) { this.send(ROOM_EVENTS.SOS, { message }); }
  sendMsg(text) { this.send(ROOM_EVENTS.MSG, { text }); }
}

export const room = new RoomClient();
export default room;
