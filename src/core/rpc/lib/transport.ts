
import { YQErrorEvents, YQEvents, YQObject, register } from '../../../base/common/object';
import { generateId, wait } from '../../../base/common/utils';
import { AS_CLASS, YQProtocol } from './protocol';

export const enum YQSessionAction {
	unknown = 0,
	authorization = 1, // 验证
	transfer = 2, // 数据传输
	keepalive = 3, // 心跳
	wave = 4, // 挥手关闭
	statusSync = 5 // 状态同步
}

const enum YQSessionMessageType {
	unknown = 0,
	request = 1,
	response = 2
}

interface IYQAuthorizationData {
	type: YQSessionMessageType; //用来标识是请求还是响应
	name: string;
	signature: string;
	error?: string;
	sessionId?: string;
	keepaliveTimeout?: number;
	keepaliveInterval?: number;
	reconnectTimeout?: number;
	reconnectInterval?: number;
}

interface IYQKeepaliveData {
	type: YQSessionMessageType; //用来标识是请求还是响应
}

interface IYQStatusSyncData {
	type: YQSessionMessageType; //用来标识是请求还是响应
}

export interface IYQSessionMessage {
	action: YQSessionAction; //用来标识动作类型
	id?: string;
	resolvedRequests?: string[];
	data?: IYQAuthorizationData | IYQKeepaliveData | IYQStatusSyncData | object;
}

export type YQTransportEvents = {
	recv(data: object): void;
	disconnect(reason?: string): void;
};

export interface IYQTransport {
	disconnect(reason?: string): Promise<void>;
	send(data: object): Promise<void>;
	on: YQEvents<YQTransportEvents>['on'];
	off: YQEvents<YQTransportEvents>['on'];
	once: YQEvents<YQTransportEvents>['on'];
	addListener: YQEvents<YQTransportEvents>['on'];
	removeListener: YQEvents<YQTransportEvents>['on'];
	emit: YQEvents<YQTransportEvents>['emit'];
}

export enum YQConnectionState {
	Disconnected = 'Disconnected',
	Connecting = 'Connecting',
	Connected = 'Connected',
	Disconnecting = 'Disconnecting',
	Reconnecting = 'Reconnecting'
}

type YQDeferred<T = any> = {
	resolve: (result?: T) => void;
	reject: (error: Error) => void;
};

type YQSessionEvents = YQErrorEvents &
	YQTransportEvents & {
		wave(): void;
	};

type YQSessionOptions<T extends IYQTransport> = {
	id: string;
	localName: string;
	remoteName: string;
	transport: T;
	keepaliveTimeout?: number;
	keepaliveInterval?: number;
};

@register('YQSession')
export class YQSession<T extends IYQTransport> extends YQObject implements IYQTransport {
	on: YQEvents<YQSessionEvents>['on'];
	off: YQEvents<YQSessionEvents>['on'];
	once: YQEvents<YQSessionEvents>['on'];
	addListener: YQEvents<YQSessionEvents>['on'];
	removeListener: YQEvents<YQSessionEvents>['on'];
	emit: YQEvents<YQSessionEvents>['emit'];

	private _id: string;
	private _localName: string;
	private _remoteName: string;
	private _transport: T;
	private _protocol: YQProtocol;
	private _resolvedRequests: string[] = [];
	private _sendRequests: { [id: string]: IYQSessionMessage } = {};
	private _onRecv: (data: object) => void;
	private _onDisconnect: (reason?: string) => void;
	private _disconnectTime: number;
	private _keepaliveTimer: ReturnType<typeof setTimeout>;
	private _keepaliveTimeout = 30000;
	private _keepaliveInterval = 5000;
	private _keepaliveQueue: string[] = [];

	static create<T extends IYQTransport>(endpoint: YQEndpoint<T>, options: YQSessionOptions<T>) {
		const { remoteName } = options;
		const session = new YQSession(options);
		const protocol = new YQProtocol(remoteName, session);
		protocol.roots = endpoint.roots;
		session.protocol = protocol;
		return session;
	}

	constructor(options: YQSessionOptions<T>) {
		super();
		const { id, transport, localName, remoteName } = options;
		this._id = id;
		this._transport = transport;
		this._localName = localName;
		this._remoteName = remoteName;
		typeof options.keepaliveTimeout === 'number' && (this._keepaliveTimeout = options.keepaliveTimeout);
		typeof options.keepaliveInterval === 'number' && (this._keepaliveInterval = options.keepaliveInterval);
		this._onRecv = this.onRecv.bind(this);
		this._onDisconnect = this.onDisconnect.bind(this);
		this._transport.on('recv', this._onRecv);
		this._transport.on('disconnect', this._onDisconnect);
	}

	get localName() {
		return this._localName;
	}

	get remoteName() {
		return this._remoteName;
	}

	get id() {
		return this._id;
	}

	get transport() {
		return this._transport;
	}

	get protocol() {
		return this._protocol;
	}

	set protocol(value) {
		this._protocol = value;
	}

	get disconnectTime() {
		return this._disconnectTime;
	}

	get keepaliveInterval() {
		return this._keepaliveInterval;
	}

	set keepaliveInterval(value) {
		this._keepaliveInterval = value;
	}

	get keepaliveTimeout() {
		return this._keepaliveTimeout;
	}

	set keepaliveTimeout(value) {
		this._keepaliveTimeout = value;
	}

	get resolvedRequests() {
		return this._resolvedRequests;
	}

	get sendRequests() {
		return this._sendRequests;
	}

	private onRecv(data: object) {
		try {
			this.logger.debug(`recv data from [${this.remoteName}]`);
			this.logger.debug(data);
			const message = data as IYQSessionMessage;

			if (message.action === YQSessionAction.wave) {
				// 对方准备主动关闭，session通知外部及时移除
				this.emit('wave');
			} else if (message.action === YQSessionAction.keepalive) {
				this.processKeepalive(message);
			} else if (message.action === YQSessionAction.transfer) {
				this.processTransfer(message);
			} else if (message.action === YQSessionAction.statusSync) {
				this.processStatusSync(message);
			}
		} catch (error) {
			this.emit('error', error);
		}
	}

	private processKeepalive(message: IYQSessionMessage) {
		const data = message.data as IYQKeepaliveData;
		if (data.type === YQSessionMessageType.request) {
			this.sendWithoutError({
				action: YQSessionAction.keepalive,
				id: message.id,
				data: {
					type: YQSessionMessageType.response
				}
			});
		} else if (data.type === YQSessionMessageType.response) {
			this._keepaliveQueue.splice(0, this._keepaliveQueue.length);
		}
	}

	private processTransfer(message: IYQSessionMessage) {
		const { id, resolvedRequests } = message;
		if (resolvedRequests && resolvedRequests.length > 0) {
			this.logger.debug(`delete resolvedRequests: ${JSON.stringify(resolvedRequests)}`);
			for (const id of resolvedRequests) {
				delete this._sendRequests[id];
			}
		}

		if (id in this._sendRequests) {
			this.logger.warn(`retry request, id: ${id}`);
			this.sendWithoutError(this._sendRequests[id]);
			return;
		}

		const cacheResolvedRequests = Object.values(this._sendRequests).reduce((previousValue, currentValue) => {
			return [...currentValue.resolvedRequests, ...previousValue];
		}, []);
		if (new Set([...this._resolvedRequests, ...cacheResolvedRequests]).has(id)) {
			return;
		}

		this._resolvedRequests.push(id);

		this.emit('recv', message.data);
	}

	private async processStatusSync(message: IYQSessionMessage) {
		const data = message.data as IYQStatusSyncData;
		await this.sendIdempotentData();
		if (data.type === YQSessionMessageType.request) {
			await this.statusSync(YQSessionMessageType.response);
		}
	}

	private onDisconnect(reason?: string) {
		this.logger.info(`[${this.remoteName}] was disconnected, reason: ${reason}`);
		this._disconnectTime = Date.now();
		this.stopKeepaliveTimer();
		this.emit('disconnect', reason);
	}

	async disconnect(reason?: string) {
		this.logger.info(`disconnect [${this.remoteName}], reason: ${reason}`);
		const transport = this._transport;
		this.destroy();
		await transport?.disconnect(reason);
	}

	async send(data: object) {
		const id = generateId();
		const message: IYQSessionMessage = {
			action: YQSessionAction.transfer,
			id: id,
			resolvedRequests: [...this._resolvedRequests],
			data
		};
		this._resolvedRequests = [];
		this._sendRequests[id] = message;
		this.logger.debug(`send to [${this.remoteName}]`);
		this.logger.debug(message);
		return this.sendWithoutError(message);
	}

	private destroy() {
		this.stopKeepaliveTimer();
		this._protocol?.destroy();
		this.resetTransport();
		this._resolvedRequests = [];
		this._sendRequests = {};
	}

	resetTransport(transport?: T) {
		if (this._transport) {
			this._transport.off('recv', this._onRecv);
			this._transport.off('disconnect', this._onDisconnect);
		}
		this._transport = transport;
		if (this._transport) {
			this._disconnectTime = null;
			this._transport.on('recv', this._onRecv);
			this._transport.on('disconnect', this._onDisconnect);
		}
	}

	private async sendIdempotentData() {
		for (const id in this._sendRequests) {
			this.logger.info(`resend ${id}: ${JSON.stringify(this._sendRequests[id])}`);
			await this.sendWithoutError(this._sendRequests[id]);
		}
	}

	async wave() {
		await this.sendWithoutError({
			action: YQSessionAction.wave
		});
	}

	/**
	 * 通道内部发送，在会话中捕捉发送错误，并主动断开通道使其能够快速重连并重新发送数据
	 */
	private async sendWithoutError(message: IYQSessionMessage) {
		return this._transport?.send(message).catch((error) => {
			// 忽略发送错误
		});
	}

	private async sendKeepaliveData() {
		const message: IYQSessionMessage = {
			action: YQSessionAction.keepalive,
			id: generateId(),
			data: {
				type: YQSessionMessageType.request
			}
		};
		this._keepaliveQueue.push(message.id);
		await this.sendWithoutError(message);
		if (this._keepaliveTimeout <= 0) {
			return;
		}
		if (this._keepaliveQueue.length >= this._keepaliveTimeout / this._keepaliveInterval) {
			this._keepaliveTimer && clearInterval(this._keepaliveTimer);
			await this._transport?.disconnect(`keepalive timeout`);
		}
	}

	async statusSync(type = YQSessionMessageType.request) {
		await this.sendWithoutError({
			action: YQSessionAction.statusSync,
			data: {
				type: type
			}
		});
	}

	startKeepaliveTimer() {
		if (this._keepaliveInterval <= 0) {
			return;
		}
		this.stopKeepaliveTimer();
		this._keepaliveTimer = setInterval(() => {
			this.sendKeepaliveData();
		}, this._keepaliveInterval);
	}

	stopKeepaliveTimer() {
		this._keepaliveTimer && clearInterval(this._keepaliveTimer);
		this._keepaliveTimer = null;
		this._keepaliveQueue = [];
	}
}

export enum YQEndpointCloseCode {
	Normal = 0,
	Disconnected = 1,
	Timeout = 2,
	Unauthorized = 3
}

export type YQEndpointEvents<T extends IYQTransport> = {
	close(code: YQEndpointCloseCode): void;
	error(error: Error, target: any): void;
	['session-connect'](session: YQSession<T>): void;
	['session-disconnect'](session: T, reason?: string): void;
};

export type YQEndpointOptions = {
	authTimeout?: number; //  认证超时，默认30000ms，内部约定，一般情况无需传递
	reconnectTimeout?: number; // 重连超时, 默认为INFINITE，无限重连，-1表示禁用重连
	reconnectInterval?: number; // 重连间隔，默认3000ms
	keepaliveTimeout?: number; // 心跳超时,默认30000ms
	keepaliveInterval?: number; // 心跳间隔，默认3000ms
};

export const MAX_RECONNECT_TIMEOUT = 1 * 60 * 60 * 1000; // 最大重连超时1小时

@register('YQEndpoint')
export abstract class YQEndpoint<T extends IYQTransport> extends YQObject {
	on: YQEvents<YQEndpointEvents<T>>['on'];
	off: YQEvents<YQEndpointEvents<T>>['on'];
	once: YQEvents<YQEndpointEvents<T>>['on'];
	addListener: YQEvents<YQEndpointEvents<T>>['on'];
	removeListener: YQEvents<YQEndpointEvents<T>>['on'];
	emit: YQEvents<YQEndpointEvents<T>>['emit'];

	private _name: string;
	private _address: string;
	private _roots: { [name: string]: any } = {};
	private _connectionStarted = false;
	protected _openInternalDeferred: Promise<void>;
	protected _state: YQConnectionState = YQConnectionState.Disconnected;
	protected _authTimeout: number;
	protected _reconnectTimeout: number;
	protected _reconnectInterval: number;
	protected _keepaliveTimeout: number;
	protected _keepaliveInterval: number;

	constructor(name: string, address: string, options?: YQEndpointOptions) {
		super();
		this._name = name;
		this._address = address;
		options = options || {};
		typeof options.authTimeout === 'number' && (this._authTimeout = options.authTimeout);
		typeof options.reconnectTimeout === 'number' && (this._reconnectTimeout = Math.min(options.reconnectTimeout, MAX_RECONNECT_TIMEOUT));
		typeof options.reconnectInterval === 'number' && (this._reconnectInterval = options.reconnectInterval);
		typeof options.keepaliveTimeout === 'number' && (this._keepaliveTimeout = options.keepaliveTimeout);
		typeof options.keepaliveInterval === 'number' && (this._keepaliveInterval = options.keepaliveInterval);
	}

	get name() {
		return this._name;
	}

	get address() {
		return this._address;
	}

	get roots() {
		return this._roots;
	}

	get state() {
		return this._state;
	}

	get authTimeout() {
		return this._authTimeout;
	}

	get reconnectTimeout() {
		return this._reconnectTimeout;
	}

	get reconnectInterval() {
		return this._reconnectInterval;
	}

	get keepaliveTimeout() {
		return this._keepaliveTimeout;
	}

	get keepaliveInterval() {
		return this._keepaliveInterval;
	}

	protected async doOpen(): Promise<void> {}
	protected async doClose(): Promise<void> {}

	publish(name: string, target: any, asClass = false) {
		if (name in this._roots) {
			throw new Error(`object ${name} has been published`);
		}
		this._roots[name] = target;
		if (asClass && typeof target === 'function') {
			target[AS_CLASS] = true;
		}
	}

	async open(retryCount = 10, retryInterval = 1000) {
		if (this._state !== YQConnectionState.Disconnected) {
			throw new Error(`Cannot start a endpoint that is not in the 'Disconnected' state`);
		}
		if (retryCount <= 0) {
			throw new Error(`The number of retryCount is greater than 0`);
		}
		this.logger.info(`open rpc endpoint ${this._name}`);
		this._state = YQConnectionState.Connecting;
		this._openInternalDeferred = this.openInternal(retryCount, retryInterval);
		await this._openInternalDeferred;
		this._connectionStarted = true;
	}

	protected async openInternal(retryCount: number, retryInterval: number) {
		while (retryCount > 0) {
			try {
				await this.doOpen();
				if (this._state !== YQConnectionState.Connecting && this._state !== YQConnectionState.Reconnecting) {
					throw new Error(`openInternal fail that is not in the 'Connecting' or 'Reconnecting' state`);
				}
				this._state = YQConnectionState.Connected;
				break;
			} catch (error) {
				this.logger.error(`openInternal error`);
				this.logger.error(error);
				// 状态被外部更改则退出循环
				if (this._state !== YQConnectionState.Connecting && this._state !== YQConnectionState.Reconnecting) {
					this.logger.error(`openInternal fail, state was changed ${this._state}`);
					throw error;
				}
				if (--retryCount <= 0) {
					this._state = YQConnectionState.Disconnected;
					// 重连超时则发送error事件
					this.emit('error', error);
					throw error;
				}
				this.logger.error(`openInternal remain count ${retryCount - 1}`);
				await wait(retryInterval);
			}
		}
	}

	async close(code: YQEndpointCloseCode = YQEndpointCloseCode.Normal) {
		if (this._state === YQConnectionState.Disconnected) {
			return;
		}
		this.logger.info(`close rpc endpoint ${this._name}`);
		this._state = YQConnectionState.Disconnecting;
		await this.closeInternal(code);
		this._state = YQConnectionState.Disconnected;
	}

	protected async closeInternal(code: YQEndpointCloseCode) {
		try {
			if (this._openInternalDeferred) {
				await this._openInternalDeferred;
				this._openInternalDeferred = null;
			}
		} catch (error) {
			// 等待_openInternalDeferred返回，并捕获错误
		}
		await this.doClose();
		this._connectionStarted && this.emit('close', code);
		this._connectionStarted = false;
	}
}

type YQAuthorizationEvents = YQErrorEvents & YQTransportEvents;

type YQAuthorizationResult<T extends IYQTransport> = {
	session: YQSession<T>;
	reconnectTimeout?: number;
	reconnectInterval?: number;
};

@register('YQAuthorization')
export class YQAuthorization<T extends IYQTransport> extends YQObject {
	on: YQEvents<YQAuthorizationEvents>['on'];
	off: YQEvents<YQAuthorizationEvents>['on'];
	once: YQEvents<YQAuthorizationEvents>['on'];
	addListener: YQEvents<YQAuthorizationEvents>['on'];
	removeListener: YQEvents<YQAuthorizationEvents>['on'];
	emit: YQEvents<YQAuthorizationEvents>['emit'];

	private _endpoint: YQEndpoint<T>;
	private _transport: T;
	private _passed = false;
	private _authorizationDenied = false;
	private _deferred: YQDeferred<YQAuthorizationResult<T>>;
	private _session: YQSession<T>;
	private _sessions: { [name: string]: YQSession<T> } = {};
	private _timeout = 30000;
	private _onRecv: (data: object) => void;
	private _onDisconnect: (reason?: string) => void;

	constructor(endpoint: YQEndpoint<T>, transport: T) {
		super();
		this._endpoint = endpoint;
		endpoint.authTimeout && (this._timeout = endpoint.authTimeout);
		this._onRecv = this.onRecv.bind(this);
		this._onDisconnect = this.onDisconnect.bind(this);
		this.resetTransport(transport);
	}

	get localName() {
		return this._endpoint?.name;
	}

	get authorizationDenied() {
		return this._authorizationDenied;
	}

	get timeout() {
		return this._timeout;
	}

	set timeout(value) {
		this._timeout = value;
	}

	async authorization(session?: YQSession<T>) {
		this._session = session;
		this.logger.info(`[${this.localName}] request authorization`);
		if (this._deferred) {
			throw new Error('the last authorization has not been completed');
		}
		const data: IYQAuthorizationData = {
			type: YQSessionMessageType.request,
			name: this.localName,
			signature: this.makeSignature(this.localName)
		};
		// 重连传递sessionId
		this._session && (data.sessionId = this._session.id);
		const message: IYQSessionMessage = {
			action: YQSessionAction.authorization,
			data
		};
		return new Promise<YQAuthorizationResult<T>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.resetTransport();
				reject(new Error('rpc authorization timeout'));
			}, this._timeout);
			this._deferred = {
				resolve: (result) => {
					clearTimeout(timer);
					resolve(result);
				},
				reject
			};
			this._transport.send(message);
		});
	}

	async waitAuthorization(sessions: { [name: string]: YQSession<T> }) {
		if (this._deferred) {
			throw new Error('the last waitAuthorization has not been completed');
		}
		this._sessions = sessions;
		return new Promise<YQAuthorizationResult<T>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.resetTransport();
				reject(new Error('rpc waitAuthorization timeout'));
			}, this._timeout);
			this._deferred = {
				resolve: (result) => {
					clearTimeout(timer);
					resolve(result);
				},
				reject
			};
		});
	}

	private makeSignature(name: string) {
		const key = 10;
		let encrypted = '';
		for (let i = 0; i < name.length; i++) {
			encrypted += String.fromCharCode(name.charCodeAt(i) ^ key);
		}
		return encrypted.split('').reverse().join(''); // 反转
	}

	private checkSignature(name: string, signature: string) {
		return this.makeSignature(name) === signature;
	}

	private destroy() {
		this.resetTransport();
		if (this._deferred) {
			this._deferred.reject(new Error('authorization destroyed'));
		}
		this._deferred = null;
	}

	private onDisconnect(reason?: string) {
		this.logger.info(`transport was disconnected, reason: ${reason}`);
		this.emit('disconnect', reason);
		this.destroy();
	}

	private onRecv(data: object) {
		try {
			const message = data as IYQSessionMessage;
			if (message.action === YQSessionAction.authorization) {
				this.logger.debug(`recv authorization action data`);
				this.logger.debug(data);
				this.onAuthorization(message);
			}
		} catch (error) {
			this.emit('error', error);
		}
	}

	private onAuthorization(message: IYQSessionMessage) {
		const data = message.data as IYQAuthorizationData;
		if (data.type !== YQSessionMessageType.request && data.type !== YQSessionMessageType.response) {
			throw new Error(`unknown session message type ${data.type}`);
		}
		if (!this._deferred) {
			throw new Error(`deferred is not exists`);
		}
		this._passed = this.checkSignature(data.name, data.signature);
		try {
			if (data.type === YQSessionMessageType.request) {
				// 如果是请求，则检查请求签名，并触发deferred，让waitAuthorization异步方法返回
				const name = data.name;
				this.logger.info(`authorization [${name}]`);
				data.type = YQSessionMessageType.response;
				data.name = this.localName;
				data.signature = this.makeSignature(this.localName);
				let session: YQSession<T> = null;
				// 携带session则复用session
				data.sessionId && (session = this._sessions[name]);
				const expired = data.sessionId && session?.id !== data.sessionId;
				if (this._passed && !expired) {
					data.error = null;
					data.sessionId = session?.id || generateId();
					// 服务端调用者设置参数则同步给客户端
					this._endpoint.keepaliveInterval && (data.keepaliveInterval = this._endpoint.keepaliveInterval);
					this._endpoint.keepaliveTimeout && (data.keepaliveTimeout = this._endpoint.keepaliveTimeout);
					this._endpoint.reconnectInterval && (data.reconnectInterval = this._endpoint.reconnectInterval);
					this._endpoint.reconnectTimeout && (data.reconnectTimeout = this._endpoint.reconnectTimeout);
					session && session.resetTransport(this._transport);
					this._deferred.resolve(
						session
							? { session }
							: {
									session: YQSession.create(this._endpoint, {
										localName: this._endpoint.name,
										id: data.sessionId,
										remoteName: name,
										transport: this._transport,
										keepaliveTimeout: this._endpoint.keepaliveTimeout,
										keepaliveInterval: this._endpoint.keepaliveInterval
									})
							  }
					);
					this._transport.send(message);
					this.logger.info(`authorization [${name}] success`);
				} else {
					data.error = expired ? `session ${data.sessionId} expired` : 'signature is not correct';
					this._transport.send(message);
					const error = new Error(data.error);
					this._deferred.reject(error);
					throw error;
				}
			} else if (data.type === YQSessionMessageType.response) {
				// 如果是响应，则检查响应结果，并触发deferred，让authorization异步方法返回
				if (data.error) {
					this._authorizationDenied = true;
					const error = new Error(data.error);
					this._deferred.reject(error);
					throw error;
				}
				if (this._passed) {
					this._session && this._session.resetTransport(this._transport);
					this._deferred.resolve(
						this._session
							? { session: this._session }
							: {
									// 参数优先级：客户端调用者传递参数 > 服务端调用者传递参数 > 双方协定的默认值
									session: YQSession.create(this._endpoint, {
										id: data.sessionId,
										localName: this.localName,
										remoteName: data.name,
										transport: this._transport,
										keepaliveTimeout: this._endpoint.keepaliveTimeout || data.keepaliveTimeout,
										keepaliveInterval: this._endpoint.keepaliveInterval || data.keepaliveInterval
									}),
									reconnectTimeout: data.reconnectTimeout,
									reconnectInterval: data.reconnectInterval
							  }
					);
				} else {
					const error = new Error('signature is not correct');
					this._deferred.reject(error);
					throw error;
				}
			}
		} finally {
			this._deferred = null;
			this.resetTransport();
		}
	}

	private resetTransport(transport?: T) {
		if (this._transport) {
			this._transport.off('recv', this._onRecv);
			this._transport.off('disconnect', this._onDisconnect);
		}
		this._transport = transport;
		if (this._transport) {
			this._transport.on('recv', this._onRecv);
			this._transport.on('disconnect', this._onDisconnect);
		}
	}
}

@register('YQServer')
export abstract class YQServer<T extends IYQTransport> extends YQEndpoint<T> {
	private _sessions: { [name: string]: YQSession<T> } = {};
	/**
	 * 同一个name的新session连接是否踢出旧的session连接
	 */
	private _kickOut = true;
	private _checkSessionTimer: ReturnType<typeof setInterval>;
	private _unreadyTransports: T[] = [];

	get sessions() {
		return this._sessions;
	}

	get kickOut() {
		return this._kickOut;
	}

	set kickOut(value: boolean) {
		this._kickOut = value;
	}

	get checkSessionInterval() {
		return (this._reconnectTimeout || MAX_RECONNECT_TIMEOUT) * 2;
	}

	get protocols() {
		return Object.entries(this._sessions).reduce<Record<string, YQProtocol>>((protocols, [name, session]) => {
			protocols[name] = session.protocol;
			return protocols;
		}, {});
	}

	private async waitAuthorization(transport: T): Promise<YQSession<T>> {
		try {
			const authorizer = new YQAuthorization(this, transport);
			authorizer.on('error', (error) => {
				this.emit('error', error);
			});
			const { session } = await authorizer.waitAuthorization(this.sessions);
			return session;
		} catch (error) {
			this.logger.error(`waitAuthorization timeout`);
			this.logger.error(error);
			await transport.disconnect(`waitAuthorization timeout`);
			throw error;
		}
	}

	protected async newTransport(transport: T) {
		try {
			this._unreadyTransports.push(transport);
			transport.once('disconnect', () => {
				const index = this._unreadyTransports.indexOf(transport);
				if (index !== -1) {
					this._unreadyTransports.splice(index, 1);
				}
			});
			const session = await this.waitAuthorization(transport);
			const protocol = session.protocol;
			const name = protocol.name;
			if (this._sessions[name] && session.id !== this._sessions[name].id) {
				if (this._kickOut) {
					const existedSession = this._sessions[name];
					await existedSession.disconnect(`session ${name} kicked out`);
					delete this._sessions[name];
				} else {
					const msg = `session ${name} was exists`;
					await transport.disconnect(msg);
					throw new Error(msg);
				}
			}
			if (!this.sessions[name]) {
				this._sessions[name] = session;
				session.on('disconnect', (reason) => {
					this.emit('session-disconnect', session, reason);
				});
				session.on('error', (error) => {
					this.emit('error', error, session);
				});
				protocol.on('error', (error) => {
					this.emit('error', error, protocol);
				});
				session.on('wave', async () => {
					await session.disconnect();
					delete this.sessions[name];
					this.emit('session-disconnect', session, 'receive wave and disconnect');
				});
			}

			this._unreadyTransports.splice(this._unreadyTransports.indexOf(transport), 1);
			this.emit('session-connect', session);
		} catch (error) {
			this.emit('error', error);
		}
	}

	protected async doOpen(): Promise<void> {
		await super.doOpen();
		this._checkSessionTimer && clearInterval(this._checkSessionTimer);
		this._checkSessionTimer = setInterval(async () => {
			for (const name in this._sessions) {
				const session = this._sessions[name];
				if (session.disconnectTime && Date.now() - session.disconnectTime > this.checkSessionInterval) {
					await session.disconnect();
					delete this._sessions[name];
				}
			}
		}, this.checkSessionInterval);
	}

	protected async doClose() {
		await super.doClose();
		await Promise.all(
			Object.values(this._sessions).map(async (session) => {
				this.logger.info(`disconnect session [${session?.remoteName}]`);
				return session.disconnect(`server [${this.name}] was closed`);
			})
		);
		this._checkSessionTimer && clearInterval(this._checkSessionTimer);
		this._checkSessionTimer = null;
		this._sessions = {};
	}

	protected async closeInternal(code: YQEndpointCloseCode): Promise<void> {
		try {
			for (const transport of this._unreadyTransports) {
				this.logger.info('server server unready transport');
				await transport.disconnect('close server unready transport');
			}
			this._unreadyTransports = [];
		} finally {
			await super.closeInternal(code);
		}
	}
}

@register('YQClient')
export abstract class YQClient<T extends IYQTransport> extends YQEndpoint<T> {
	private _session: YQSession<T>;
	private _unreadyTransport: T;
	private _reconnectTimer: ReturnType<typeof setTimeout>;

	get session() {
		return this._session;
	}

	get protocol() {
		return this._session?.protocol;
	}

	private async authorization(transport: T): Promise<YQSession<T>> {
		const authorizer = new YQAuthorization(this, transport);
		try {
			authorizer.on('error', (error) => {
				this.emit('error', error, authorizer);
			});
			const { session, reconnectTimeout, reconnectInterval } = await authorizer.authorization(this._session);
			// 优先级：调用者 > 服务器配置
			if (reconnectTimeout && !this._reconnectTimeout) {
				this._reconnectTimeout = reconnectTimeout;
			}
			if (reconnectInterval && !this._reconnectInterval) {
				this._reconnectInterval = reconnectInterval;
			}
			return session;
		} catch (error) {
			this.logger.error(`authorization failed`);
			this.logger.error(error);
			await transport.disconnect(`authorization failed`);
			if (authorizer.authorizationDenied) {
				this.close(YQEndpointCloseCode.Unauthorized);
			}
			throw error;
		}
	}

	protected async newTransport(transport: T) {
		this._unreadyTransport = transport;
		const session = await this.authorization(transport);
		if (!this._session) {
			this._session = session;
			session.on('error', (error) => {
				this.emit('error', error, session);
			});
			// session监听通道断开时,根据重连参数决定是否重连
			session.on('disconnect', async (reason) => {
				this.emit('session-disconnect', session, reason);
				if (this._state !== YQConnectionState.Connected) {
					return;
				}
				const reconnectTimeout = this._reconnectTimeout || MAX_RECONNECT_TIMEOUT;
				const reconnectInterval = this._reconnectInterval || 3000;
				const reconnectCount = reconnectTimeout / reconnectInterval;
				if (reconnectCount > 0) {
					this.reconnect(reconnectCount, reconnectInterval);
				} else {
					await this.close(YQEndpointCloseCode.Disconnected);
				}
			});
			session.protocol.on('error', (error) => {
				this.emit('error', error, session.protocol);
			});
		}

		await this._session.statusSync();
		this._session.startKeepaliveTimer();
		this._unreadyTransport = null;
		this.emit('session-connect', session);
	}

	protected async doClose() {
		try {
			this.logger.info(`disconnect session [${this._session?.remoteName}]`);
			await this._session?.wave();
			await this._session?.disconnect();
			this._session = null;
		} finally {
			await super.doClose();
		}
	}

	protected async closeInternal(code: YQEndpointCloseCode): Promise<void> {
		try {
			this._reconnectTimer && clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
			if (this._unreadyTransport) {
				this.logger.info('close client unready transport');
				await this._unreadyTransport.disconnect('close client unready transport');
				this._unreadyTransport = null;
			}
		} finally {
			await super.closeInternal(code);
		}
	}

	protected reconnect(count: number, interval: number) {
		this._state = YQConnectionState.Reconnecting;
		this._reconnectTimer = setTimeout(async () => {
			try {
				if (this._state !== YQConnectionState.Reconnecting) {
					return;
				}
				this._openInternalDeferred = this.openInternal(count, interval);
				await this._openInternalDeferred;
			} catch (error) {
				if (this._state !== YQConnectionState.Reconnecting) {
					return;
				}
				this.logger.warn(`reconnect error`);
				this.logger.warn(error);
				await this.close(YQEndpointCloseCode.Timeout);
			}
		}, interval);
	}
}
