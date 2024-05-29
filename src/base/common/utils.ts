export function stringify(val: any) {
	return val === undefined || typeof val === 'function' ? val + '' : JSON.stringify(val);
}

export function parse(value: any) {
	if (typeof value !== 'string') {
		return undefined;
	}
	try {
		return JSON.parse(value);
	} catch (e) {
		return value;
	}
}

export function wait(interval?: number): Promise<void> {
	return new Promise((resolve) => (interval ? setTimeout(resolve, interval) : setTimeout(resolve, 0)));
}

export const toCamel = (key: string) => `${key[0].toLowerCase()}${key.substr(1)}`;

export const toPascal = (key: string) => `${key[0].toUpperCase()}${key.substr(1)}`;

/**
 * 生成随机ID
 * @param [length] {number} 可选，输出的id长度，默认为12
 * @return {string}
 */
export function generateId(length = 12): string {
	let result = '';
	const baseLength = 4;
	for (let i = 0; i < ~~(length / baseLength); i++) {
		result += Math.random().toString(32).substr(2, baseLength);
	}
	const more = length % baseLength;
	if (more > 0) {
		result += Math.random()
			.toString(32)
			.substr(2, more + 2);
	}
	return result;
}
