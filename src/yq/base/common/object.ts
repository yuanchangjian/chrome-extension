import events from 'events';
import { YQLogger } from './logger';


export type YQConstructor<T> = Function & { prototype: T };

type YQClassDesc = {
	name: string;
	Construct: YQConstructor<YQObject>;
};

const classes: {
	[key: string]: YQClassDesc;
} = {};

export class YQObject extends events.EventEmitter {
	private _logger: YQLogger;
	private static _instances = new Map<string, YQObject>();

	static registerClass(name: string, Construct: YQConstructor<YQObject>) {
		if (name in classes) {
			throw new Error(`class ${name} already register`);
		}
		classes[name] = {
			name,
			Construct
		};
	}

	static getInstance<T extends YQObject>(obj: YQConstructor<T> | string, ...args: unknown[]): T {
		let className: string = typeof obj !== 'string' ? YQObject.getClassName(obj) : obj;
		if (this._instances.has(className)) {
			return this._instances.get(className) as T;
		}
		const ctor = this.getClass(className);
		const instance = new ctor(...args) as T;
		this._instances.set(className, instance);
		return instance;
	}

	static getClassName<T>(obj: T | YQConstructor<YQObject>, def?: string): string {
		const Construct = typeof obj === 'function' ? obj : obj.constructor;
		const name = Object.keys(classes).find((k) => classes[k].Construct === Construct) || def;
		return name;
	}

	static getClass<T extends YQObject>(name: string, def?: new (...args: any) => T) {
		const Construct = (classes[name] && (classes[name].Construct as new (...args: any) => T)) || def;
		if (!Construct) throw new Error(`class ${name} not registered`);
		return Construct;
	}

	static getDerivedClasses<T extends YQObject>(name: string | YQConstructor<T>): YQConstructor<T>[] {
		const Construct = typeof name === 'string' ? classes[name as string]?.Construct : name;
		if (!Construct) {
			throw new Error(`class ${name} not registered`);
		}
		return Object.values(classes).reduce((previousValue, currentValue) => {
			if (currentValue.Construct.prototype instanceof Construct) {
				previousValue.push(currentValue.Construct);
			}
			return previousValue;
		}, []);
	}

	static get classes() {
		return classes;
	}

	constructor() {
		super();
		this._logger = new YQLogger(YQObject.getClassName(this));
	}

	get className() {
		return YQObject.getClassName(this);
	}

	is(className: string): boolean {
		const Construct = YQObject.getClass(className);
		if (!Construct) {
			return false;
		}
		return this instanceof Construct;
	}

	get logger() {
		return this._logger;
	}
}

export function register(name: string) {
	return function (Construct: YQConstructor<YQObject>) {
		YQObject.registerClass(name, Construct);
	};
}

type YQEventsDefinition = { [event: string]: (...args: any[]) => void };

type YQAny<T> = {
	[key: string]: T;
};

type YQValueType<T> = T extends YQAny<infer U> ? U : never;

type YQUnionToIntersection<Union> = (Union extends any ? (argument: Union) => void : never) extends (
	argument: infer Intersection
) => void
	? Intersection
	: never;

export type YQEventsWithoutAny<T extends { [event: string]: (...args: any[]) => void }> = {
	on: YQUnionToIntersection<YQValueType<{ [K in keyof T]: (event: K, listener: T[K]) => any }>>;
	emit: YQUnionToIntersection<
		YQValueType<{
			[K in keyof T]: (event: K, ...args: Parameters<T[K]>) => boolean;
		}>
	>;
};

export type YQEvents<T extends YQEventsDefinition> = YQEventsWithoutAny<T> & {
	on(event: string, listener: (...args: any[]) => void): any;
	emit(event: string, ...args: any[]): any;
};

export interface IYQEvents<T extends YQEventsDefinition> {
	on: YQEventsWithoutAny<T>['on'];
	off: YQEventsWithoutAny<T>['on'];
	once: YQEventsWithoutAny<T>['on'];
	addListener: YQEventsWithoutAny<T>['on'];
	removeListener: YQEventsWithoutAny<T>['on'];
	emit: YQEventsWithoutAny<T>['emit'];
}

export type YQErrorEvents = {
	error(error: Error): void;
};


export function deepClone<T>(obj: T): T {
	if (!obj || typeof obj !== 'object') {
		return obj;
	}
	if (obj instanceof RegExp) {
		return obj;
	}
	const result: any = Array.isArray(obj) ? [] : {};
	Object.entries(obj).forEach(([key, value]) => {
		result[key] = value && typeof value === 'object' ? deepClone(value) : value;
	});
	return result;
}