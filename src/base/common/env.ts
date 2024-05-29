import { YQEvents, YQObject, register } from "./object";

type YQEnvEvents = {
	change(key: PropertyKey): void;
};

export interface IYQEnv {
	on: YQEvents<YQEnvEvents>['on'];
	off: YQEvents<YQEnvEvents>['on'];
	once: YQEvents<YQEnvEvents>['on'];
	addListener: YQEvents<YQEnvEvents>['on'];
	removeListener: YQEvents<YQEnvEvents>['on'];
	emit: YQEvents<YQEnvEvents>['emit'];

	set(key: string, value: any): void;
	get(key: string, def?: any): any;
	has(key: string): boolean;
	readonly version: string;
}

@register('YQEnv')
export class YQEnv extends YQObject implements IYQEnv {
	on: YQEvents<YQEnvEvents>['on'];
	off: YQEvents<YQEnvEvents>['on'];
	once: YQEvents<YQEnvEvents>['on'];
	addListener: YQEvents<YQEnvEvents>['on'];
	removeListener: YQEvents<YQEnvEvents>['on'];
	emit: YQEvents<YQEnvEvents>['emit'];

	private _version: string;

	set(key: string, value: any): void {
		this[key] = value;
		this.emit('change', key);
	}

	get(key: string, def?: any): any {
		return key in this ? this[key] : def;
	}

	has(key: string): boolean {
		return key in this;
	}

	get version() {
		return this._version;
	}
	set version(value: string) {
		this._version = value;
	}
}
