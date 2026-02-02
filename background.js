let latestPlaylist = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PLAYLIST_SCRAPED') {
    latestPlaylist = {
      platform: message.platform,
      playlistTitle: message.playlistTitle,
      tracks: message.tracks,
      sourceTabId: sender.tab?.id,
      receivedAt: Date.now(),
    };
    chrome.storage.local.set({ latestPlaylist });
    
    // Notify popup of the update
    chrome.runtime.sendMessage({
      type: 'PLAYLIST_UPDATED'
    }).catch(() => {
      // Ignore errors if popup is not open
    });
    
    sendResponse?.({ status: 'stored', count: latestPlaylist.tracks?.length || 0 });
    return true;
  }

  if (message?.type === 'GET_PLAYLIST') {
    chrome.storage.local.get('latestPlaylist').then((data) => {
      const stored = data?.latestPlaylist || latestPlaylist;
      sendResponse?.({ playlist: stored || null });
    });
    return true;
  }

  if (message?.type === 'CLEAR_PLAYLIST') {
    latestPlaylist = null;
    chrome.storage.local.remove('latestPlaylist');
    sendResponse?.({ status: 'cleared' });
    return true;
  }

  // Placeholder for future feature: create a playlist on the target service.
  if (message?.type === 'ADD_TO_TARGET_SERVICE') {
    // This requires authenticated APIs for the destination service, which
    // cannot be automated reliably from a background script alone.
    sendResponse?.({ status: 'unimplemented' });
    return true;
  }

  return false;
});
