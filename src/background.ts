import { logger } from './yq/base/common/logger';
import { Connection } from './extensions/connection';
import { YQObject } from './yq/base/common/object';

chrome.runtime.onInstalled.addListener(function (details) {
	try {
		if (details.reason == 'install') {
			logger.debug('extension first installed');
		} else if (details.reason == 'update') {
			const thisVersion = chrome.runtime.getManifest().version;
			logger.debug('extension updated from ' + details.previousVersion + ' to ' + thisVersion + '!');
		}
	} catch (e) {
		logger.error(e);
		return;
	}
});

(async () => {
	const connection = YQObject.getInstance(Connection);
  await connection.open();
})();
