import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const Popup = () => {
  const [playlist, setPlaylist] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadPlaylist();

    // Listen for playlist updates from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'PLAYLIST_UPDATED') {
        loadPlaylist();
      }
    });
  }, []);

  const loadPlaylist = async () => {
    const { latestPlaylist } = await chrome.storage.local.get('latestPlaylist');
    console.log('[ListPlay Popup] Loaded playlist:', latestPlaylist);
    setPlaylist(latestPlaylist || null);
  };

  const handleCopy = async () => {
    console.log('[ListPlay Popup] Copy list (Capture) clicked');
    setIsLoading(true);
    setStatusMessage('Capturing all songs from playlist...');

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    console.log('[ListPlay Popup] Target tab:', tab?.url);

    if (!tab?.id) {
      setStatusMessage('Error: No active tab');
      setIsLoading(false);
      return;
    }

    console.log('[ListPlay Popup] Sending CAPTURE_PLAYLIST to tab', tab.id);

    try {
      chrome.tabs.sendMessage(
        tab.id,
        { type: 'CAPTURE_PLAYLIST' },
        (response) => {
          console.log('[ListPlay Popup] Capture response:', response);

          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError?.message || 'Unknown error';
            setStatusMessage(`${errorMsg}. Capturing in progress...`);
            console.error('[ListPlay Popup] Error:', errorMsg);
          } else if (response) {
            setStatusMessage('Captured! Updating popup...');
            setTimeout(() => {
              loadPlaylist();
              setStatusMessage('');
              setIsLoading(false);
            }, 1000);
          } else {
            setStatusMessage('Capture in progress. Please wait...');
            setTimeout(() => {
              loadPlaylist();
              setStatusMessage('');
              setIsLoading(false);
            }, 2000);
          }
        }
      );
    } catch (error) {
      console.error('[ListPlay Popup] Exception:', error);
      setStatusMessage('Error sending message to tab');
      setIsLoading(false);
    }
  };

  const handleClear = async () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_PLAYLIST' }, () => {
      setPlaylist(null);
      setStatusMessage('');
    });
  };

  const handleAddToPlaylist = () => {
    setStatusMessage('Feature coming soon...');
    setTimeout(() => setStatusMessage(''), 3000);
  };

  const tracks = playlist?.tracks || [];
  const isEmpty = !tracks.length;

  return (
    <div className="listplay-popup">
      <div className="card">
        <header>
          <h1>ListPlay</h1>
          <span className="badge">{playlist?.platform || 'Waiting'}</span>
        </header>

        <div className="meta">
          <div>
            <strong>Playlist</strong>
            <div id="playlist-name">
              {playlist?.playlistTitle || 'No playlist detected'}
            </div>
          </div>
          <div>
            <strong>Tracks</strong>
            <div id="track-count">{playlist?.tracks?.length || 0}</div>
          </div>
        </div>

        {!isEmpty && (
          <ul id="track-list" className="tracks">
            {tracks.map((track, idx) => (
              <li key={idx}>
                <div className="track-title">{track.title}</div>
                <div className="track-artist">
                  {(track.artists || []).join(', ')}
                </div>
              </li>
            ))}
          </ul>
        )}

        {isEmpty && (
          <div className="empty" style={{ display: 'block' }}>
            Open a playlist on Spotify, Apple Music, or YouTube Music, then
            click refresh.
          </div>
        )}

        <div className="actions">
          <button
            id="copy"
            className="primary"
            onClick={handleCopy}
            disabled={isLoading}
          >
            Copy Playlist
          </button>
        </div>

        <div className="actions">
          <button id="add-to-playlist" className="primary" onClick={handleAddToPlaylist}>
            Add to Playlist
          </button>
          <button id="clear" onClick={handleClear}>
            Clear
          </button>
        </div>

        {statusMessage && (
          <div
            id="status-message"
            className="empty"
            style={{
              display: 'block',
              marginTop: '10px',
              padding: '8px',
              fontSize: '12px',
            }}
          >
            {statusMessage}
          </div>
        )}
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Popup />);
