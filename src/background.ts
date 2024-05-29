import { logger } from './base/common/logger';
import { YQWebSocketClient } from './core/rpc'

// window['IsChromeTabUrl'] = function (url) {
//   if (url && url.indexOf('chrome://') === 0) {
//     return true;
//   }
//   return false;
// }


chrome.runtime.onInstalled.addListener(function (details) {
  try {
    if (details.reason == 'install') {
      logger.debug('extension first installed');
    } else if (details.reason == 'update') {
      const thisVersion = chrome.runtime.getManifest().version;
      logger.debug('extension updated from ' + details.previousVersion + ' to ' + thisVersion + '!');
    }

    // chrome.tabs.query({}, function (tabsList) {
    //   for (const i in tabsList) {
    //     if (!window['IsChromeTabUrl'](tabsList[i].url)) {
    //       chrome.tabs.reload(tabsList[i].id, {});
    //     }
    //   }
    // });

  } catch (e) {
    logger.error(e);
    return;
  }
});

(async () => {
  try {
    const address = 'ws://127.0.0.1:12346';
    const client = new YQWebSocketClient('Background', address);

    client.on('disconnect', async () => {
      logger.info('YQWebSocketClient reconnecting');
      try {
        await client.open(Infinity, 1000);
      } catch (error) {
        logger.error('rpc reconnecting error');
        logger.error(error);
      }
    })
    client.on('error', async (error) => {
      logger.error(`YQWebSocketClient error`);
      logger.error(error);
    })
    await client.open(Infinity, 1000);
  } catch (error) {
    logger.error('rpc connect error');
    logger.error(error);
  }
})()