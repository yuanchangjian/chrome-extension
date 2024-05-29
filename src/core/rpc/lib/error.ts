
export const EOL = '\r\n';


export interface IYQRpcError extends Error {
	readonly innerError: Error;
	readonly stackTrace: string;
	setStack(stack: string): void;
	getStack(): string;
}

class YQRpcErrorImpl extends Error {
	private _code: number;
	private _innerError: Error;
	private _stack: string;

	constructor(message: string, code?: number, innerError?: Error) {
		super(message);
		this._code = code;
		this._innerError = innerError;
	}

	get stackTrace() {
		const stack = this._stack || this.stack;
		if (this._innerError instanceof YQRpcErrorImpl) {
			return `${this._innerError.stackTrace}${EOL}${stack}`;
		}
		return `${this._innerError ? this._innerError.stack : ''}${EOL}${stack}`;
	}

	get code(): number {
		return this._code;
	}

	get innerError(): Error {
		return this._innerError;
	}

	get originalError(): Error {
		if (this._innerError instanceof YQRpcErrorImpl) {
			return this._innerError.originalError;
		} else {
			return this;
		}
	}

	setStack(stack: string) {
		this._stack = stack;
	}
	getStack() {
		return this._stack;
	}

	rethrow(): void {
		const stack = this.stack;
		Error.captureStackTrace(this, this.rethrow);
		let index = this.stack.indexOf('\n') + 1;
		if (index < 0) {
			index = this.stack.indexOf('\r\n') + 2;
		}
		super.stack = `${stack}${EOL}${this.stack.substring(index)}`;
		throw this;
	}
}

let YQRpcError: new (message: string, code?: number, innerError?: Error) => IYQRpcError = YQRpcErrorImpl;

export type YQRpcErrorConstruct = new () => IYQRpcError;

export function setErrorImpl(Construct: YQRpcErrorConstruct) {
	YQRpcError = Construct;
}

export function getErrorImpl() {
	return YQRpcError;
}