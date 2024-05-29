
import { YQErrorEvents, YQEvents, register } from '../../base/common/object';
import { YQTransportEvents, IYQTransport, YQClient, YQEndpointEvents } from './lib/transport';

type YQWebSocketClientEvents = YQErrorEvents & YQTransportEvents & YQEndpointEvents<IYQTransport>;

export class YQWebSocketClient extends YQClient<IYQTransport> {
	on: YQEvents<YQWebSocketClientEvents>['on'];
	off: YQEvents<YQWebSocketClientEvents>['on'];
	once: YQEvents<YQWebSocketClientEvents>['on'];
	addListener: YQEvents<YQWebSocketClientEvents>['on'];
	removeListener: YQEvents<YQWebSocketClientEvents>['on'];
	emit: YQEvents<YQWebSocketClientEvents>['emit'];

	private _client: WebSocket;

	protected async doOpen() {
		await super.doOpen();
		const url = `${this.address}${this.address[this.address.length - 1] === '/' ? 'rpc/' : '/rpc/'}`;
		this._client = new WebSocket(url);
		return new Promise<void>((resolve, reject) => {
			this._client.onerror = reject;
			this._client.onopen = () => {
				this._client.onerror = (ev: Event) => this.emit('error', new Error(`WebSocket error, ${JSON.stringify(ev)}`), this._client);
				this._client.onmessage = (message) => {
					const data = JSON.parse(message.data as string);
					this.emit('recv', data);
				};
				this._client.onclose = (event) => {
					this.emit('disconnect', event.reason);
					this._client = null;
				};
				this.newTransport(this).then(resolve, reject);
			};
		});
	}

	async disconnect(reason?: string) {
		if (!this._client) {
			return;
		}
		return new Promise<void>((resolve, reject) => {
			this._client.onclose = (event) => {
				this.emit('disconnect', event.reason);
				this._client = null;
				resolve();
			};
			this._client.onerror = reject;
			this._client.close(1000, reason);
		});
	}

	async send(data: object) {
		this._client.send(JSON.stringify(data));
	}
}
