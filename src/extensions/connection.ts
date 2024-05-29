import { logger } from '../yq/base/common/logger';
import { YQObject, register } from '../yq/base/common/object';
import { YQEndpointCloseCode } from '../yq/rpc/common/transport';
import { YQWebSocketClient } from '../yq/rpc/common/webSocketTransport';

declare const _$RPC_URL_: string;

@register('Connection')
export class Connection extends YQObject {
	private _client: YQWebSocketClient;
	private _address: string;
	private _onClose: () => Promise<void>;
	private _onError: () => Promise<void>;
	private _reconnecting: boolean;

	constructor() {
		super();
		this._address = _$RPC_URL_;
		this._client = new YQWebSocketClient('Background', this._address);
		this._onError = this.onError.bind(this);
		this._onClose = this.onClose.bind(this);
	}

	async open() {
		try {
			this._client.on('close', this._onClose);
			this._client.on('error', this._onError);
			await this._client.open(Infinity, 1000);
		} catch (error) {
			logger.error('connection open error');
			logger.error(error);
			this._client.off('close', this._onClose);
			this._client.off('error', this._onError);
		}
	}

	async close() {
		try {
			await this._client.close();
		} catch (error) {
			logger.error('connection close error');
			logger.error(error);
		} finally {
			this._client.off('close', this._onClose);
			this._client.off('error', this._onError);
		}
	}

	private async reconnect() {
		if (this._reconnecting) return;
		this._reconnecting = true;
		try {
      this.close();
      this.open();
		} catch (error) {
			logger.error('reconnect error');
			logger.error(error);
		} finally {
			this._reconnecting = false;
		}
	}

	onClose(code: YQEndpointCloseCode) {
		this.logger.info(`connection closed with code: ${code}`);
		if (code !== YQEndpointCloseCode.Normal) {
			this.reconnect();
		}
	}

	onError(error: Error) {
		this.logger.error(`connection error`);
		this.logger.error(error);
	}
}
