import moment from "moment";

export enum YQLogLevel {
	NONE = 0,
	ERROR = 1,
	WARN = 2,
	INFO = 3,
	DEBUG = 4
}

export interface IYQLogger {
	error: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
}

export class YQLogger implements IYQLogger {
	private static _default = new YQLogger();
	private static _level = YQLogLevel.INFO;
	private static _instance: IYQLogger;

	static get instance() {
		return YQLogger._instance ? YQLogger._instance : YQLogger._default;
	}

	static set(value: IYQLogger) {
		YQLogger._instance = value;
	}

	static get level() {
		return YQLogger._level;
	}

	static set level(value) {
		YQLogger._level = value;
	}

	protected _name: string;

	constructor(name?: string) {
		this._name = name || 'YQApp';
	}
	

	debug(...args: unknown[]) {
		if (YQLogger.level >= YQLogLevel.DEBUG) {
			args = [`[DEBUG]`, `[${this.formatDate()}]`, `[${this._name}]`, ...args];
			console.debug(...args);
		}
	}

	info(...args: unknown[]) {
		if (YQLogger.level >= YQLogLevel.INFO) {
			args = [`[INFO]`, `[${this.formatDate()}]`, `[${this._name}]`, ...args];
			console.info(...args);
		}
	}

	warn(...args: unknown[]) {
		if (YQLogger.level >= YQLogLevel.WARN) {
			args = [`[WARN]`, `[${this.formatDate()}]`, `[${this._name}]`, ...args];
			console.warn(...args);
		}
	}

	error(...args: unknown[]) {
		if (YQLogger.level >= YQLogLevel.ERROR) {
			args = [`[ERROR]`, `[${this.formatDate()}]`, `[${this._name}]`, ...args];
			console.error(...args);
		}
	}
	
	private formatDate(): string {
		return `${moment().format('YYYY-MM-DD HH:mm:ss.SSS')}`;
	}
}

export const logger = new YQLogger();