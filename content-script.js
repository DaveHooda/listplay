// Utility: debounce repeated DOM updates so we do not spam the background worker.
const debounce = (fn, delay = 400) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const detectPlatform = () => {
  if (location.host.includes('open.spotify.com')) return 'spotify';
  if (location.host.includes('music.youtube.com')) return 'youtube-music';
  if (location.host.includes('music.apple.com')) return 'apple-music';
  return null;
};

const scrapeSpotify = () => {
  console.log('[ListPlay] Scraping Spotify...');
  const rows = document.querySelectorAll(
    '[data-testid="tracklist-row"], [data-testid^="tracklist-row"], li[data-testid="tracklist-row"]'
  );
  console.log('[ListPlay] Found', rows.length, 'rows on Spotify');
  const tracks = Array.from(rows)
    .map((row) => {
      const titleEl =
        row.querySelector('a[href*="/track/"]') ||
        row.querySelector('[data-testid="internal-track-link"]') ||
        row.querySelector('[data-testid="track-name"]') ||
        row.querySelector('div[aria-colindex="2"] [dir="auto"]') ||
        row.querySelector('div[dir="auto"]') ||
        row.querySelector('[role="gridcell"] a') ||
        row.querySelector('span');
      const artistEls =
        row.querySelectorAll('a[href*="/artist/"]') ||
        row.querySelectorAll('[data-testid="artist-name"] a') ||
        row.querySelectorAll('a[href*="/artist"]');
      const title = titleEl?.textContent?.trim();
      const artists = Array.from(artistEls)
        .map((el) => el.textContent?.trim())
        .filter(Boolean);
      if (!title) {
        console.log('[ListPlay] Skipped row: no title found');
        return null;
      }
      console.log('[ListPlay] Found track:', title, 'by', artists.join(', '));
      return { title, artists };
    })
    .filter(Boolean);

  const playlistTitle =
    document.querySelector('h1[data-testid="entityTitle"]')?.textContent?.trim() ||
    document.querySelector('h1[data-qa="now-playing-header"]')?.textContent?.trim() ||
    document.querySelector('h1')?.textContent?.trim() ||
    'Spotify playlist';

  console.log('[ListPlay] Playlist title:', playlistTitle);
  return { playlistTitle, tracks };
};

const scrapeYouTubeMusic = () => {
  const rows = document.querySelectorAll('ytmusic-responsive-list-item-renderer');
  const tracks = Array.from(rows)
    .map((row) => {
      const title = row.querySelector('yt-formatted-string.title')?.textContent?.trim();
      const artistEls = row.querySelectorAll('yt-formatted-string.byline a');
      const artists = Array.from(artistEls)
        .map((el) => el.textContent?.trim())
        .filter(Boolean);
      if (!title) return null;
      return { title, artists };
    })
    .filter(Boolean);

  const playlistTitle =
    document.querySelector('h1.title')?.textContent?.trim() ||
    document.querySelector('yt-formatted-string.title')?.textContent?.trim() ||
    'YouTube Music playlist';

  return { playlistTitle, tracks };
};

const scrapeAppleMusic = () => {
  const rows = document.querySelectorAll('.songs-list-row');
  const tracks = Array.from(rows)
    .map((row) => {
      const title =
        row.querySelector('.songs-list-row__song-name')?.textContent?.trim() ||
        row.querySelector('.songs-list-row__song-name-wrapper')?.textContent?.trim();
      const artistEls = row.querySelectorAll('.songs-list-row__by-line a');
      const artists = Array.from(artistEls)
        .map((el) => el.textContent?.trim())
        .filter(Boolean);
      if (!title) return null;
      return { title, artists };
    })
    .filter(Boolean);

  const playlistTitle =
    document.querySelector('.product-header__title')?.textContent?.trim() ||
    document.querySelector('h1')?.textContent?.trim() ||
    'Apple Music playlist';

  return { playlistTitle, tracks };
};

const scrapePlatform = () => {
  const platform = detectPlatform();
  if (platform === 'spotify') return { platform, ...scrapeSpotify() };
  if (platform === 'youtube-music') return { platform, ...scrapeYouTubeMusic() };
  if (platform === 'apple-music') return { platform, ...scrapeAppleMusic() };
  return null;
};

// Helper: wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let captureInProgress = false;

// Simple scroll-based playlist capture
const loadAllTracks = async () => {
  if (captureInProgress) {
    console.log('[ListPlay] Capture already in progress. Ignoring duplicate request.');
    return [];
  }
  captureInProgress = true;

  const platform = detectPlatform();
  console.log('[ListPlay] Starting loadAllTracks for platform:', platform);
  try {
    await chrome.storage.local.set({ lastAddStatus: 'Capturing playlist...' });
  } catch (e) {
    console.log('[ListPlay] Status update error:', e.message);
  }
  
  if (!platform) {
    console.log('[ListPlay] Unknown platform, stopping');
    captureInProgress = false;
    return [];
  }

  // Get selectors for current platform
  const selectorSpotify = '[data-testid="tracklist-row"]';
  const selectorYtm = 'ytmusic-responsive-list-item-renderer';
  const selectorApple = '.songs-list-row';
  const selector = platform === 'spotify' ? selectorSpotify : platform === 'youtube-music' ? selectorYtm : selectorApple;

  // Get playlist info
  const playlistTitle = document.querySelector('h1[data-testid="entityTitle"]')?.textContent?.trim() || 'Playlist';
  console.log('[ListPlay] Playlist title:', playlistTitle);
  console.log('[ListPlay] Using selector:', selector);

  // Collect all tracks with deduplication
  let allTracks = [];
  let seenTitles = new Set();
  let noNewRowsCount = 0;
  let stagnantScrollCount = 0;
  let iteration = 0;
  let reachedBottomOnce = false;
  const startedAt = Date.now();
  const maxDurationMs = 5 * 60 * 1000;
  
  const waitForRows = async (attempts = 10) => {
    for (let i = 0; i < attempts; i++) {
      const rows = document.querySelectorAll(selector);
      if (rows.length) return rows;
      await sleep(500);
    }
    return document.querySelectorAll(selector);
  };

  const findScrollableParent = (el) => {
    let node = el;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const canScroll =
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight + 10;
      if (canScroll) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const getTracklistContainer = () => {
    return (
      document.querySelector('[data-testid="playlist-tracklist"]') ||
      document.querySelector('[data-testid="tracklist"]') ||
      document.querySelector('section[aria-label*="Playlist"]') ||
      document.querySelector('main') ||
      document.body
    );
  };

  let rows = await waitForRows(12);
  if (!rows.length) {
    console.log('[ListPlay] No rows found. Stopping.');
    captureInProgress = false;
    return [];
  }

  let scrollContainer = findScrollableParent(rows[0]);
  console.log('[ListPlay] Using scroll container:', scrollContainer === document.scrollingElement ? 'document.scrollingElement' : scrollContainer.tagName);

  // Scroll until we reach the bottom
  try {
    while (iteration < 200) {
      iteration++;

      const tracklistContainer = getTracklistContainer();
      rows = tracklistContainer ? tracklistContainer.querySelectorAll(selector) : document.querySelectorAll(selector);
    console.log('[ListPlay] Iteration', iteration, '- Found', rows.length, 'DOM rows');

    let foundNew = false;
    Array.from(rows).forEach((row) => {
      const titleEl =
        row.querySelector('a[href*="/track/"]') ||
        row.querySelector('[data-testid="track-name"]') ||
        row.querySelector('span');
      const title = titleEl?.textContent?.trim();

      if (title && !seenTitles.has(title)) {
        seenTitles.add(title);
        const artistEls = row.querySelectorAll('a[href*="/artist/"]');
        const artists = Array.from(artistEls)
          .map((el) => el.textContent?.trim())
          .filter(Boolean);
        allTracks.push({ title, artists });
        foundNew = true;
      }
    });

    console.log('[ListPlay] Total unique tracks:', allTracks.length);

    if (!foundNew) {
      noNewRowsCount++;
      console.log('[ListPlay] No new tracks. Count:', noNewRowsCount);
    } else {
      noNewRowsCount = 0;
    }

    // Update storage with current tracks (only while actively capturing)
    if (!reachedBottomOnce) {
      try {
        await chrome.storage.local.set({
          latestPlaylist: {
            platform,
            playlistTitle,
            tracks: allTracks,
          },
        });
      } catch (e) {
        console.log('[ListPlay] Storage error:', e.message);
      }
    }

      const scrollTop = scrollContainer.scrollTop || 0;
      const scrollHeight = scrollContainer.scrollHeight || 0;
      const clientHeight = scrollContainer.clientHeight || window.innerHeight || 0;
      const remaining = scrollHeight - (scrollTop + clientHeight);
      const atBottom = remaining <= 2;
      if (atBottom) {
        reachedBottomOnce = true;
      }

      if (reachedBottomOnce && noNewRowsCount >= 1) {
        console.log('[ListPlay] Reached bottom. Stopping capture now.');
        try {
          await chrome.storage.local.set({
            lastAddStatus: `Capture complete. ${allTracks.length} songs saved.`,
          });
        } catch (e) {
          console.log('[ListPlay] Final status update error:', e.message);
        }
        break;
      }

      // Scroll down slowly
      const prevScrollTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop = prevScrollTop + 350;
      const newScrollTop = scrollContainer.scrollTop;
      console.log('[ListPlay] Scrolling... scrollTop:', newScrollTop, 'remaining:', remaining);

      if (newScrollTop === prevScrollTop) {
        stagnantScrollCount += 1;
        console.log('[ListPlay] Scroll position not changing. Count:', stagnantScrollCount);
      } else {
        stagnantScrollCount = 0;
      }

      if (stagnantScrollCount >= 3 && noNewRowsCount >= 2) {
        console.log('[ListPlay] Scroll stalled or bottom reached. Stopping.');
        break;
      }

      if (Date.now() - startedAt > maxDurationMs) {
        console.log('[ListPlay] Max capture duration reached. Stopping.');
        try {
          await chrome.storage.local.set({
            lastAddStatus: `Capture complete. ${allTracks.length} songs saved.`,
          });
        } catch (e) {
          console.log('[ListPlay] Final status update error:', e.message);
        }
        break;
      }

      await sleep(1500);
    }
  } finally {
    captureInProgress = false;
    try {
      await chrome.storage.local.set({
        lastAddStatus: `Capture complete. ${allTracks.length} songs saved.`,
      });
    } catch (e) {
      console.log('[ListPlay] Final status update error:', e.message);
    }
  }
  
  // Final storage update once capture is finished
  try {
    await chrome.storage.local.set({
      latestPlaylist: {
        platform,
        playlistTitle,
        tracks: allTracks,
      },
      lastAddStatus: `Capture complete. ${allTracks.length} songs saved.`,
    });
  } catch (e) {
    console.log('[ListPlay] Final storage error:', e.message);
  }

  console.log('[ListPlay] Capture complete. Final count:', allTracks.length);
  return allTracks;
};

let lastFingerprint = '';
const sendPlaylist = debounce(async () => {
  // Just scrape what's currently visible - do NOT scroll on refresh
  const payload = scrapePlatform();
  if (!payload || !payload.tracks.length) {
    console.log('[ListPlay] No playlist found or no tracks');
    return;
  }
  console.log('[ListPlay] Found playlist:', payload.playlistTitle, 'with', payload.tracks.length, 'tracks (currently visible)');
  const fingerprint = `${payload.platform}:${payload.tracks.length}:${payload.tracks
    .slice(0, 3)
    .map((t) => t.title)
    .join('|')}`;
  if (fingerprint === lastFingerprint) return;
  lastFingerprint = fingerprint;
  
  // Update storage directly instead of sending messages
  try {
    await chrome.storage?.local?.set?.({
      latestPlaylist: payload
    });
    console.log('[ListPlay] Updated storage with visible tracks');
  } catch (error) {
    console.error('[ListPlay] Error updating storage:', error);
  }
}, 300);

// Auto-detection disabled - only capture on button click
// const observer = new MutationObserver(() => {
//   const platform = detectPlatform();
//   if (!platform) return;
//   const hasRows =
//     document.querySelector('[data-testid="tracklist-row"]') ||
//     document.querySelector('a[href*="/track/"]') ||
//     document.querySelector('ytmusic-responsive-list-item-renderer') ||
//     document.querySelector('.songs-list-row');
//   if (hasRows) sendPlaylist();
// });

// observer.observe(document.body, {
//   subtree: true,
//   childList: true,
// });

// sendPlaylist();

// Auto updates disabled - capture only on button click
// window.addEventListener('load', () => {
//   setTimeout(sendPlaylist, 500);
// });

// setInterval(() => {
//   sendPlaylist();
// }, 3000);

// Helper: wait for a condition
const waitFor = (condition, timeout = 5000) => {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (condition()) {
        resolve(true);
      } else if (Date.now() - start > timeout) {
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
};

// Helper: simulate user interactions
const clickElement = (selector) => {
  const el = document.querySelector(selector);
  if (el) {
    el.click();
    return true;
  }
  return false;
};

const typeText = (selector, text) => {
  const el = document.querySelector(selector);
  if (el) {
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
};

// Spotify: Add playlist and songs
const addToSpotify = async (playlist, onUpdate) => {
  try {
    onUpdate('Creating new playlist...');
    try {
      await chrome.storage.local.set({ lastAddStatus: 'Adding to playlist...' });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
    
    // Find and click the "Create Playlist" button or access Library
    const createBtn = document.querySelector('[aria-label*="Create"]') || 
                      document.querySelector('button[aria-label*="Create"]');
    
    if (createBtn) {
      createBtn.click();
      await waitFor(() => document.querySelector('input[placeholder*="Playlist name"]'), 3000);
    }
    
    const playlistNameInput = document.querySelector('input[placeholder*="Playlist name"]') ||
                              document.querySelector('input[aria-label*="Playlist name"]');
    
    if (playlistNameInput) {
      playlistNameInput.focus();
      playlistNameInput.value = `ListPlay - ${playlist.playlistTitle}`;
      playlistNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Click create or confirm button
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(btn => 
        btn.textContent.toLowerCase().includes('create') || 
        btn.textContent.toLowerCase().includes('save')
      );
      if (confirmBtn) confirmBtn.click();
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Add songs one by one (use playlist.tracks which are already captured)
    for (let i = 0; i < playlist.tracks.length; i++) {
      const track = playlist.tracks[i];
      onUpdate(`Adding song ${i + 1}/${playlist.tracks.length}: ${track.title}`);
      
      // Use playlist inline search bar ("Let's find something for your playlist")
      const searchInput = document.querySelector('input[placeholder*="Search for songs"]') ||
                         document.querySelector('input[placeholder*="Search for songs or episodes"]') ||
                         document.querySelector('input[aria-label*="Search for songs"]');
      
      if (searchInput) {
        console.log(`[ListPlay] Searching for: ${track.title}`);
        searchInput.focus();
        searchInput.value = '';
        await sleep(100);
        searchInput.value = `${track.title} ${track.artists?.[0] || ''}`.trim();
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(800);

        // Press Enter to trigger search results
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(1500);

        // Find the Add button by looking for all visible buttons and finding the one with text "Add"
        const allButtons = Array.from(document.querySelectorAll('button'));
        let addBtn = null;
        
        // Strategy 1: Find button with exact text "Add"
        addBtn = allButtons.find(btn => {
          const text = btn.textContent.trim();
          const isVisible = btn.offsetParent !== null && btn.offsetHeight > 0;
          return text === 'Add' && isVisible;
        });
        
        // Strategy 2: If not found, look for button with aria-label containing "Add"
        if (!addBtn) {
          addBtn = allButtons.find(btn => {
            const ariaLabel = btn.getAttribute('aria-label') || '';
            const isVisible = btn.offsetParent !== null && btn.offsetHeight > 0;
            return ariaLabel.includes('Add') && isVisible;
          });
        }
        
        // Strategy 3: Look for button near search results
        if (!addBtn) {
          const resultsArea = searchInput.closest('div[class*="search"], section, [role="region"]');
          if (resultsArea) {
            const buttons = Array.from(resultsArea.querySelectorAll('button'));
            addBtn = buttons.find(btn => btn.textContent.trim() === 'Add' && btn.offsetParent !== null);
          }
        }

        if (addBtn) {
          console.log('[ListPlay] Found Add button, clicking it');
          addBtn.click();
          onUpdate?.(`Added: ${track.title}`);
          await sleep(800);
        } else {
          console.log('[ListPlay] Could not find Add button', allButtons.filter(b => b.offsetParent).map(b => b.textContent).slice(0, 20));
          onUpdate?.(`⚠️ Could not find add button for: ${track.title}`);
          await sleep(400);
        }
      }
    }
    
    onUpdate(`Successfully added all ${playlist.tracks.length} songs!`);
    try {
      await chrome.storage.local.set({ lastAddStatus: 'Enjoy your playlist!' });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
  } catch (error) {
    onUpdate(`Error adding to Spotify: ${error.message}`);
    try {
      await chrome.storage.local.set({ lastAddStatus: `Error: ${error.message}` });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
  }
};

// YouTube Music: Add playlist and songs
const addToYouTubeMusic = async (playlist, onUpdate) => {
  try {
    onUpdate('Opening YouTube Music menu...');
    try {
      await chrome.storage.local.set({ lastAddStatus: 'Adding to playlist...' });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
    
    // Click create playlist button
    const createBtn = document.querySelector('button[aria-label*="Create"]') ||
                     document.querySelector('yt-icon-button[aria-label*="Create"]');
    
    if (createBtn) {
      createBtn.click();
      await waitFor(() => document.querySelector('input[placeholder*="Playlist name"]'), 3000);
    }
    
    onUpdate('Creating new playlist...');
    const nameInput = document.querySelector('input[placeholder*="Playlist name"]');
    if (nameInput) {
      nameInput.focus();
      nameInput.value = `ListPlay - ${playlist.playlistTitle}`;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Confirm creation
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(btn =>
        btn.textContent.toLowerCase().includes('create') ||
        btn.textContent.toLowerCase().includes('save')
      );
      if (confirmBtn) confirmBtn.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Add songs one by one
    for (let i = 0; i < playlist.tracks.length; i++) {
      const track = playlist.tracks[i];
      onUpdate(`Adding song ${i + 1}/${playlist.tracks.length}: ${track.title}`);
      
      // Use search functionality
      const searchInput = document.querySelector('input[placeholder*="Search"]') ||
                         document.querySelector('yt-formatted-string[role="searchbox"]');
      
      if (searchInput) {
        searchInput.focus();
        searchInput.value = `${track.title} ${track.artists?.[0] || ''}`;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Press Enter to search
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        });
        searchInput.dispatchEvent(enterEvent);
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Click first result's add button
        const addBtn = document.querySelector('button[aria-label*="Add"]');
        if (addBtn) addBtn.click();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    onUpdate(`Successfully added all ${playlist.tracks.length} songs!`);
    try {
      await chrome.storage.local.set({ lastAddStatus: 'Enjoy your playlist!' });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
  } catch (error) {
    onUpdate(`Error adding to YouTube Music: ${error.message}`);
    try {
      await chrome.storage.local.set({ lastAddStatus: `Error: ${error.message}` });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
  }
};

// Apple Music: Add playlist and songs
const addToAppleMusic = async (playlist, onUpdate) => {
  try {
    onUpdate('Opening Apple Music menu...');
    try {
      await chrome.storage.local.set({ lastAddStatus: 'Adding to playlist...' });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
    
    // Click library or create playlist
    const libraryBtn = document.querySelector('button[aria-label*="Library"]') ||
                      document.querySelector('a[href*="library"]');
    
    if (libraryBtn) {
      libraryBtn.click();
      await waitFor(() => document.querySelector('button[aria-label*="Create"]'), 2000);
    }
    
    onUpdate('Creating new playlist...');
    const createBtn = document.querySelector('button[aria-label*="Create"]') ||
                     document.querySelector('button[aria-label*="New"]');
    
    if (createBtn) {
      createBtn.click();
      await waitFor(() => document.querySelector('input[placeholder*="Playlist"]'), 2000);
      
      const nameInput = document.querySelector('input[placeholder*="Playlist"]') ||
                       document.querySelector('input[placeholder*="Name"]');
      
      if (nameInput) {
        nameInput.focus();
        nameInput.value = `ListPlay - ${playlist.playlistTitle}`;
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(btn =>
          btn.textContent.toLowerCase().includes('create') ||
          btn.textContent.toLowerCase().includes('save')
        );
        if (confirmBtn) confirmBtn.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Add songs one by one
    for (let i = 0; i < playlist.tracks.length; i++) {
      const track = playlist.tracks[i];
      onUpdate(`Adding song ${i + 1}/${playlist.tracks.length}: ${track.title}`);
      
      // Use search
      const searchInput = document.querySelector('input[placeholder*="Search"]') ||
                         document.querySelector('input[type="search"]');
      
      if (searchInput) {
        searchInput.focus();
        searchInput.value = `${track.title} ${track.artists?.[0] || ''}`;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Click first result
        const firstResult = document.querySelector('.songs-list-row') ||
                           document.querySelector('[role="button"][aria-label*="Add"]');
        
        if (firstResult) firstResult.click();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    onUpdate(`Successfully added all ${playlist.tracks.length} songs!`);
    try {
      await chrome.storage.local.set({ lastAddStatus: 'Enjoy your playlist!' });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
  } catch (error) {
    onUpdate(`Error adding to Apple Music: ${error.message}`);
    try {
      await chrome.storage.local.set({ lastAddStatus: `Error: ${error.message}` });
    } catch (e) {
      console.log('[ListPlay] Status update error:', e.message);
    }
  }
};

// Allow manual refresh from the popup.
chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  try {
    if (message?.type === 'REQUEST_SCRAPE') {
      sendPlaylist();
      sendResponse?.({ status: 'requested' });
      return true;
    }

    if (message?.type === 'CAPTURE_PLAYLIST') {
      // Send immediate acknowledgment - capture is a long-running operation
      sendResponse?.({ message: 'Starting to capture playlist...' });
      console.log('[ListPlay] CAPTURE_PLAYLIST received');
      
      // Run the capture (scroll through entire playlist)
      // Don't wait for it - just start it in background
      loadAllTracks().then(tracks => {
        console.log('[ListPlay] Capture complete:', tracks.length, 'tracks');
      }).catch(err => {
        console.error('[ListPlay] Error capturing playlist:', err);
      });

      return true;
    }

    if (message?.type === 'ADD_TO_TARGET_SERVICE') {
      const playlist = message.playlist;
      const platform = detectPlatform();
      
      // Send immediate acknowledgment - add is a long-running operation
      sendResponse?.({ message: 'Starting to add songs...' });
      
      // Just start the operation, don't try updating status via chrome.storage (context may be invalidated)
      if (platform === 'spotify') {
        addToSpotify(playlist, () => {}).catch(err => {
          console.error('[ListPlay] Error in addToSpotify:', err);
        });
      } else if (platform === 'youtube-music') {
        addToYouTubeMusic(playlist, () => {}).catch(err => {
          console.error('[ListPlay] Error in addToYouTubeMusic:', err);
        });
      } else if (platform === 'apple-music') {
        addToAppleMusic(playlist, () => {}).catch(err => {
          console.error('[ListPlay] Error in addToAppleMusic:', err);
        });
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error('[ListPlay] Error in message handler:', error);
    return false;
  }
});
