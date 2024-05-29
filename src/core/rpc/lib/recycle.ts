/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IYQRecycle {
	add(id: number, object: any): void;
	remove(id: number): void;
	clear(): void;
	get(id: number): any;
	collect(): number[];
}

class YQRecycle implements IYQRecycle {
	// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
	// @ts-ignore
	private _objects: { [id: number]: WeakRef<any> } = {};

	add(id: number, object: any) {
		if (id in this._objects && this._objects[id].deref()) {
			throw new Error(`${id} was exists`);
		}
		// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
		// @ts-ignore
		this._objects[id] = new WeakRef(object);
	}

	remove(id: number) {
		if (!(id in this._objects)) {
			throw new Error(`${id} was not exists`);
		}
		delete this._objects[id];
	}

	clear() {
		this._objects = {};
	}

	get(id: number) {
		return this._objects[id]?.deref();
	}

	collect() {
		const ids = [];
		for (const [id, obj] of Object.entries(this._objects)) {
			if (!obj.deref()) {
				ids.push(id);
				delete this._objects[id];
			}
		}
		return ids;
	}
}

export function createRecycle(): IYQRecycle {
	return new YQRecycle();
}
