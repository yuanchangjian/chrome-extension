import { IYQEvents, YQEvents, YQObject, register, deepClone } from './object';
import { parse, stringify } from './utils';

type YQStoreEvents = {
	changed(event: { key: string; value: any; isRemote?: boolean }): void;
};

export interface IYQStore extends IYQEvents<YQStoreEvents> {
	init(): Promise<void>;
	flush(): Promise<void>;
	get<T>(key: string): Promise<T>;
	set(key: string, value: any): Promise<void>;
	has(key: string): Promise<boolean>;
	update(key: string, func: (value: any) => Promise<any>): Promise<void>;
	remove(key: string): Promise<void>;
	clear(): Promise<void>;
	keys(): Promise<string[]>;
	values(): Promise<any[]>;
	entries(): Promise<[string, any][]>;
}

export interface IYQStoreSync extends IYQEvents<YQStoreEvents> {
	initSync(): void;
	flushSync(): void;
	getSync<T>(key: string): T;
	setSync(key: string, value: any): void;
	hasSync(key: string): boolean;
	updateSync(key: string, func: (value: any) => any): void;
	removeSync(key: string): void;
	clearSync(): void;
	keysSync(): string[];
	valuesSync(): any[];
	entriesSync(): [string, any][];
}

@register('YQStoreBase')
class YQStoreBase extends YQObject {
	on: YQEvents<YQStoreEvents>['on'];
	off: YQEvents<YQStoreEvents>['on'];
	once: YQEvents<YQStoreEvents>['on'];
	addListener: YQEvents<YQStoreEvents>['on'];
	removeListener: YQEvents<YQStoreEvents>['on'];
	emit: YQEvents<YQStoreEvents>['emit'];

	protected _prefix: string;

	constructor(prefix: string) {
		super();
		this._prefix = prefix;
	}
}

interface ILYStoreSyncImpl {
	readonly length: number;
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	key(index: number): string | null;
	removeItem(key: string): void;
	clear(): void;
}

@register('YQStoreSync')
export class YQStoreSync extends YQStoreBase implements IYQStoreSync {
	protected _storage: ILYStoreSyncImpl;

	constructor(prefix: string, storage: ILYStoreSyncImpl) {
		super(prefix);
		this._storage = storage;
	}

	initSync(): void { }

	flushSync(): void { }

	getSync<T>(key: string): T {
		return parse(this._storage.getItem(this._prefix + key)) as T;
	}

	setSync(key: string, value: any): void {
		const stringifyValue = stringify(value);
		this._storage.setItem(this._prefix + key, stringifyValue);
		this.emit('changed', { key, value });
	}

	hasSync(key: string): boolean {
		const keys = this.keysSync();
		return keys.includes(key);
	}

	/**
	 * 为了更新原子化，譬如我要在原来的基础上+1，如果是先get，在set，而get和set是异步的话，那么get和set中间可能出现对这个值再进行了操作的情况，导致不符合预期
	 */
	updateSync(key: string, func: (value: any) => any): void {
		const value = this.getSync(key);
		const updateValue = func(deepClone(value));
		this._storage.setItem(this._prefix + key, stringify(updateValue));
		this.emit('changed', { key, value: updateValue });
	}

	removeSync(key: string): boolean {
		this._storage.removeItem(this._prefix + key);
		this.emit('changed', { key });
		return true;
	}

	clearSync(): void {
		const delKeys: string[] = [];
		for (let i = 0; i < this._storage.length; i++) {
			let key = this._storage.key(i);
			if (key && key.startsWith(this._prefix)) {
				delKeys.push(key.slice(this._prefix.length));
			}
		}
		delKeys.map((key) => this.removeSync(key));
	}

	keysSync(): string[] {
		const result: string[] = [];
		for (let i = 0; i < this._storage.length; i++) {
			const key = this._storage.key(i);
			if (key && key.indexOf(this._prefix) === 0) {
				result.push(key.slice(this._prefix.length));
			}
		}
		return result;
	}

	valuesSync(): any[] {
		const result: any[] = [];
		for (let i = 0; i < this._storage.length; i++) {
			const key = this._storage.key(i);
			if (key && key.indexOf(this._prefix) === 0) {
				const value = JSON.parse(this._storage.getItem(key));
				result.push(value);
			}
		}
		return result;
	}

	entriesSync(): [string, any][] {
		const result: [string, any][] = [];
		for (let i = 0; i < this._storage.length; i++) {
			const key = this._storage.key(i);
			if (key && key.indexOf(this._prefix) === 0) {
				const value = JSON.parse(this._storage.getItem(key));
				result.push([key.slice(this._prefix.length), value]);
			}
		}
		return result;
	}
}

export interface IYQStoreImpl {
	setValue(key: string, value: string): Promise<void>;
	getValue(key: string): Promise<string>;
	remove(keys: string[]): Promise<void>;
	clear(prefix?: string): Promise<void>;
	getAll(): Promise<Record<string, any>>;
	getKeys(): Promise<string[]>;
}

@register('YQStore')
export class YQStore extends YQStoreBase implements IYQStore {
	protected _impl: IYQStoreImpl;

	constructor(prefix: string, impl: IYQStoreImpl) {
		super(prefix);
		this._impl = impl;
	}

	async init(): Promise<void> { }

	async flush(): Promise<void> { }

	async get<T>(key: string): Promise<T> {
		const value = await this._impl.getValue(this._prefix + key);
		return parse(value) as T;
	}

	async set(key: string, value: any): Promise<void> {
		const stringifyValue = stringify(value);
		await this._impl.setValue(this._prefix + key, stringifyValue);
		this.emit('changed', { key, value });
	}

	async has(key: string): Promise<boolean> {
		const keys = await this.keys();
		return keys.includes(key);
	}

	async update(key: string, func: (value: any) => Promise<any>): Promise<void> {
		const value = await this.get(key);
		const updateValue = await func(deepClone(value));
		await this._impl.setValue(this._prefix + key, stringify(updateValue));
		this.emit('changed', { key, value: updateValue });
	}

	async remove(key: string): Promise<void> {
		await this._impl.remove([this._prefix + key]);
		this.emit('changed', { key });
	}

	async clear(): Promise<void> {
		const keys = await this.keys();
		await this._impl.clear(this._prefix);
		keys.map((key) => this.emit('changed', { key }));
	}

	async keys(): Promise<string[]> {
		const keys = await this._impl.getKeys();
		return keys.filter((key) => key.startsWith(this._prefix)).map((key) => key.slice(this._prefix.length));
	}

	async values(): Promise<any[]> {
		const all = await this._impl.getAll();
		const result: string[] = [];
		for (const [key, value] of Object.entries(all)) {
			if (key.startsWith(this._prefix)) {
				result.push(parse(value));
			}
		}
		return result;
	}

	async entries(): Promise<[string, any][]> {
		const all = await this._impl.getAll();
		const result: [string, any][] = [];
		for (const [key, value] of Object.entries(all)) {
			if (key.startsWith(this._prefix)) {
				result.push([key.slice(this._prefix.length), parse(value)]);
			}
		}
		return result;
	}
}