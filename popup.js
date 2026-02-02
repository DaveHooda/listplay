const platformChip = document.getElementById("platform-chip");
const playlistNameEl = document.getElementById("playlist-name");
const trackCountEl = document.getElementById("track-count");
const trackList = document.getElementById("track-list");
const emptyState = document.getElementById("empty-state");

const renderPlaylist = (playlist) => {
    if (!playlist || !playlist.tracks?.length) {
        platformChip.textContent = "Waiting";
        playlistNameEl.textContent = "No playlist detected";
        trackCountEl.textContent = "0";
        trackList.innerHTML = "";
        emptyState.style.display = "block";
        return;
    }

    platformChip.textContent = playlist.platform || "Source";
    playlistNameEl.textContent =
        playlist.playlistTitle || "Playlist";
    trackCountEl.textContent = playlist.tracks.length;
    emptyState.style.display = "none";

    const limited = playlist.tracks.slice(0, 20);
    trackList.innerHTML = limited
        .map(
            (track) => `
            <li>
              <div class="track-title">${track.title}</div>
              <div class="track-artist">${(track.artists || []).join(
                  ", "
              )}</div>
            </li>
          `
        )
        .join("");
    if (playlist.tracks.length > limited.length) {
        trackList.innerHTML += `<li class="track-artist">+ ${
            playlist.tracks.length - limited.length
        } more…</li>`;
    }
};

const loadPlaylist = async () => {
    const { latestPlaylist, lastAddStatus } = await chrome.storage.local.get(
        ["latestPlaylist", "lastAddStatus"]
    );
    console.log(
        "[ListPlay Popup] Loaded playlist:",
        latestPlaylist
    );
    renderPlaylist(latestPlaylist || null);

    const statusMsg = document.getElementById("status-message");
    if (statusMsg && lastAddStatus) {
        statusMsg.style.display = "block";
        statusMsg.textContent = lastAddStatus;
    }
};

const isSupportedTab = (tabUrl) => {
    if (!tabUrl) return false;
    return (
        tabUrl.includes("open.spotify.com") ||
        tabUrl.includes("music.youtube.com") ||
        tabUrl.includes("music.apple.com")
    );
};

const sendMessageWithInject = async (tabId, message) => {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, async (response) => {
            if (!chrome.runtime.lastError) {
                resolve({ response, injected: false });
                return;
            }

            // Try injecting the content script and re-sending
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: ["content-script.js"],
                });
                chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
                    resolve({ response: retryResponse, injected: true, error: chrome.runtime.lastError });
                });
            } catch (error) {
                resolve({ response: null, injected: true, error });
            }
        });
    });
};

document
    .getElementById("copy")
    .addEventListener("click", async () => {
        console.log("[ListPlay Popup] Copy list (Capture) clicked");
        const statusMsg = document.getElementById("status-message");
        const button = document.getElementById("copy");
        button.disabled = true;
        statusMsg.style.display = "block";
        statusMsg.textContent = "Capturing all songs from playlist...";

        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        console.log("[ListPlay Popup] Target tab:", tab?.url);
        if (!tab?.id) {
            statusMsg.textContent = "Error: No active tab";
            button.disabled = false;
            return;
        }
        if (!isSupportedTab(tab?.url)) {
            statusMsg.textContent = "Open a playlist on Spotify, YouTube Music, or Apple Music.";
            button.disabled = false;
            return;
        }

        console.log(
            "[ListPlay Popup] Sending CAPTURE_PLAYLIST to tab",
            tab.id
        );
        
        try {
          const result = await sendMessageWithInject(tab.id, { type: "CAPTURE_PLAYLIST" });
          console.log("[ListPlay Popup] Capture response:", result.response);
          if (result.error) {
              const errorMsg = result.error?.message || "Could not establish connection.";
              statusMsg.textContent = errorMsg;
              console.error("[ListPlay Popup] Error:", errorMsg);
          } else if (result.response) {
              statusMsg.textContent = result.response?.message || "Capturing songs...";
          } else {
              statusMsg.textContent = "Capturing songs...";
          }
          
          setTimeout(() => {
              button.disabled = false;
          }, 1000);
        } catch (error) {
            console.error("[ListPlay Popup] Exception:", error);
            statusMsg.textContent = "Starting capture operation...";
            button.disabled = false;
        }
    });

document
    .getElementById("add-to-playlist")
    .addEventListener("click", async () => {
        console.log("[ListPlay Popup] Add to Playlist clicked");
        const { latestPlaylist } = await chrome.storage.local.get(
            "latestPlaylist"
        );
        console.log(
            "[ListPlay Popup] Current playlist:",
            latestPlaylist
        );
        if (!latestPlaylist || !latestPlaylist.tracks.length) {
            alert(
                "No captured songs. Please click 'Copy list' first to capture the playlist."
            );
            return;
        }

        const statusMsg = document.getElementById("status-message");
        const button = document.getElementById("add-to-playlist");
        button.disabled = true;
        statusMsg.style.display = "block";
        statusMsg.textContent = "Adding to playlist...";
        await chrome.storage.local.set({ lastAddStatus: "Adding to playlist..." });

        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        console.log("[ListPlay Popup] Target tab:", tab?.url);
        if (!tab?.id) {
            statusMsg.textContent = "Error: No active tab";
            button.disabled = false;
            return;
        }
        if (!isSupportedTab(tab?.url)) {
            statusMsg.textContent = "Open a playlist on Spotify, YouTube Music, or Apple Music.";
            button.disabled = false;
            return;
        }

        console.log(
            "[ListPlay Popup] Sending ADD_TO_TARGET_SERVICE to tab",
            tab.id
        );
        
        try {
          const result = await sendMessageWithInject(tab.id, {
              type: "ADD_TO_TARGET_SERVICE",
              playlist: latestPlaylist,
          });
          console.log("[ListPlay Popup] Add response:", result.response);
          if (result.error) {
              const errorMsg = result.error?.message || "Could not establish connection.";
              statusMsg.textContent = errorMsg;
              console.error("[ListPlay Popup] Error:", errorMsg);
          } else if (result.response) {
              statusMsg.textContent = result.response?.message || "Adding songs...";
          } else {
              statusMsg.textContent = "Adding songs...";
          }
          button.disabled = false;
          
          setTimeout(() => {
              button.disabled = false;
          }, 1000);
        } catch (error) {
            console.error("[ListPlay Popup] Exception:", error);
            statusMsg.textContent = "Starting add operation...";
            button.disabled = false;
        }
    });

document
    .getElementById("clear")
    .addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
            type: "CLEAR_PLAYLIST",
        });
        await chrome.storage.local.set({ lastAddStatus: "Cleared." });
        loadPlaylist();
        platformChip.textContent = "Cleared";
        setTimeout(loadPlaylist, 800);
    });

// Listen for updates from background script when playlist is scraped
chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
        if (message?.type === "PLAYLIST_UPDATED") {
            loadPlaylist();
        }
    }
);

// Also listen for status updates from content script via storage
chrome.storage.local.onChanged?.addListener?.((changes, areaName) => {
    if (areaName === 'local' && changes?.lastAddStatus) {
        const statusMsg = document.getElementById("status-message");
        if (statusMsg) {
            statusMsg.textContent = changes.lastAddStatus.newValue;
        }
    }
});

// Periodically check for new playlist data every 2 seconds
setInterval(loadPlaylist, 2000);

loadPlaylist();
