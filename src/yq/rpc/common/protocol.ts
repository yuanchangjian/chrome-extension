/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import { IYQEvents, YQErrorEvents, YQEvents, YQObject, register } from '../../base/common/object';
import { IYQRpcError, getErrorImpl } from './error';
import { createRecycle } from './recycle';
import type { IYQTransport } from './transport';
import { toCamel } from '../../base/common/utils';

const enum YQValueType {
	error = -1,
	unknown = 0,
	null = 1,
	boolean = 2,
	integer = 3,
	float = 4,
	string = 5,
	object = 6,
	function = 7, // 用于支持Javascript下的function对象
	delegate = 8, // 用于支持.NET下的委托对象
	class = 9, // 用于支持.NET下的类
	array = 10,
	dictionary = 11
}

interface IYQError {
	message: string;
	stack: string;
}

interface IYQDelegate {
	type: number;
	method: number;
	target: number;
}

interface IYQValue {
	type: YQValueType;
	value: any;
	proxy: boolean;
}

const enum YQAction {
	unknown = 0,
	call = 1,
	new = 2
}

const enum YQMessageType {
	unknown = 0,
	request = 1,
	response = 2
}

interface IYQMessage {
	id: number; //用来标识唯一的一对请求和响应
	type: YQMessageType; //用来标识是请求还是响应
	action: YQAction; //用来标识动作类型
	disposed?: number[]; //已进行释放的对象id列表
}

interface IYQRequest extends IYQMessage {
	self: IYQValue; // 调用时的this对象，delegate类型将忽略此值
	value: IYQValue; // 函数调用时指函数本身，方法调用时指需要在self上执行调用的方法名
	args: IYQValue[]; // 调用参数列表
}

interface IYQResponse extends IYQMessage {
	result: IYQValue; // 调用的返回值
}

const VALUE_KEY = Symbol('value');
const PROTOCOL_KEY = Symbol('protocol');

export const DISPOSE_KEY = Symbol('dispose');
export const DESTROYED = Symbol('destroyed');
export const DISCONNECTED = Symbol('disconnected');
export const AS_CLASS = Symbol('asClass');

let messageId = 0;
let objectId = 0;

function newObjectId() {
	return ++objectId;
}

function newMessageId() {
	return ++messageId;
}

function isJsonObject(target: object) {
	if (typeof target !== 'object' || target.constructor !== Object) {
		return false;
	}
	for (const value of Object.values(target)) {
		if (!isJsonObject(value)) {
			return false;
		}
	}
	return true;
}

function isSimpleObject(target: object) {
	if (typeof target !== 'object' || target.constructor !== Object) {
		return false;
	}
	for (const value of Object.values(target)) {
		if (typeof value === 'function') {
			return false;
		}
	}
	return true;
}

export type YQDeferred<T = any> = {
	resolve: (result: T) => void;
	reject: (error: Error) => void;
	stack: string;
};

type YQProtocolEvents = YQErrorEvents;

const emitter: IYQEvents<{
	['proxy-create'](proxy: any): void;
}> = new EventEmitter();

@register('YQProtocol')
export class YQProtocol extends YQObject {
	on: YQEvents<YQProtocolEvents>['on'];
	off: YQEvents<YQProtocolEvents>['on'];
	once: YQEvents<YQProtocolEvents>['on'];
	addListener: YQEvents<YQProtocolEvents>['on'];
	removeListener: YQEvents<YQProtocolEvents>['on'];
	emit: YQEvents<YQProtocolEvents>['emit'];

	private _name: string;

	private _recycle = createRecycle();

	private _references: { [id: number]: any } = {};
	private _referencesMap = new Map<any, number>();
	private _deferrals: { [id: number]: YQDeferred } = {};
	private _disposed: number[] = [];

	private _roots: { [name: string]: any };
	private _transport: IYQTransport;
	private _onRecv: (data: object) => void;

	static get emitter() {
		return emitter;
	}

	constructor(name: string, transport: IYQTransport) {
		super();
		this._name = name;
		this._onRecv = this.onRecv.bind(this);
		this.reset(transport);
	}

	get roots() {
		return this._roots;
	}
	set roots(value) {
		this._roots = value;
	}

	get name() {
		return this._name;
	}

	get disconnected() {
		return !this._transport;
	}

	private onError(error: Error) {
		this.logger.error(error);
		this.emit('error', error);
	}

	private getId(obj: any) {
		if (this._referencesMap.has(obj)) {
			return this._referencesMap.get(obj);
		}
		const id = newObjectId();
		this._references[id] = obj;
		this._referencesMap.set(obj, id);
		this.logger.debug(`new reference ${id}, reference count ${Object.keys(this._references).length}`);
		return id;
	}

	private getObject(id: number) {
		if (id in this._references) {
			return this._references[id];
		}
		this.onError(new Error(`unregister object of ${id}`));
	}

	private serialize(obj: any): IYQValue {
		if (obj) {
			const protocol = obj[PROTOCOL_KEY];
			if (protocol) {
				// protocol存在表示obj是代理对象
				if (obj[PROTOCOL_KEY] === this) {
					// 如果是本Protocol的代理对象，则直接返回代理类型，且值为引用id
					return { ...obj[VALUE_KEY], proxy: true };
				}
				// 如果是其他Protocol的代理对象，则按普通对象处理
			}
			const YQRpcError = getErrorImpl();
			if (obj instanceof YQRpcError) {
				const errors: IYQError[] = [{ message: obj.message, stack: obj.getStack() }];
				// 如果是YQRpcError则存在innerError，将innerError进行数组拼接并传输至远端
				for (obj = obj.innerError; obj; obj = obj.innerError) {
					if (obj instanceof YQRpcError) {
						errors.splice(0, 0, { message: obj.message, stack: obj.getStack() });
					} else {
						errors.splice(0, 0, { message: obj.message, stack: obj.stack });
					}
				}
				return {
					type: YQValueType.error,
					value: errors,
					proxy: false
				};
			}
			if (obj instanceof Error) {
				return {
					type: YQValueType.error,
					value: [{ message: obj.message, stack: obj.stack }],
					proxy: false
				};
			}
		}
		if (obj === null || typeof obj === 'undefined') {
			return {
				type: YQValueType.null,
				value: null,
				proxy: false
			};
		}
		if (typeof obj === 'boolean') {
			return {
				type: YQValueType.boolean,
				value: obj,
				proxy: false
			};
		}
		if (typeof obj === 'string') {
			return {
				type: YQValueType.string,
				value: obj,
				proxy: false
			};
		}
		if (typeof obj === 'bigint') {
			return {
				type: YQValueType.integer,
				value: obj,
				proxy: false
			};
		}
		if (typeof obj === 'number') {
			if (Number.isInteger(obj)) {
				return {
					type: YQValueType.integer,
					value: obj,
					proxy: false
				};
			} else {
				return {
					type: YQValueType.float,
					value: obj,
					proxy: false
				};
			}
		}
		if (typeof obj === 'function') {
			return {
				type: YQValueType.function,
				value: this.getId(obj),
				proxy: false
			};
		}
		if (typeof obj === 'object') {
			if (Array.isArray(obj)) {
				return {
					type: YQValueType.array,
					value: obj.map((item) => this.serialize(item)),
					proxy: false
				};
			} else if (isSimpleObject(obj)) {
				return {
					type: YQValueType.dictionary,
					value: Object.entries(obj).reduce((result, [key, value]) => {
						result[key] = this.serialize(value);
						return result;
					}, {}),
					proxy: false
				};
			} else {
				return {
					type: YQValueType.object,
					value: this.getId(obj),
					proxy: false
				};
			}
		}
		this.onError(new Error('unsupported serialize type'));
	}

	private createProxy(val: IYQValue) {
		let proxy = this._recycle.get(val.type === YQValueType.delegate ? (val.value as IYQDelegate).type : val.value);
		const target = val.type === YQValueType.object ? {} : function () {};
		if (!proxy) {
			proxy = new Proxy(target, {
				construct: (target, args) => {
					if (val.type === YQValueType.function || val.type === YQValueType.class) {
						return new Promise((resolve, reject) => {
							this.send(
								{
									id: newMessageId(),
									type: YQMessageType.request,
									action: YQAction.new,
									self: null,
									value: { ...val, proxy: true },
									args: args.map((item: any) => this.serialize(item))
								},
								{ resolve, reject, stack: new Error().stack }
							);
						});
					}
					throw new Error(`type ${val.type} is not supported for new`);
				},
				apply: (target, self, args) => {
					if (val.type === YQValueType.function || val.type === YQValueType.delegate) {
						// function对象传输时，value为function对象本身；delegate对象传输时，value为IYQDelegate
						return new Promise((resolve, reject) => {
							this.send(
								{
									id: newMessageId(),
									type: YQMessageType.request,
									action: YQAction.call,
									self: this.serialize(self),
									value: { ...val, proxy: true },
									args: args.map((item: any) => this.serialize(item))
								},
								{ resolve, reject, stack: new Error().stack }
							);
						});
					}
					throw new Error(`type ${val.type} is not supported for apply`);
				},
				get: (target, key) => {
					if (key === DESTROYED) {
						return val[DESTROYED];
					}
					if (key === DISCONNECTED) {
						return this.disconnected;
					}
					if (key === DISPOSE_KEY) {
						return () => this.dispose(proxy);
					}
					if (key === VALUE_KEY) {
						return val;
					}
					if (key === PROTOCOL_KEY) {
						return this;
					}
					if (typeof key !== 'string') {
						throw new Error(`get property on object only support string key`);
					}
					// 不支持代理Promise对象
					// 如果在代理对象上await时，会进入then属性获取，返回null则忽略await操作
					if (['then'].includes(key)) {
						return null;
					}
					// 为支持function代理对象在apply、call调用，EventEmitter内部有进行listener属性获取
					if (typeof target === 'function' && ['apply', 'call', 'listener'].includes(key)) {
						return target[key];
					}
					if (![YQValueType.object, YQValueType.function, YQValueType.class].includes(val.type)) {
						throw new Error(`get property on object of type ${val.type} is not allowed`);
					}
					// 由于属性访问全部转换为方法访问形式，因此object进行get访问器时只可能是获取方法
					if (val.type === YQValueType.object || val.type === YQValueType.function || val.type === YQValueType.class) {
						return (...args: any[]) =>
							new Promise((resolve, reject) => {
								this.send(
									{
										id: newMessageId(),
										type: YQMessageType.request,
										action: YQAction.call,
										self: { ...val, proxy: true },
										value: this.serialize(key),
										args: args.map((item) => this.serialize(item))
									},
									{ resolve, reject, stack: new Error().stack }
								);
							});
					}
					throw new Error(`type ${val.type} is not supported for get`);
				}
			});
			if (val.type === YQValueType.delegate) {
				this._recycle.add((val.value as IYQDelegate).type, proxy);
			} else {
				this._recycle.add(val.value, proxy);
			}
		}
		emitter.emit('proxy-create', proxy);
		return proxy;
	}

	private deserialize(val: IYQValue): any {
		if (!val) {
			return val;
		}
		const { type, value, proxy } = val;
		if (proxy) {
			if (type !== YQValueType.function && type !== YQValueType.object) {
				this.onError(new Error(`type ${val.type} can not be a proxy`));
			}
			return this.getObject(value);
		}
		switch (type) {
			case YQValueType.error: {
				const YQRpcError = getErrorImpl();
				const errors: IYQError[] = val.value;
				return errors.reduce<IYQRpcError>((result, { message, stack }) => {
					const error = new YQRpcError(message, -1, result);
					error.setStack(stack);
					return error;
				}, null);
			}
			case YQValueType.null:
			case YQValueType.boolean:
			case YQValueType.integer:
			case YQValueType.float:
			case YQValueType.string: {
				return value;
			}
			case YQValueType.array: {
				return value.map((item: any) => this.deserialize(item));
			}
			case YQValueType.dictionary: {
				return Object.entries<IYQValue>(value).reduce((result, [key, value]) => {
					result[toCamel(key)] = this.deserialize(value);
					return result;
				}, {});
			}
			case YQValueType.object:
			case YQValueType.function:
			case YQValueType.class:
			case YQValueType.delegate: {
				return this.createProxy(val);
			}
			default: {
				this.onError(new Error(`unsupported value type ${type}`));
			}
		}
	}

	private send(request: IYQRequest, deferred: YQDeferred): void;
	private send(response: IYQResponse): void;
	private send(message: IYQRequest | IYQResponse, deferred?: YQDeferred): void {
		if (deferred) {
			this._deferrals[message.id] = deferred;
		}
		const set = new Set([...this._disposed, ...this._recycle.collect()]);
		message.disposed = [...set];
		this._disposed = [];
		if (message.disposed.length > 0) {
			this.logger.debug(`dispose ${message.disposed.length} references`);
		}
		this._transport.send(message);
	}

	private async callFunction(self: any, value: Function, args: any[]): Promise<any> {
		return await value.apply(self, args);
	}

	private async newFunction(value: new (...args: any) => any, args: any[]): Promise<any> {
		return new value(...args);
	}

	private async callMethod(self: any, method: string, args: any[]): Promise<any> {
		// 没有self时，则认为是从roots上获取命名对象
		self = self || this._roots;
		// self为代理对象对象时，直接按代理在模式进行调用
		if (self[VALUE_KEY]) {
			return await self[method](...args);
		}

		const camelName = toCamel(method);
		method = camelName in self ? camelName : method;
		if (!(method in self)) {
			throw new Error(`there is no property or method ${method} in object`);
		}
		if (typeof self[method] === 'function' && !self[method][AS_CLASS]) {
			// 如果是普通方法，则直接调用
			return await self[method](...args);
		} else if (args.length === 0) {
			// 如果是属性，且未传递参数，则认为是属性获取
			return self[method];
		} else if (args.length === 1) {
			// 如果是属性，且仅传递一个参数，则认为是属性设置
			self[method] = args[0];
		} else {
			throw new Error(`${method} is property, but args count is not correct`);
		}
	}

	private async processRequest(request: IYQRequest) {
		let result = null;
		const self = this.deserialize(request.self);
		const value = this.deserialize(request.value);
		const args = request.args.map((item) => this.deserialize(item));
		if (!value) {
			throw new Error(`value can not be null`);
		}

		try {
			if (request.action === YQAction.call) {
				if (typeof value === 'function') {
					result = await this.callFunction(self, value, args);
				} else if (typeof value === 'string') {
					result = await this.callMethod(self, value, args);
				} else {
					throw new Error(`value can not be of type ${typeof value} when call`);
				}
			}
			if (request.action === YQAction.new) {
				if (typeof value === 'function') {
					result = await this.newFunction(value, args);
				} else {
					throw new Error(`value can not be of type ${typeof value} when new`);
				}
			}
		} catch (error) {
			result = error;
		}

		this.send({
			id: request.id,
			type: YQMessageType.response,
			action: request.action,
			result: this.serialize(result)
		});
	}

	private processResponse(response: IYQResponse) {
		const result = this.deserialize(response.result);
		const deferred = this._deferrals[response.id];
		if (!deferred) {
			throw new Error(`can not find request of id ${response.id}`);
		}
		delete this._deferrals[response.id];
		if (result instanceof Error) {
			const YQRpcError = getErrorImpl();
			// 将远程在错误对象栈信息中添加远端在名称，方便后续分析
			if (result instanceof YQRpcError) {
				result.setStack(`${this._name}----${result.getStack()}`);
			}
			const error = new YQRpcError(`rpc call error: ${result.message}`, -1, result);
			error.setStack(deferred.stack);
			deferred.reject(error);
		} else {
			deferred.resolve(result);
		}
	}

	private onRecv(data: object) {
		const message = data as IYQMessage;
		try {
			const { disposed } = message;
			if (disposed && disposed.length > 0) {
				disposed.forEach((id) => {
					if (id in this._references) {
						this._referencesMap.delete(this._references[id]);
						delete this._references[id];
					} else {
						this.onError(new Error(`can not dispose object of ${id}`));
					}
				});
				this.logger.debug(`release ${disposed.length} references, reference count ${Object.keys(this._references).length}`);
			}
			if (message.type === YQMessageType.request) {
				this.processRequest(message as IYQRequest);
			} else if (message.type === YQMessageType.response) {
				this.processResponse(message as IYQResponse);
			} else {
				this.onError(new Error(`unknown message type ${message.type}`));
			}
		} catch (error) {
			this.onError(error);
		}
	}

	isProxy(proxy: any): boolean {
		return proxy[PROTOCOL_KEY] === this;
	}

	dispose(proxies: any[]) {
		proxies.forEach((proxy) => {
			const val = proxy[VALUE_KEY] as IYQValue;
			if (!val || !val.proxy) {
				throw new Error(`the dispose parameter must be proxy`);
			}
			if (val.type === YQValueType.delegate) {
				const delegate = val.value as IYQDelegate;
				this._disposed.push(delegate.type);
				this._disposed.push(delegate.method);
				this._disposed.push(delegate.target);
				this._recycle.remove(delegate.type);
			} else {
				this._disposed.push(val.value);
				this._recycle.remove(val.value);
			}
			proxy[VALUE_KEY][DESTROYED] = null;
		});
		this._disposed = [...new Set(this._disposed)];
	}

	private reset(transport?: IYQTransport) {
		if (this._transport) {
			this._transport.off('recv', this._onRecv);
		}
		this._transport = transport;
		if (this._transport) {
			this._transport.on('recv', this._onRecv);
		}
	}

	destroy() {
		this.reset();
		this._recycle.clear();
		this._roots = null;
		const error = new Error(`protocol destroyed`);
		Object.values(this._deferrals).forEach((deferred) => deferred.reject(error));
		this._deferrals = {};
		this._references = {};
		this._referencesMap.clear();
		this.logger.debug(`protocol ${this._name} was destroyed`);
	}

	get<T = any>(name: string) {
		return new Promise<T>((resolve, reject) => {
			this.send(
				{
					id: newMessageId(),
					type: YQMessageType.request,
					action: YQAction.call,
					self: null,
					value: this.serialize(name),
					args: []
				},
				{ resolve, reject, stack: new Error().stack }
			);
		});
	}
}
