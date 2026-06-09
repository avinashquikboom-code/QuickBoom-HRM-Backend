import WebSocketService from '../services/websocketService';

let _instance: WebSocketService | null = null;

export function setWebSocketInstance(svc: WebSocketService): void {
  _instance = svc;
}

export function getWebSocketInstance(): WebSocketService {
  if (!_instance) {
    throw new Error('WebSocketService has not been initialized yet.');
  }
  return _instance;
}
