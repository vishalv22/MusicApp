const { ipcRenderer } = require('electron');

class MusicPlayer {
    constructor() {
        this.songs = [];
        this.lyrics = [];
        this.currentSongIndex = -1;
        this.currentLyricIndex = -1;
        this.isPlaying = false;
        this.settings = {};
        this.shuffleMode = false;
        this.repeatMode = 'none'; // 'none', 'all', 'one'
        this.filteredSongs = null;
        this.queue = [];
        this.currentImageUrl = null;
        this.isVideoMode = false;
        this.lyricsOffset = 0;
        this.songOffsets = {};
        this.isVideo43Mode = false;
        this.playlists = {};
        this.currentPlaylist = null;
        this.playlistOrder = [];
        this.lyricsFontSize = 16;
        this.floatingLyricsFontSize = 28;
        this.floatingLyricsColor = '#ffffff';
        this.selectedSongs = new Set();
        this.selectionMode = false;
        this.selectionAnchorDisplayIndex = null;
        this.songIndexLookup = new Map();
        this.scrollbarTimeouts = {};
        this.scrollbarHideState = {};
        this.shuffleHistory = [];
        this.shuffleQueue = [];
        this.currentCategory = 'all';

        // Playback context should not change just because the user is browsing a different list.
        // It updates only when the user plays a song from another list or explicitly queues from another list.
        this.playbackContext = { type: 'all', playlistName: null, category: 'all' };
        this.pendingShuffleRegenerate = false;
        this.crossfadeInterval = null;
        this.originalVolume = 1;
        this.nextAudio = null;
        this.spotdlServerRunning = false;
        this.videoInMainPanel = false;
        this.mainPanelVideo = null;
        this.downloadResults = [];
        this.downloadLogs = [];
        this.downloadInProgress = false;
        this.downloadProcessId = null;
        this.downloadCancelRequestedForId = null;
        this.downloadCompletedKeys = new Set();
        this.downloadStateRenderRaf = 0;
        this.downloadSearchLoading = false;
        this.downloadSearchToken = 0;
        this.downloadSettings = {};
        this.downloadPanelInitialized = false;
        this.downloadIpcBound = false;
        this.downloadSearchType = 'track';
        this.downloadQueueItems = [];
        this.pendingDownloadQueue = [];
        this.activeDownloadJob = null;
        this.downloadJobCounter = 0;
        this.dabLoggedIn = false;
        this.dabUserName = '';
        this.dabAuthMode = 'login';
        this.librarySearchValue = '';
        this.defaultSearchPlaceholder = '';
        this.downloadLastQuery = '';
        this.downloadLastCount = 0;
        this.previewMode = false;
        this.previewTrack = null;
        this.progressSyncInterval = null;
        this.progressSyncIntervalMs = 500;
        this.lastEndedEventAt = 0;
        this.songSelectionToken = 0;
        this.guardWarnings = new Set();
        this.mediaTransitionToken = 0;
        this.autoResumeSuppressedUntil = 0;
        
        // Audio context for equalizer
        this.audioContext = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.analyserNode = null;
        this.eqFilters = [];
        this.isEqInitialized = false;

        // Visualizer overlay
        this.visualizer = null;
        this.visualizerCanvas = null;
        this.albumCoverMedia = null;
        this.visualizerColorRequestId = 0;
        this.visualizerColorCanvas = null;
        this.visualizerBtn = null;
        this.visualizerPanel = null;
        this.isVisualizerViewActive = false;
        this.visualizerPrevPanelState = null;
        this.videoSourceNode = null;
        this.videoSourceElement = null;

        // Queue panel (shown when lyrics are hidden)
        this.queuePanel = null;
        this.queueList = null;
        this.queueMeta = null;
        this.queueCoverUrlCache = new Map();
        this.songCoverRenderQueue = [];
        this.songCoverRenderToken = 0;
        this.songCoverRenderRafId = 0;
        this.songCoverRenderIdleId = null;
        this.songCoverRenderScheduled = false;

        // Media Session / SMTC integration
        this.mediaSessionEnabled = false;
        this.mediaSessionArtworkUrls = [];
        this.mediaSessionUpdateToken = 0;
        this.mediaSessionPositionUpdateAt = 0;
        this.mediaSessionFallbackArtwork = 'icons/default-playlist.png';
        this.songSearchDocCache = new WeakMap();

        
        this.initElements();
        this.defaultSearchPlaceholder = this.searchInput?.placeholder || 'Search here...';
        this.bindEvents();
        this.initMediaSession();
        this.initVisualizer();
        this.updateMediaAvailabilityButtons(null);
        // Defer music loading to reduce startup delay
        setTimeout(() => this.loadMusic(), 50);
    }

    // Sanitize HTML to prevent XSS
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeAttribute(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    logGuardWarningOnce(key, message) {
        if (!this.guardWarnings) this.guardWarnings = new Set();
        if (this.guardWarnings.has(key)) return;
        this.guardWarnings.add(key);
        console.warn(message);
    }

    beginMediaTransition(reason = '') {
        this.mediaTransitionToken += 1;
        this.lastMediaTransitionReason = reason;
        return this.mediaTransitionToken;
    }

    isMediaTransitionCurrent(token) {
        return token === this.mediaTransitionToken;
    }

    addOneTimeMediaListener(target, eventName, handler, transitionToken = null) {
        if (!target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') return;
        target.addEventListener(eventName, (event) => {
            if (transitionToken !== null && !this.isMediaTransitionCurrent(transitionToken)) return;
            handler(event);
        }, { once: true });
    }

    suppressAutoResume(durationMs = 400) {
        const ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 400;
        this.autoResumeSuppressedUntil = Math.max(this.autoResumeSuppressedUntil || 0, Date.now() + ms);
    }

    canAutoResumePlayback() {
        return Date.now() >= (this.autoResumeSuppressedUntil || 0);
    }

    // Helper function to update song badge
    updateSongBadge(songIndex, hasLyrics) {
        // Use more efficient selector with caching
        const songItem = document.querySelector(`[data-song-index="${songIndex}"]`)?.closest('.song-item');
        if (!songItem) return;

        const song = this.songs[songIndex];
        if (!song) return;

        const lyricsAvailable = typeof hasLyrics === 'boolean' ? hasLyrics : !!song.hasLyrics;
        const videoAvailable = !!song.isVideo || !!song.attachedVideo || !!song.youtubeVideo;
        const dotMode = lyricsAvailable && videoAvailable ? 'both' : lyricsAvailable ? 'lyrics' : videoAvailable ? 'video' : null;

        const nameEl = songItem.querySelector('.song-name');
        if (!nameEl) return;

        let dot = nameEl.querySelector('.song-detail-dot');
        if (!dotMode) {
            if (dot) dot.remove();
            return;
        }

        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'song-detail-dot';
            nameEl.appendChild(dot);
        }

        // Migration: older builds used a `lyrics` class which conflicts with the right-panel `.lyrics` styles.
        dot.classList.remove('lyrics');

        dot.classList.toggle('has-lyrics', dotMode === 'lyrics');
        dot.classList.toggle('video', dotMode === 'video');
        dot.classList.toggle('both', dotMode === 'both');
        dot.title =
            dotMode === 'both'
                ? 'Lyrics + Video available'
                : dotMode === 'lyrics'
                  ? 'Lyrics available'
                  : 'Video available';
    }

    initElements() {
        this.initAudioElements();
        this.initControlElements();
        this.initDisplayElements();
        this.initPanelElements();
        
        this.playPauseBtn.disabled = true;
        this.updateVisualizerAvailability();
    }

    initAudioElements() {
        this.audio = document.getElementById('audio');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.playPauseImg = this.playPauseBtn.querySelector('img'); // Cache for performance
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.shuffleBtn = document.getElementById('shuffleBtn');
        this.repeatBtn = document.getElementById('repeatBtn');
    }

    initControlElements() {
        this.progressBar = document.getElementById('progressBar');
        this.progressFill = document.getElementById('progressFill');
        this.progressHandle = document.getElementById('progressHandle');
        this.volumeBar = document.getElementById('volumeBar');
        this.volumeFill = document.getElementById('volumeFill');
        this.volumeHandle = document.getElementById('volumeHandle');
        this.volumePercent = document.getElementById('volumePercent');
        this.volumeIcon = document.getElementById('volumeIcon');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.themeToggle = document.getElementById('themeToggle');
        this.slidePanelBtn = document.getElementById('slidePanelBtn');
        this.slidePanel = document.getElementById('slidePanel');
        this.searchInput = document.getElementById('searchInput');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.settingsPanel = document.getElementById('settingsPanel');
        this.musicContainer = document.querySelector('.music-container');
        this.selectModeBtn = document.getElementById('selectModeBtn');
        this.selectAllSongs = document.getElementById('selectAllSongs');
        this.headerSelect = document.getElementById('headerSelect');
    }

    initDisplayElements() {
        this.timeDisplay = document.getElementById('time');
        this.albumCover = document.getElementById('albumCover');
        this.albumCoverMedia = document.getElementById('albumCoverMedia');
        this.visualizerCanvas = document.getElementById('visualizerCanvas');
        this.detailTitle = document.getElementById('detailTitle');
        this.detailArtist = document.getElementById('detailArtist');
        this.detailDuration = document.getElementById('detailDuration');
        this.detailFormat = document.getElementById('detailFormat');
        this.starRatingCurrent = document.getElementById('starRatingCurrent');
        this.videoPlayer = document.getElementById('videoPlayer');
        this.videoElement = document.getElementById('videoElement');
        this.videoBtn = document.getElementById('videoBtn');
        this.visualizerBtn = document.getElementById('visualizerBtn');
        this.lyricsToggleBtn = document.getElementById('lyricsToggleBtn');
        this.offsetToggleBtn = document.getElementById('offsetToggleBtn');
        this.timingBackward = document.getElementById('timingBackward');
        this.timingForward = document.getElementById('timingForward');
        this.timingOffset = document.getElementById('timingOffset');
        this.timingSave = document.getElementById('timingSave');
        this.lyricsTimingControls = document.getElementById('lyricsTimingControls');
        this.lyricsFontBtn = document.getElementById('lyricsFontBtn');
        this.lyricsFontControls = document.getElementById('lyricsFontControls');
        this.fontDecrease = document.getElementById('fontDecrease');
        this.fontIncrease = document.getElementById('fontIncrease');
        this.fontSizeDisplay = document.getElementById('fontSizeDisplay');
        this.fontSave = document.getElementById('fontSave');
    }

    initPanelElements() {
        // Batch DOM queries for better performance
        const elements = {
            leftPanel: 'leftPanel',
            rightPanel: 'rightPanel', 
            musicList: 'musicList',
            visualizerPanel: 'visualizerPanel',
            songsDiv: 'songs',
            lyricsDiv: 'lyrics',
            queuePanel: 'queuePanel',
            queueList: 'queueList',
            queueMeta: 'queueMeta',

            floatLyricsBtn: 'floatLyricsBtn',
            contextMenu: 'contextMenu',
            musicFileInput: 'musicFileInput',
            videoFileInput: 'videoFileInput',
            lyricsFileInput: 'lyricsFileInput',
            resizer: 'resizer',

            downloadMusicBtn: 'downloadMusicBtn',
            downloadPanel: 'downloadPanel',
            downloadCloseBtn: 'downloadCloseBtn',
            downloadResultsEl: 'downloadResults',
            downloadResultsStatus: 'downloadResultsStatus',
            downloadSearchTabs: 'downloadSearchTabs',
            downloadSubtitle: 'downloadSubtitle',
            downloadUserBadge: 'downloadUserBadge',
            downloadUserName: 'downloadUserName',
            downloadLoggedInActions: 'downloadLoggedInActions',
            downloadAuthCard: 'downloadAuthCard',
            downloadAuthFields: 'downloadAuthFields',
            downloadPostLogin: 'downloadPostLogin',
            dabAuthTitleEl: 'dabAuthTitle',
            dabAuthSubtitleEl: 'dabAuthSubtitle',
            dabUsernameField: 'dabUsernameField',
            dabUsernameInput: 'dabUsernameInput',
            dabEmailInput: 'dabEmailInput',
            dabPasswordInput: 'dabPasswordInput',
            dabConfirmPasswordField: 'dabConfirmPasswordField',
            dabConfirmPasswordInput: 'dabConfirmPasswordInput',
            dabForgotPassword: 'dabForgotPassword',
            dabLoginBtn: 'dabLoginBtn',
            dabRegisterBtn: 'dabRegisterBtn',
            dabShowRegisterBtn: 'dabShowRegisterBtn',
            dabShowLoginBtn: 'dabShowLoginBtn',
            dabAuthFooterLogin: 'dabAuthFooterLogin',
            dabAuthFooterRegister: 'dabAuthFooterRegister',
            dabLogoutBtn: 'dabLogoutBtn',
            dabStatusEl: 'dabStatus',
            downloadLogsToggleBtn: 'downloadLogsToggleBtn',
            downloadLogsPanel: 'downloadLogsPanel',
            downloadCopyLogsBtn: 'downloadCopyLogsBtn',
            downloadClearLogsBtn: 'downloadClearLogsBtn',
            downloadStatusEl: 'downloadStatus',
            downloadLogsEl: 'downloadLogs'
        };
        
        Object.keys(elements).forEach(key => {
            this[key] = document.getElementById(elements[key]);
        });
    }

    initVisualizer() {
        if (this.visualizer || !this.visualizerCanvas) return;
        if (!window.NCSVisualizerOverlay) {
            console.warn('[Visualizer] visualizer.js not loaded; skipping visualizer initialization');
            return;
        }

        try {
            this.visualizer = new window.NCSVisualizerOverlay(this.visualizerCanvas);
            this.visualizer.setColor(this.getDefaultVisualizerColor());
            this.visualizer.setSeed(1);
            this.applyVisualizerFpsSetting();
        } catch (error) {
            console.error('[Visualizer] Failed to initialize visualizer:', error);
            this.visualizer = null;
        }
    }

    startVisualizer() {
        if (!this.visualizer || !this.isVisualizerViewActive) return;
        if (this.isVideoMode && this.videoInMainPanel) return;
        const media = this.isVideoMode ? this.videoElement : this.audio;
        if (!media || media.paused) return;
        this.initializeAudioContext();
        this.syncVisualizerAudioSource();
        if (this.audioContext && typeof this.audioContext.resume === 'function') {
            this.audioContext.resume().catch(() => {});
        }
        this.visualizer.start();
    }

    stopVisualizer() {
        if (!this.visualizer) return;
        this.visualizer.stop();
    }

    toggleVisualizerView() {
        if (this.videoInMainPanel) return;
        if (this.isVisualizerViewActive) {
            this.disableVisualizerView(true);
        } else {
            this.enableVisualizerView();
        }
    }

    enableVisualizerView() {
        if (this.isVisualizerViewActive) return;
        if (this.videoInMainPanel) {
            this.updateVisualizerAvailability();
            return;
        }
        if (!this.visualizerPanel || !this.visualizerCanvas) {
            console.warn('[Visualizer] visualizer panel not found; cannot enable visualizer view');
            return;
        }

        this.initVisualizer();

        const musicContainer = document.getElementById('musicContainer');
        const settingsPanel = document.getElementById('settingsPanel');
        const playlistDetailsPanel = document.getElementById('playlistDetailsPanel');

        this.visualizerPrevPanelState = {
            musicContainerDisplay: musicContainer?.style.display ?? '',
            settingsPanelDisplay: settingsPanel?.style.display ?? '',
            playlistDetailsPanelDisplay: playlistDetailsPanel?.style.display ?? '',
            mainPanelVideoDisplay: this.mainPanelVideo?.style.display ?? null,
            leftPanelHadDownloadActive: this.leftPanel?.classList.contains('download-active') ?? false,
            currentView: this.currentView ?? 'music',
            settingsBtnActive: this.settingsBtn?.classList.contains('active') ?? false
        };

        this.isVisualizerViewActive = true;
        this.currentView = 'visualizer';

        if (this.visualizerBtn) this.visualizerBtn.classList.add('active');
        if (this.leftPanel) this.leftPanel.classList.add('visualizer-view-active');

        if (musicContainer) musicContainer.style.display = 'none';
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (playlistDetailsPanel) playlistDetailsPanel.style.display = 'none';
        if (this.mainPanelVideo) this.mainPanelVideo.style.display = 'none';

        this.visualizerPanel.style.display = 'block';

        // Ensure WebAudio graph exists before starting the renderer.
        this.initializeAudioContext();
        this.syncVisualizerAudioSource();
        if (this.visualizer) this.visualizer.requestResize();
        this.startVisualizer();
    }

    disableVisualizerView(restorePreviousPanels) {
        if (!this.isVisualizerViewActive) return;

        this.stopVisualizer();

        this.isVisualizerViewActive = false;
        if (this.visualizerBtn) this.visualizerBtn.classList.remove('active');
        if (this.leftPanel) this.leftPanel.classList.remove('visualizer-view-active');
        if (this.visualizerPanel) this.visualizerPanel.style.display = 'none';

        const prev = this.visualizerPrevPanelState;
        this.visualizerPrevPanelState = null;

        if (!restorePreviousPanels || !prev) return;

        const musicContainer = document.getElementById('musicContainer');
        const settingsPanel = document.getElementById('settingsPanel');
        const playlistDetailsPanel = document.getElementById('playlistDetailsPanel');

        if (musicContainer) musicContainer.style.display = prev.musicContainerDisplay;
        if (settingsPanel) settingsPanel.style.display = prev.settingsPanelDisplay;
        if (playlistDetailsPanel) playlistDetailsPanel.style.display = prev.playlistDetailsPanelDisplay;

        if (this.mainPanelVideo && prev.mainPanelVideoDisplay !== null) {
            this.mainPanelVideo.style.display = prev.mainPanelVideoDisplay;
        }

        if (this.leftPanel) {
            this.leftPanel.classList.toggle('download-active', !!prev.leftPanelHadDownloadActive);
        }

        if (this.settingsBtn) {
            this.settingsBtn.classList.toggle('active', !!prev.settingsBtnActive);
        }

        this.currentView = prev.currentView ?? 'music';
    }

    updateVisualizerAvailability() {
        const disabled = !!this.videoInMainPanel;
        if (this.visualizerBtn) {
            this.visualizerBtn.disabled = disabled;
            this.visualizerBtn.classList.toggle('disabled', disabled);
            this.visualizerBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            this.visualizerBtn.title = disabled
                ? 'Visualizer unavailable while video is in the main panel'
                : 'Toggle Visualizer';
        }
        if (disabled && this.isVisualizerViewActive) {
            this.disableVisualizerView(false);
        }
    }

    ensureVideoAudioSource() {
        if (!this.audioContext || !this.gainNode) return;
        if (!this.videoElement) return;
        if (this.videoSourceElement === this.videoElement && this.videoSourceNode) return;

        if (this.videoSourceNode) {
            try {
                this.videoSourceNode.disconnect();
            } catch {}
        }

        try {
            this.videoSourceNode = this.audioContext.createMediaElementSource(this.videoElement);
            this.videoSourceElement = this.videoElement;
            this.videoSourceNode.connect(this.gainNode);
        } catch (error) {
            console.warn('Failed to connect video audio source:', error);
        }
    }

    syncVisualizerAudioSource() {
        if (!this.visualizer || !this.analyserNode || !this.isVisualizerViewActive) return;
        if (this.isVideoMode && !this.videoInMainPanel) {
            this.ensureVideoAudioSource();
            this.visualizer.setAudioSource(this.videoElement, this.analyserNode);
            return;
        }
        this.visualizer.setAudioSource(this.audio, this.analyserNode);
    }

    getDefaultVisualizerColor() {
        if (document.body.classList.contains('light-theme')) return { r: 20, g: 20, b: 20 };
        return { r: 255, g: 107, b: 107 };
    }

    hashStringToSeed(str) {
        if (!str) return 1;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return hash | 0;
    }

    boostVisualizerColorForVisibility(color) {
        if (!color) return this.getDefaultVisualizerColor();

        let { r, g, b } = color;
        r = Math.max(0, Math.min(255, r | 0));
        g = Math.max(0, Math.min(255, g | 0));
        b = Math.max(0, Math.min(255, b | 0));

        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (luminance < 0.35) {
            // Blend with white to keep particles visible on dark covers.
            r = Math.round(r * 0.4 + 255 * 0.6);
            g = Math.round(g * 0.4 + 255 * 0.6);
            b = Math.round(b * 0.4 + 255 * 0.6);
        }

        return { r, g, b };
    }

    updateVisualizerColorFromImageUrl(imageUrl) {
        if (!this.visualizer || !imageUrl) return;

        const requestId = ++this.visualizerColorRequestId;
        this.extractAverageColorFromImageUrl(imageUrl).then(color => {
            if (requestId !== this.visualizerColorRequestId) return;
            this.visualizer.setColor(this.boostVisualizerColorForVisibility(color));
        });
    }

    extractAverageColorFromImageUrl(imageUrl) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const size = 32;
                if (!this.visualizerColorCanvas) this.visualizerColorCanvas = document.createElement('canvas');
                const canvas = this.visualizerColorCanvas;
                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    resolve(this.getDefaultVisualizerColor());
                    return;
                }

                ctx.clearRect(0, 0, size, size);
                ctx.drawImage(img, 0, 0, size, size);

                let data;
                try {
                    data = ctx.getImageData(0, 0, size, size).data;
                } catch {
                    resolve(this.getDefaultVisualizerColor());
                    return;
                }

                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;

                for (let i = 0; i < data.length; i += 4) {
                    const a = data[i + 3];
                    if (a < 32) continue;
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }

                if (!count) {
                    resolve(this.getDefaultVisualizerColor());
                    return;
                }

                resolve({
                    r: Math.round(r / count),
                    g: Math.round(g / count),
                    b: Math.round(b / count)
                });
            };

            img.onerror = () => resolve(this.getDefaultVisualizerColor());
            img.src = imageUrl;
        });
    }

    bindEvents() {
        this.playPauseBtn.onclick = () => this.togglePlayPause();
        this.prevBtn.onclick = () => this.playPrevious(true);
        this.nextBtn.onclick = () => this.playNext(true);
        this.refreshBtn.onclick = () => this.loadMusic();
        this.floatLyricsBtn.onclick = () => this.openFloatingLyrics();
        
        // Listen for floating window ready event
        ipcRenderer.on('floating-window-ready', () => {
            if (this.currentSongIndex >= 0) {
                const currentSong = this.songs[this.currentSongIndex];
                ipcRenderer.send('update-floating-lyrics', {
                    songInfo: {
                        title: currentSong.title,
                        artist: currentSong.artist
                    },
                    lyrics: this.lyrics,
                    currentIndex: this.currentLyricIndex
                });
            }
        });
        
        this.audio.ontimeupdate = () => this.updateTime();
        this.audio.onended = () => {
            this.lastEndedEventAt = Date.now();
            this.playNext();
        };
        this.audio.onloadedmetadata = () => {
            this.updateDuration();
            this.updateMediaSessionPositionState(true);
        };
        this.audio.onplay = () => {
            if (!this.isVideoMode) {
                this.isPlaying = true;
                this.playPauseImg.src = 'icons/pause.png';
                this.startVisualizer();
            }
            this.syncMediaSessionPlaybackState();
            this.startProgressSync();
        };
        this.audio.onpause = () => {
            if (!this.isVideoMode) {
                this.isPlaying = false;
                this.playPauseImg.src = 'icons/play.png';
                this.stopVisualizer();
            }
            this.syncMediaSessionPlaybackState();
            this.stopProgressSync();
        };
        
        // Video event handlers
        this.videoElement.ontimeupdate = () => this.updateTime();
        this.videoElement.onended = () => {
            this.lastEndedEventAt = Date.now();
            this.playNext();
        };
        this.videoElement.onloadedmetadata = () => {
            this.updateDuration();
            this.updateMediaSessionPositionState(true);
        };
        this.videoElement.onplay = () => {
            if (this.isVideoMode) {
                this.isPlaying = true;
                this.playPauseImg.src = 'icons/pause.png';
            }
            this.startVisualizer();
            this.syncMediaSessionPlaybackState();
            this.startProgressSync();
        };
        this.videoElement.ondblclick = () => this.toggleVideoAspectRatio();
        this.videoElement.onwaiting = () => this.handleVideoBuffering();
        this.videoElement.oncanplay = () => this.handleVideoReady();
        this.videoElement.onerror = () => this.handleVideoError();
        this.videoElement.onpause = () => {
            this.handleVideoPause();
            if (this.isVideoMode) {
                this.isPlaying = false;
                this.playPauseImg.src = 'icons/play.png';
            }
            this.stopVisualizer();
            this.syncMediaSessionPlaybackState();
            this.stopProgressSync();
        };
        this.videoElement.oncontextmenu = (e) => {
            if (this.isVideoMode) {
                e.preventDefault();
                this.showVideoContextMenu(e.clientX, e.clientY);
            }
        };
        
        this.setupProgressBar();
        this.setupVolumeControl();
        this.setupContextMenu();
        this.setupDragDrop();
        this.setupKeyboardShortcuts();
        this.setupSearch();
        this.setupModeButtons();
        this.setupTheme();
        this.setupSlidePanel();
        this.setupVideo();
        this.setupTimingControls();
        this.setupFontControls();
        this.setupResizer();
        this.setupSortMenu();
        this.setupSelectionUi();
        this.setupPlaylists();
        this.setupDownloadPanel();
        this.setupVisibilityHandler();
        this.setupPlayerBarSizing();
        this.setupScrollbarTimeout();
        this.setupScrollPerformanceHints();
        this.setupSettings();
        this.setupSongContextMenuDelegation();
        this.loadSettings();
        this.applyLyricsVisibilityPreference();
        const volume = this.settings.volume || 1;
        this.audio.volume = volume;
        this.videoElement.volume = volume;
        this.updateVolumeDisplay(volume * 100);
    }

    async loadMusic() {
        if (this.selectionMode || this.selectedSongs.size > 0) {
            this.disableSelectionMode();
        }
        this.musicList.innerHTML = '<div id="songs"></div>';
        this.songsDiv = document.getElementById('songs');
        
        try {
            const musicFiles = await ipcRenderer.invoke('get-music-files');
            const videoFiles = await ipcRenderer.invoke('get-video-files') || [];
            const lyricsFiles = await ipcRenderer.invoke('get-lyrics-files');
            const lyricsFileSet = new Set(Array.isArray(lyricsFiles) ? lyricsFiles : []);
            
            // Combine music and video files
            const allFiles = [...musicFiles, ...videoFiles.map(video => ({
                ...video,
                isVideo: true
            }))];
            
            this.songs = allFiles.map((file, index) => {
                const song = {
                    ...file,
                    hasLyrics: !file.isVideo && (lyricsFileSet.has(file.baseName) || file.lyricsMatch !== null),
                    lyricsFile: file.lyricsMatch || file.baseName,
                    loadIndex: index // Track loading order
                };
                
                // Check if attached video still exists
                if (song.attachedVideo) {
                    ipcRenderer.invoke('file-exists', song.attachedVideo.path).then(exists => {
                        if (!exists) {
                            song.attachedVideo = null;
                            this.updateSongBadge(index, song.hasLyrics);
                        }
                    });
                }
                
                return song;
            });
            this.songSearchDocCache = new WeakMap();
            
            this.loadRatings();
            // Sort by rating on refresh
            this.songs.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            this.rebuildSongIndexLookup();
            

            
            // Restore current view state
            if (this.currentPlaylist) {
                this.loadPlaylist(this.currentPlaylist);
            } else {
                const categoryToApply = this.normalizeCategory(this.currentCategory || this.settings?.selectedCategory || 'all');
                this.currentCategory = categoryToApply;
                this.updateCategorySelectionUi(categoryToApply);
                this.applyCategoryView(categoryToApply);
            }
            
            this.showNotification(`Loaded ${this.songs.length} files`, 'success');
            
            // Resume last played song by finding it by name
            if (this.settings.resumeLastSong !== false && this.settings.lastSongName) {
                const songIndex = this.songs.findIndex(song => song.name === this.settings.lastSongName);
                if (songIndex >= 0) {
                    this.selectSong(songIndex, false); // false = don't auto-play
                    this.isPlaying = false;
                    this.playPauseImg.src = 'icons/play.png';
                    // Restore last playback position after audio loads
                    if (this.settings.lastCurrentTime) {
                        const resumeTime = this.settings.lastCurrentTime;
                        const resumeTransitionToken = this.mediaTransitionToken;
                        this.addOneTimeMediaListener(this.audio, 'loadedmetadata', () => {
                            this.audio.currentTime = resumeTime;
                            this.updateDuration();
                            this.updateProgress();
                            this.updateMediaSessionPositionState(true);
                        }, resumeTransitionToken);
                    }
                }
            }
            this.syncMediaSessionPlaybackState();
        } catch (error) {
            this.musicList.innerHTML = '<div id="songs"></div><p class="error">Error loading music</p>';
            this.songsDiv = document.getElementById('songs');
            this.showNotification('Error loading music files', 'error');
        }
    }

    rebuildSongIndexLookup() {
        this.songIndexLookup = new Map();
        if (!Array.isArray(this.songs)) return;

        this.songs.forEach((song, index) => {
            if (song) this.songIndexLookup.set(song, index);
        });
    }

    getSongIndexForSong(song) {
        if (!song) return -1;
        const idx = this.songIndexLookup?.get(song);
        if (Number.isInteger(idx)) return idx;
        return this.songs.indexOf(song);
    }

    displaySongs() {
        this.currentPlaylist = null;
        this.hidePlaylistDetails();
        this.filteredSongs = [...this.songs];
        this.displayFilteredSongs();
        this.renderQueuePanelIfVisible();
    }
    
    generateStars(rating) {
        let starsHtml = '';
        for (let i = 1; i <= 5; i++) {
            const filled = i <= rating;
            starsHtml += `<span class="star ${filled ? 'filled' : ''}" data-rating="${i}">★</span>`;
        }
        return starsHtml;
    }
    
    rateSong(songIndex, rating) {
        if (songIndex < 0 || songIndex >= this.songs.length) {
            console.error('Invalid song index:', songIndex);
            return;
        }
        if (rating === 0) {
            delete this.songs[songIndex].rating;
        } else {
            this.songs[songIndex].rating = rating;
        }
        this.saveRatings();
        
        // Update current song rating if it's the same song
        if (songIndex === this.currentSongIndex) {
            this.updateCurrentSongRating();
        }
    }
    
    saveRatings() {
        const ratings = {};
        this.songs.forEach((song, index) => {
            if (song.rating) {
                ratings[song.name] = song.rating;
            }
        });
        localStorage.setItem('vimusic-ratings', JSON.stringify(ratings));
    }
    
    loadRatings() {
        const saved = localStorage.getItem('vimusic-ratings');
        if (saved) {
            const ratings = JSON.parse(saved);
            this.songs.forEach(song => {
                if (ratings[song.name]) {
                    song.rating = ratings[song.name];
                }
            });
        }
    }
    
    displayEmptyState() {
        this.resetSongCoverRenderQueue();
        this.songsDiv.innerHTML = `
            <div class="empty-library">
                <div class="empty-icon">📁</div>
                <h3>No music folders added</h3>
                <p>Add your music folders to get started</p>
                <p class="sub-text">Right-click → "Add Music Folder" or use side panel button</p>
                <p class="sub-text">Supported: MP3, WAV, OGG, M4A, FLAC</p>
                <p class="sub-text">App will scan all subfolders automatically</p>
                <p class="sub-text">Add .lrc files in same folders for synchronized lyrics</p>
                <p class="sub-text tip">💡 Tip: Your music files stay in their original locations</p>
            </div>
        `;
    }

    displayContextEmptyState() {
        this.resetSongCoverRenderQueue();
        if (this.currentPlaylist) {
            this.songsDiv.innerHTML = `
                <div class="empty-library">
                    <div class="empty-icon">📋</div>
                    <h3>Empty Playlist</h3>
                    <p>This playlist has no songs yet</p>
                    <p class="sub-text">Right-click on songs to add them to this playlist</p>
                </div>
            `;
            return;
        }

        const category = this.normalizeCategory(this.currentCategory || 'all');
        if (category !== 'all') {
            const emptyCategoryMeta = {
                video: {
                    icon: '🎬',
                    title: 'No video songs found',
                    description: 'Add videos or attach videos to songs to see them here'
                },
                rated: {
                    icon: '⭐',
                    title: 'No rated songs yet',
                    description: 'Rate songs to populate this category'
                },
                recent: {
                    icon: '🕒',
                    title: 'No recently added songs',
                    description: 'Newly scanned tracks will appear here'
                }
            };
            const state = emptyCategoryMeta[category] || {
                icon: '🎵',
                title: 'No songs found',
                description: 'Try another category'
            };

            this.songsDiv.innerHTML = `
                <div class="empty-library">
                    <div class="empty-icon">${state.icon}</div>
                    <h3>${state.title}</h3>
                    <p>${state.description}</p>
                </div>
            `;
            return;
        }

        this.displayEmptyState();
    }

    async selectSong(index, autoPlay = true) {
        if (index < 0 || index >= this.songs.length) {
            console.error('Invalid song index:', index);
            return;
        }
        const selectionToken = ++this.songSelectionToken;
        const transitionToken = this.beginMediaTransition('select-song');
        if (this.previewMode) {
            this.previewMode = false;
            this.previewTrack = null;
            this.updatePreviewBar();
            this.setPreviewOptionState(false);
        }
        this.currentSongIndex = index;
        const song = this.songs[index];

        if (this.shuffleMode) {
            // If playback context changed while shuffling, regenerate once we land on a song within that context.
            if (this.pendingShuffleRegenerate) {
                const contextSongs = this.getContextSongs();
                if (Array.isArray(contextSongs) && contextSongs.includes(song)) {
                    this.generateShuffleQueue();
                    this.pendingShuffleRegenerate = false;
                }
            }

            // Ensure the currently playing song isn't present in the upcoming shuffle queue.
            if (Array.isArray(this.shuffleQueue) && this.shuffleQueue.length > 0) {
                const idx = this.shuffleQueue.indexOf(this.currentSongIndex);
                if (idx !== -1) this.shuffleQueue.splice(idx, 1);
            }
        }

        if (this.visualizer) {
            const seedInput = song.path || song.baseName || song.name || `${index}`;
            this.visualizer.setSeed(this.hashStringToSeed(seedInput));
        }
        
        // Save last played song by name instead of index
        this.settings.lastSongIndex = index;
        this.settings.lastSongName = song.name;
        this.saveSettings();
        
        // Update UI
        document.querySelectorAll('.song-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        
        // Stop any playing video to prevent dual audio
        this.suppressAutoResume();
        this.videoElement.pause();
        this.videoElement.src = '';

        // Cancel any in-flight crossfades and restore target volume
        if (this.crossfadeInterval) {
            clearInterval(this.crossfadeInterval);
            this.crossfadeInterval = null;
        }
        this.restorePlaybackVolume();
        
        // Always load music first with maximum quality
        this.audio.src = `file:///${song.path.replace(/\\/g, '/')}`;
        this.audio.muted = false;
        
        // Set preload based on gapless playback setting
        if (this.settings.gaplessPlayback) {
            this.audio.preload = 'auto';
        } else {
            this.audio.preload = 'metadata';
        }
        
        // Prepare video if available but don't show it
        if (song.isVideo) {
            this.videoElement.src = `file:///${song.path.replace(/\\/g, '/')}`;
        } else if (song.attachedVideo) {
            this.videoElement.src = `file:///${song.attachedVideo.path.replace(/\\/g, '/')}`;
        } else {
            this.videoElement.src = '';
        }
        
        // Check if video button is active (video mode preference)
        const videoModePreferred = this.videoBtn.classList.contains('active');
        const hasVideo = song.isVideo || song.attachedVideo || song.youtubeVideo;
        
        if (videoModePreferred && hasVideo) {
            // Video mode with video available
            if (song.youtubeVideo) {
                this.videoPlayer.innerHTML = `<iframe src="${song.youtubeVideo.url}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>`;
            }
            this.showVideoPlayer();
            this.isVideoMode = true;
            this.lyricsOffset = this.songOffsets[song.baseName] || 0;
        } else if (videoModePreferred && !hasVideo) {
            // Video mode preferred but no video - fall back to audio but keep video button active
            this.hideVideoPlayer();
            this.isVideoMode = false;
            this.lyricsOffset = 0;
        } else {
            // Normal audio mode
            this.hideVideoPlayer();
            this.isVideoMode = false;
            this.lyricsOffset = 0;
        }
        
        // Update details based on current mode
        this.updateSongDetails(song);
        void this.updateMediaSessionForSong(song);
        
        // Update album cover with memory leak fix
        if (this.currentImageUrl) {
            URL.revokeObjectURL(this.currentImageUrl);
            this.currentImageUrl = null;
        }
        
        // Show album cover if not in video mode OR if video is in main panel
        if (!this.isVideoMode || this.videoInMainPanel) {
            const coverContainer = this.albumCoverMedia || this.albumCover;
            if (song.picture) {
                const blob = new Blob([song.picture]);
                this.currentImageUrl = URL.createObjectURL(blob);
                coverContainer.innerHTML = '';
                this.albumCover.style.display = 'flex';
                this.albumCover.style.alignItems = 'center';
                this.albumCover.style.justifyContent = 'center';
                const img = document.createElement('img');
                img.src = this.currentImageUrl;
                img.alt = 'Album Cover';
                coverContainer.appendChild(img);
                this.updateVisualizerColorFromImageUrl(this.currentImageUrl);
            } else {
                coverContainer.innerHTML = '<div class="cover-placeholder">🎵</div>';
                this.albumCover.style.display = 'flex';
                this.albumCover.style.alignItems = 'center';
                this.albumCover.style.justifyContent = 'center';
                if (this.visualizer) this.visualizer.setColor(this.getDefaultVisualizerColor());
            }
            
            // Hide video player when showing album cover
            if (this.videoInMainPanel) {
                this.videoPlayer.style.display = 'none';
            }
        }
        
        this.setupAlbumCoverDragDrop();
        
        // Click handler is set in setupAlbumCoverDragDrop()
        
        // Send song info to floating window immediately
        ipcRenderer.send('update-floating-lyrics', {
            songInfo: {
                title: song.title,
                artist: song.artist
            },
            lyrics: [],
            currentIndex: -1
        });
        
        // Load lyrics (only for audio files)
        if (song.hasLyrics && !song.isVideo) {
            const lyricsText = await ipcRenderer.invoke('read-lyrics', song.lyricsFile);
            if (selectionToken !== this.songSelectionToken || !this.isMediaTransitionCurrent(transitionToken)) return;
            this.parseLyrics(lyricsText);
            ipcRenderer.send('update-floating-lyrics', {
                lyrics: this.lyrics,
                songInfo: {
                    title: song.title,
                    artist: song.artist
                }
            });
        } else {
            this.lyrics = [];
            this.lyricsDiv.innerHTML = `
                <div class="no-lyrics-container">
                    <p class="no-lyrics">No lyrics available</p>
                    <div class="lyrics-instructions">
                        <ul class="instruction-list">
                            <li>Add .lrc file to music folder</li>
                            <li>Right-click and paste synced lyrics</li>
                            <li><a href="#" onclick="player.searchMusicOnline()" style="color: #4a9eff; text-decoration: none;">Search for Lyrics Online</a></li>
                        </ul>
                        <p class="format-hint">Synced lyrics format: [00:12.34]Lyric text here</p>
                    </div>
                </div>
            `;
            this.setupLyricsDragDrop();
            this.setupLyricsKeyboardShortcut();
            ipcRenderer.send('update-floating-lyrics', {
                lyrics: [],
                songInfo: {
                    title: song.title,
                    artist: song.artist
                }
            });
        }
        
        this.enableControls();
        this.updateCurrentSongRating();
        
        // Preload next song for gapless playback
        if (this.settings.gaplessPlayback) {
            this.preloadNextSong();
        }
        
        // Start with appropriate mode
        if (this.isVideoMode) {
            if (!song.youtubeVideo) {
                this.videoElement.currentTime = 0;
                
                // Update main panel video if it's active
                if (this.videoInMainPanel && this.updateMainPanelVideo) {
                    const videoSrc = song.isVideo ? 
                        `file:///${song.path.replace(/\\/g, '/')}` : 
                        (song.attachedVideo ? `file:///${song.attachedVideo.path.replace(/\\/g, '/')}` : '');
                    
                    if (videoSrc) {
                        this.updateMainPanelVideo(videoSrc);
                    } else {
                        this.showNoVideoMessage();
                    }
                }
                
                if (autoPlay) {
                    this.playVideo();
                }
            }
        } else {
            this.audio.currentTime = 0;
            if (autoPlay) {
                this.play();
            }
        }

        this.updateMediaAvailabilityButtons(song);
        this.renderQueuePanelIfVisible();
        this.syncMediaSessionPlaybackState();
    }

    parseLyrics(text) {
        this.lyrics = [];
        if (!text) return;
        
        text.split('\n').forEach(line => {
            const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2})\](.*)/);
            if (match) {
                const time = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseInt(match[3], 10) / 100;
                const lyric = match[4].trim();
                this.lyrics.push({ time, text: lyric || ' ♪ ♪ ♪' });
            }
        });
        
        this.displayLyrics();
    }

    displayLyrics() {
        this.lyricsDiv.innerHTML = '';
        this.lyrics.forEach((lyric, index) => {
            const div = document.createElement('div');
            div.className = 'lyric-line';
            div.textContent = lyric.text;
            div.dataset.index = index;
            div.style.fontSize = `${this.lyricsFontSize}px`;
            div.onclick = () => this.seekToLyric(index);
            this.lyricsDiv.appendChild(div);
        });
    }

    enableControls() {
        this.playPauseBtn.disabled = false;
        this.prevBtn.disabled = false;
        this.nextBtn.disabled = false;
    }

    setPreviewOptionState(isPreview) {
        const controls = [
            this.lyricsToggleBtn,
            this.lyricsFontBtn,
            this.offsetToggleBtn,
            this.videoBtn,
            this.visualizerBtn,
            this.floatLyricsBtn
        ];

        controls.forEach(control => {
            if (!control) return;
            control.disabled = isPreview;
            control.classList.toggle('disabled', isPreview);
            if (isPreview) {
                control.style.opacity = '0.4';
            } else {
                control.style.opacity = '';
            }
        });

        if (isPreview) {
            if (this.lyricsFontControls) this.lyricsFontControls.style.display = 'none';
            if (this.lyricsFontBtn) this.lyricsFontBtn.classList.remove('active');
            if (this.lyricsTimingControls) this.lyricsTimingControls.style.display = 'none';
            if (this.offsetToggleBtn) this.offsetToggleBtn.classList.remove('active');
        }
    }

    togglePlayPause() {
        if (this.previewMode) {
            if (this.isPlaying) {
                this.pause();
            } else {
                this.play();
            }
            return;
        }
        if (this.currentSongIndex === -1) return;
        
        if (this.isPlaying) {
            if (this.isVideoMode) {
                this.pauseVideo();
            } else {
                this.pause();
            }
        } else {
            if (this.isVideoMode) {
                this.playVideo();
            } else {
                this.play();
            }
        }
    }
    
    play() {
        const transitionToken = this.beginMediaTransition('play-audio');
        // Ensure video is completely stopped
        this.suppressAutoResume();
        this.videoElement.pause();
        this.videoElement.src = '';
        
        this.initializeAudioContext();
        this.resumeAudioContext();

        const targetVolume = this.restorePlaybackVolume();
        
        const crossfadeDuration = this.settings.crossfadeDuration || 0;
        
        if (crossfadeDuration > 0) {
            this.originalVolume = targetVolume;
            this.audio.volume = 0;
            this.applyCrossfadeIn(crossfadeDuration);
        }
        
        this.audio.play().catch(error => {
            if (!this.isMediaTransitionCurrent(transitionToken)) return;
            console.error('Playback failed:', error);
            this.isPlaying = false;
            this.playPauseImg.src = 'icons/play.png';
            this.stopVisualizer();
            this.syncMediaSessionPlaybackState();
        });
        this.isPlaying = true;
        this.playPauseImg.src = 'icons/pause.png';
        this.startVisualizer();
        this.syncMediaSessionPlaybackState();
        this.startProgressSync();
    }

    pause() {
        this.beginMediaTransition('pause-audio');
        this.suppressAutoResume();
        this.audio.pause();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
        this.stopVisualizer();
        this.syncMediaSessionPlaybackState();
        this.stopProgressSync();
        
        // Clear crossfade interval
        if (this.crossfadeInterval) {
            clearInterval(this.crossfadeInterval);
            this.crossfadeInterval = null;
        }
    }
    
    playVideo() {
        const transitionToken = this.beginMediaTransition('play-video');
        // Ensure audio is completely stopped
        this.suppressAutoResume();
        this.audio.pause();
        this.audio.src = '';
        if (this.videoInMainPanel || !this.isVisualizerViewActive) {
            this.stopVisualizer();
        }
        
        if (this.videoElement.readyState >= 2) {
            this.videoElement.play().catch(error => {
                if (!this.isMediaTransitionCurrent(transitionToken)) return;
                console.error('Video playback failed:', error);
                this.isPlaying = false;
                this.playPauseImg.src = 'icons/play.png';
                this.syncMediaSessionPlaybackState();
            });
            this.isPlaying = true;
            this.playPauseImg.src = 'icons/pause.png';
            this.startVisualizer();
            this.syncMediaSessionPlaybackState();
            this.startProgressSync();
        } else {
            this.videoElement.load();
            this.addOneTimeMediaListener(this.videoElement, 'canplay', () => {
                if (!this.isMediaTransitionCurrent(transitionToken)) return;
                this.videoElement.play();
                this.isPlaying = true;
                this.playPauseImg.src = 'icons/pause.png';
                this.startVisualizer();
                this.syncMediaSessionPlaybackState();
                this.startProgressSync();
            }, transitionToken);
        }
    }
    
    pauseVideo() {
        this.beginMediaTransition('pause-video');
        this.suppressAutoResume();
        this.videoElement.pause();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
        this.stopVisualizer();
        this.syncMediaSessionPlaybackState();
        this.stopProgressSync();
    }
    
    showVideoPlayer() {
        this.albumCover.style.display = 'none';
        this.videoPlayer.style.display = 'block';
        this.isVideoMode = true;
        this.videoBtn.classList.add('active');
    }
    
    hideVideoPlayer() {
        this.albumCover.style.display = 'flex';
        this.albumCover.style.alignItems = 'center';
        this.albumCover.style.justifyContent = 'center';
        this.videoPlayer.style.display = 'none';
        this.isVideoMode = false;
        this.videoBtn.classList.remove('active');
    }
    
    playPrevious(manual = false) {
        if (this.previewMode) {
            this.stopPreviewPlayback();
            return;
        }
        if (this.shuffleMode) {
            const prevIndex = this.getPreviousShuffleSong();
            this.selectSong(prevIndex);
        } else {
            const prevIndex = this.getPreviousSongInContext();
            if (prevIndex !== null) {
                this.selectSong(prevIndex);
            }
        }
    }

    playNext(manual = false) {
        if (this.previewMode) {
            this.stopPreviewPlayback();
            return;
        }
        // Skip repeat one logic if manually clicked
        if (this.repeatMode === 'one' && !manual) {
            if (this.isVideoMode) {
                if (this.videoElement && this.videoElement.src) {
                    this.videoElement.currentTime = 0;
                    this.playVideo();
                } else {
                    this.audio.currentTime = 0;
                    this.play();
                }
            } else {
                this.audio.currentTime = 0;
                this.play();
            }
            return;
        }
        
        // Check queue first (but not for manual clicks)
        if (this.queue.length > 0 && !manual) {
            const nextIndex = this.queue.shift();
            this.selectSong(nextIndex);
            return;
        }
        
        let nextIndex;
        
        if (this.shuffleMode) {
            nextIndex = this.getNextShuffleSong();
        } else {
            nextIndex = this.getNextSongInContext();
        }
        
        if (nextIndex !== null) {
            this.selectSong(nextIndex);
        }
    }

    updateTime() {
        const currentTime = this.isVideoMode ? this.videoElement.currentTime : this.audio.currentTime;
        const duration = this.isVideoMode ? this.videoElement.duration || 0 : this.audio.duration || 0;
        
        const currentMinutes = Math.floor(currentTime / 60);
        const currentSeconds = Math.floor(currentTime % 60);
        const totalMinutes = Math.floor(duration / 60);
        const totalSeconds = Math.floor(duration % 60);
        
        this.timeDisplay.textContent = `${currentMinutes.toString().padStart(2, '0')}:${currentSeconds.toString().padStart(2, '0')} / ${totalMinutes.toString().padStart(2, '0')}:${totalSeconds.toString().padStart(2, '0')}`;
        
        // Handle crossfade out (only when actively playing)
        if (this.isPlaying) {
            const crossfadeDuration = this.settings.crossfadeDuration || 0;
            if (crossfadeDuration > 0 && duration > 0 && !this.isVideoMode) {
                const timeLeft = duration - currentTime;
                if (timeLeft <= crossfadeDuration && timeLeft > 0 && !this.crossfadeInterval) {
                    this.applyCrossfadeOut(timeLeft);
                }
            }
        }
        
        // Save current time with throttling (skip previews)
        if (!this.previewMode) {
            this.settings.lastCurrentTime = currentTime;
            if (!this.saveSettingsTimeout) {
                this.saveSettingsTimeout = setTimeout(() => {
                    this.saveSettings();
                    this.saveSettingsTimeout = null;
                }, 1000);
            }
        }
        
        this.updateProgress();
        this.highlightLyrics(currentTime);
        this.updateMediaSessionPositionState();
    }

    startProgressSync() {
        if (this.progressSyncInterval) return;
        this.progressSyncInterval = setInterval(() => {
            this.syncPlaybackProgress();
        }, this.progressSyncIntervalMs);
    }

    stopProgressSync() {
        if (!this.progressSyncInterval) return;
        clearInterval(this.progressSyncInterval);
        this.progressSyncInterval = null;
    }

    syncPlaybackProgress(force = false) {
        const media = this.isVideoMode ? this.videoElement : this.audio;
        if (!media) return;

        const isDragging = typeof this.isProgressDragging === 'function' && this.isProgressDragging();
        const duration = media.duration;
        const currentTime = media.currentTime;

        if (!this.previewMode && this.isPlaying && !isDragging) {
            const ended =
                media.ended ||
                (Number.isFinite(duration) && duration > 0 && currentTime >= duration - 0.05);
            if (ended) {
                const now = Date.now();
                if (now - this.lastEndedEventAt > 500) {
                    this.lastEndedEventAt = now;
                    this.playNext();
                }
                return;
            }
        }

        if (force || this.isPlaying) {
            this.updateTime();
        }
    }

    resumeAudioContext() {
        if (!this.audioContext || typeof this.audioContext.resume !== 'function') return;
        if (this.audioContext.state === 'running') return;
        this.audioContext.resume().catch(() => {});
    }

    getDesiredVolume() {
        const raw = Number.isFinite(this.settings?.volume) ? this.settings.volume : this.audio.volume;
        if (!Number.isFinite(raw)) return 1;
        return Math.max(0, Math.min(1, raw));
    }

    restorePlaybackVolume() {
        const volume = this.getDesiredVolume();
        this.audio.volume = volume;
        this.videoElement.volume = volume;
        this.originalVolume = volume;
        return volume;
    }

    updateDuration() {
        const duration = this.isVideoMode ? this.videoElement.duration : this.audio.duration;
        if (this.previewMode && this.previewTrack) {
            const fallback = this.previewTrack.duration || 0;
            const display = Number.isFinite(duration) && duration > 0 ? duration : fallback;
            this.detailDuration.textContent = this.formatDuration(display);
            return;
        }

        const currentSong = this.songs[this.currentSongIndex];
        if (!currentSong) return;
        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60);
        this.detailDuration.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    updateProgress() {
        const currentTime = this.isVideoMode ? this.videoElement.currentTime : this.audio.currentTime;
        const duration = this.isVideoMode ? this.videoElement.duration : this.audio.duration;
        
        if (!duration || this.isProgressDragging()) return;
        const percent = (currentTime / duration) * 100;
        this.progressFill.style.width = `${percent}%`;
        this.progressHandle.style.left = `${percent}%`;
    }

    highlightLyrics(currentTime) {
        if (this.lyrics.length === 0) return;
        
        // Apply offset for video mode
        const adjustedTime = this.isVideoMode ? currentTime + (this.lyricsOffset / 1000) : currentTime;
        
        // Binary search for better performance with large lyrics
        let newIndex = -1;
        let left = 0;
        const maxIndex = this.lyrics.length - 1; // Cache length calculation
        let right = maxIndex;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (this.lyrics[mid].time <= adjustedTime) {
                newIndex = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        if (newIndex !== this.currentLyricIndex) {
            this.clearLyricHighlight();
            this.currentLyricIndex = newIndex;
            
            if (this.currentLyricIndex >= 0) {
                const line = this.lyricsDiv.querySelector(`[data-index="${this.currentLyricIndex}"]`);
                if (line) {
                    line.classList.add('active');
                    line.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    ipcRenderer.send('update-floating-lyrics', {
                        currentIndex: this.currentLyricIndex
                    });
                }
            }
        }
    }

    clearLyricHighlight() {
        const active = this.lyricsDiv.querySelector('.active');
        if (active) active.classList.remove('active');
    }

    setupProgressBar() {
        let isProgressDragging = false;
        
        const updateProgress = (e) => {
            const rect = this.progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const duration = this.isVideoMode ? this.videoElement.duration : this.audio.duration;
            const newTime = percent * duration;
            
            this.progressFill.style.width = `${percent * 100}%`;
            this.progressHandle.style.left = `${percent * 100}%`;
            
            if (this.isVideoMode) {
                this.videoElement.currentTime = newTime;
            } else {
                this.audio.currentTime = newTime;
            }
        };
        
        const handleProgressMove = (e) => {
            if (isProgressDragging && this.audio.duration) {
                updateProgress(e);
            }
        };
        
        const handleProgressUp = () => {
            if (isProgressDragging) {
                isProgressDragging = false;
                document.removeEventListener('mousemove', handleProgressMove);
                document.removeEventListener('mouseup', handleProgressUp);
            }
        };

        const cancelProgressDrag = () => {
            if (isProgressDragging) {
                handleProgressUp();
            }
        };

        window.addEventListener('blur', cancelProgressDrag);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) cancelProgressDrag();
        });
        
        this.progressBar.onmousedown = (e) => {
            const duration = this.isVideoMode ? this.videoElement.duration : this.audio.duration;
            if (!duration) return;
            isProgressDragging = true;
            updateProgress(e);
            document.addEventListener('mousemove', handleProgressMove);
            document.addEventListener('mouseup', handleProgressUp);
        };
        
        // Store dragging state for updateProgress method
        this.isProgressDragging = () => isProgressDragging;
    }
    
    updateCurrentSongRating() {
        if (this.currentSongIndex < 0) {
            this.starRatingCurrent.innerHTML = '';
            return;
        }
        
        const song = this.songs[this.currentSongIndex];
        const rating = song.rating || 0;
        
        // Remove existing handlers to prevent memory leaks
        if (this.starRatingCurrent.onmouseleave) {
            this.starRatingCurrent.onmouseleave = null;
        }
        
        this.starRatingCurrent.innerHTML = this.generateStars(rating);
        
        // Add event handlers for current song rating
        const stars = this.starRatingCurrent.querySelectorAll('.star');
        
        stars.forEach((star, starIndex) => {
            let clickCount = 0;
            let clickTimer = null;
            
            star.onclick = (e) => {
                e.stopPropagation();
                
                if (starIndex === 0) {
                    const currentRating = song.rating || 0;
                    
                    if (currentRating === 1) {
                        this.rateSong(this.currentSongIndex, 0);
                    } else if (currentRating > 1) {
                        clickCount++;
                        
                        if (clickCount === 1) {
                            clickTimer = setTimeout(() => {
                                this.rateSong(this.currentSongIndex, 1);
                                clickCount = 0;
                            }, 300);
                        } else if (clickCount === 2) {
                            clearTimeout(clickTimer);
                            this.rateSong(this.currentSongIndex, 0);
                            clickCount = 0;
                        }
                    } else {
                        this.rateSong(this.currentSongIndex, 1);
                    }
                } else {
                    this.rateSong(this.currentSongIndex, starIndex + 1);
                }
            };
            
            star.onmouseenter = () => {
                stars.forEach((s, i) => {
                    if (i <= starIndex) {
                        s.style.color = '#ffd700';
                        s.style.transform = 'scale(1.4)';
                    } else {
                        s.style.color = '#2a2a2a';
                        s.style.transform = 'scale(1)';
                    }
                });
            };
        });
        
        this.starRatingCurrent.onmouseleave = () => {
            stars.forEach((s, i) => {
                s.style.color = i < rating ? '#ffd700' : '#2a2a2a';
                s.style.transform = 'scale(1)';
            });
        };
    }

    setupVolumeControl() {
        let isVolumeDragging = false;
        
        const updateVolume = (e) => {
            const rect = this.volumeBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this.audio.volume = percent;
            this.videoElement.volume = percent;
            this.updateVolumeDisplay(percent * 100);
        };
        
        const handleVolumeMove = (e) => {
            if (isVolumeDragging) updateVolume(e);
        };
        
        const handleVolumeUp = () => {
            if (isVolumeDragging) {
                isVolumeDragging = false;
                document.removeEventListener('mousemove', handleVolumeMove);
                document.removeEventListener('mouseup', handleVolumeUp);
            }
        };
        
        this.volumeBar.onmousedown = (e) => {
            isVolumeDragging = true;
            updateVolume(e);
            document.addEventListener('mousemove', handleVolumeMove);
            document.addEventListener('mouseup', handleVolumeUp);
        };
        
        this.volumeBar.onwheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const newVolume = Math.max(0, Math.min(1, this.audio.volume + delta));
            this.audio.volume = newVolume;
            this.videoElement.volume = newVolume;
            this.updateVolumeDisplay(newVolume * 100);
        };
    }

    updateVolumeDisplay(volume) {
        this.volumeFill.style.width = `${volume}%`;
        this.volumeHandle.style.left = `${volume}%`;
        this.volumePercent.textContent = `${Math.round(volume)}%`;
        
        // Update volume icon based on level
        if (volume === 0) {
            this.volumeIcon.src = 'icons/0.png';
        } else if (volume <= 10) {
            this.volumeIcon.src = 'icons/10.png';
        } else if (volume <= 40) {
            this.volumeIcon.src = 'icons/40.png';
        } else if (volume <= 70) {
            this.volumeIcon.src = 'icons/70.png';
        } else {
            this.volumeIcon.src = 'icons/100.png';
        }
        
        // Save volume setting
        this.settings.volume = this.audio.volume;
        this.saveSettings();
    }
    
    openFloatingLyrics() {
        if (this.floatLyricsBtn?.disabled) {
            this.showNotification('No lyrics available for this song', 'info');
            return;
        }
        // Check if floating window exists, if so close it
        ipcRenderer.invoke('is-floating-window-open').then(isOpen => {
            if (isOpen) {
                ipcRenderer.send('close-floating-lyrics');
                this.floatLyricsBtn.classList.remove('active');
            } else {
                ipcRenderer.send('create-floating-lyrics');
                this.floatLyricsBtn.classList.add('active');
                
                // Send current lyrics and position immediately
                if (this.lyrics.length > 0) {
                    ipcRenderer.send('update-floating-lyrics', {
                        lyrics: this.lyrics
                    });
                    
                    if (this.currentLyricIndex >= 0) {
                        ipcRenderer.send('update-floating-lyrics', {
                            currentIndex: this.currentLyricIndex
                        });
                    }
                }
            }
        });
    }
    
    setupContextMenu() {
        // Cache context menus for centralized open/close behavior
        this.contextMenus = Array.from(document.querySelectorAll('.context-menu'));
        this.activeContextMenu = null;
        this.submenuStates = new WeakMap();

        // Prevent native context menu inside custom menus
        this.contextMenus.forEach(menu => {
            menu.addEventListener('contextmenu', (e) => e.preventDefault());
            this.setupSubmenuHoverIntent(menu);
        });

        // Submenu overflow handling (flip/fit within viewport)
        document.querySelectorAll('.context-menu .submenu-parent').forEach(parent => {
            const adjust = () => this.adjustSubmenuPosition(parent);
            parent.addEventListener('mouseenter', adjust);
            parent.addEventListener('focusin', adjust);
        });

        // Close menus on outside interaction
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideAllContextMenus();
            }
        }, { capture: true });

        // Close menus on Escape
        document.addEventListener('keydown', (e) => {
            if (!this.activeContextMenu) return;

            const key = e.key;

            if (key === 'Escape') {
                e.preventDefault();
                this.hideAllContextMenus();
                return;
            }

            if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) return;

            const menu = this.activeContextMenu;
            if (!menu.classList.contains('is-open')) return;

            const items = this.getContextMenuItems(menu);
            if (items.length === 0) return;

            const active = document.activeElement;
            let index = items.indexOf(active);
            if (index === -1) index = 0;

            e.preventDefault();
            e.stopPropagation();

            if (key === 'ArrowDown') {
                items[(index + 1) % items.length].focus();
            } else if (key === 'ArrowUp') {
                items[(index - 1 + items.length) % items.length].focus();
            } else if (key === 'Home') {
                items[0].focus();
            } else if (key === 'End') {
                items[items.length - 1].focus();
            } else if (key === 'Enter' || key === ' ') {
                const el = items[index];
                if (el && typeof el.click === 'function') el.click();
            }
        }, { capture: true });

        // Close menus when window focus/layout changes
        window.addEventListener('blur', () => this.hideAllContextMenus());
        window.addEventListener('resize', () => this.hideAllContextMenus());
        
        document.getElementById('addMusic').onclick = async () => {
            const result = await ipcRenderer.invoke('browse-music-folders');
            if (result && !result.canceled && result.filePaths.length > 0) {
                const count = await ipcRenderer.invoke('add-music-folders', result.filePaths);
                if (count > 0) {
                    this.showNotification(`Added ${count} music folder(s)`, 'success');
                    await this.loadMusic();
                } else {
                    this.showNotification('Folders already added', 'info');
                }
            }
            this.hideContextMenu();
        };
        
        document.getElementById('addVideo').onclick = async () => {
            const result = await ipcRenderer.invoke('browse-video-files');
            if (result && !result.canceled && result.filePaths.length > 0) {
                await this.handleFileAdd(result.filePaths.map(path => ({path})), 'video');
            }
            this.hideContextMenu();
        };
        
        document.getElementById('addLyrics').onclick = async () => {
            const result = await ipcRenderer.invoke('browse-lyrics-files');
            if (result && !result.canceled && result.filePaths.length > 0) {
                await this.handleFileAdd(result.filePaths.map(path => ({path})), 'lyrics');
            }
            this.hideContextMenu();
        };
        
        document.getElementById('viewFolder').onclick = () => {
            ipcRenderer.send('open-folder');
            this.hideContextMenu();
        };
        
        // Legacy HTML file inputs - kept for compatibility but not used
        if (this.musicFileInput) this.musicFileInput.onchange = (e) => this.handleFileAdd(e.target.files, 'music');
        if (this.videoFileInput) this.videoFileInput.onchange = (e) => this.handleFileAdd(e.target.files, 'video');
        if (this.lyricsFileInput) this.lyricsFileInput.onchange = (e) => this.handleFileAdd(e.target.files, 'lyrics');
        
        // Song context menu handlers
        document.getElementById('addToQueue').onclick = () => {
            const menu = document.getElementById('songContextMenu');
            const isMulti = menu?.dataset.mode === 'multi';
            if (isMulti) {
                this.addSelectedToQueue();
            } else {
                this.addToQueue();
            }
        };
        document.getElementById('enableSelection').onclick = () => {
            const menu = document.getElementById('songContextMenu');
            const idx = menu ? Number(menu.dataset.songIndex) : NaN;
            if (Number.isInteger(idx)) {
                this.enableSelectionMode(idx, { keepExisting: false, showNotification: true, hideMenu: true });
            } else {
                this.enableSelectionMode();
            }
        };
        document.getElementById('removeFromPlaylist').onclick = () => this.removeFromPlaylist();
        document.getElementById('removeLyrics').onclick = () => {
            const menu = document.getElementById('songContextMenu');
            const isMulti = menu?.dataset.mode === 'multi';
            if (isMulti) {
                this.removeLyricsForSelection();
            } else {
                this.removeLyrics();
            }
        };
        document.getElementById('viewInFolder').onclick = () => {
            const menu = document.getElementById('songContextMenu');
            const isMulti = menu?.dataset.mode === 'multi';
            if (!isMulti) this.viewInFolder();
        };
        document.getElementById('deleteSong').onclick = () => {
            const menu = document.getElementById('songContextMenu');
            const isMulti = menu?.dataset.mode === 'multi';
            if (isMulti) {
                this.deleteSelectedSongs();
            } else {
                this.deleteSong();
            }
        };
        

        
        // Remove video handler is now in HTML
        document.getElementById('removeVideo').onclick = () => {
            const menu = document.getElementById('songContextMenu');
            const isMulti = menu?.dataset.mode === 'multi';
            if (isMulti) {
                this.removeVideosForSelection();
            } else {
                this.removeVideo();
            }
        };
        
        // Lyrics context menu handlers
        document.getElementById('pasteLyrics').onclick = () => this.pasteLyrics();
        
        // Playlist context menu handlers
        document.getElementById('editPlaylist').onclick = () => this.editPlaylist();
        document.getElementById('mergePlaylist').onclick = () => this.mergePlaylist();
        document.getElementById('pinPlaylist').onclick = () => this.pinPlaylist();
        document.getElementById('deletePlaylist').onclick = () => this.deletePlaylistFromMenu();
        
        // Video context menu handlers
        document.getElementById('playInMainPanel').onclick = () => this.playVideoInMainPanel();
        document.getElementById('playFullScreen').onclick = () => this.playVideoFullScreen();
        
        // Main panel video context menu handlers
        document.getElementById('switchBackToMiniPlayer').onclick = () => this.switchBackToMiniPlayer();
        document.getElementById('mainPanelFullScreen').onclick = () => this.playVideoFullScreen();
    }

    adjustSubmenuPosition(submenuParent) {
        const submenu = submenuParent?.querySelector('.submenu');
        if (!submenu) return;

        submenuParent.classList.remove('submenu-left');
        submenu.style.maxHeight = '';
        submenu.style.top = '';

        requestAnimationFrame(() => {
            const margin = 8;
            const parentRect = submenuParent.getBoundingClientRect();
            const submenuWidth = submenu.offsetWidth;
            const rawHeight = submenu.scrollHeight;
            const availableHeight = Math.max(120, window.innerHeight - margin * 2);
            const effectiveHeight = Math.min(rawHeight, availableHeight);

            const shouldFlip = parentRect.right + submenuWidth > window.innerWidth - margin;
            submenuParent.classList.toggle('submenu-left', shouldFlip);

            submenu.style.maxHeight = `${Math.round(availableHeight)}px`;

            let desiredTop = parentRect.top;
            desiredTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - margin - effectiveHeight));
            submenu.style.top = `${Math.round(desiredTop - parentRect.top)}px`;
        });
    }

    hideAllContextMenus(exceptMenu = null) {
        const menus = this.contextMenus || Array.from(document.querySelectorAll('.context-menu'));
        menus.forEach(menu => {
            if (menu !== exceptMenu) this.closeContextMenu(menu);
        });
    }

    getContextMenuItems(menuEl) {
        if (!menuEl) return [];
        const items = Array.from(menuEl.querySelectorAll(':scope > .menu-item'));
        return items.filter(item => {
            if (item.classList.contains('disabled')) return false;
            if (item.hidden) return false;
            if (item.style.display === 'none') return false;
            return true;
        });
    }

    openContextMenu(menuEl, x, y, options = {}) {
        if (!menuEl) return;

        this.hideAllContextMenus(menuEl);
        this.preContextMenuFocus = document.activeElement;

        // Ensure the menu can be measured even if legacy code hid it with display: none
        menuEl.style.display = 'block';

        // Clear any submenu flip class from previous opens
        menuEl.querySelectorAll('.submenu-parent').forEach(parent => {
            parent.classList.remove('submenu-left');
            const submenu = parent.querySelector('.submenu');
            if (submenu) {
                submenu.style.maxHeight = '';
                submenu.style.top = '';
            }
        });

        const margin = 8;
        const menuWidth = menuEl.offsetWidth;
        const menuHeight = menuEl.offsetHeight;
        const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
        const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);
        const adjustedX = Math.max(margin, Math.min(x, maxX));
        const adjustedY = Math.max(margin, Math.min(y, maxY));

        menuEl.style.left = `${adjustedX}px`;
        menuEl.style.top = `${adjustedY}px`;
        menuEl.classList.add('is-open');
        menuEl.setAttribute('aria-hidden', 'false');
        this.activeContextMenu = menuEl;
        this.closeAllSubmenus(menuEl);

        if (options.focusFirst) {
            // Focus first available item for keyboard navigation
            requestAnimationFrame(() => {
                const items = this.getContextMenuItems(menuEl);
                const first = items.find(item => !item.classList.contains('submenu-parent')) || items[0];
                if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
            });
        }
    }

    closeContextMenu(menuEl) {
        if (!menuEl) return;
        this.closeAllSubmenus(menuEl);
        menuEl.classList.remove('is-open');
        menuEl.setAttribute('aria-hidden', 'true');
        if (this.activeContextMenu === menuEl) {
            this.activeContextMenu = null;
            const restore = this.preContextMenuFocus;
            this.preContextMenuFocus = null;
            if (restore && restore !== document.body && typeof restore.focus === 'function') {
                restore.focus({ preventScroll: true });
            }
        }
    }

    setupSubmenuHoverIntent(menuEl) {
        if (!menuEl) return;
        const state = {
            mouseLocs: [],
            activeParent: null,
            closeTimer: null
        };
        this.submenuStates.set(menuEl, state);

        const track = (e) => {
            state.mouseLocs.push({ x: e.clientX, y: e.clientY });
            if (state.mouseLocs.length > 4) state.mouseLocs.shift();
        };

        menuEl.addEventListener('pointermove', track);

        menuEl.querySelectorAll('.submenu-parent').forEach(parent => {
            const submenu = parent.querySelector('.submenu');
            if (!submenu) return;

            const open = () => this.openSubmenu(parent, menuEl);
            const scheduleClose = () => this.scheduleSubmenuClose(parent, menuEl);
            const cancelClose = () => this.cancelSubmenuClose(menuEl);

            parent.addEventListener('pointerenter', open);
            parent.addEventListener('focusin', open);
            parent.addEventListener('pointerleave', scheduleClose);
            parent.addEventListener('focusout', scheduleClose);

            submenu.addEventListener('pointerenter', cancelClose);
            submenu.addEventListener('pointerleave', scheduleClose);
        });
    }

    openSubmenu(parent, menuEl) {
        if (!parent || !menuEl) return;
        const state = this.submenuStates.get(menuEl);
        if (!state) return;

        if (state.activeParent && state.activeParent !== parent) {
            state.activeParent.classList.remove('submenu-open');
        }
        state.activeParent = parent;
        parent.classList.add('submenu-open');
        this.cancelSubmenuClose(menuEl);
        this.adjustSubmenuPosition(parent);
    }

    closeAllSubmenus(menuEl) {
        if (!menuEl) return;
        const state = this.submenuStates.get(menuEl);
        if (state) {
            this.cancelSubmenuClose(menuEl);
            state.activeParent = null;
        }
        menuEl.querySelectorAll('.submenu-parent.submenu-open').forEach(parent => {
            parent.classList.remove('submenu-open');
        });
    }

    scheduleSubmenuClose(parent, menuEl) {
        const state = this.submenuStates.get(menuEl);
        if (!state || !parent) return;

        const delay = this.getSubmenuActivationDelay(menuEl, parent);
        this.cancelSubmenuClose(menuEl);

        state.closeTimer = setTimeout(() => {
            parent.classList.remove('submenu-open');
            if (state.activeParent === parent) state.activeParent = null;
        }, delay);
    }

    cancelSubmenuClose(menuEl) {
        const state = this.submenuStates.get(menuEl);
        if (state && state.closeTimer) {
            clearTimeout(state.closeTimer);
            state.closeTimer = null;
        }
    }

    getSubmenuActivationDelay(menuEl, parent) {
        const state = this.submenuStates.get(menuEl);
        if (!state || !parent) return 0;

        const submenu = parent.querySelector('.submenu');
        if (!submenu) return 0;

        const locs = state.mouseLocs;
        if (locs.length < 2) return 0;

        const curr = locs[locs.length - 1];
        const prev = locs[locs.length - 2];

        const parentRect = parent.getBoundingClientRect();
        const submenuRect = submenu.getBoundingClientRect();
        const tolerance = 10;

        // If cursor is inside submenu or the bridge corridor, keep open without delay.
        if (this.pointInRect(curr, submenuRect) || this.pointInCorridor(curr, parentRect, submenuRect, tolerance)) {
            return 250;
        }

        const submenuOnRight = !parent.classList.contains('submenu-left');
        const upper = {
            x: submenuOnRight ? submenuRect.left : submenuRect.right,
            y: submenuRect.top - tolerance
        };
        const lower = {
            x: submenuOnRight ? submenuRect.left : submenuRect.right,
            y: submenuRect.bottom + tolerance
        };

        const movingToward = this.isMovingTowardSubmenu(prev, curr, upper, lower);
        return movingToward ? 250 : 80;
    }

    pointInRect(point, rect) {
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    }

    pointInCorridor(point, parentRect, submenuRect, pad) {
        const left = Math.min(parentRect.right, submenuRect.left) - pad;
        const right = Math.max(parentRect.right, submenuRect.left) + pad;
        const top = Math.min(parentRect.top, submenuRect.top) - pad;
        const bottom = Math.max(parentRect.bottom, submenuRect.bottom) + pad;
        return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    }

    isMovingTowardSubmenu(prev, curr, upper, lower) {
        const slope = (a, b) => {
            if (b.x === a.x) return b.y > a.y ? Infinity : -Infinity;
            return (b.y - a.y) / (b.x - a.x);
        };
        const prevUpper = slope(prev, upper);
        const prevLower = slope(prev, lower);
        const currUpper = slope(curr, upper);
        const currLower = slope(curr, lower);
        return currUpper < prevUpper && currLower > prevLower;
    }
    
    setupDragDrop() {
        this.leftPanel.ondragover = (e) => {
            e.preventDefault();
            this.leftPanel.classList.add('drag-over');
        };
        
        this.leftPanel.ondragleave = (e) => {
            e.preventDefault();
            this.leftPanel.classList.remove('drag-over');
        };
        
        this.leftPanel.ondrop = (e) => {
            e.preventDefault();
            this.leftPanel.classList.remove('drag-over');
            this.handleFileDrop(e.dataTransfer.files);
        };
    }
    
    setupLyricsDragDrop() {
        this.lyricsDiv.ondragover = (e) => {
            e.preventDefault();
            this.lyricsDiv.classList.add('drag-over');
        };
        
        this.lyricsDiv.ondragleave = (e) => {
            e.preventDefault();
            this.lyricsDiv.classList.remove('drag-over');
        };
        
        this.lyricsDiv.ondrop = (e) => {
            e.preventDefault();
            this.lyricsDiv.classList.remove('drag-over');
            this.handleLyricsDrop(e.dataTransfer.files);
        };
        
        // Add right-click context menu for lyrics panel
        this.lyricsDiv.oncontextmenu = (e) => {
            if (this.currentSongIndex >= 0 && !this.songs[this.currentSongIndex].hasLyrics) {
                e.preventDefault();
                this.showLyricsContextMenu(e.clientX, e.clientY);
            }
        };
    }
    
    setupLyricsKeyboardShortcut() {
        this.lyricsDiv.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'v' && this.currentSongIndex >= 0 && !this.songs[this.currentSongIndex].hasLyrics) {
                e.preventDefault();
                this.pasteLyrics();
            }
        });
        
        // Make lyrics div focusable for keyboard events
        this.lyricsDiv.tabIndex = 0;
    }
    
    async handleLyricsDrop(files) {
        const lrcFiles = Array.from(files).filter(file => file.name.endsWith('.lrc'));
        if (lrcFiles.length === 0) {
            this.showNotification('Please drop a .lrc file', 'error');
            return;
        }
        if (this.currentSongIndex < 0) {
            this.showNotification('Please select a song first', 'error');
            return;
        }
        
        const song = this.songs[this.currentSongIndex];
        this.showNotification('Adding lyrics...', 'info');
        
        try {
            const success = await ipcRenderer.invoke('add-song-lyrics', song.baseName, lrcFiles[0].path);
            if (success) {
                this.showNotification('Lyrics added successfully', 'success');
                this.loadMusic();
                // Reload current song to show new lyrics
                setTimeout(() => {
                    this.selectSong(this.currentSongIndex, false);
                }, 100);
            } else {
                this.showNotification('Failed to add lyrics', 'error');
            }
        } catch (error) {
            this.showNotification('Error adding lyrics', 'error');
        }
    }
    
    showContextMenu(x, y) {
        this.openContextMenu(this.contextMenu, x, y);
    }
    
    hideContextMenu() {
        this.closeContextMenu(this.contextMenu);
    }
    
    showSongContextMenu(x, y, songIndex, options = {}) {
        const { forceMulti = false } = options;
        if (songIndex < 0 || songIndex >= this.songs.length) {
            console.error('Invalid song index for context menu:', songIndex);
            return;
        }
        this.selectedSongIndex = songIndex;
        const song = this.songs[songIndex];
        const songContextMenu = document.getElementById('songContextMenu');
        if (songContextMenu) songContextMenu.dataset.songIndex = String(songIndex);
        const addToQueueBtn = document.getElementById('addToQueue');
        const removeLyricsBtn = document.getElementById('removeLyrics');
        const removeVideoBtn = document.getElementById('removeVideo');
        const viewInFolderBtn = document.getElementById('viewInFolder');
        const enableSelectionBtn = document.getElementById('enableSelection');
        const removeFromPlaylistBtn = document.getElementById('removeFromPlaylist');
        const deleteSongBtn = document.getElementById('deleteSong');
        
        const selectionActive = forceMulti || (this.selectionMode && this.selectedSongs.size > 0);
        if (songContextMenu) songContextMenu.dataset.mode = selectionActive ? 'multi' : 'single';
        const selectedIndices = selectionActive ? this.getSelectedSongIndices() : [];
        const deleteLabel = deleteSongBtn?.querySelector('.menu-label');
        if (deleteLabel) {
            deleteLabel.textContent = selectionActive && selectedIndices.length > 1 ? 'Delete Songs' : 'Delete Song';
        }

        // Populate playlist submenu
        const playlistSubmenu = document.getElementById('playlistSubmenu');
        const playlistNames = Object.keys(this.playlists);
        
        playlistSubmenu.innerHTML = '';
        if (playlistNames.length === 0) {
            const item = document.createElement('div');
            item.className = 'menu-item disabled';
            item.setAttribute('role', 'menuitem');
            item.setAttribute('aria-disabled', 'true');
            item.tabIndex = -1;
            const label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = 'No playlists available';
            item.appendChild(label);
            playlistSubmenu.appendChild(item);
        } else {
            playlistNames.forEach(name => {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.setAttribute('role', 'menuitem');
                item.tabIndex = -1;
                const label = document.createElement('span');
                label.className = 'menu-label';
                label.textContent = name;
                item.appendChild(label);
                item.onclick = () => {
                    if (selectionActive) {
                        this.addSelectedToPlaylist(name);
                    } else {
                        this.addToPlaylist(name);
                    }
                    this.hideSongContextMenu();
                };
                playlistSubmenu.appendChild(item);
            });
        }

        if (selectionActive) {
            const allHaveLyrics = selectedIndices.length > 0 && selectedIndices.every(idx => {
                const s = this.songs[idx];
                return !!s && !!s.hasLyrics && !s.isVideo;
            });
            const allHaveVideo = selectedIndices.length > 0 && selectedIndices.every(idx => {
                const s = this.songs[idx];
                return !!s && !!s.attachedVideo;
            });

            if (addToQueueBtn) addToQueueBtn.style.display = '';
            if (enableSelectionBtn) enableSelectionBtn.style.display = 'none';
            if (viewInFolderBtn) viewInFolderBtn.style.display = 'none';
            if (removeFromPlaylistBtn) removeFromPlaylistBtn.style.display = 'none';

            if (removeLyricsBtn) {
                removeLyricsBtn.style.display = '';
                removeLyricsBtn.classList.toggle('disabled', !allHaveLyrics);
            }
            if (removeVideoBtn) {
                removeVideoBtn.style.display = '';
                removeVideoBtn.classList.toggle('disabled', !allHaveVideo);
            }
            if (deleteSongBtn) deleteSongBtn.style.display = '';
        } else {
            // Hide Add to Queue for currently playing song
            if (songIndex === this.currentSongIndex) {
                addToQueueBtn.style.display = 'none';
            } else {
                addToQueueBtn.style.display = '';
            }

            if (enableSelectionBtn) enableSelectionBtn.style.display = '';
            if (viewInFolderBtn) viewInFolderBtn.style.display = '';

            // Update menu items based on context
            if (removeFromPlaylistBtn) {
                removeFromPlaylistBtn.style.display = this.currentPlaylist ? '' : 'none';
            }
            
            if (removeLyricsBtn) {
                removeLyricsBtn.style.display = song.hasLyrics ? '' : 'none';
                removeLyricsBtn.classList.remove('disabled');
            }
            
            if (removeVideoBtn) {
                if (song.attachedVideo) {
                    removeVideoBtn.classList.remove('disabled');
                } else {
                    removeVideoBtn.classList.add('disabled');
                }
            }
        }
        
        this.openContextMenu(songContextMenu, x, y);
    }
    
    hideSongContextMenu() {
        this.closeContextMenu(document.getElementById('songContextMenu'));
    }
    
    addToQueue() {
        if (this.currentSongIndex >= 0 && this.isPlaying) {
            this.setPlaybackContextFromBrowseContext();
            this.queue.push(this.selectedSongIndex);
            this.renderQueuePanelIfVisible();
        }
        this.hideSongContextMenu();
    }
    
    showLyricsContextMenu(x, y) {
        const lyricsContextMenu = document.getElementById('lyricsContextMenu');
        this.openContextMenu(lyricsContextMenu, x, y);
    }
    
    hideLyricsContextMenu() {
        this.closeContextMenu(document.getElementById('lyricsContextMenu'));
    }
    
    async pasteLyrics() {
        if (this.currentSongIndex < 0) {
            this.showNotification('Please select a song first', 'error');
            return;
        }
        
        try {
            const text = await navigator.clipboard.readText();
            if (!text.trim()) {
                this.showNotification('Clipboard is empty', 'error');
                return;
            }
            
            this.showNotification('Pasting lyrics...', 'info');
            const song = this.songs[this.currentSongIndex];
            
            const success = await ipcRenderer.invoke('save-pasted-lyrics', song.baseName, text.trim());
            if (success) {
                // Parse and display lyrics without interrupting playback
                this.parseLyrics(text.trim());
                
                // Update song metadata
                song.hasLyrics = true;
                song.lyricsFile = song.baseName;
                song.lyricsMatch = song.baseName;
                
                // Update the song item badge without full reload
                this.updateSongBadge(this.currentSongIndex, true);
                
                // Update the songs array to persist the change
                this.songs[this.currentSongIndex] = song;
                this.updateMediaAvailabilityButtons(song);
                
                this.showNotification('Lyrics pasted successfully', 'success');
            } else {
                this.showNotification('Failed to save lyrics', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to read clipboard', 'error');
        }
        this.hideLyricsContextMenu();
    }
    

    async addSongLyrics() {
        const song = this.songs[this.selectedSongIndex];
        if (song.hasLyrics) {
            this.showNotification('Song already has lyrics', 'error');
            return;
        }
        
        try {
            const result = await ipcRenderer.invoke('browse-lyrics-file');
            if (result && !result.canceled && result.filePaths.length > 0) {
                const lyricsPath = result.filePaths[0];
                this.showNotification('Adding lyrics...', 'info');
                
                const success = await ipcRenderer.invoke('add-song-lyrics', song.baseName, lyricsPath);
                if (success) {
                    this.showNotification('Lyrics added successfully', 'success');
                    this.loadMusic();
                } else {
                    this.showNotification('Failed to add lyrics', 'error');
                }
            }
        } catch (error) {
            this.showNotification('Error adding lyrics', 'error');
        }
        this.hideSongContextMenu();
    }
    
    removeLyrics() {
        const song = this.songs[this.selectedSongIndex];
        if (!song.hasLyrics) {
            this.showNotification('Song has no lyrics to remove', 'error');
            return;
        }
        
        this.showNotification('Removing lyrics...', 'info');
        
        ipcRenderer.invoke('remove-lyrics', song.baseName).then((success) => {
            if (success) {
                // Update song data without full reload
                song.hasLyrics = false;
                song.lyricsFile = null;
                
                // Update the song item badge without full reload
                this.updateSongBadge(this.selectedSongIndex, false);
                this.updateMediaAvailabilityButtons(song);
                
                // Clear lyrics if it's the currently playing song
                if (this.selectedSongIndex === this.currentSongIndex) {
                    this.lyrics = [];
                    this.lyricsDiv.innerHTML = `
                        <div class="no-lyrics-container">
                            <p class="no-lyrics">No lyrics available</p>
                            <div class="lyrics-instructions">
                                <ul class="instruction-list">
                                    <li>Drop .lrc file here</li>
                                    <li>Right-click and paste synced lyrics</li>
                                    <li><a href="#" onclick="player.searchMusicOnline()" style="color: #4a9eff; text-decoration: none;">Search Music Online</a></li>
                                </ul>
                                <p class="format-hint">Synced lyrics format: [00:12.34]Lyric text here</p>
                            </div>
                        </div>
                    `;
                    this.setupLyricsDragDrop();
                    this.setupLyricsKeyboardShortcut();
                }
                
                this.showNotification('Lyrics removed successfully', 'success');
            } else {
                this.showNotification('Failed to remove lyrics', 'error');
            }
        }).catch(() => {
            this.showNotification('Error removing lyrics', 'error');
        });
        this.hideSongContextMenu();
    }

    async removeLyricsForSelection() {
        const indices = this.getSelectedSongIndices();
        if (indices.length === 0) {
            this.showNotification('No songs selected', 'info');
            return;
        }

        const eligible = indices.filter(idx => {
            const s = this.songs[idx];
            return !!s && !!s.hasLyrics && !s.isVideo;
        });

        if (eligible.length !== indices.length) {
            this.showNotification('Selected songs must all have lyrics to remove', 'error');
            return;
        }

        this.showNotification('Removing lyrics...', 'info');

        const results = await Promise.allSettled(
            eligible.map(idx => ipcRenderer.invoke('remove-lyrics', this.songs[idx].baseName))
        );

        let successCount = 0;
        results.forEach((res, i) => {
            if (res.status === 'fulfilled' && res.value) {
                const idx = eligible[i];
                const song = this.songs[idx];
                if (!song) return;
                song.hasLyrics = false;
                song.lyricsFile = null;
                this.updateSongBadge(idx, false);
                if (idx === this.currentSongIndex) {
                    this.lyrics = [];
                    this.lyricsDiv.innerHTML = `
                        <div class="no-lyrics-container">
                            <p class="no-lyrics">No lyrics available</p>
                            <div class="lyrics-instructions">
                                <ul class="instruction-list">
                                    <li>Drop .lrc file here</li>
                                    <li>Right-click and paste synced lyrics</li>
                                    <li><a href="#" onclick="player.searchMusicOnline()" style="color: #4a9eff; text-decoration: none;">Search Music Online</a></li>
                                </ul>
                                <p class="format-hint">Synced lyrics format: [00:12.34]Lyric text here</p>
                            </div>
                        </div>
                    `;
                    this.setupLyricsDragDrop();
                    this.setupLyricsKeyboardShortcut();
                    this.updateMediaAvailabilityButtons(song);
                }
                successCount++;
            }
        });

        if (successCount > 0) {
            this.showNotification(`Lyrics removed from ${successCount} song${successCount === 1 ? '' : 's'}`, 'success');
        }

        if (successCount !== eligible.length) {
            this.showNotification('Some lyrics could not be removed', 'error');
        }

        this.hideSongContextMenu();
    }
    
    viewInFolder() {
        const song = this.songs[this.selectedSongIndex];
        ipcRenderer.send('view-song-in-folder', song.path);
        this.hideSongContextMenu();
    }

    prepareSongsForDeletion(songsToDelete = []) {
        if (!Array.isArray(songsToDelete) || songsToDelete.length === 0) return;
        const currentSong = this.songs[this.currentSongIndex];
        if (!currentSong) return;

        const deletingCurrentSong = songsToDelete.some(song => (
            song === currentSong ||
            (song?.path && currentSong.path && song.path === currentSong.path)
        ));

        if (!deletingCurrentSong) return;

        this.beginMediaTransition('delete-song');
        this.suppressAutoResume();
        this.audio.pause();
        this.videoElement.pause();
        this.audio.src = '';
        this.audio.load();
        this.videoElement.src = '';
        this.videoElement.load();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
        this.stopVisualizer();
        this.stopProgressSync();
        this.syncMediaSessionPlaybackState();
        this.currentSongIndex = -1;
        this.settings.lastSongName = '';
        this.settings.lastCurrentTime = 0;
        this.saveSettings();
    }
    
    async deleteSong() {
        if (this.selectedSongIndex < 0 || this.selectedSongIndex >= this.songs.length) {
            this.showNotification('Invalid song selection', 'error');
            this.hideSongContextMenu();
            return;
        }
        const song = this.songs[this.selectedSongIndex];
        const ok = await this.showConfirmDialog({
            title: 'Delete song?',
            message: `Move "${song.title}" to Recycle Bin?`,
            confirmText: 'Delete',
            kind: 'danger'
        });
        if (!ok) {
            this.hideSongContextMenu();
            return;
        }

        this.prepareSongsForDeletion([song]);
        this.showNotification('Deleting song...', 'info');
        ipcRenderer.invoke('delete-song', {
            filePath: song.path,
            fileName: song.name,
            baseName: song.baseName,
            isVideo: !!song.isVideo
        }).then((success) => {
            if (success) {
                this.showNotification('Song deleted successfully', 'success');
                this.loadMusic();
            } else {
                this.showNotification('Failed to delete song', 'error');
            }
        }).catch(() => {
            this.showNotification('Error deleting song', 'error');
        });
        this.hideSongContextMenu();
    }
    
    removeVideo() {
        const song = this.songs[this.selectedSongIndex];
        if (!song.attachedVideo) {
            this.showNotification('Song has no attached video to remove', 'error');
            return;
        }
        
        if (confirm(`Remove attached video from "${song.title}"?`)) {
            this.showNotification('Removing video...', 'info');
            
            ipcRenderer.invoke('remove-attached-video', song.baseName).then((success) => {
                if (success) {
                    // Update song data
                    song.attachedVideo = null;
                    
                    // Update the song item badge
                    this.updateSongBadge(this.selectedSongIndex, song.hasLyrics);
                    
                    // If it's the currently playing song, update video player
                    if (this.selectedSongIndex === this.currentSongIndex) {
                        this.videoElement.src = '';
                        if (this.isVideoMode) {
                            this.switchToMusic();
                        }
                    }
                    
                    this.showNotification('Video removed successfully', 'success');
                } else {
                    this.showNotification('Failed to remove video', 'error');
                }
            }).catch(() => {
                this.showNotification('Error removing video', 'error');
            });
        }
        this.hideSongContextMenu();
    }

    async removeVideosForSelection() {
        const indices = this.getSelectedSongIndices();
        if (indices.length === 0) {
            this.showNotification('No songs selected', 'info');
            return;
        }

        const eligible = indices.filter(idx => {
            const s = this.songs[idx];
            return !!s && !!s.attachedVideo;
        });

        if (eligible.length !== indices.length) {
            this.showNotification('Selected songs must all have attached videos to remove', 'error');
            return;
        }

        const count = eligible.length;
        const ok = await this.showConfirmDialog({
            title: 'Remove attached videos?',
            message: `Remove attached video from ${count} song${count === 1 ? '' : 's'}?`,
            confirmText: 'Remove',
            kind: 'danger'
        });
        if (!ok) return;

        this.showNotification('Removing video...', 'info');

        const results = await Promise.allSettled(
            eligible.map(idx => ipcRenderer.invoke('remove-attached-video', this.songs[idx].baseName))
        );

        let successCount = 0;
        results.forEach((res, i) => {
            if (res.status === 'fulfilled' && res.value) {
                const idx = eligible[i];
                const song = this.songs[idx];
                if (!song) return;
                song.attachedVideo = null;
                this.updateSongBadge(idx, song.hasLyrics);
                if (idx === this.currentSongIndex) {
                    this.videoElement.src = '';
                    if (this.isVideoMode) {
                        this.switchToMusic();
                    }
                }
                successCount++;
            }
        });

        if (successCount > 0) {
            this.showNotification(`Video removed from ${successCount} song${successCount === 1 ? '' : 's'}`, 'success');
        }
        if (successCount !== eligible.length) {
            this.showNotification('Some videos could not be removed', 'error');
        }

        this.hideSongContextMenu();
    }
    

    
    async handleFileDrop(files) {
        this.showNotification('Drag & drop not supported. Use "Add Music Folder" instead.', 'info');
    }

    async handleFileAdd(files, type) {
        this.logGuardWarningOnce(
            'handleFileAdd',
            '[Guard] handleFileAdd is not available in this build; ignoring request.'
        );
        return false;
    }
    
    setupSearch() {
        this.searchInput.oninput = (e) => {
            if (this.searchTimeout) {
                clearTimeout(this.searchTimeout);
            }
            
            const query = e.target.value.trim();

            if (this.currentView === 'download') {
                return;
            }
            
            // Immediate search for short queries or clearing
            if (query.length <= 2) {
                this.filterSongs(query);
                return;
            }
            
            // Debounced search for longer queries
            this.searchTimeout = setTimeout(() => {
                this.filterSongs(query);
            }, 100);
        };
        
        // Clear search on Escape key
        this.searchInput.onkeydown = (e) => {
            if (e.key === 'Enter' && this.currentView === 'download') {
                e.preventDefault();
                this.performDownloadSearch();
                return;
            }
            if (e.key === 'Escape') {
                this.searchInput.value = '';
                if (this.currentView === 'download') {
                    this.downloadSearchLoading = false;
                    this.downloadSearchToken += 1;
                    this.downloadResults = [];
                    this.renderDownloadResults();
                } else {
                    this.filterSongs('');
                }
            }
        };
    }
    
    setupModeButtons() {
        this.shuffleBtn.onclick = () => this.toggleShuffle();
        this.repeatBtn.onclick = () => this.toggleRepeat();
    }
    
    setupTheme() {
        this.themeToggle.onclick = () => this.toggleTheme();
    }
    
    setupSlidePanel() {
        this.slidePanelBtn.onclick = () => this.toggleSlidePanel();
        this.loadPanelState();
    }
    
    toggleSlidePanel() {
        this.slidePanel.classList.toggle('pinned');
        this.slidePanelBtn.classList.toggle('pinned', this.slidePanel.classList.contains('pinned'));
        this.savePanelState();
    }
    
    loadPanelState() {
        const isPinned = localStorage.getItem('vimusic-panel-pinned') === 'true';
        if (isPinned) {
            this.slidePanel.classList.add('pinned');
            this.slidePanelBtn.classList.add('pinned');
        }
    }
    
    savePanelState() {
        const isPinned = this.slidePanel.classList.contains('pinned');
        localStorage.setItem('vimusic-panel-pinned', isPinned.toString());
    }
    

    
    setupVideo() {
        this.videoBtn.onclick = () => this.toggleVideoMode();
        if (this.visualizerBtn) this.visualizerBtn.onclick = () => this.toggleVisualizerView();
        this.lyricsToggleBtn.onclick = () => this.toggleLyrics();
    }
    
    setupTimingControls() {
        this.offsetToggleBtn.onclick = () => this.toggleOffsetPanel();
        this.timingBackward.onclick = () => this.adjustLyricsTiming(-500);
        this.timingForward.onclick = () => this.adjustLyricsTiming(500);
        this.timingSave.onclick = () => this.saveOffset();
        this.updateTimingControls();
    }
    
    setupFontControls() {
        this.lyricsFontBtn.onclick = () => this.toggleFontPanel();
        this.fontDecrease.onclick = () => this.adjustFontSize(-2);
        this.fontIncrease.onclick = () => this.adjustFontSize(2);
        
        // Floating lyrics font controls
        document.getElementById('floatFontDecrease').onclick = () => this.adjustFloatingFontSize(-2);
        document.getElementById('floatFontIncrease').onclick = () => this.adjustFloatingFontSize(2);
        
        // Single save button for all settings
        document.getElementById('saveAllFontSettings').onclick = () => this.saveAllFontSettings();
        
        // Color picker
        document.querySelectorAll('.color-box').forEach(box => {
            box.onclick = () => {
                document.querySelectorAll('.color-box').forEach(b => b.style.border = 'none');
                box.style.border = '2px solid #fff';
                this.floatingLyricsColor = box.dataset.color;
                this.applyFloatingLyricsColor();
            };
        });
        
        this.loadFontSettings();
        
        // Keep it visible; disable/enable is handled by updateFontButtonState().
        this.lyricsFontBtn.style.display = 'flex';
        
        // Use requestAnimationFrame to prevent layout thrashing
        requestAnimationFrame(() => {
            this.updateFontButtonState();
        });
    }
    
    toggleOffsetPanel() {
        if (!this.isVideoMode) return;
        const isVisible = this.lyricsTimingControls.style.display !== 'none';
        this.lyricsTimingControls.style.display = isVisible ? 'none' : 'flex';
        this.offsetToggleBtn.classList.toggle('active', !isVisible);
    }
    
    saveOffset() {
        this.lyricsTimingControls.style.display = 'none';
        this.offsetToggleBtn.classList.remove('active');
        localStorage.setItem('vimusic-song-offsets', JSON.stringify(this.songOffsets));
        this.showNotification(`Lyrics offset saved: ${this.lyricsOffset}ms`, 'success');
    }
    
    toggleVideoAspectRatio() {
        if (!this.isVideoMode) return;
        
        this.isVideo43Mode = !this.isVideo43Mode;
        
        if (this.isVideo43Mode) {
            this.videoElement.style.objectFit = 'cover';
            this.videoElement.style.aspectRatio = '4/3';
            this.videoPlayer.style.aspectRatio = '4/3';
            this.showNotification('Video cropped to 4:3', 'info');
        } else {
            this.videoElement.style.objectFit = 'contain';
            this.videoElement.style.aspectRatio = 'auto';
            this.videoPlayer.style.aspectRatio = 'auto';
            this.showNotification('Video restored to original ratio', 'info');
        }
    }
    
    adjustLyricsTiming(ms) {
        if (!this.isVideoMode || this.currentSongIndex < 0) return;
        this.lyricsOffset += ms;
        const currentSong = this.songs[this.currentSongIndex];
        this.songOffsets[currentSong.baseName] = this.lyricsOffset;
        localStorage.setItem('vimusic-song-offsets', JSON.stringify(this.songOffsets));
        this.updateTimingControls();
    }
    
    updateTimingControls() {
        const enabled = this.isVideoMode;
        this.offsetToggleBtn.disabled = !enabled;
        this.offsetToggleBtn.style.opacity = enabled ? '1' : '0.4';
        this.timingBackward.disabled = !enabled;
        this.timingForward.disabled = !enabled;
        this.timingSave.disabled = !enabled;
        this.timingOffset.textContent = `Offset: ${this.lyricsOffset}ms`;
        
        if (!enabled) {
            this.lyricsTimingControls.style.display = 'none';
            this.offsetToggleBtn.classList.remove('active');
        }
    }
    
    applyLyricsVisibilityPreference() {
        if (!this.lyricsDiv || !this.lyricsToggleBtn) return;
        const visible = this.settings.lyricsVisible !== false;

        if (visible) {
            this.lyricsDiv.style.display = 'block';
            if (this.queuePanel) this.queuePanel.style.display = 'none';
            this.lyricsToggleBtn.classList.add('active');
        } else {
            this.lyricsDiv.style.display = 'none';
            if (this.queuePanel) this.queuePanel.style.display = 'flex';
            this.lyricsToggleBtn.classList.remove('active');
            if (this.lyricsFontControls) this.lyricsFontControls.style.display = 'none';
            if (this.lyricsFontBtn) this.lyricsFontBtn.classList.remove('active');
            this.renderQueuePanelIfVisible();
        }

        this.updateFontButtonState();
    }

    toggleLyrics() {
        const isHidden = this.lyricsDiv.style.display === 'none';
        
        if (isHidden) {
            this.lyricsDiv.style.display = 'block';
            if (this.queuePanel) this.queuePanel.style.display = 'none';
            this.lyricsToggleBtn.classList.add('active');
            this.showNotification('Lyrics shown', 'info');
        } else {
            this.lyricsDiv.style.display = 'none';
            if (this.queuePanel) this.queuePanel.style.display = 'flex';
            this.lyricsToggleBtn.classList.remove('active');
            this.lyricsFontControls.style.display = 'none';
            this.lyricsFontBtn.classList.remove('active');
            this.showNotification('Lyrics hidden', 'info');
            this.renderQueuePanelIfVisible();
        }
        this.settings.lyricsVisible = this.lyricsDiv.style.display !== 'none';
        this.saveSettings();
        this.updateFontButtonState();
    }

    isQueuePanelVisible() {
        return !!this.queuePanel && this.queuePanel.style.display !== 'none';
    }

    renderQueuePanelIfVisible() {
        if (!this.isQueuePanelVisible()) return;
        this.renderQueuePanel();
    }

    getQueueCoverUrl(song) {
        if (!song || !song.picture) return null;
        const key = song.path || song.name || song.baseName;
        if (!key) return null;

        const cached = this.queueCoverUrlCache.get(key);
        if (cached) return cached;

        try {
            const url = URL.createObjectURL(new Blob([song.picture]));
            this.queueCoverUrlCache.set(key, url);

            const maxEntries = 120;
            if (this.queueCoverUrlCache.size > maxEntries) {
                const firstKey = this.queueCoverUrlCache.keys().next().value;
                const firstUrl = this.queueCoverUrlCache.get(firstKey);
                if (firstUrl) URL.revokeObjectURL(firstUrl);
                this.queueCoverUrlCache.delete(firstKey);
            }

            return url;
        } catch {
            return null;
        }
    }

    getQueuePreviewIndices(limit = 25) {
        const maxItems = Math.max(1, Math.min(200, Number(limit) || 25));
        const indices = [];

        if (this.currentSongIndex < 0 || this.currentSongIndex >= this.songs.length) return indices;
        indices.push(this.currentSongIndex);

        if (this.repeatMode === 'one') return indices;

        const queue = Array.isArray(this.queue) ? this.queue : [];
        let simulatedCurrentIndex = this.currentSongIndex;
        for (let i = queue.length - 1; i >= 0; i--) {
            const n = Number(queue[i]);
            if (Number.isInteger(n) && n >= 0 && n < this.songs.length) {
                simulatedCurrentIndex = n;
                break;
            }
        }

        for (let i = 0; i < queue.length && indices.length < maxItems; i++) {
            const n = Number(queue[i]);
            if (!Number.isInteger(n) || n < 0 || n >= this.songs.length) continue;
            indices.push(n);
        }

        if (indices.length >= maxItems) return indices;

        if (this.shuffleMode) {
            if (Array.isArray(this.shuffleQueue) && this.shuffleQueue.length > 0) {
                for (let i = 0; i < this.shuffleQueue.length && indices.length < maxItems; i++) {
                    const n = Number(this.shuffleQueue[i]);
                    if (!Number.isInteger(n) || n < 0 || n >= this.songs.length) continue;
                    indices.push(n);
                }
            }
            return indices;
        }

        const contextSongs = this.getContextSongs() || [];
        if (contextSongs.length === 0) return indices;

        const simulatedSong = this.songs[simulatedCurrentIndex];
        let startPos = contextSongs.indexOf(simulatedSong);
        if (startPos === -1) startPos = -1;

        const maxSteps =
            this.repeatMode === 'all' && startPos !== -1 ? Math.max(0, contextSongs.length - 1) : contextSongs.length;
        for (let step = 1; step <= maxSteps && indices.length < maxItems; step++) {
            let nextPos = startPos + step;
            if (nextPos >= contextSongs.length) {
                if (this.repeatMode !== 'all') break;
                nextPos = nextPos % contextSongs.length;
            }

            const nextSong = contextSongs[nextPos];
            const nextIndex = this.songs.indexOf(nextSong);
            if (nextIndex >= 0) indices.push(nextIndex);
        }

        return indices;
    }

    renderQueuePanel() {
        if (!this.queueList || !this.queuePanel) return;

        const maxItems = 25;
        const indices = this.getQueuePreviewIndices(maxItems);

        if (this.queueMeta) {
            const parts = [];
            if (this.shuffleMode) parts.push('Shuffle');
            if (this.repeatMode === 'all') parts.push('Repeat');
            if (this.repeatMode === 'one') parts.push('Repeat 1');
            if (this.repeatMode !== 'one' && this.queue && this.queue.length) parts.push(`Queued ${this.queue.length}`);

            const shownUpcoming = Math.max(0, indices.length - 1);
            if (this.currentSongIndex >= 0 && this.repeatMode !== 'one') {
                const suffix = shownUpcoming >= maxItems - 1 ? '+' : '';
                parts.push(`Up next ${shownUpcoming}${suffix}`);
            }

            this.queueMeta.textContent = parts.join(' • ');
        }

        if (indices.length === 0) {
            this.queueList.innerHTML = `<div class="queue-empty">No song selected</div>`;
            return;
        }

        this.queueList.innerHTML = '';
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < indices.length; i++) {
            const songIndex = indices[i];
            const song = this.songs[songIndex];
            if (!song) continue;

            const item = document.createElement('div');
            item.className = 'queue-item';
            if (songIndex === this.currentSongIndex) item.classList.add('active');
            item.dataset.songIndex = String(songIndex);

            const cover = document.createElement('div');
            cover.className = 'queue-cover';

            const coverUrl = this.getQueueCoverUrl(song);
            if (coverUrl) {
                const img = document.createElement('img');
                img.src = coverUrl;
                img.alt = 'Cover';
                cover.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'cover-placeholder';
                placeholder.textContent = '🎵';
                cover.appendChild(placeholder);
            }

            const info = document.createElement('div');
            info.className = 'queue-info';
            info.innerHTML = `
                <div class="queue-title">${this.escapeHtml(song.title)}</div>
                <div class="queue-artist">${this.escapeHtml(song.artist)}</div>
            `;

            item.appendChild(cover);
            item.appendChild(info);

            if (i === 0) {
                const badge = document.createElement('div');
                badge.className = 'queue-badge';
                badge.textContent = 'Now';
                item.appendChild(badge);
            } else if (i === 1) {
                const badge = document.createElement('div');
                badge.className = 'queue-badge';
                badge.textContent = 'Next';
                item.appendChild(badge);
            }

            item.onclick = () => this.handleQueuePreviewClick(i, indices);

            fragment.appendChild(item);
        }

        this.queueList.appendChild(fragment);
    }

    handleQueuePreviewClick(position, indices) {
        if (!Array.isArray(indices)) return;
        const pos = Number(position);
        if (!Number.isInteger(pos) || pos < 0 || pos >= indices.length) return;

        const targetIndex = Number(indices[pos]);
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.songs.length) return;

        // "Skip ahead" behavior: everything above the clicked song in the queue preview is skipped.
        // The preview order is: [Now playing] + [manual queue] + [shuffle queue OR context order].
        if (pos > 0 && this.repeatMode !== 'one') {
            const queueLen = Array.isArray(this.queue) ? this.queue.length : 0;

            if (queueLen > 0) {
                if (pos <= queueLen) {
                    // Clicked within manual queue: drop items up to and including the clicked one.
                    this.queue.splice(0, pos);
                } else {
                    // Clicked beyond manual queue: skip everything queued manually.
                    this.queue.length = 0;
                }
            }

            if (this.shuffleMode && Array.isArray(this.shuffleQueue)) {
                // If the click is in the shuffle-preview portion, skip those earlier shuffle items too.
                const shuffleStartPos = 1 + queueLen;
                if (pos >= shuffleStartPos) {
                    const shufflePos = pos - shuffleStartPos;
                    if (shufflePos >= 0) {
                        this.shuffleQueue.splice(0, Math.min(this.shuffleQueue.length, shufflePos + 1));
                    }
                }
            }
        }

        this.selectSong(targetIndex);
    }
    
    updateFontButtonState() {
        const lyricsVisible = this.lyricsToggleBtn.classList.contains('active') && this.lyricsDiv.style.display !== 'none';
        const currentSong = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null;
        const hasLyrics = !!currentSong && !!currentSong.hasLyrics && !currentSong.isVideo;
        const enabled = lyricsVisible && hasLyrics;
        this.lyricsFontBtn.disabled = !enabled;
        this.lyricsFontBtn.style.opacity = enabled ? '1' : '0.4';
    }

    updateMediaAvailabilityButtons(song) {
        if (this.previewMode) {
            this.setPreviewOptionState(true);
            return;
        }
        const currentSong = song || (this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null);
        const hasLyrics = !!currentSong && !!currentSong.hasLyrics && !currentSong.isVideo;
        const hasVideo = !!currentSong && (!!currentSong.isVideo || !!currentSong.attachedVideo || !!currentSong.youtubeVideo);

        if (this.videoBtn) {
            this.videoBtn.disabled = !hasVideo;
            this.videoBtn.style.opacity = hasVideo ? '1' : '0.4';
        }

        if (this.floatLyricsBtn) {
            if (!hasLyrics) {
                // Avoid trapping the user with an open floating window and a disabled close button.
                ipcRenderer.invoke('is-floating-window-open')
                    .then(isOpen => {
                        if (isOpen) ipcRenderer.send('close-floating-lyrics');
                    })
                    .catch(() => {});
                this.floatLyricsBtn.classList.remove('active');
            }
            this.floatLyricsBtn.disabled = !hasLyrics;
            this.floatLyricsBtn.style.opacity = hasLyrics ? '1' : '0.4';
        }

        // Lyrics toggle stays available always; only the font/settings depend on lyrics availability + visibility.
        if (this.lyricsFontBtn) this.updateFontButtonState();
    }
    
    toggleFontPanel() {
        const isVisible = this.lyricsFontControls.style.display !== 'none';
        this.lyricsFontControls.style.display = isVisible ? 'none' : 'flex';
        this.lyricsFontBtn.classList.toggle('active', !isVisible);
        this.updateFontDisplay();
    }
    
    adjustFontSize(change) {
        this.lyricsFontSize = Math.max(10, Math.min(32, this.lyricsFontSize + change));
        this.updateFontDisplay();
        this.applyFontSize();
    }
    
    updateFontDisplay() {
        this.fontSizeDisplay.textContent = `Size: ${this.lyricsFontSize}px`;
    }
    
    applyFontSize() {
        const lyricLines = this.lyricsDiv.querySelectorAll('.lyric-line');
        lyricLines.forEach(line => {
            line.style.fontSize = `${this.lyricsFontSize}px`;
        });
    }
    
    saveFontSettings() {
        localStorage.setItem('vimusic-lyrics-font-size', this.lyricsFontSize.toString());
    }
    
    saveAllFontSettings() {
        localStorage.setItem('vimusic-lyrics-font-size', this.lyricsFontSize.toString());
        localStorage.setItem('vimusic-floating-lyrics-font-size', this.floatingLyricsFontSize.toString());
        localStorage.setItem('vimusic-floating-lyrics-color', this.floatingLyricsColor);
        this.lyricsFontControls.style.display = 'none';
        this.lyricsFontBtn.classList.remove('active');
        this.showNotification('All lyrics settings saved', 'success');
    }
    
    adjustFloatingFontSize(change) {
        this.floatingLyricsFontSize = Math.max(16, Math.min(48, this.floatingLyricsFontSize + change));
        this.updateFloatingFontDisplay();
        this.applyFloatingFontSize();
    }
    
    updateFloatingFontDisplay() {
        document.getElementById('floatFontSizeDisplay').textContent = `Size: ${this.floatingLyricsFontSize}px`;
    }
    
    applyFloatingFontSize() {
        ipcRenderer.send('update-floating-lyrics-style', {
            fontSize: this.floatingLyricsFontSize
        });
    }
    
    applyFloatingLyricsColor() {
        ipcRenderer.send('update-floating-lyrics-style', {
            color: this.floatingLyricsColor
        });
    }
    
    applyFloatingLyricsSettings() {
        ipcRenderer.send('update-floating-lyrics-style', {
            fontSize: this.floatingLyricsFontSize,
            color: this.floatingLyricsColor
        });
    }
    
    saveFloatingFontSettings() {
        localStorage.setItem('vimusic-floating-lyrics-font-size', this.floatingLyricsFontSize.toString());
        localStorage.setItem('vimusic-floating-lyrics-color', this.floatingLyricsColor);
    }
    
    loadFontSettings() {
        const saved = localStorage.getItem('vimusic-lyrics-font-size');
        if (saved) {
            this.lyricsFontSize = parseInt(saved) || 16;
        }
        
        const savedFloatSize = localStorage.getItem('vimusic-floating-lyrics-font-size');
        if (savedFloatSize) {
            this.floatingLyricsFontSize = parseInt(savedFloatSize) || 28;
        }
        
        const savedColor = localStorage.getItem('vimusic-floating-lyrics-color');
        if (savedColor) {
            this.floatingLyricsColor = savedColor;
            document.querySelectorAll('.color-box').forEach(box => {
                if (box.dataset.color === savedColor) {
                    box.style.border = '2px solid #fff';
                }
            });
        }
        
        this.updateFontDisplay();
        this.updateFloatingFontDisplay();
        this.applyFloatingLyricsSettings();
    }
    
    toggleVideoMode() {
        if (this.videoBtn?.disabled) {
            this.showNotification('No video available for this song', 'info');
            return;
        }
        if (this.currentSongIndex < 0) {
            this.showNotification('No song selected', 'error');
            return;
        }
        
        const currentSong = this.songs[this.currentSongIndex];
        if (!currentSong) {
            this.showNotification('Current song not found', 'error');
            return;
        }
        
        if (currentSong.isVideo || currentSong.attachedVideo || currentSong.youtubeVideo) {
            if (this.isVideoMode) {
                // Switch back to music
                this.switchToMusic();
            } else {
                // Switch to video
                this.switchToVideo();
            }
        } else {
            this.showNotification('No video content available. Drag a video file to attach', 'error');
        }
    }
    
    switchToVideo() {
        this.beginMediaTransition('switch-to-video');
        const currentSong = this.songs[this.currentSongIndex];
        const wasPlaying = this.isPlaying;
        const currentTime = this.audio.currentTime;
        
        // Stop music completely
        this.suppressAutoResume();
        this.audio.pause();
        this.stopVisualizer();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
        
        // Reload video source
        if (currentSong.isVideo) {
            this.videoElement.src = `file:///${currentSong.path.replace(/\\/g, '/')}`;
        } else if (currentSong.attachedVideo) {
            this.videoElement.src = `file:///${currentSong.attachedVideo.path.replace(/\\/g, '/')}`;
        }
        
        // Setup video
        this.videoElement.currentTime = currentTime;
        this.showVideoPlayer();
        this.isVideoMode = true;
        
        // Load song-specific offset for video mode
        this.lyricsOffset = this.songOffsets[currentSong.baseName] || 0;
        
        // Update details for video
        this.updateSongDetails(currentSong);
        
        // Update timing controls
        this.updateTimingControls();
        
        if (wasPlaying) {
            this.playVideo();
        }

        this.syncVisualizerAudioSource();
        
        this.showNotification('Switched to video', 'info');
    }
    
    switchToMusic() {
        this.beginMediaTransition('switch-to-music');
        const currentSong = this.songs[this.currentSongIndex];
        const wasPlaying = this.isPlaying;
        const currentTime = this.videoElement.currentTime;
        this.stopVisualizer();
        
        // Move video back to default if in main panel
        if (this.videoInMainPanel) {
            this.moveVideoBackToDefault();
        }
        
        // Stop video completely and clear source
        this.suppressAutoResume();
        this.videoElement.pause();
        this.videoElement.src = '';
        this.videoElement.load();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
        
        // Setup music - restore audio source first
        this.audio.src = `file:///${currentSong.path.replace(/\\/g, '/')}`;
        this.audio.currentTime = currentTime;
        this.hideVideoPlayer();
        this.isVideoMode = false;
        
        // Reset video aspect ratio
        this.isVideo43Mode = false;
        this.videoElement.style.objectFit = 'contain';
        this.videoElement.style.aspectRatio = 'auto';
        this.videoPlayer.style.aspectRatio = 'auto';
        
        // Reset lyrics offset
        this.lyricsOffset = 0;
        this.updateTimingControls();
        
        // Update details for music
        this.updateSongDetails(currentSong);
        
        if (wasPlaying) {
            this.play();
        }

        this.syncVisualizerAudioSource();
        
        this.showNotification('Switched to music', 'info');
    }
    
    updateSongDetails(song) {
        if (song?.isPreview) {
            this.detailTitle.textContent = `${song.title || 'Unknown Title'} (Preview)`;
            this.detailArtist.textContent = song.artist || 'Unknown Artist';
            this.detailFormat.textContent = song.formatLabel || 'STREAM';
            return;
        }

        if (this.isVideoMode && (song.isVideo || song.attachedVideo)) {
            // Show video details
            this.detailTitle.textContent = song.title + ' (Video)';
            this.detailArtist.textContent = song.artist;
            if (song.isVideo) {
                this.detailFormat.textContent = song.name.split('.').pop().toUpperCase();
            } else {
                this.detailFormat.textContent = song.attachedVideo.name.split('.').pop().toUpperCase();
            }
        } else {
            // Show music details
            this.detailTitle.textContent = song.title;
            this.detailArtist.textContent = song.artist;
            if (song?.name && song.name.includes('.')) {
                this.detailFormat.textContent = song.name.split('.').pop().toUpperCase();
            } else {
                this.detailFormat.textContent = song.formatLabel || '--';
            }
        }
    }

    initMediaSession() {
        if (!('mediaSession' in navigator) || typeof window.MediaMetadata === 'undefined') return;
        this.mediaSessionEnabled = true;
        this.setMediaSessionActionHandlers();
        this.syncMediaSessionPlaybackState();
    }

    setMediaSessionActionHandlers() {
        if (!this.mediaSessionEnabled) return;
        const mediaSession = navigator.mediaSession;
        const setHandler = (action, handler) => {
            try {
                mediaSession.setActionHandler(action, handler);
            } catch {
                // Some actions may not be supported by the current Chromium build.
            }
        };

        setHandler('play', () => {
            if (this.previewMode) {
                this.play();
                return;
            }
            if (this.currentSongIndex < 0) return;
            if (this.isVideoMode) this.playVideo();
            else this.play();
        });
        setHandler('pause', () => {
            if (this.previewMode) {
                this.pause();
                return;
            }
            if (this.isVideoMode) this.pauseVideo();
            else this.pause();
        });
        setHandler('previoustrack', () => this.playPrevious(true));
        setHandler('nexttrack', () => this.playNext(true));
    }

    syncMediaSessionPlaybackState() {
        if (!this.mediaSessionEnabled) return;
        if (this.previewMode && this.previewTrack) {
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
            return;
        }
        if (this.currentSongIndex < 0) {
            this.clearMediaSessionMetadata();
            navigator.mediaSession.playbackState = 'none';
            return;
        }
        navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
    }

    updateMediaSessionPositionState(force = false) {
        if (!this.mediaSessionEnabled) return;
        if (typeof navigator.mediaSession.setPositionState !== 'function') return;

        const now = Date.now();
        if (!force && now - this.mediaSessionPositionUpdateAt < 1000) return;

        const media = this.isVideoMode ? this.videoElement : this.audio;
        if (!media) return;

        const duration = media.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;

        try {
            navigator.mediaSession.setPositionState({
                duration,
                playbackRate: media.playbackRate || 1,
                position: media.currentTime || 0
            });
            this.mediaSessionPositionUpdateAt = now;
        } catch {
            // Ignore unsupported states.
        }
    }

    async updateMediaSessionForSong(song) {
        if (!this.mediaSessionEnabled) return;
        if (!song) {
            this.clearMediaSessionMetadata();
            return;
        }

        const updateId = ++this.mediaSessionUpdateToken;
        const title = song.title || song.name || 'Unknown Title';
        const artist = song.artist || 'Unknown Artist';
        const album = song.album || '';

        let artwork = [];
        let urls = [];

        try {
            const result = await this.buildMediaSessionArtwork(song);
            artwork = result.artwork;
            urls = result.urls;
        } catch (error) {
            console.error('Failed to build media session artwork:', error);
        }

        if (updateId !== this.mediaSessionUpdateToken) {
            this.revokeMediaSessionArtworkUrls(urls);
            return;
        }

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title,
                artist,
                album,
                artwork
            });
        } catch (error) {
            console.error('Failed to set media session metadata:', error);
        }

        this.replaceMediaSessionArtworkUrls(urls);
        this.updateMediaSessionPositionState(true);
    }

    clearMediaSessionMetadata() {
        if (!this.mediaSessionEnabled) return;
        try {
            navigator.mediaSession.metadata = null;
        } catch {
            // Ignore failures to clear metadata.
        }
        this.revokeMediaSessionArtworkUrls();
    }

    replaceMediaSessionArtworkUrls(urls) {
        this.revokeMediaSessionArtworkUrls();
        this.mediaSessionArtworkUrls = Array.isArray(urls) ? urls : [];
    }

    revokeMediaSessionArtworkUrls(urls = this.mediaSessionArtworkUrls) {
        if (!Array.isArray(urls)) return;
        urls.forEach(url => {
            if (typeof url === 'string' && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        });
        if (urls === this.mediaSessionArtworkUrls) this.mediaSessionArtworkUrls = [];
    }

    async buildMediaSessionArtwork(song) {
        const sizes = [96, 128, 256, 512];
        const source = this.getMediaSessionArtworkSource(song);
        if (!source) return { artwork: [], urls: [] };

        const img = await this.loadArtworkImage(source.url);
        if (source.revokeUrl) URL.revokeObjectURL(source.url);
        if (!img) return { artwork: [], urls: [] };

        return this.renderArtworkEntries(img, sizes);
    }

    getMediaSessionArtworkSource(song) {
        if (song && song.picture) {
            const bytes = song.picture instanceof Uint8Array ? song.picture : new Uint8Array(song.picture);
            const mimeType = this.detectImageMimeType(bytes) || 'image/jpeg';
            const blob = new Blob([bytes], { type: mimeType });
            return { url: URL.createObjectURL(blob), revokeUrl: true };
        }

        try {
            const fallbackUrl = new URL(this.mediaSessionFallbackArtwork, window.location.href).toString();
            return { url: fallbackUrl, revokeUrl: false };
        } catch {
            return null;
        }
    }

    detectImageMimeType(bytes) {
        if (!bytes || bytes.length < 12) return null;
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
        if (
            bytes[0] === 0x52 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x46 &&
            bytes[8] === 0x57 &&
            bytes[9] === 0x45 &&
            bytes[10] === 0x42 &&
            bytes[11] === 0x50
        ) {
            return 'image/webp';
        }
        return null;
    }

    loadArtworkImage(src) {
        return new Promise(resolve => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    async renderArtworkEntries(img, sizes) {
        const artwork = [];
        const urls = [];

        for (const size of sizes) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const scale = Math.max(size / img.width, size / img.height);
            const drawWidth = img.width * scale;
            const drawHeight = img.height * scale;
            const dx = (size - drawWidth) / 2;
            const dy = (size - drawHeight) / 2;

            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, dx, dy, drawWidth, drawHeight);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) continue;

            const url = URL.createObjectURL(blob);
            urls.push(url);
            artwork.push({
                src: url,
                sizes: `${size}x${size}`,
                type: 'image/png'
            });
        }

        return { artwork, urls };
    }

    createPlaylistFromInput() {
        this.logGuardWarningOnce(
            'createPlaylistFromInput',
            '[Guard] createPlaylistFromInput is not available in this build; ignoring request.'
        );
        return false;
    }

    hidePlaylistInput() {
        this.logGuardWarningOnce(
            'hidePlaylistInput',
            '[Guard] hidePlaylistInput is not available in this build; ignoring request.'
        );
        return false;
    }
    
    setupPlaylists() {
        this.loadPlaylists();
        this.displayPlaylists();
        
        document.getElementById('createPlaylistBtn').onclick = () => this.createNewPlaylist();
        
        // Handle playlist name input
        const playlistInput = document.getElementById('playlistNameInput');
        playlistInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                this.createPlaylistFromInput();
            }
        };
        
        // Hide input when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.playlist-input-container') && !e.target.closest('#createPlaylistBtn')) {
                this.hidePlaylistInput();
            }
        });
        document.getElementById('categorySelector').onclick = (e) => {
            // If clicking on the dropdown arrow, toggle dropdown
            if (e.target.classList.contains('dropdown-arrow')) {
                this.toggleCategoryDropdown(e);
            } else {
                // If clicking on main button, use current category
                const selectedCategory = document.getElementById('selectedCategory');
                const displayText = selectedCategory.textContent.trim();
                this.selectCategory(this.currentCategory, displayText);
            }
        };
        
        // Separate handler for dropdown arrow
        document.querySelector('.dropdown-arrow').onclick = (e) => {
            e.stopPropagation();
            this.toggleCategoryDropdown(e);
        };
        
        // Handle category selection
        document.querySelectorAll('#categoryDropdown .dropdown-item').forEach(item => {
            item.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const target = e.currentTarget;
                this.selectCategory(target.dataset.category, target.textContent.trim());
            };
        });
        
        const viewStorageFolderBtn = document.getElementById('viewStorageFolderBtn');
        if (viewStorageFolderBtn) viewStorageFolderBtn.onclick = () => this.viewStorageFolder();
        document.getElementById('addMusicFilesBtn').onclick = () => this.addMusicFolders();
        document.getElementById('downloadMusicBtn').onclick = () => {
            this.toggleDownloadPanel();
        };
        
        // Auto-hide dropdown on mouse leave
        const dropdownContainer = document.querySelector('.dropdown-container');
        dropdownContainer.onmouseleave = () => {
            this.dropdownHideTimeout = setTimeout(() => {
                document.getElementById('categoryDropdown').style.display = 'none';
            }, 500);
        };
        
        dropdownContainer.onmouseenter = () => {
            if (this.dropdownHideTimeout) {
                clearTimeout(this.dropdownHideTimeout);
                this.dropdownHideTimeout = null;
            }
        };
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown-container')) {
                document.getElementById('categoryDropdown').style.display = 'none';
            }
        });
    }

    setupDownloadPanel() {
        if (this.downloadPanelInitialized || !this.downloadPanel) return;
        this.downloadPanelInitialized = true;

        if (this.downloadCloseBtn) {
            this.downloadCloseBtn.onclick = () => this.showMusicView();
        }
        if (this.downloadSearchTabs) {
            this.downloadSearchTabs.onclick = (e) => {
                const tab = e.target.closest('.download-tab');
                if (!tab) return;
                const type = tab.dataset.type;
                if (!type) return;
                this.setDownloadSearchType(type);
            };
        }
        if (this.dabLoginBtn) this.dabLoginBtn.onclick = () => this.handleDabLogin();
        if (this.dabRegisterBtn) this.dabRegisterBtn.onclick = () => this.handleDabRegister();
        if (this.dabForgotPassword) this.dabForgotPassword.onclick = () => this.handleDabForgotPassword();
        if (this.dabShowRegisterBtn) {
            this.dabShowRegisterBtn.onclick = () => {
                this.setDabAuthMode('register');
                this.setDabStatus('Create a new account');
                if (this.dabUsernameInput && !this.dabUsernameInput.value.trim()) {
                    const seed = String(this.dabEmailInput?.value || '').trim().split('@')[0];
                    if (seed) {
                        this.dabUsernameInput.value = seed.replace(/[^a-zA-Z0-9_]/g, '_');
                    }
                }
                if (this.dabPasswordInput) this.dabPasswordInput.value = '';
                if (this.dabConfirmPasswordInput) this.dabConfirmPasswordInput.value = '';
            };
        }
        if (this.dabShowLoginBtn) {
            this.dabShowLoginBtn.onclick = () => {
                this.setDabAuthMode('login');
                this.setDabStatus('Not logged in');
                if (this.dabPasswordInput) this.dabPasswordInput.value = '';
                if (this.dabConfirmPasswordInput) this.dabConfirmPasswordInput.value = '';
            };
        }
        if (this.dabLogoutBtn) this.dabLogoutBtn.onclick = () => this.handleDabLogout();
        if (this.downloadLogsToggleBtn) this.downloadLogsToggleBtn.onclick = () => this.toggleDownloadLogs();
        if (this.downloadCopyLogsBtn) this.downloadCopyLogsBtn.onclick = () => this.copyDownloadLogs();
        if (this.downloadClearLogsBtn) this.downloadClearLogsBtn.onclick = () => this.clearDownloadLogs();

        if (this.downloadResultsEl) {
            this.downloadResultsEl.onclick = (e) => this.handleDownloadResultClick(e);
        }

        if (!this.downloadIpcBound) {
            ipcRenderer.on('dab-log', (event, payload) => this.handleDabLog(payload));
            ipcRenderer.on('dab-exit', (event, payload) => this.handleDabExit(payload));
            this.downloadIpcBound = true;
        }

        this.setDabAuthMode('login');
        this.refreshDownloadSettings();
    }

    toggleDownloadPanel() {
        if (!this.downloadPanel) return;
        const isVisible = window.getComputedStyle(this.downloadPanel).display !== 'none';
        if (isVisible) {
            this.showMusicView();
            return;
        }

        if (this.selectionMode) this.disableSelectionMode();
        this.hideAllPanels();
        this.downloadPanel.style.display = 'flex';
        this.leftPanel.classList.add('download-active');
        this.leftPanel.classList.remove('settings-active');
        document.body.classList.remove('settings-open');
        document.body.classList.add('download-open');
        if (this.downloadMusicBtn) this.downloadMusicBtn.classList.add('active');
        this.currentView = 'download';
        if (this.searchInput) {
            this.librarySearchValue = this.searchInput.value;
            this.searchInput.value = '';
            this.searchInput.placeholder = this.dabLoggedIn ? 'Search online catalog...' : 'Log in to search the catalog';
        }
        if (this.downloadLogsPanel) this.downloadLogsPanel.style.display = 'none';
        if (this.downloadLogsToggleBtn) this.downloadLogsToggleBtn.textContent = 'Logs';
        this.refreshDownloadSettings();
        this.renderDownloadResults();
    }

    setDownloadSearchType(type) {
        if (!type) return;
        this.downloadSearchType = type;
        if (this.downloadSearchTabs) {
            this.downloadSearchTabs.querySelectorAll('.download-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.type === type);
            });
        }
    }

    async refreshDownloadSettings() {
        try {
            const settings = await ipcRenderer.invoke('dab-get-settings');
            this.downloadSettings = settings || {};
            this.dabLoggedIn = !!settings?.loggedIn;
            if (!this.dabUserName) {
                this.dabUserName = this.getSavedDabUserName();
            }
            this.setDabStatus(this.dabLoggedIn ? 'Logged in' : 'Not logged in', this.dabLoggedIn);
            this.updateAuthUI();
            if (!this.dabLoggedIn) {
                this.setDownloadResultsStatus('Please log in to search the catalog.');
            } else if (!this.searchInput?.value?.trim()) {
                this.setDownloadResultsStatus('');
            }
        } catch (error) {
            console.error('Failed to load DAB settings:', error);
        }
    }

    setDabStatus(message, ok = false) {
        if (!this.dabStatusEl) return;
        this.dabStatusEl.textContent = message;
        this.dabStatusEl.style.color = ok ? '#3ddc97' : '';
    }

    setDabAuthMode(mode = 'login') {
        const nextMode = mode === 'register' ? 'register' : 'login';
        this.dabAuthMode = nextMode;
        const isRegister = nextMode === 'register';

        if (this.dabAuthTitleEl) {
            this.dabAuthTitleEl.textContent = isRegister ? 'Register' : 'Login';
        }
        if (this.dabAuthSubtitleEl) {
            this.dabAuthSubtitleEl.textContent = isRegister
                ? 'Create an account to download music.'
                : 'You need to sign up to download music, or log in if you already have an account.';
        }
        if (this.dabForgotPassword) {
            this.dabForgotPassword.style.display = isRegister ? 'none' : 'block';
        }
        if (this.dabUsernameField) {
            this.dabUsernameField.style.display = isRegister ? 'flex' : 'none';
        }
        if (this.dabLoginBtn) {
            this.dabLoginBtn.style.display = isRegister ? 'none' : 'block';
        }
        if (this.dabConfirmPasswordField) {
            this.dabConfirmPasswordField.style.display = isRegister ? 'flex' : 'none';
        }
        if (this.dabRegisterBtn) {
            this.dabRegisterBtn.style.display = isRegister ? 'block' : 'none';
        }
        if (this.dabAuthFooterLogin) {
            this.dabAuthFooterLogin.style.display = isRegister ? 'none' : 'block';
        }
        if (this.dabAuthFooterRegister) {
            this.dabAuthFooterRegister.style.display = isRegister ? 'block' : 'none';
        }
    }

    setDownloadResultsStatus(message, options = {}) {
        if (!this.downloadResultsStatus) return;
        if (options.html) {
            this.downloadResultsStatus.innerHTML = message;
        } else {
            this.downloadResultsStatus.textContent = message;
        }
    }

    getDownloadResultKey(track, explicitKind = null) {
        if (!track) return '';
        const kind = String(explicitKind || track.kind || 'track').toLowerCase();
        const normalize = (value) => String(value || '').trim().toLowerCase();
        const primitiveId = (value) => {
            if (value === null || value === undefined) return '';
            if (typeof value === 'string' || typeof value === 'number') {
                return String(value);
            }
            if (typeof value === 'object') {
                const nested = value.id ?? value.trackId ?? value.albumId ?? value.artistId ?? value.value ?? '';
                if (nested === null || nested === undefined) return '';
                if (typeof nested === 'string' || typeof nested === 'number') return String(nested);
            }
            return '';
        };

        if (kind === 'artist') {
            const id = primitiveId(track.id) || primitiveId(track.artistId);
            return id ? `artist:${normalize(id)}` : '';
        }
        if (kind === 'album') {
            const id = primitiveId(track.id) || primitiveId(track.albumId);
            return id ? `album:${normalize(id)}` : '';
        }

        const id = primitiveId(track.id) || primitiveId(track.isrc);
        return id ? `track:${normalize(id)}` : '';
    }

    getDownloadStateForResult(track, kind) {
        const key = this.getDownloadResultKey(track, kind);
        if (!key) return { key: '', state: 'idle', progress: 0 };

        const matchingItems = this.downloadQueueItems.filter(item => item.downloadKey === key);
        if (!matchingItems.length) {
            if (this.downloadCompletedKeys.has(key)) return { key, state: 'done', progress: 100 };
            return { key, state: 'idle', progress: 0 };
        }

        const matchingStatuses = matchingItems.map(item => item.status);
        const activeItems = matchingItems.filter(item => (
            item.status === 'running' || item.status === 'queued' || item.status === 'cancelling'
        ));
        const progressSource = activeItems.length ? activeItems : matchingItems;
        const progress = progressSource.reduce((max, item) => {
            const value = Number(item.progress);
            if (!Number.isFinite(value)) return max;
            const clamped = Math.max(0, Math.min(100, value));
            return Math.max(max, clamped);
        }, 0);

        if (matchingStatuses.includes('cancelling')) return { key, state: 'cancelling', progress };
        if (matchingStatuses.includes('running')) return { key, state: 'running', progress };
        if (matchingStatuses.includes('queued')) return { key, state: 'queued', progress };

        const latestItem = matchingItems.reduce((latest, item) => {
            const latestRank = Number(latest?.createdAt || latest?.id || 0);
            const itemRank = Number(item?.createdAt || item?.id || 0);
            return itemRank >= latestRank ? item : latest;
        }, null);

        if (latestItem?.status === 'error') return { key, state: 'error', progress };
        if (latestItem?.status === 'cancelled') return { key, state: 'cancelled', progress };
        if (latestItem?.status === 'done') return { key, state: 'done', progress: 100 };
        if (this.downloadCompletedKeys.has(key)) return { key, state: 'done', progress: 100 };
        return { key, state: 'idle', progress };
    }

    getDownloadTypeLabel(type) {
        switch (type) {
            case 'album':
                return 'Albums';
            case 'artist':
                return 'Artists';
            default:
                return 'Tracks';
        }
    }

    getSavedDabUserName() {
        try {
            return localStorage.getItem('vimusic-dab-user') || '';
        } catch {
            return '';
        }
    }

    setLoggedInUser(email) {
        this.dabUserName = email || '';
        try {
            if (email) {
                localStorage.setItem('vimusic-dab-user', email);
            } else {
                localStorage.removeItem('vimusic-dab-user');
            }
        } catch {}
        this.updateAuthUI();
    }

    updateAuthUI() {
        const loggedIn = this.dabLoggedIn;
        const displayName = this.dabUserName || 'Account';

        if (this.downloadPanel) {
            this.downloadPanel.classList.toggle('download-logged-out', !loggedIn);
            this.downloadPanel.classList.toggle('download-logged-in-minimal', loggedIn);
        }
        if (document.body) {
            document.body.classList.toggle('download-minimal', loggedIn && this.currentView === 'download');
        }
        if (this.downloadLoggedInActions) {
            this.downloadLoggedInActions.style.display = loggedIn ? 'flex' : 'none';
        }
        if (this.downloadUserBadge) {
            this.downloadUserBadge.style.display = loggedIn ? 'inline-flex' : 'none';
        }
        if (this.downloadUserName) {
            this.downloadUserName.textContent = displayName;
        }
        if (this.downloadAuthCard) {
            this.downloadAuthCard.style.display = loggedIn ? 'none' : 'flex';
        }
        if (this.downloadAuthFields) {
            this.downloadAuthFields.style.display = loggedIn ? 'none' : 'flex';
        }
        if (this.downloadPostLogin) {
            this.downloadPostLogin.style.display = loggedIn ? 'flex' : 'none';
        }
        if (this.dabLogoutBtn) {
            this.dabLogoutBtn.style.display = loggedIn ? 'inline-flex' : 'none';
        }
        if (!loggedIn) {
            if (this.downloadLogsPanel) this.downloadLogsPanel.style.display = 'none';
            this.setDabAuthMode(this.dabAuthMode);
        }
        if (this.downloadLogsToggleBtn && this.downloadLogsPanel) {
            const logsVisible = window.getComputedStyle(this.downloadLogsPanel).display !== 'none';
            this.downloadLogsToggleBtn.textContent = logsVisible ? 'Hide Logs' : 'Logs';
        }
    }

    setDownloadStatus(message) {
        if (this.downloadStatusEl) this.downloadStatusEl.textContent = message;
    }

    async handleDabLogin() {
        const email = this.dabEmailInput?.value?.trim();
        const password = this.dabPasswordInput?.value ?? '';

        if (!email || !password) {
            this.showNotification('Enter email and password', 'error');
            return;
        }

        this.setDabStatus('Logging in...');
        const result = await ipcRenderer.invoke('dab-login', { email, password });
        if (result?.ok) {
            this.showNotification('Login successful', 'success');
            if (this.dabPasswordInput) this.dabPasswordInput.value = '';
            this.dabLoggedIn = true;
            this.setLoggedInUser(email);
            this.setDabAuthMode('login');
            await this.refreshDownloadSettings();
            if (this.searchInput && this.currentView === 'download') {
                this.searchInput.placeholder = 'Search online catalog...';
            }
        } else {
            this.setDabStatus(result?.error || 'Login failed');
            this.showNotification(result?.error || 'Login failed', 'error');
        }
    }

    async handleDabRegister() {
        const username = this.dabUsernameInput?.value?.trim();
        const email = this.dabEmailInput?.value?.trim();
        const password = this.dabPasswordInput?.value ?? '';
        const confirmPassword = this.dabConfirmPasswordInput?.value ?? '';

        if (!username || !email || !password || !confirmPassword) {
            this.showNotification('Enter username, email, password, and confirm password', 'error');
            return;
        }
        if (password !== confirmPassword) {
            this.showNotification('Password and confirm password do not match', 'error');
            return;
        }

        this.setDabStatus('Creating account...');
        const result = await ipcRenderer.invoke('dab-register', { username, email, password });
        if (result?.ok) {
            this.dabLoggedIn = false;
            this.setDabAuthMode('login');
            if (this.dabEmailInput) this.dabEmailInput.value = email;
            if (this.dabPasswordInput) this.dabPasswordInput.value = '';
            if (this.dabConfirmPasswordInput) this.dabConfirmPasswordInput.value = '';
            this.setDabStatus('Registration successful. Please log in.');
            this.showNotification('Registration successful. Please log in.', 'success');
            if (this.dabPasswordInput) this.dabPasswordInput.focus();
            return;
        }

        this.setDabStatus(result?.error || 'Registration failed');
        this.showNotification(result?.error || 'Registration failed', 'error');
    }

    async handleDabForgotPassword() {
        const email = this.dabEmailInput?.value?.trim();
        if (!email) {
            this.showNotification('Enter your email first', 'info');
            return;
        }

        this.setDabStatus('Sending reset link...');
        const result = await ipcRenderer.invoke('dab-forgot-password', { email });
        if (result?.ok) {
            this.setDabStatus(result.message || 'Password reset link sent');
            this.showNotification(result.message || 'Password reset link sent', 'success');
            return;
        }

        this.setDabStatus(result?.error || 'Failed to send reset link');
        this.showNotification(result?.error || 'Failed to send reset link', 'error');
    }

    async handleDabLogout() {
        await ipcRenderer.invoke('dab-logout');
        this.showNotification('Logged out', 'info');
        this.dabLoggedIn = false;
        this.setLoggedInUser('');
        this.setDabAuthMode('login');
        if (this.dabPasswordInput) this.dabPasswordInput.value = '';
        if (this.dabConfirmPasswordInput) this.dabConfirmPasswordInput.value = '';
        await this.refreshDownloadSettings();
        if (this.searchInput && this.currentView === 'download') {
            this.searchInput.placeholder = 'Log in to search the catalog';
        }
    }

    async performDownloadSearch() {
        const query = this.searchInput?.value?.trim();
        if (!query) {
            this.showNotification('Enter a search term', 'info');
            return;
        }
        if (!this.dabLoggedIn) {
            this.showNotification('Please login to search', 'info');
            return;
        }

        const requestToken = ++this.downloadSearchToken;
        this.downloadSearchLoading = true;
        this.setDownloadStatus('Searching...');
        this.downloadLastQuery = query;
        const typeLabel = this.getDownloadTypeLabel(this.downloadSearchType);
        this.setDownloadResultsStatus(`Searching for: <span class="download-results-highlight">${typeLabel}</span>...`, { html: true });
        this.downloadResults = [];
        this.renderDownloadResults();

        try {
            const result = await ipcRenderer.invoke('dab-search', { query, type: this.downloadSearchType });
            if (requestToken !== this.downloadSearchToken) return;

            if (!result?.ok) {
                this.setDownloadStatus(result?.error || 'Search failed');
                this.showNotification(result?.error || 'Search failed', 'error');
                this.setDownloadResultsStatus(result?.error || 'Search failed.');
                this.downloadResults = [];
                return;
            }

            this.downloadResults = Array.isArray(result.results) ? result.results : [];
            const count = this.downloadResults.length;
            this.downloadLastCount = count;
            this.setDownloadStatus(count ? `Found ${count} result${count === 1 ? '' : 's'}` : 'No results');
            const noun = typeLabel.toLowerCase();
            const countLabel = `(${count} unique ${noun}${count === 1 ? '' : 's'} loaded)`;
            this.setDownloadResultsStatus(`Searching for: <span class="download-results-highlight">${typeLabel}</span> ${countLabel}`, { html: true });
        } catch (error) {
            if (requestToken !== this.downloadSearchToken) return;
            console.error('Download search failed:', error);
            this.setDownloadStatus('Search failed');
            this.showNotification('Search failed', 'error');
            this.setDownloadResultsStatus('Search failed.');
            this.downloadResults = [];
        } finally {
            if (requestToken === this.downloadSearchToken) {
                this.downloadSearchLoading = false;
                this.renderDownloadResults();
            }
        }
    }

    renderDownloadResults() {
        if (!this.downloadResultsEl) return;
        const results = Array.isArray(this.downloadResults) ? this.downloadResults : [];

        if (this.downloadSearchLoading) {
            this.downloadResultsEl.innerHTML = `
                <div class="download-loading-state" aria-live="polite" aria-label="Loading search results">
                    <div class="download-loading-spinner" aria-hidden="true"></div>
                </div>
            `;
            return;
        }

        if (!results.length) {
            this.downloadResultsEl.innerHTML = `
                <div class="download-empty${this.dabLoggedIn ? ' download-search-hint' : ''}">${this.dabLoggedIn ? 'Try searching song name with artist name for better result.' : 'Log in to search the catalog.'}</div>
            `;
            return;
        }

        const previewId = this.previewTrack?.id;
        this.downloadResultsEl.innerHTML = results.map((track, index) => {
            const rawKind = String(track.kind || 'track').toLowerCase();
            const kind = rawKind === 'album' || rawKind === 'artist' ? rawKind : 'track';
            const { key, state, progress } = this.getDownloadStateForResult(track, kind);
            const coverUrl = String(track.coverUrl || '').trim().replace(/^['"]+|['"]+$/g, '');
            const cover = coverUrl
                ? `<img src="${this.escapeAttribute(coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                : `<div class="cover-placeholder">🎵</div>`;
            const isPreviewing = previewId !== undefined && previewId !== null && track.id === previewId;
            const showProgress = !!key && (state === 'running' || state === 'queued' || state === 'cancelling');
            const progressNumber = Number(progress);
            const fallbackProgress = state === 'queued' ? 2 : (state === 'running' ? 4 : (state === 'cancelling' ? 99 : 0));
            const progressPercent = Math.max(
                fallbackProgress,
                Number.isFinite(progressNumber) ? Math.max(0, Math.min(100, progressNumber)) : 0
            );
            const rowClasses = `download-result${isPreviewing ? ' is-previewing' : ''}${showProgress ? ' has-download-progress' : ''}`;
            const progressStyle = showProgress ? ` style="--download-progress:${progressPercent.toFixed(1)}%;"` : '';
            const progressMarkup = showProgress
                ? `<div class="download-result-progress" aria-hidden="true"><span class="download-result-progress-fill"></span></div>`
                : '';
            let title = track.title || track.name || 'Unknown';
            let artistLine = '';
            let metaHtml = '';
            let actions = '';

            if (kind === 'track') {
                const artist = track.artist || 'Unknown Artist';
                artistLine = `
                    <div class="download-result-artist">
                        <img src="icons/user.svg" alt="">
                        <span>${this.escapeHtml(artist)}</span>
                    </div>
                `;
                const meta = [];
                if (track.genre) meta.push(this.escapeHtml(track.genre));
                if (track.releaseDate) meta.push(this.escapeHtml(this.formatReleaseDate(track.releaseDate)));
                if (track.duration) meta.push(this.formatDuration(track.duration));
                const quality = this.formatQuality(track);
                if (quality) meta.push(this.escapeHtml(quality));
                metaHtml = meta.length
                    ? `<div class="download-result-meta-row">${meta.map(item => `<span class="download-meta-pill">${item}</span>`).join('')}</div>`
                    : '';
                const previewLabel = isPreviewing ? 'Stop' : 'Play';
                let downloadAction = '';
                if (state === 'done') {
                    downloadAction = `<span class="download-result-done" title="Downloaded">✓ Downloaded</span>`;
                } else if (state === 'running') {
                    downloadAction = `<button class="download-action-btn danger" data-action="cancel-download">Cancel</button>`;
                } else if (state === 'cancelling') {
                    downloadAction = `<button class="download-action-btn danger" disabled>Cancelling...</button>`;
                } else if (state === 'queued') {
                    downloadAction = `<button class="download-action-btn" disabled>Queued</button>`;
                } else {
                    downloadAction = `<button class="download-action-btn primary" data-action="download-track" ${this.downloadInProgress ? 'disabled' : ''}>Download</button>`;
                }
                actions = `
                    <button class="download-action-btn" data-action="play">${previewLabel}</button>
                    ${downloadAction}
                `;
            } else if (kind === 'album') {
                const artist = track.artist || 'Unknown Artist';
                artistLine = `<div class="download-result-sub">${this.escapeHtml(artist)}</div>`;
                const meta = [];
                if (track.year) meta.push(this.escapeHtml(track.year));
                if (track.totalTracks) meta.push(`${track.totalTracks} tracks`);
                metaHtml = meta.length
                    ? `<div class="download-result-meta-row">${meta.map(item => `<span class="download-meta-pill">${item}</span>`).join('')}</div>`
                    : '';
                if (state === 'done') {
                    actions = `<span class="download-result-done" title="Downloaded">✓ Downloaded</span>`;
                } else if (state === 'running') {
                    actions = `<button class="download-action-btn danger" data-action="cancel-download">Cancel</button>`;
                } else if (state === 'cancelling') {
                    actions = `<button class="download-action-btn danger" disabled>Cancelling...</button>`;
                } else if (state === 'queued') {
                    actions = `<button class="download-action-btn" disabled>Queued</button>`;
                } else {
                    actions = `<button class="download-action-btn primary" data-action="download-album" ${this.downloadInProgress ? 'disabled' : ''}>Download</button>`;
                }
            } else if (kind === 'artist') {
                artistLine = `<div class="download-result-sub">Artist</div>`;
                metaHtml = '';
                if (state === 'done') {
                    actions = `<span class="download-result-done" title="Downloaded">✓ Downloaded</span>`;
                } else if (state === 'running') {
                    actions = `<button class="download-action-btn danger" data-action="cancel-download">Cancel</button>`;
                } else if (state === 'cancelling') {
                    actions = `<button class="download-action-btn danger" disabled>Cancelling...</button>`;
                } else if (state === 'queued') {
                    actions = `<button class="download-action-btn" disabled>Queued</button>`;
                } else {
                    actions = `<button class="download-action-btn primary" data-action="download-artist" ${this.downloadInProgress ? 'disabled' : ''}>Download</button>`;
                }
                title = track.name || track.title || 'Unknown Artist';
            }

            return `
                <div class="${rowClasses}" data-index="${index}" data-download-state="${state}"${progressStyle}>
                    <div class="download-result-cover">${cover}</div>
                    <div class="download-result-meta">
                        <div class="download-result-title">${this.escapeHtml(title)}</div>
                        ${artistLine}
                        ${metaHtml}
                    </div>
                    <div class="download-result-actions">${actions}</div>
                    ${progressMarkup}
                </div>
            `;
        }).join('');
    }

    handleDownloadResultClick(event) {
        const actionBtn = event.target.closest('button[data-action]');
        if (!actionBtn) return;
        const row = event.target.closest('.download-result');
        if (!row) return;
        const index = Number(row.dataset.index);
        if (!Number.isInteger(index)) return;
        const track = this.downloadResults?.[index];
        if (!track) return;

        const action = actionBtn.dataset.action;
        if (action === 'play') {
            this.previewDownloadTrack(track);
        } else if (action === 'download-track') {
            this.queueDownloadItem(track, 'track');
        } else if (action === 'download-album') {
            const albumItem = track.kind === 'album' ? track : {
                ...track,
                kind: 'album',
                id: track.albumId || track.id,
                title: track.album || track.title,
                artist: track.artist
            };
            this.queueDownloadItem(albumItem, 'album');
        } else if (action === 'download-artist') {
            const artistItem = track.kind === 'artist' ? track : {
                ...track,
                kind: 'artist',
                id: track.artistId || track.id,
                name: track.artist || track.name
            };
            this.queueDownloadItem(artistItem, 'artist');
        } else if (action === 'cancel-download') {
            this.cancelActiveDownload();
        }
    }

    async previewDownloadTrack(track) {
        if (!track?.id) {
            this.showNotification('Preview not available', 'error');
            return;
        }
        if (!this.dabLoggedIn) {
            this.showNotification('Please login to preview', 'info');
            return;
        }

        if (this.previewMode && this.previewTrack?.id === track.id) {
            this.stopPreviewPlayback();
            return;
        }

        this.setDownloadStatus('Loading preview...');
        const result = await ipcRenderer.invoke('dab-stream-url', { trackId: track.id });
        if (!result?.ok || !result.url) {
            this.showNotification(result?.error || 'Preview failed', 'error');
            this.setDownloadStatus(result?.error || 'Preview failed');
            return;
        }

        this.startPreviewPlayback({
            ...track,
            streamUrl: result.url,
            isPreview: true,
            formatLabel: 'STREAM'
        });
        this.setDownloadStatus(`Previewing "${track.title}"`);
        this.renderDownloadResults();
    }

    queueDownloadItem(item, kind) {
        if (!item) return;
        const title = item.title || item.name || 'Unknown';
        const artist = item.artist || item.name || 'Unknown';
        const job = {
            id: ++this.downloadJobCounter,
            kind,
            item,
            title,
            artist,
            downloadKey: this.getDownloadResultKey(item, kind),
            progress: this.downloadInProgress ? 0 : 3,
            status: this.downloadInProgress ? 'queued' : 'running',
            createdAt: Date.now()
        };

        this.downloadQueueItems.push(job);
        this.renderDownloadResults();

        if (this.downloadInProgress) {
            this.pendingDownloadQueue.push(job);
            this.showNotification(`Added "${title}" to queue`, 'info');
            this.renderDownloadQueue();
            return;
        }

        this.startDownloadJob(job);
    }

    async startDownloadJob(job) {
        if (!job) return;
        if (!this.dabLoggedIn) {
            this.showNotification('Please login to download', 'info');
            return;
        }
        this.downloadInProgress = true;
        this.downloadCancelRequestedForId = null;
        this.activeDownloadJob = job;
        this.downloadProcessId = null;
        if (!job.downloadKey) {
            job.downloadKey = this.getDownloadResultKey(job.item, job.kind);
        }
        job.progress = Math.max(3, Number(job.progress) || 0);
        job.status = 'running';
        this.renderDownloadQueue();
        this.clearDownloadLogs();

        const settings = await ipcRenderer.invoke('dab-get-settings');
        const downloadPath = settings?.downloadPath;
        if (downloadPath) {
            await ipcRenderer.invoke('add-music-folders', [downloadPath]);
        }

        this.setDownloadStatus(`Downloading "${job.title}"`);
        this.renderDownloadResults();

        const result = await ipcRenderer.invoke('dab-download-track', {
            kind: job.kind,
            track: job.item,
            apiUrl: settings?.apiUrl,
            downloadPath
        });

        if (!result?.ok) {
            job.status = 'error';
            job.error = result?.error || 'Download failed to start';
            this.downloadInProgress = false;
            this.activeDownloadJob = null;
            this.setDownloadStatus(job.error);
            this.showNotification(job.error, 'error');
            this.renderDownloadQueue();
            this.renderDownloadResults();
            this.startNextQueuedDownload();
            return;
        }

        this.downloadProcessId = result.id;
    }

    async cancelActiveDownload() {
        if (!this.downloadInProgress || !this.downloadProcessId || !this.activeDownloadJob) {
            this.showNotification('No active download to cancel', 'info');
            return;
        }

        const activeJob = this.activeDownloadJob;
        if (activeJob.status === 'cancelling') return;

        this.downloadCancelRequestedForId = this.downloadProcessId;
        activeJob.status = 'cancelling';
        this.setDownloadStatus(`Cancelling "${activeJob.title}"...`);
        this.renderDownloadQueue();
        this.renderDownloadResults();

        try {
            const result = await ipcRenderer.invoke('dab-cancel-download', this.downloadProcessId);
            if (result?.ok) return;

            this.downloadCancelRequestedForId = null;
            if (this.activeDownloadJob === activeJob && activeJob.status === 'cancelling') {
                activeJob.status = 'running';
            }
            this.setDownloadStatus(result?.error || 'Failed to cancel download');
            this.showNotification(result?.error || 'Failed to cancel download', 'error');
            this.renderDownloadQueue();
            this.renderDownloadResults();
        } catch (error) {
            this.downloadCancelRequestedForId = null;
            if (this.activeDownloadJob === activeJob && activeJob.status === 'cancelling') {
                activeJob.status = 'running';
            }
            this.setDownloadStatus('Failed to cancel download');
            this.showNotification('Failed to cancel download', 'error');
            this.renderDownloadQueue();
            this.renderDownloadResults();
        }
    }

    startNextQueuedDownload() {
        if (this.downloadInProgress) return;
        const next = this.pendingDownloadQueue.shift();
        if (next) {
            this.startDownloadJob(next);
        }
    }

    scheduleDownloadStateRender() {
        if (this.downloadStateRenderRaf) return;
        this.downloadStateRenderRaf = window.requestAnimationFrame(() => {
            this.downloadStateRenderRaf = 0;
            this.renderDownloadQueue();
            this.renderDownloadResults();
        });
    }

    updateActiveDownloadProgress(progressValue) {
        const job = this.activeDownloadJob;
        if (!job) return;
        const numeric = Number(progressValue);
        if (!Number.isFinite(numeric)) return;

        const clamped = Math.max(0, Math.min(100, numeric));
        const previous = Number(job.progress);
        const safePrevious = Number.isFinite(previous) ? previous : 0;
        if (clamped <= safePrevious && clamped < 100) return;

        job.progress = clamped;
        this.scheduleDownloadStateRender();
    }

    handleDabLog(payload) {
        if (!payload) return;
        if (this.downloadProcessId && payload.id !== this.downloadProcessId) return;
        const message = String(payload.message || '').replace(/\r/g, '\n');
        const lines = message.split('\n').filter(line => line.trim().length);
        lines.forEach(line => {
            this.appendDownloadLog(line);
            const percentMatch = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
            if (percentMatch) {
                this.updateActiveDownloadProgress(parseFloat(percentMatch[1]));
            }
        });
    }

    handleDabExit(payload) {
        if (!payload) return;
        if (this.downloadProcessId && payload.id !== this.downloadProcessId) return;

        const wasCancelled = this.downloadCancelRequestedForId !== null && payload.id === this.downloadCancelRequestedForId;
        this.downloadCancelRequestedForId = null;
        this.downloadInProgress = false;
        this.downloadProcessId = null;
        const successByExitCode = !wasCancelled && payload.code === 0;
        const downloadedFileDetected = payload.downloadedFileDetected === true;
        const success = successByExitCode && downloadedFileDetected;
        const noFileDownloaded = successByExitCode && !downloadedFileDetected;
        const job = this.activeDownloadJob;
        if (job) {
            if (wasCancelled) {
                job.status = 'cancelled';
                job.error = 'Download cancelled';
            } else {
                job.status = success ? 'done' : 'error';
                if (success && job.downloadKey) {
                    job.progress = 100;
                    this.downloadCompletedKeys.add(job.downloadKey);
                }
                if (!success) {
                    if (job.downloadKey) {
                        this.downloadCompletedKeys.delete(job.downloadKey);
                    }
                    job.error = job.error || (noFileDownloaded ? 'No new files were downloaded' : 'Download failed');
                }
            }
        }
        this.activeDownloadJob = null;
        const statusMessage = wasCancelled
            ? 'Download cancelled'
            : success
                ? 'Download complete'
                : (noFileDownloaded ? 'No files downloaded' : 'Download failed');
        this.setDownloadStatus(statusMessage);
        this.showNotification(statusMessage, wasCancelled || noFileDownloaded ? 'info' : (success ? 'success' : 'error'));
        this.renderDownloadQueue();
        this.renderDownloadResults();

        if (success) {
            setTimeout(() => this.loadMusic(), 1000);
        }
        this.startNextQueuedDownload();
    }

    appendDownloadLog(line) {
        if (!line || !this.downloadLogsEl) return;
        this.downloadLogs.push(line);
        if (this.downloadLogs.length > 200) {
            this.downloadLogs.shift();
        }
        this.downloadLogsEl.textContent = this.downloadLogs.join('\n');
        this.downloadLogsEl.scrollTop = this.downloadLogsEl.scrollHeight;
    }

    clearDownloadLogs() {
        this.downloadLogs = [];
        if (this.downloadLogsEl) this.downloadLogsEl.textContent = '';
    }

    async copyDownloadLogs() {
        const text = Array.isArray(this.downloadLogs) ? this.downloadLogs.join('\n') : '';
        if (!text.trim()) {
            this.showNotification('No logs to copy', 'info');
            return;
        }

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const temp = document.createElement('textarea');
                temp.value = text;
                temp.setAttribute('readonly', '');
                temp.style.position = 'absolute';
                temp.style.left = '-9999px';
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                temp.remove();
            }
            this.showNotification('Logs copied', 'success');
        } catch (error) {
            console.error('Failed to copy logs:', error);
            this.showNotification('Failed to copy logs', 'error');
        }
    }

    toggleDownloadLogs() {
        if (!this.downloadLogsPanel || !this.downloadLogsToggleBtn) return;
        const isVisible = window.getComputedStyle(this.downloadLogsPanel).display !== 'none';
        this.downloadLogsPanel.style.display = isVisible ? 'none' : 'flex';
        this.downloadLogsToggleBtn.textContent = isVisible ? 'Logs' : 'Hide Logs';
        if (!isVisible && this.downloadLogsEl) {
            this.downloadLogsEl.scrollTop = this.downloadLogsEl.scrollHeight;
        }
    }

    renderDownloadQueue() {
        if (!this.downloadQueueEl) return;
        const items = Array.isArray(this.downloadQueueItems) ? this.downloadQueueItems : [];
        if (!items.length) {
            this.downloadQueueEl.innerHTML = `<div class="download-empty">No downloads yet.</div>`;
            return;
        }

        this.downloadQueueEl.innerHTML = items.map(item => {
            const statusLabel = item.status === 'running'
                ? 'Running'
                : item.status === 'cancelling'
                  ? 'Cancelling'
                : item.status === 'queued'
                  ? 'Queued'
                : item.status === 'done'
                    ? 'Done'
                    : item.status === 'cancelled'
                      ? 'Cancelled'
                    : 'Error';
            const subtitle = item.kind === 'artist'
                ? 'Artist'
                : item.kind === 'album'
                  ? (item.artist || 'Album')
                  : (item.artist || 'Track');
            return `
                <div class="download-queue-item" data-status="${item.status}">
                    <div class="download-queue-meta">
                        <div class="download-queue-title">${this.escapeHtml(item.title)}</div>
                        <div class="download-queue-sub">${this.escapeHtml(subtitle)}</div>
                    </div>
                    <div class="download-queue-status">${statusLabel}</div>
                </div>
            `;
        }).join('');
    }

    clearFinishedDownloads() {
        this.downloadQueueItems = this.downloadQueueItems.filter(item => item.status === 'running' || item.status === 'queued');
        this.pendingDownloadQueue = this.pendingDownloadQueue.filter(item => item.status === 'queued');
        this.renderDownloadQueue();
    }

    startPreviewPlayback(track) {
        if (!track?.streamUrl) return;
        this.previewMode = true;
        this.previewTrack = track;
        this.setPreviewOptionState(true);

        if (this.isVideoMode) {
            this.pauseVideo();
        } else {
            this.pause();
        }

        this.hideVideoPlayer();
        this.videoElement.pause();
        this.videoElement.src = '';

        this.audio.src = track.streamUrl;
        this.audio.preload = 'auto';
        this.audio.muted = false;

        this.detailTitle.textContent = `${track.title || 'Unknown Title'} (Preview)`;
        this.detailArtist.textContent = track.artist || 'Unknown Artist';
        this.detailFormat.textContent = track.formatLabel || 'STREAM';
        if (track.duration) {
            this.detailDuration.textContent = this.formatDuration(track.duration);
        }

        if (this.currentImageUrl) {
            URL.revokeObjectURL(this.currentImageUrl);
            this.currentImageUrl = null;
        }

        const coverContainer = this.albumCoverMedia || this.albumCover;
        if (track.coverUrl) {
            coverContainer.innerHTML = '';
            this.albumCover.style.display = 'flex';
            const img = document.createElement('img');
            img.src = track.coverUrl;
            img.alt = 'Album Cover';
            coverContainer.appendChild(img);
            this.updateVisualizerColorFromImageUrl(track.coverUrl);
        } else {
            coverContainer.innerHTML = '<div class="cover-placeholder">🎵</div>';
        }

        this.lyrics = [];
        this.lyricsDiv.innerHTML = `
            <div class="no-lyrics-container">
                <p class="no-lyrics">Preview mode</p>
                <div class="lyrics-instructions">
                    <ul class="instruction-list">
                        <li>Lyrics are not available for previews</li>
                        <li>Download the track to add synced lyrics</li>
                    </ul>
                </div>
            </div>
        `;

        void this.updateMediaSessionForSong(track);
        this.enableControls();
        this.updatePreviewBar();
        this.play();
    }

    stopPreviewPlayback() {
        if (!this.previewMode) return;
        this.previewMode = false;
        this.previewTrack = null;
        this.pause();
        this.setDownloadStatus('Preview stopped');
        this.updatePreviewBar();
        this.renderDownloadResults();
        this.setPreviewOptionState(false);
        this.updateMediaAvailabilityButtons();
        this.updateTimingControls();
        this.updateVisualizerAvailability();
    }

    updatePreviewBar() {
        if (!this.downloadPreviewBar || !this.downloadPreviewTitle) return;
        if (this.previewMode && this.previewTrack) {
            this.downloadPreviewTitle.textContent = `Previewing: ${this.previewTrack.title || 'Unknown Title'}`;
            this.downloadPreviewBar.style.display = 'flex';
        } else {
            this.downloadPreviewBar.style.display = 'none';
        }
    }

    formatDuration(seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value) || value <= 0) return '--:--';
        const minutes = Math.floor(value / 60);
        const remainingSeconds = Math.floor(value % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    formatReleaseDate(value) {
        if (!value) return '';
        const text = String(value).trim();
        if (!text) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
        if (/^\d{4}$/.test(text)) return text;
        const parsed = new Date(text);
        if (Number.isNaN(parsed.getTime())) return text;
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    formatQuality(track) {
        const bitDepth = Number(track?.bitDepth);
        const sampleRate = Number(track?.sampleRate);
        if (!Number.isFinite(bitDepth) || !Number.isFinite(sampleRate)) return '';
        if (bitDepth <= 0 || sampleRate <= 0) return '';
        const rateKhz = sampleRate >= 1000 ? (sampleRate / 1000).toFixed(1) : sampleRate.toFixed(1);
        return `${bitDepth}bit / ${rateKhz}kHz`;
    }
    
    setupPlaylistNameEdit(playlistName) {
        const editIcon = document.getElementById('playlistEditIcon');
        const titleElement = document.getElementById('playlistTitle');
        const inputElement = document.getElementById('playlistTitleInput');
        
        if (!editIcon || !titleElement || !inputElement) return;
        
        // Remove existing handlers to prevent duplicates
        editIcon.onclick = null;
        inputElement.onkeydown = null;
        inputElement.onblur = null;
        
        let isEditing = false;
        
        editIcon.onclick = (e) => {
            e.stopPropagation();
            if (isEditing) return;
            
            isEditing = true;
            titleElement.style.display = 'none';
            editIcon.style.display = 'none';
            inputElement.style.display = 'block';
            inputElement.value = playlistName;
            
            // Use setTimeout to ensure proper focus
            setTimeout(() => {
                inputElement.focus();
                inputElement.select();
            }, 10);
        };
        
        const saveEdit = () => {
            if (!isEditing) return;
            
            const newName = inputElement.value.trim();
            if (newName && newName !== playlistName && newName.length > 0) {
                if (this.playlists[newName]) {
                    this.showNotification('Playlist name already exists', 'error');
                    inputElement.focus();
                    inputElement.select();
                    return;
                }
                this.renamePlaylist(playlistName, newName);
            }
            
            // Reset UI state
            isEditing = false;
            titleElement.style.display = 'block';
            editIcon.style.display = 'block';
            inputElement.style.display = 'none';
        };
        
        const cancelEdit = () => {
            if (!isEditing) return;
            
            isEditing = false;
            titleElement.style.display = 'block';
            editIcon.style.display = 'block';
            inputElement.style.display = 'none';
        };
        
        inputElement.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        };
        
        inputElement.onblur = () => {
            // Small delay to prevent conflicts with other events
            setTimeout(saveEdit, 100);
        };
    }
    
    renamePlaylist(oldName, newName) {
        const playlistData = this.playlists[oldName];
        this.playlists[newName] = playlistData;
        delete this.playlists[oldName];
        
        const index = this.playlistOrder.indexOf(oldName);
        if (index !== -1) this.playlistOrder[index] = newName;
        
        if (this.currentPlaylist === oldName) {
            this.currentPlaylist = newName;
        }
        
        this.savePlaylists();
        this.displayPlaylists();
        
        // Update the displayed title immediately
        document.getElementById('playlistTitle').textContent = newName;
        
        const playlistSongs = this.getPlaylistSongs(newName);
        this.showPlaylistDetails(newName, playlistSongs.length, playlistSongs);
        this.showNotification(`Playlist renamed to "${newName}"`, 'success');
    }
    
    setupPlaylistBgEdit(playlistName) {
        const bgEditIcon = document.getElementById('playlistBgEditIcon');
        if (!bgEditIcon) return;
        
        // Remove existing handler
        bgEditIcon.onclick = null;
        
        bgEditIcon.onclick = async () => {
            try {
                const result = await ipcRenderer.invoke('browse-image-file');
                if (result && !result.canceled && result.filePaths.length > 0) {
                    const imagePath = result.filePaths[0];
                    this.setPlaylistBackground(playlistName, imagePath);
                }
            } catch (error) {
                this.showNotification('Error selecting image', 'error');
            }
        };
    }
    
    setPlaylistBackground(playlistName, imagePath) {
        const playlistData = this.playlists[playlistName];
        
        if (Array.isArray(playlistData)) {
            this.playlists[playlistName] = {
                songs: playlistData,
                pinned: false,
                backgroundImage: imagePath
            };
        } else {
            playlistData.backgroundImage = imagePath;
        }
        
        this.savePlaylists();
        
        const panel = document.getElementById('playlistDetailsPanel');
        panel.style.backgroundImage = `url('file:///${imagePath.replace(/\\/g, '/')}')`;
        
        this.showNotification('Background image updated', 'success');
    }
    
    loadPlaylists() {
        const saved = localStorage.getItem('vimusic-playlists');
        this.playlists = saved ? JSON.parse(saved) : {};
        const savedOrder = localStorage.getItem('vimusic-playlist-order');
        this.playlistOrder = savedOrder ? JSON.parse(savedOrder) : Object.keys(this.playlists);
    }
    
    savePlaylists() {
        localStorage.setItem('vimusic-playlists', JSON.stringify(this.playlists));
        localStorage.setItem('vimusic-playlist-order', JSON.stringify(this.playlistOrder));
    }
    
    displayPlaylists() {
        const playlistList = document.getElementById('playlistList');
        playlistList.innerHTML = '';
        
        // Use custom order, add new playlists to end
        const allPlaylists = Object.keys(this.playlists);
        const orderedPlaylists = [...this.playlistOrder.filter(name => this.playlists[name])];
        allPlaylists.forEach(name => {
            if (!orderedPlaylists.includes(name)) orderedPlaylists.push(name);
        });
        this.playlistOrder = orderedPlaylists;
        
        // Sort to put pinned playlists first
        orderedPlaylists.sort((a, b) => {
            const aData = this.playlists[a];
            const bData = this.playlists[b];
            const aPinned = Array.isArray(aData) ? false : (aData.pinned || false);
            const bPinned = Array.isArray(bData) ? false : (bData.pinned || false);
            
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            return 0;
        });
        
        orderedPlaylists.forEach(name => {
            const playlistData = this.playlists[name];
            // Handle both old array format and new object format
            const songs = Array.isArray(playlistData) ? playlistData : (playlistData.songs || []);
            const isPinned = Array.isArray(playlistData) ? false : (playlistData.pinned || false);
            
            const item = document.createElement('div');
            item.className = 'playlist-item';
            if (this.currentPlaylist === name) item.classList.add('active');
            if (isPinned) item.classList.add('pinned');
            
            item.innerHTML = `
                <img src="${this.getPlaylistCoverUrl(name)}" class="playlist-icon">
                <span class="playlist-name">${name}</span>
                <span class="playlist-count">${songs.length}</span>
            `;
            
            item.onclick = () => this.loadPlaylist(name);
            item.oncontextmenu = (e) => {
                e.preventDefault();
                this.showPlaylistContextMenu(e.clientX, e.clientY, name);
            };
            // Remove drag and drop for now
            // item.ondragover = (e) => {
            //     e.preventDefault();
            //     item.classList.add('drag-over');
            // };
            // item.ondragleave = () => {
            //     item.classList.remove('drag-over');
            // };
            // item.ondrop = async (e) => {
            //     e.preventDefault();
            //     item.classList.remove('drag-over');
            //     
            //     if (e.dataTransfer.files.length > 0) {
            //         // Handle file drops
            //         await this.handlePlaylistFileDrop(e.dataTransfer.files, name);
            //     }
            // };
            playlistList.appendChild(item);
        });
    }
    
    createNewPlaylist() {
        let counter = 1;
        let name = `Playlist ${counter}`;
        
        // Find unique name
        while (this.playlists[name]) {
            counter++;
            name = `Playlist ${counter}`;
        }

        // Open dedicated create flow; data is created only on Done.
        this.showPlaylistModal(null, { suggestedName: name });
    }
    
    showPlaylistModal(editingName = null, options = {}) {
        const isEditing = !!editingName;
        const playlistData = isEditing ? this.playlists[editingName] : null;
        const mode = isEditing ? 'edit' : 'create';
        const modalTitle = isEditing ? 'Edit Playlist' : 'Create Playlist';
        const modalSubtitle = isEditing
            ? 'Update playlist name or cover image.'
            : 'Choose a playlist name and optional cover image.';
        const confirmText = isEditing ? 'Save Changes' : 'Create';
        const initialName = isEditing ? (editingName || '') : (options.suggestedName || '');
        const coverSrc = isEditing ? this.getPlaylistCoverUrl(editingName) : 'icons/default-playlist.png';
        
        const modal = document.createElement('div');
        modal.className = `playlist-modal-overlay playlist-editor-overlay ${mode}-mode`;
        modal.dataset.editing = isEditing;
        modal.dataset.mode = mode;
        if (isEditing) modal.dataset.originalName = editingName;
        
        modal.innerHTML = `
            <div class="playlist-modal playlist-editor-modal playlist-editor-modal--${mode}" role="dialog" aria-modal="true" aria-label="${modalTitle}">
                <h3>${modalTitle}</h3>
                <p class="playlist-editor-subtitle">${modalSubtitle}</p>
                <div class="modal-cover">
                    <img src="${coverSrc}" id="modalCoverImg">
                </div>
                <input type="text" id="modalPlaylistName" placeholder="Playlist name" maxlength="14" value="${initialName}" autocomplete="off" spellcheck="false">
                <div class="modal-buttons">
                    <button type="button" id="modalCancel">Cancel</button>
                    <button type="button" id="modalDone">${confirmText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const img = document.getElementById('modalCoverImg');
        if (playlistData?.coverImage) {
            img.dataset.path = playlistData.coverImage;
            img.style.filter = 'none';
        } else {
            img.style.filter = 'none';
        }
        
        const nameInput = document.getElementById('modalPlaylistName');
        const doneBtn = document.getElementById('modalDone');
        
        // Force focus
        setTimeout(() => {
            nameInput.focus();
            nameInput.select();
        }, 150);
        
        // Store reference to this for event handlers
        const player = this;
        const closeModal = () => {
            modal.remove();
        };
        
        nameInput.onkeydown = function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                player.createPlaylistFromModal(modal);
            }
        };
        
        document.getElementById('modalCancel').onclick = function() {
            closeModal();
        };
        
        doneBtn.onclick = function() {
            player.createPlaylistFromModal(modal);
        };
        
        document.getElementById('modalCoverImg').onclick = function() {
            player.selectModalCover();
        };
        
        modal.onclick = function(e) {
            if (e.target === modal) closeModal();
        };
    }
    
    async selectModalCover() {
        try {
            const result = await ipcRenderer.invoke('browse-image-file');
            if (result && !result.canceled && result.filePaths.length > 0) {
                const img = document.getElementById('modalCoverImg');
                img.src = `file:///${result.filePaths[0].replace(/\\/g, '/')}`;
                img.dataset.path = result.filePaths[0];
                img.style.filter = 'none';
            }
        } catch (error) {
            this.showNotification('Error selecting image', 'error');
        }
    }
    
    editPlaylist() {
        this.showPlaylistModal(this.selectedPlaylistName);
        this.hidePlaylistContextMenu();
    }
    
    createPlaylistFromModal(modal) {
        const inputValue = document.getElementById('modalPlaylistName').value.trim();
        const isEditing = modal.dataset.editing === 'true';
        const originalName = modal.dataset.originalName || '';
        const fallbackName = isEditing ? originalName : '';
        const name = inputValue || fallbackName;
        
        if (!name) {
            this.showNotification('Playlist name cannot be empty', 'error');
            return;
        }
        if (isEditing && !originalName) {
            this.showNotification('Unable to edit playlist', 'error');
            return;
        }
        if (!isEditing && this.playlists[name]) {
            this.showNotification('Playlist name already exists', 'error');
            return;
        }
        if (isEditing && name !== originalName && this.playlists[name]) {
            this.showNotification('Playlist name already exists', 'error');
            return;
        }
        
        const img = document.getElementById('modalCoverImg');
        const coverPath = img.dataset.path || null;
        
        if (isEditing) {
            const playlistData = this.playlists[originalName];
            playlistData.coverImage = coverPath;
            if (name !== originalName) {
                this.playlists[name] = playlistData;
                delete this.playlists[originalName];
                const index = this.playlistOrder.indexOf(originalName);
                if (index !== -1) this.playlistOrder[index] = name;
                if (this.currentPlaylist === originalName) this.currentPlaylist = name;
            }
            this.showNotification(`Playlist "${name}" updated`, 'success');
        } else {
            this.playlists[name] = {
                songs: [],
                pinned: false,
                coverImage: coverPath || 'icons/default-playlist.png',
                createdAt: Date.now()
            };
            this.playlistOrder.push(name);
            this.showNotification(`Playlist "${name}" created`, 'success');
        }
        
        this.savePlaylists();
        this.displayPlaylists();
        if (!isEditing) {
            this.loadPlaylist(name);
        }
        // Update playlist details if currently viewing edited playlist.
        if (isEditing && this.currentPlaylist === originalName) {
            const playlistSongs = this.getPlaylistSongs(name);
            this.showPlaylistDetails(name, playlistSongs.length, playlistSongs);
        }
        modal.remove();
    }
    
    createPlaylist() {
        const name = prompt('Enter playlist name:');
        if (name && !this.playlists[name]) {
            this.playlists[name] = [];
            this.savePlaylists();
            this.displayPlaylists();
            this.showNotification(`Playlist "${name}" created`, 'success');
        }
    }
    
    deletePlaylist(name) {
        if (confirm(`Delete playlist "${name}"?`)) {
            delete this.playlists[name];
            const index = this.playlistOrder.indexOf(name);
            if (index !== -1) this.playlistOrder.splice(index, 1);
            if (this.currentPlaylist === name) {
                this.currentPlaylist = null;
                this.displaySongs();
            }
            this.savePlaylists();
            this.displayPlaylists();
            this.showNotification(`Playlist "${name}" deleted`, 'success');
        }
    }
    
    getPlaylistSongs(playlistName) {
        const playlistData = this.playlists[playlistName];
        const songs = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
        
        return songs.reduce((acc, songName) => {
            const song = this.songs.find(s => s.name === songName);
            if (song) acc.push(song);
            return acc;
        }, []);
    }
    
    loadPlaylist(name) {
        if (this.isVisualizerViewActive) this.disableVisualizerView(true);
        if (!this.songs || this.songs.length === 0) {
            setTimeout(() => this.loadPlaylist(name), 100);
            return;
        }
        
        this.showMusicView({ restoreSearch: false });
        this.settingsBtn.classList.remove('active');
        
        // Clear search input when switching playlists
        this.searchInput.value = '';
        
        this.currentPlaylist = name;
        const playlistData = this.playlists[name];
        const songNames = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
        
        // Get only the songs that are actually in this playlist
        const playlistSongs = songNames.map(songName => {
            return this.songs.find(song => song.name === songName);
        }).filter(song => song !== undefined); // Remove any songs that no longer exist
        
        // Update UI immediately without loading states
        this.showPlaylistDetails(name, playlistSongs.length, playlistSongs);
        this.displayPlaylists();
        
        if (playlistSongs.length === 0) {
            this.filteredSongs = [];
            this.displayContextEmptyState();
        } else {
            this.filteredSongs = playlistSongs;
            this.displayFilteredSongs();
        }

        this.renderQueuePanelIfVisible();
    }
    
    showAllSongs() {
        // Clear search input when showing all songs
        this.searchInput.value = '';
        
        this.currentPlaylist = null;
        this.hidePlaylistDetails();
        this.displaySongs();
        this.displayPlaylists();
        this.showNotification('Showing all songs', 'info');
    }
    
    showPlaylistDetails(name, songCount, playlistSongs = null) {
        const panel = document.getElementById('playlistDetailsPanel');
        const title = document.getElementById('playlistTitle');
        const stats = document.getElementById('playlistStats');
        const description = document.getElementById('playlistDescription');
        const cover = document.getElementById('playlistCover');
        const metaLine = document.getElementById('playlistMetaLine');
        const playlistData = this.playlists[name];
        const songs = Array.isArray(playlistSongs) ? playlistSongs : this.getPlaylistSongs(name);
        const totalDuration = songs.reduce((sum, song) => sum + (Number(song?.duration) || 0), 0);
        const durationText = this.formatPlaylistDuration(totalDuration);
        const createdAt = Array.isArray(playlistData) ? null : playlistData?.createdAt;
        const createdText = createdAt ? new Date(createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
        
        // Update text content immediately
        title.textContent = name;
        stats.textContent = `${songCount} song${songCount !== 1 ? 's' : ''}`;
        description.textContent = songCount === 0 ? 'Empty playlist' : 'Curated by you';
        if (metaLine) {
            const metaItems = [
                durationText,
                'Custom playlist',
                createdText ? `Created ${createdText}` : null
            ].filter(Boolean);
            metaLine.innerHTML = metaItems.map(item => `<span class="playlist-meta-chip">${item}</span>`).join('');
            metaLine.style.display = metaItems.length > 0 ? 'flex' : 'none';
        }
        panel.style.display = 'block';
        
        // Load images asynchronously to prevent blocking
        requestAnimationFrame(() => {
            const coverImage = Array.isArray(playlistData) ? null : (playlistData?.coverImage || null);
            const coverImg = document.querySelector('.playlist-cover-img');
            
            if (coverImage && !coverImage.startsWith('icons/')) {
                coverImg.src = `file:///${coverImage.replace(/\\/g, '/')}`;
            } else {
                coverImg.src = 'icons/default-playlist.png';
            }
            coverImg.style.width = '100%';
            coverImg.style.height = '100%';
            coverImg.style.objectFit = 'cover';
            coverImg.style.filter = 'none';
            
            // Set background image
            const bgImage = Array.isArray(playlistData) ? null : (playlistData?.backgroundImage || null);
            if (bgImage) {
                panel.style.backgroundImage = `url('file:///${bgImage.replace(/\\/g, '/')}')`;
            } else {
                panel.style.backgroundImage = 'none';
            }
        });
        
        // Setup handlers for current playlist
        cover.onclick = () => this.selectPlaylistCover(name);
        this.setupPlaylistNameEdit(name);
        this.setupPlaylistBgEdit(name);
    }

    formatPlaylistDuration(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }
    
    async selectPlaylistCover(playlistName) {
        try {
            const result = await ipcRenderer.invoke('browse-image-file');
            if (result && !result.canceled && result.filePaths.length > 0) {
                const imagePath = result.filePaths[0];
                this.showNotification('Setting playlist cover...', 'info');
                
                // Store the image path in playlist data
                const playlistData = this.playlists[playlistName];
                if (Array.isArray(playlistData)) {
                    this.playlists[playlistName] = {
                        songs: playlistData,
                        pinned: false,
                        coverImage: imagePath
                    };
                } else {
                    playlistData.coverImage = imagePath;
                }
                
                this.savePlaylists();
                this.updatePlaylistCover(imagePath);
                this.showNotification('Playlist cover updated', 'success');
            }
        } catch (error) {
            this.showNotification('Error selecting image', 'error');
        }
    }
    
    updatePlaylistCover(imagePath) {
        const coverImg = document.querySelector('.playlist-cover-img');
        if (imagePath) {
            coverImg.src = `file:///${imagePath.replace(/\\/g, '/')}`;
        } else {
            coverImg.src = 'icons/default-playlist.png';
        }
        coverImg.style.width = '100%';
        coverImg.style.height = '100%';
        coverImg.style.objectFit = 'cover';
        coverImg.style.filter = 'none';
        // Update slide panel playlist items
        this.displayPlaylists();
    }
    
    hidePlaylistDetails() {
        const panel = document.getElementById('playlistDetailsPanel');
        panel.style.display = 'none';
    }
    
    toggleCategoryDropdown(e) {
        e.stopPropagation();
        const dropdown = document.getElementById('categoryDropdown');
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
    }

    normalizeCategory(category) {
        const normalized = String(category || '').toLowerCase();
        return ['all', 'video', 'rated', 'recent'].includes(normalized) ? normalized : 'all';
    }

    getCategoryMeta(category) {
        const normalized = this.normalizeCategory(category);
        const meta = {
            all: { label: 'All Songs', icon: 'icons/all-song.png' },
            video: { label: 'Video Songs', icon: 'icons/video-songs.png' },
            rated: { label: 'Rated Songs', icon: 'icons/star-songs.png' },
            recent: { label: 'Recently Added', icon: 'icons/clock.png' }
        };
        return meta[normalized];
    }

    updateCategorySelectionUi(category, displayText = null) {
        const selectedCategory = document.getElementById('selectedCategory');
        if (!selectedCategory) return;

        const meta = this.getCategoryMeta(category);
        const label = (displayText && String(displayText).trim()) || meta.label;
        selectedCategory.innerHTML = `<img src="${meta.icon}"> ${label}`;
    }

    applyCategoryView(category, options = {}) {
        const { showNotification = false } = options;
        const normalized = this.normalizeCategory(category);

        this.currentPlaylist = null;
        this.hidePlaylistDetails();

        switch (normalized) {
            case 'video':
                this.filteredSongs = this.getSongsForCategory('video');
                this.displayFilteredSongs();
                if (showNotification) this.showNotification('Showing video songs only', 'info');
                break;
            case 'rated':
                this.filteredSongs = this.getSongsForCategory('rated');
                this.displayFilteredSongs();
                if (showNotification) this.showNotification('Showing rated songs only', 'info');
                break;
            case 'recent':
                this.filteredSongs = this.getSongsForCategory('recent');
                this.displayFilteredSongs();
                if (showNotification) {
                    this.showNotification(`Showing ${this.filteredSongs.length} recently added songs`, 'info');
                }
                break;
            case 'all':
            default:
                this.displaySongs();
                if (showNotification) this.showNotification('Showing all songs', 'info');
                break;
        }

        this.displayPlaylists();
    }
    
    selectCategory(category, displayText) {
        // Close dropdown and update UI immediately
        document.getElementById('categoryDropdown').style.display = 'none';

        if (this.isVisualizerViewActive) this.disableVisualizerView(true);
        
        this.showMusicView({ restoreSearch: false });
        this.settingsBtn.classList.remove('active');
        
        // Clear search input when switching categories
        this.searchInput.value = '';
        
        // Track current category
        const normalizedCategory = this.normalizeCategory(category);
        this.currentCategory = normalizedCategory;
        this.settings.selectedCategory = normalizedCategory;
        this.saveSettings();
        this.updateCategorySelectionUi(normalizedCategory, displayText);
        
        // Show loading immediately
        this.songsDiv.innerHTML = '<div class="loading">Filtering songs...</div>';
        
        // Process filtering asynchronously
        requestAnimationFrame(() => {
            this.applyCategoryView(normalizedCategory, { showNotification: true });
        });
    }
    
    viewStorageFolder() {
        ipcRenderer.send('open-folder');
        this.showNotification('Opening storage folder', 'info');
    }
    
    async addMusicFolders() {
        try {
            const result = await ipcRenderer.invoke('browse-music-folders');
            if (result && !result.canceled && result.filePaths.length > 0) {
                this.showNotification(`Adding ${result.filePaths.length} folder(s)...`, 'info');
                const count = await ipcRenderer.invoke('add-music-folders', result.filePaths);
                await this.loadMusic();
                this.showNotification(`Added ${count} new folder(s)`, 'success');
            }
        } catch (error) {
            this.showNotification('Failed to add music folders', 'error');
        }
    }
    

    
    hideAllPanels() {
        this.disableVisualizerView(false);
        document.getElementById('musicContainer').style.display = 'none';
        document.getElementById('settingsPanel').style.display = 'none';
        if (this.downloadPanel) this.downloadPanel.style.display = 'none';
        this.hidePlaylistDetails();
        document.body.classList.remove('download-open');
        document.body.classList.remove('download-minimal');
        if (this.downloadMusicBtn) this.downloadMusicBtn.classList.remove('active');
    }
    

    
    showMusicView(options = {}) {
        const cameFromDownload = this.currentView === 'download';
        const shouldRestoreSearch = options.restoreSearch ?? cameFromDownload;

        this.hideAllPanels();
        document.getElementById('musicContainer').style.display = 'flex';
        this.leftPanel.classList.remove('download-active');
        this.leftPanel.classList.remove('settings-active');
        document.body.classList.remove('settings-open');
        document.body.classList.remove('download-open');
        document.body.classList.remove('download-minimal');
        if (this.downloadMusicBtn) this.downloadMusicBtn.classList.remove('active');
        this.currentView = 'music';
        if (this.searchInput) {
            this.searchInput.placeholder = this.defaultSearchPlaceholder || 'Search here...';
        }
        if (shouldRestoreSearch) {
            this.restoreLibrarySearchBar();
        }
        
        // Move video back to default position if it was in main panel
        if (this.videoInMainPanel) {
            this.moveVideoBackToDefault();
        }
    }

    restoreLibrarySearchBar() {
        if (!this.searchInput) return;
        this.searchInput.placeholder = this.defaultSearchPlaceholder || 'Search here...';
        const restoreValue = this.librarySearchValue || '';
        this.searchInput.value = restoreValue;
        this.filterSongs(restoreValue);
    }
    
    updateSelectionUI() {
        const selectedCount = this.selectedSongs.size;
        if (this.selectionMode || selectedCount > 0) {
            this.showSelectionActions(selectedCount);
        } else {
            this.hideSelectionActions();
        }
        this.updateSelectionHeaderState();
    }

    getVisibleSongSelectionCheckboxes() {
        return Array.from(document.querySelectorAll('.song-select[data-song-index]'));
    }

    getBrowseContextSongs() {
        if (this.currentPlaylist) {
            return this.getPlaylistSongs(this.currentPlaylist);
        }

        const category = this.normalizeCategory(this.currentCategory || 'all');
        if (category !== 'all') {
            return this.getSongsForCategory(category);
        }

        return Array.isArray(this.songs) ? this.songs : [];
    }

    getSongsForCurrentView() {
        const list = Array.isArray(this.filteredSongs) ? this.filteredSongs : this.getBrowseContextSongs();
        return Array.isArray(list) ? list : [];
    }

    getSongIndicesForCurrentView() {
        const songs = this.getSongsForCurrentView();
        const indices = [];
        songs.forEach(song => {
            const idx = this.getSongIndexForSong(song);
            if (Number.isInteger(idx) && idx >= 0) indices.push(idx);
        });
        return indices;
    }

    getSelectedSongIndices() {
        return Array.from(this.selectedSongs).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < this.songs.length);
    }

    getFirstSelectedSongIndex() {
        const indices = this.getSelectedSongIndices();
        return indices.length > 0 ? indices[0] : -1;
    }

    syncSelectionDom() {
        const checkboxes = this.getVisibleSongSelectionCheckboxes();
        checkboxes.forEach(cb => {
            const idx = Number(cb.dataset.songIndex);
            if (!Number.isInteger(idx)) return;
            const selected = this.selectedSongs.has(idx);
            if (cb.checked !== selected) cb.checked = selected;
            cb.closest('.song-item')?.classList.toggle('selected', selected);
        });
    }

    updateSelectionHeaderState() {
        document.body.classList.toggle('selection-mode', !!this.selectionMode);

        if (this.headerSelect) {
            this.headerSelect.setAttribute('aria-hidden', this.selectionMode ? 'false' : 'true');
        }

        if (this.selectModeBtn) {
            this.selectModeBtn.classList.toggle('active', !!this.selectionMode);
            const img = this.selectModeBtn.querySelector('img');
            if (img) img.src = this.selectionMode ? 'icons/ticked.png' : 'icons/unticked.png';
        }

        if (!this.selectAllSongs) return;

        this.selectAllSongs.disabled = !this.selectionMode;

        if (!this.selectionMode) {
            this.selectAllSongs.checked = false;
            this.selectAllSongs.indeterminate = false;
            return;
        }

        const indices = this.getSongIndicesForCurrentView();
        if (indices.length === 0) {
            this.selectAllSongs.checked = false;
            this.selectAllSongs.indeterminate = false;
            return;
        }

        let selectedCount = 0;
        indices.forEach(idx => {
            if (this.selectedSongs.has(idx)) selectedCount++;
        });

        this.selectAllSongs.checked = selectedCount > 0 && selectedCount === indices.length;
        this.selectAllSongs.indeterminate = selectedCount > 0 && selectedCount < indices.length;
    }

    selectAllSongsInView() {
        const indices = this.getSongIndicesForCurrentView();
        indices.forEach(idx => this.selectedSongs.add(idx));
        this.syncSelectionDom();
        this.updateSelectionUI();
    }

    deselectAllSongsInView() {
        const indices = this.getSongIndicesForCurrentView();
        indices.forEach(idx => this.selectedSongs.delete(idx));
        this.syncSelectionDom();
        this.updateSelectionUI();
    }

    toggleSelectAllInView() {
        const indices = this.getSongIndicesForCurrentView();
        if (indices.length === 0) return;

        let selectedInView = 0;
        indices.forEach(idx => {
            if (this.selectedSongs.has(idx)) selectedInView++;
        });

        if (selectedInView === indices.length) {
            this.deselectAllSongsInView();
        } else {
            this.selectAllSongsInView();
        }
    }

    invertSelectionInView() {
        const indices = this.getSongIndicesForCurrentView();
        indices.forEach(idx => {
            if (this.selectedSongs.has(idx)) {
                this.selectedSongs.delete(idx);
            } else {
                this.selectedSongs.add(idx);
            }
        });
        this.syncSelectionDom();
        this.updateSelectionUI();
    }

    selectRangeInList(fromDisplayIndex, toDisplayIndex, songsList = null) {
        const list = Array.isArray(songsList) ? songsList : this.getSongsForCurrentView();
        const from = Number(fromDisplayIndex);
        const to = Number(toDisplayIndex);
        if (!Number.isInteger(from) || !Number.isInteger(to)) return;

        const start = Math.min(from, to);
        const end = Math.max(from, to);
        for (let pos = start; pos <= end; pos++) {
            const song = list[pos];
            const idx = this.getSongIndexForSong(song);
            if (Number.isInteger(idx) && idx >= 0) this.selectedSongs.add(idx);
        }
    }

    clearSelectedSongs({ exitSelectionMode = false } = {}) {
        this.selectedSongs.clear();
        this.selectionAnchorDisplayIndex = null;
        if (exitSelectionMode) {
            this.disableSelectionMode();
            return;
        }
        this.syncSelectionDom();
        this.updateSelectionUI();
    }
    
    showSelectionActions(count) {
        let actionBar = document.getElementById('selectionActionBar');
        if (!actionBar) {
            actionBar = document.createElement('div');
            actionBar.id = 'selectionActionBar';
            actionBar.className = 'selection-action-bar';
            actionBar.setAttribute('role', 'toolbar');
            actionBar.setAttribute('aria-label', 'Selection actions');
            
            actionBar.innerHTML = `
                <div class="selection-summary">
                    <div class="selection-count-pill" aria-live="polite">
                        <span class="selection-count-num" id="selectionCountNum">${count}</span>
                        <span class="selection-count-text">selected</span>
                    </div>
                    <button class="selection-btn selection-close-btn" id="selectionDone" title="Close selection (Esc)" aria-label="Close selection">
                        <img src="icons/close.png" alt="">
                        <span>Close selection</span>
                    </button>
                </div>
                <div class="selection-actions">
                    <button class="selection-btn" id="selectionToggleAll" title="Select all (Ctrl+A)">
                        <img src="icons/ticked.png" alt="">
                        <span class="selection-btn-label">Select all</span>
                    </button>
                    <button class="selection-btn" id="selectionInvert" title="Invert selection (Ctrl+I)">
                        <img src="icons/shortby.png" alt="">
                        <span>Invert</span>
                    </button>
                    <div class="selection-divider" aria-hidden="true"></div>
                    <button class="selection-btn primary" id="addSelectedToPlaylist" title="Add to playlist">
                        <img src="icons/add-to-playlist.png" alt="">
                        <span>Playlist</span>
                    </button>
                    <button class="selection-btn" id="addSelectedToQueue" title="Add to queue">
                        <img src="icons/queue.png" alt="">
                        <span>Queue</span>
                    </button>
                    <button class="selection-btn" id="removeSelectedFromPlaylist" title="Remove from current playlist" style="display: none;">
                        <img src="icons/delete.png" alt="">
                        <span>Remove</span>
                    </button>
                    <button class="selection-btn danger" id="selectionDelete" title="Delete selected songs">
                        <span>Delete</span>
                    </button>
                </div>
            `;
            document.querySelector('.music-container').appendChild(actionBar);
            
            // Cache button references to avoid repeated queries
            this.addSelectedBtn = document.getElementById('addSelectedToPlaylist');
            this.addSelectedQueueBtn = document.getElementById('addSelectedToQueue');
            this.removeSelectedBtn = document.getElementById('removeSelectedFromPlaylist');
            this.selectionToggleAllBtn = document.getElementById('selectionToggleAll');
            this.selectionToggleAllLabel = this.selectionToggleAllBtn?.querySelector('.selection-btn-label') || null;
            this.selectionInvertBtn = document.getElementById('selectionInvert');
            this.selectionDeleteBtn = document.getElementById('selectionDelete');
            this.selectionDoneBtn = document.getElementById('selectionDone');
            this.selectionCountNum = document.getElementById('selectionCountNum');
            
            this.addSelectedBtn.onclick = () => this.showPlaylistSelectionMenu();
            if (this.addSelectedQueueBtn) {
                this.addSelectedQueueBtn.onclick = () => this.addSelectedToQueue();
            }
            if (this.removeSelectedBtn) {
                this.removeSelectedBtn.onclick = () => this.removeSelectedFromPlaylist();
            }
            if (this.selectionToggleAllBtn) {
                this.selectionToggleAllBtn.onclick = () => this.toggleSelectAllInView();
            }
            if (this.selectionInvertBtn) {
                this.selectionInvertBtn.onclick = () => this.invertSelectionInView();
            }
            if (this.selectionDeleteBtn) {
                this.selectionDeleteBtn.onclick = () => this.deleteSelectedSongs();
            }
            if (this.selectionDoneBtn) {
                this.selectionDoneBtn.onclick = () => this.disableSelectionMode();
            }
        } else {
            if (this.selectionCountNum) {
                this.selectionCountNum.textContent = String(count);
            } else {
                const countEl = actionBar.querySelector('#selectionCountNum');
                if (countEl) countEl.textContent = String(count);
            }
        }

        if (this.removeSelectedBtn) {
            this.removeSelectedBtn.style.display = this.currentPlaylist ? '' : 'none';
        }

        const viewIndices = this.getSongIndicesForCurrentView();
        let selectedInView = 0;
        viewIndices.forEach(idx => {
            if (this.selectedSongs.has(idx)) selectedInView++;
        });
        const allSelectedInView = viewIndices.length > 0 && selectedInView === viewIndices.length;

        if (this.selectionToggleAllLabel) {
            this.selectionToggleAllLabel.textContent = allSelectedInView ? 'Deselect all' : 'Select all';
        }
        if (this.selectionToggleAllBtn) {
            this.selectionToggleAllBtn.title = allSelectedInView ? 'Deselect all (Ctrl+A)' : 'Select all (Ctrl+A)';
            const img = this.selectionToggleAllBtn.querySelector('img');
            if (img) img.src = allSelectedInView ? 'icons/unticked.png' : 'icons/ticked.png';
        }

        const hasSelection = count > 0;
        if (this.selectionInvertBtn) this.selectionInvertBtn.disabled = !hasSelection;
        if (this.addSelectedBtn) this.addSelectedBtn.disabled = !hasSelection;
        if (this.addSelectedQueueBtn) this.addSelectedQueueBtn.disabled = !hasSelection;
        if (this.selectionDeleteBtn) this.selectionDeleteBtn.disabled = !hasSelection;
        if (this.removeSelectedBtn) this.removeSelectedBtn.disabled = !hasSelection;
    }
    
    hideSelectionActions() {
        const actionBar = document.getElementById('selectionActionBar');
        if (actionBar) actionBar.remove();

        this.addSelectedBtn = null;
        this.addSelectedQueueBtn = null;
        this.removeSelectedBtn = null;
        this.selectionToggleAllBtn = null;
        this.selectionToggleAllLabel = null;
        this.selectionInvertBtn = null;
        this.selectionDeleteBtn = null;
        this.selectionDoneBtn = null;
        this.selectionCountNum = null;
    }
    
    clearSelection() {
        this.disableSelectionMode();
    }
    
    showPlaylistSelectionMenu() {
        const playlistNames = Object.keys(this.playlists);
        if (playlistNames.length === 0) {
            this.showNotification('No playlists available', 'error');
            return;
        }
        
        const menu = document.createElement('div');
        menu.className = 'playlist-selection-menu';
        menu.innerHTML = `
            <div class="menu-header">Add ${this.selectedSongs.size} songs to:</div>
            ${playlistNames.map(name => `
                <div class="menu-item" data-playlist="${name}">${name}</div>
            `).join('')}
        `;
        
        document.body.appendChild(menu);
        
        menu.querySelectorAll('.menu-item').forEach(item => {
            item.onclick = () => {
                this.addSelectedToPlaylist(item.dataset.playlist);
                menu.remove();
            };
        });
        
        setTimeout(() => {
            document.onclick = () => {
                menu.remove();
                document.onclick = null;
            };
        }, 100);
    }
    
    addSelectedToPlaylist(playlistName) {
        const playlistData = this.playlists[playlistName];
        const songs = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
        
        let addedCount = 0;
        this.selectedSongs.forEach(songIndex => {
            const song = this.songs[songIndex];
            if (song && !songs.includes(song.name)) {
                if (Array.isArray(playlistData)) {
                    this.playlists[playlistName] = {
                        songs: [...playlistData, song.name],
                        pinned: false
                    };
                } else {
                    songs.push(song.name);
                }
                addedCount++;
            }
        });
        
        this.savePlaylists();
        this.displayPlaylists();
        this.clearSelection();
        
        if (this.currentPlaylist === playlistName) {
            this.loadPlaylist(playlistName);
        }
        
        this.showNotification(`Added ${addedCount} songs to "${playlistName}"`, 'success');
    }

    addSelectedToQueue() {
        if (this.currentSongIndex < 0) {
            this.showNotification('Please select a song first', 'error');
            return;
        }

        const viewIndices = this.getSongIndicesForCurrentView();
        const order = new Map();
        viewIndices.forEach((idx, pos) => order.set(idx, pos));

        const indices = Array.from(this.selectedSongs).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < this.songs.length);
        const toQueue = indices.filter(idx => idx !== this.currentSongIndex);

        if (toQueue.length === 0) {
            this.showNotification('Nothing to add to queue', 'info');
            return;
        }

        toQueue.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
        const existing = new Set(Array.isArray(this.queue) ? this.queue : []);
        const unique = toQueue.filter(idx => !existing.has(idx));

        if (unique.length === 0) {
            this.showNotification('Selected songs are already in the queue', 'info');
            return;
        }

        const limited = unique.slice(0, 20);
        if (unique.length > 20) {
            this.showNotification('Only the first 20 selected songs were added to the queue', 'info');
        }

        this.setPlaybackContextFromBrowseContext();
        if (!Array.isArray(this.queue)) this.queue = [];
        this.queue.push(...limited);
        this.renderQueuePanelIfVisible();
        this.showNotification(`Added ${limited.length} to queue`, 'success');
    }

    async deleteSelectedSongs() {
        const indices = Array.from(this.selectedSongs).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < this.songs.length);
        if (indices.length === 0) {
            this.showNotification('No songs selected', 'info');
            return;
        }

        const songsToDelete = indices.map(idx => this.songs[idx]).filter(Boolean);
        const count = songsToDelete.length;
        const ok = await this.showConfirmDialog({
            title: 'Delete selected songs?',
            message: `Move ${count} song${count === 1 ? '' : 's'} to Recycle Bin?`,
            confirmText: 'Delete',
            kind: 'danger'
        });
        if (!ok) return;

        this.prepareSongsForDeletion(songsToDelete);
        this.showNotification(`Deleting ${count} song${count === 1 ? '' : 's'}...`, 'info');

        const deleteRequests = songsToDelete.map(song => ({
            filePath: song.path,
            fileName: song.name,
            baseName: song.baseName,
            isVideo: !!song.isVideo
        }));
        const results = await Promise.allSettled(deleteRequests.map(payload => ipcRenderer.invoke('delete-song', payload)));
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
        const failCount = count - successCount;

        if (successCount > 0) {
            this.showNotification(`Deleted ${successCount} song${successCount === 1 ? '' : 's'}`, 'success');
            await this.loadMusic();
        }
        if (failCount > 0) {
            this.showNotification(`Failed to delete ${failCount} song${failCount === 1 ? '' : 's'}`, 'error');
        }

        this.clearSelectedSongs({ exitSelectionMode: true });
    }
    
    removeFromPlaylist() {
        if (!this.currentPlaylist) {
            this.showNotification('Not viewing a playlist', 'error');
            return;
        }
        
        const song = this.songs[this.selectedSongIndex];
        const playlistData = this.playlists[this.currentPlaylist];
        const songs = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
        
        const index = songs.indexOf(song.name);
        if (index > -1) {
            songs.splice(index, 1);
            this.savePlaylists();
            this.displayPlaylists();
            this.loadPlaylist(this.currentPlaylist);
            this.showNotification(`Removed "${song.title}" from "${this.currentPlaylist}"`, 'success');
        } else {
            this.showNotification('Song not found in playlist', 'error');
        }
        this.hideSongContextMenu();
    }
    
    removeSelectedFromPlaylist() {
        if (!this.currentPlaylist) {
            this.showNotification('Not viewing a playlist', 'error');
            return;
        }
        
        const playlistData = this.playlists[this.currentPlaylist];
        const songs = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
        
        // Process in reverse order to avoid index shifting issues
        const indicesToRemove = [];
        this.selectedSongs.forEach(songIndex => {
            const song = this.songs[songIndex];
            if (song) {
                const index = songs.indexOf(song.name);
                if (index > -1) {
                    indicesToRemove.push(index);
                }
            }
        });
        
        // Sort in descending order and remove
        let removedCount = 0;
        indicesToRemove.sort((a, b) => b - a).forEach(index => {
            songs.splice(index, 1);
            removedCount++;
        });
        
        this.savePlaylists();
        this.displayPlaylists();
        this.clearSelection();
        this.loadPlaylist(this.currentPlaylist);
        
        this.showNotification(`Removed ${removedCount} songs from "${this.currentPlaylist}"`, 'success');
    }
    
    enableSelectionMode(startIndex = null, options = {}) {
        const { keepExisting = true, showNotification = true, hideMenu = true } = options;

        this.selectionMode = true;
        this.selectionAnchorDisplayIndex = null;

        if (!keepExisting) {
            this.selectedSongs.clear();
        }

        const fallbackIndex =
            Number.isInteger(this.currentSongIndex) && this.currentSongIndex >= 0
                ? this.currentSongIndex
                : 0;
        const idx = Number.isInteger(startIndex) ? startIndex : Number(startIndex);
        const start =
            Number.isInteger(idx) && idx >= 0 && idx < this.songs.length
                ? idx
                : Number.isInteger(this.selectedSongIndex) && this.selectedSongIndex >= 0 && this.selectedSongIndex < this.songs.length
                  ? this.selectedSongIndex
                  : fallbackIndex;

        if (Number.isInteger(start) && start >= 0 && start < this.songs.length) {
            this.selectedSongs.add(start);

            const viewSongs = this.getSongsForCurrentView();
            const startSong = this.songs[start];
            const pos = startSong ? viewSongs.indexOf(startSong) : -1;
            if (pos >= 0) this.selectionAnchorDisplayIndex = pos;
        }

        this.syncSelectionDom();
        this.updateSelectionUI();

        if (hideMenu) this.hideSongContextMenu();
        if (showNotification) this.showNotification('Selection mode enabled', 'info');
    }
    
    disableSelectionMode(options = {}) {
        const { showNotification = false } = options;

        this.selectionMode = false;
        this.selectionAnchorDisplayIndex = null;
        this.selectedSongs.clear();

        // Reset visible UI state (even though the checkbox column is hidden in non-selection mode)
        document.querySelectorAll('.song-item.selected').forEach(item => item.classList.remove('selected'));
        document.querySelectorAll('.song-select[data-song-index]').forEach(cb => {
            cb.checked = false;
        });

        this.hideSelectionActions();
        this.updateSelectionHeaderState();

        if (showNotification) this.showNotification('Selection mode disabled', 'info');
    }
    
    async handlePlaylistFileDrop(files, playlistName) {
        console.log('handlePlaylistFileDrop called with:', files.length, 'files for playlist:', playlistName);
        
        const musicFiles = [];
        const videoFiles = [];
        
        Array.from(files).forEach(file => {
            console.log('Processing file:', file.name, 'path:', file.path);
            const filePath = file.path;
            if (!filePath) {
                console.log('No file path available for:', file.name);
                return;
            }
            
            if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name)) {
                musicFiles.push(filePath);
            } else if (/\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i.test(file.name)) {
                videoFiles.push(filePath);
            }
        });
        
        const totalFiles = musicFiles.length + videoFiles.length;
        console.log('Total supported files:', totalFiles);
        
        if (totalFiles === 0) {
            this.showNotification('No supported files found', 'error');
            return;
        }
        
        this.showNotification(`Adding ${totalFiles} files to "${playlistName}"...`, 'info');
        
        try {
            // Add files to main library
            if (musicFiles.length > 0) {
                await ipcRenderer.invoke('add-files', musicFiles, 'music');
            }
            if (videoFiles.length > 0) {
                await ipcRenderer.invoke('add-files', videoFiles, 'video');
            }
            
            // Get fresh library data
            const musicLibrary = await ipcRenderer.invoke('get-music-files');
            const videoLibrary = await ipcRenderer.invoke('get-video-files') || [];
            
            // Add to playlist by filename
            const playlistData = this.playlists[playlistName];
            const songs = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
            
            let addedCount = 0;
            [...musicFiles, ...videoFiles].forEach(filePath => {
                const fileName = filePath.split(/[\\/]/).pop();
                console.log('Adding to playlist:', fileName);
                
                if (!songs.includes(fileName)) {
                    if (Array.isArray(playlistData)) {
                        this.playlists[playlistName] = {
                            songs: [...playlistData, fileName],
                            pinned: false
                        };
                    } else {
                        songs.push(fileName);
                    }
                    addedCount++;
                }
            });
            
            this.savePlaylists();
            
            // Reload everything
            await this.loadMusic();
            
            this.showNotification(`Added ${addedCount} songs to "${playlistName}"`, 'success');
            
        } catch (error) {
            console.error('Error in handlePlaylistFileDrop:', error);
            this.showNotification('Failed to add files to playlist', 'error');
        }
    }
    

    
    addToPlaylist(playlistName) {
        const song = this.songs[this.selectedSongIndex];
        const playlistData = this.playlists[playlistName];
        const songs = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
        
        if (!songs.includes(song.name)) {
            if (Array.isArray(playlistData)) {
                // Convert old format to new format
                this.playlists[playlistName] = {
                    songs: [...playlistData, song.name],
                    pinned: false
                };
            } else {
                songs.push(song.name);
            }
            this.savePlaylists();
            this.displayPlaylists();
            this.showNotification(`Added "${song.title}" to "${playlistName}"`, 'success');
        } else {
            this.showNotification('Song already in playlist', 'error');
        }
    }
    
    showPlaylistContextMenu(x, y, playlistName) {
        this.selectedPlaylistName = playlistName;
        
        // Update pin/unpin text based on current state
        const playlistData = this.playlists[playlistName];
        const isPinned = Array.isArray(playlistData) ? false : (playlistData.pinned || false);
        const pinMenuItem = document.getElementById('pinPlaylist');
        const pinLabel = pinMenuItem?.querySelector('.menu-label');
        if (pinLabel) {
            pinLabel.textContent = isPinned ? 'Unpin Playlist' : 'Pin Playlist';
        } else if (pinMenuItem) {
            pinMenuItem.textContent = isPinned ? 'Unpin Playlist' : 'Pin Playlist';
        }
        
        // Populate merge submenu
        const mergeSubmenu = document.getElementById('mergeSubmenu');
        const otherPlaylists = Object.keys(this.playlists).filter(name => name !== playlistName);
        
        mergeSubmenu.innerHTML = '';
        if (otherPlaylists.length === 0) {
            const item = document.createElement('div');
            item.className = 'menu-item disabled';
            item.setAttribute('role', 'menuitem');
            item.setAttribute('aria-disabled', 'true');
            item.tabIndex = -1;
            const label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = 'No other playlists';
            item.appendChild(label);
            mergeSubmenu.appendChild(item);
        } else {
            otherPlaylists.forEach(name => {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.setAttribute('role', 'menuitem');
                item.tabIndex = -1;
                const label = document.createElement('span');
                label.className = 'menu-label';
                label.textContent = name;
                item.appendChild(label);
                item.onclick = () => {
                    this.performPlaylistMerge(playlistName, name);
                    this.hidePlaylistContextMenu();
                };
                mergeSubmenu.appendChild(item);
            });
        }
        
        const playlistContextMenu = document.getElementById('playlistContextMenu');
        this.openContextMenu(playlistContextMenu, x, y);
    }
    
    hidePlaylistContextMenu() {
        this.closeContextMenu(document.getElementById('playlistContextMenu'));
    }
    
    showVideoContextMenu(x, y) {
        const videoContextMenu = document.getElementById('videoContextMenu');
        this.openContextMenu(videoContextMenu, x, y);
    }
    
    hideVideoContextMenu() {
        this.closeContextMenu(document.getElementById('videoContextMenu'));
    }
    
    showMainPanelVideoContextMenu(x, y) {
        const contextMenu = document.getElementById('mainPanelVideoContextMenu');
        this.openContextMenu(contextMenu, x, y);
    }
    
    hideMainPanelVideoContextMenu() {
        this.closeContextMenu(document.getElementById('mainPanelVideoContextMenu'));
    }
    
    switchBackToMiniPlayer() {
        this.moveVideoBackToDefault();
        this.hideMainPanelVideoContextMenu();
    }
    
    playVideoInMainPanel() {
        if (!this.videoInMainPanel) {
            this.moveVideoToMainPanel();
        }
        this.hideVideoContextMenu();
    }
    
    playVideoFullScreen() {
        if (this.videoElement.requestFullscreen) {
            this.videoElement.requestFullscreen();
        }
        this.hideVideoContextMenu();
    }
    
    moveVideoToMainPanel() {
        this.beginMediaTransition('move-video-to-main-panel');
        this.disableVisualizerView(false);
        this.videoInMainPanel = true;
        this.updateVisualizerAvailability();
        const leftPanel = document.getElementById('leftPanel');
        const currentTime = this.videoElement.currentTime;
        const wasPlaying = !this.videoElement.paused;
        
        // Pause original video and audio completely
        this.suppressAutoResume();
        this.videoElement.pause();
        this.audio.pause();
        this.audio.src = '';
        this.stopVisualizer();
        
        // Hide music container and show album cover
        document.getElementById('musicContainer').style.display = 'none';
        this.albumCover.style.display = 'flex';
        
        // Create main panel video container
        this.mainPanelVideo = document.createElement('div');
        this.mainPanelVideo.className = 'main-panel-video';
        
        // Create new video element
        const newVideo = document.createElement('video');
        newVideo.src = this.videoElement.src;
        newVideo.currentTime = currentTime;
        newVideo.controls = false;
        this.mainPanelVideo.appendChild(newVideo);
        
        // Add to main panel
        leftPanel.appendChild(this.mainPanelVideo);
        
        // Hide original video player
        this.videoPlayer.style.display = 'none';
        
        // Update video element reference
        this.videoElement = newVideo;
        
        if (wasPlaying) {
            this.videoElement.play();
        }
        
        // Update event handlers
        this.setupMainPanelVideoEvents(this.videoElement);
        
        // Sync volume with main control
        this.videoElement.volume = this.audio.volume;
        
        // Add context menu for main panel video
        this.videoElement.oncontextmenu = (e) => {
            e.preventDefault();
            this.showMainPanelVideoContextMenu(e.clientX, e.clientY);
        };
        
        // Update main panel video when song changes
        this.updateMainPanelVideo = (newVideoSrc) => {
            if (this.videoInMainPanel && this.videoElement) {
                const wasPlaying = !this.videoElement.paused;
                this.videoElement.src = newVideoSrc;
                this.videoElement.volume = this.audio.volume;
                this.videoElement.style.display = 'block';
                if (wasPlaying) {
                    this.videoElement.play();
                }
            }
        };
        
        // Show no video message in main panel
        this.showNoVideoMessage = () => {
            if (this.videoInMainPanel && this.mainPanelVideo) {
                this.videoElement.style.display = 'none';
                this.mainPanelVideo.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #fff; text-align: center; font-size: 18px; background: #1a1a1a;">
                        <div>
                            <p>No Video Attached</p>
                            <p style="font-size: 14px; opacity: 0.7;">Double click on cover image to attach video</p>
                        </div>
                    </div>
                `;
            }
        };
        
        this.showNotification('Video moved to main panel', 'info');
    }
    
    moveVideoBackToDefault() {
        if (this.videoInMainPanel && this.mainPanelVideo) {
            this.beginMediaTransition('move-video-to-default');
            const currentTime = this.videoElement.currentTime;
            const wasPlaying = !this.videoElement.paused;
            
            // Pause main panel video and ensure audio is stopped
            this.suppressAutoResume();
            this.videoElement.pause();
            this.audio.pause();
            this.stopVisualizer();
            
            // Get original video element
            const originalVideo = this.videoPlayer.querySelector('video');
            
            // Restore video to original position
            originalVideo.src = this.videoElement.src;
            originalVideo.currentTime = currentTime;
            
            // Update video element reference
            this.videoElement = originalVideo;
            
            if (wasPlaying) {
                this.videoElement.play();
            }
            
            // Remove main panel video
            this.mainPanelVideo.remove();
            this.mainPanelVideo = null;
            this.videoInMainPanel = false;
            this.updateVisualizerAvailability();
            
            // Show music container and original video player
            document.getElementById('musicContainer').style.display = 'flex';
            this.videoPlayer.style.display = 'block';
            
            // Hide album cover since we're back in video mode
            this.albumCover.style.display = 'none';
        }
    }
    
    setupMainPanelVideoEvents(videoEl) {
        videoEl.ontimeupdate = () => this.updateTime();
        videoEl.onended = () => {
            this.lastEndedEventAt = Date.now();
            this.playNext();
        };
        videoEl.onloadedmetadata = () => this.updateDuration();
        videoEl.onplay = () => {
            if (this.isVideoMode) {
                this.isPlaying = true;
                this.playPauseImg.src = 'icons/pause.png';
            }
            this.startVisualizer();
            this.syncMediaSessionPlaybackState();
            this.startProgressSync();
        };
        videoEl.onpause = () => {
            this.handleVideoPause();
            if (this.isVideoMode) {
                this.isPlaying = false;
                this.playPauseImg.src = 'icons/play.png';
            }
            this.stopVisualizer();
            this.syncMediaSessionPlaybackState();
            this.stopProgressSync();
        };
        videoEl.ondblclick = () => this.toggleVideoAspectRatio();
        videoEl.onclick = () => {
            if (this.isVisualizerViewActive) this.disableVisualizerView(true);
        };
    }
    

    
    mergePlaylist() {
        // This method is now handled by the submenu hover
    }
    
    performPlaylistMerge(sourcePlaylist, targetPlaylist) {
        const sourceData = this.playlists[sourcePlaylist];
        const targetData = this.playlists[targetPlaylist];
        
        const sourceSongs = Array.isArray(sourceData) ? sourceData : (sourceData?.songs || []);
        const targetSongs = Array.isArray(targetData) ? targetData : (targetData?.songs || []);
        
        // Add unique songs from source to target
        let addedCount = 0;
        sourceSongs.forEach(songName => {
            if (!targetSongs.includes(songName)) {
                targetSongs.push(songName);
                addedCount++;
            }
        });
        
        // Ensure target is in new format
        if (Array.isArray(targetData)) {
            this.playlists[targetPlaylist] = {
                songs: targetSongs,
                pinned: false
            };
        }
        
        this.savePlaylists();
        this.displayPlaylists();
        this.showNotification(`Merged ${addedCount} songs from "${sourcePlaylist}" to "${targetPlaylist}"`, 'success');
    }
    
    pinPlaylist() {
        const playlistData = this.playlists[this.selectedPlaylistName];
        
        // Convert to new format if needed
        if (Array.isArray(playlistData)) {
            this.playlists[this.selectedPlaylistName] = {
                songs: playlistData,
                pinned: true
            };
            this.showNotification(`Playlist "${this.selectedPlaylistName}" pinned`, 'success');
        } else {
            // Toggle pin status
            const isPinned = playlistData.pinned || false;
            playlistData.pinned = !isPinned;
            this.showNotification(`Playlist "${this.selectedPlaylistName}" ${isPinned ? 'unpinned' : 'pinned'}`, 'success');
        }
        
        this.savePlaylists();
        this.displayPlaylists();
        this.hidePlaylistContextMenu();
    }
    
    getPlaylistCoverUrl(playlistName) {
        const playlistData = this.playlists[playlistName];
        const coverImage = Array.isArray(playlistData) ? 'icons/default-playlist.png' : (playlistData?.coverImage || 'icons/default-playlist.png');
        return coverImage.startsWith('icons/') ? coverImage : `file:///${coverImage.replace(/\\/g, '/')}`;
    }
    
    deletePlaylistFromMenu() {
        this.deletePlaylist(this.selectedPlaylistName);
        this.hidePlaylistContextMenu();
    }
    
    setupSortMenu() {
        const sortBtn = document.getElementById('sortBtn');
        const sortMenu = document.getElementById('sortMenu');
        
        sortBtn.onclick = (e) => {
            e.stopPropagation();
            sortMenu.style.display = sortMenu.style.display === 'block' ? 'none' : 'block';
        };
        
        document.onclick = () => {
            sortMenu.style.display = 'none';
        };
        
        document.querySelectorAll('.sort-option').forEach(option => {
            option.onclick = (e) => {
                e.stopPropagation();
                const sortType = option.dataset.sort;
                this.sortSongs(sortType);
                sortMenu.style.display = 'none';
            };
        });
    }

    setupSelectionUi() {
        if (this.selectModeBtn) {
            this.selectModeBtn.onclick = (e) => {
                e.stopPropagation();
                if (this.selectionMode) {
                    this.disableSelectionMode();
                } else {
                    const startIndex =
                        Number.isInteger(this.currentSongIndex) && this.currentSongIndex >= 0
                            ? this.currentSongIndex
                            : Number.isInteger(this.selectedSongIndex) && this.selectedSongIndex >= 0
                              ? this.selectedSongIndex
                              : 0;
                    this.enableSelectionMode(startIndex, { keepExisting: false, showNotification: false, hideMenu: false });
                }
            };
        }

        if (this.selectAllSongs) {
            this.selectAllSongs.onchange = (e) => {
                if (!this.selectionMode) return;
                const shouldSelectAll = !!e.target.checked;
                if (shouldSelectAll) {
                    this.selectAllSongsInView();
                } else {
                    this.deselectAllSongsInView();
                }
            };
        }

        this.updateSelectionHeaderState();
    }
    
    sortSongs(type) {
        const shouldPreserveSelection = this.selectionMode && this.selectedSongs.size > 0;
        const selectedSongObjects = shouldPreserveSelection
            ? Array.from(this.selectedSongs)
                  .map(idx => this.songs[idx])
                  .filter(Boolean)
            : [];

        const comparators = {
            title: (a, b) => String(a?.title || a?.name || '').localeCompare(String(b?.title || b?.name || '')),
            artist: (a, b) => String(a?.artist || '').localeCompare(String(b?.artist || '')),
            rating: (a, b) => (Number(b?.rating) || 0) - (Number(a?.rating) || 0),
            recent: (a, b) => (Number(b?.loadIndex) || 0) - (Number(a?.loadIndex) || 0)
        };
        const comparator = comparators[type] || comparators.title;

        this.songs.sort(comparator);

        this.rebuildSongIndexLookup();

        if (shouldPreserveSelection) {
            const nextSelection = new Set();
            selectedSongObjects.forEach(song => {
                const idx = this.getSongIndexForSong(song);
                if (Number.isInteger(idx) && idx >= 0) nextSelection.add(idx);
            });
            this.selectedSongs = nextSelection;
        }

        const activeQuery = this.searchInput?.value?.trim() || '';
        if (activeQuery) {
            this.filterSongs(activeQuery);
        } else if (this.currentPlaylist) {
            this.filteredSongs = [...this.getPlaylistSongs(this.currentPlaylist)].sort(comparator);
            this.displayFilteredSongs();
        } else {
            const category = this.normalizeCategory(this.currentCategory || 'all');
            if (category !== 'all') {
                this.filteredSongs = [...this.getSongsForCategory(category)].sort(comparator);
                this.displayFilteredSongs();
            } else {
                this.displaySongs();
            }
        }

        if (this.selectionMode) this.updateSelectionUI();
    }
    
    setupResizer() {
        let isResizing = false;
        let animationId = null;
        
        const handleMouseMove = (e) => {
            if (!isResizing) return;
            
            // Throttle with requestAnimationFrame for better performance
            if (animationId) return;
            
            animationId = requestAnimationFrame(() => {
                const containerWidth = this.resizer.parentElement.offsetWidth;
                const leftWidth = (e.clientX / containerWidth) * 100;
                const rightWidth = 100 - leftWidth;
                
                // Constrain right panel between 25% and 35%
                const constrainedRightWidth = Math.max(25, Math.min(35, rightWidth));
                const constrainedLeftWidth = 100 - constrainedRightWidth;
                
                this.leftPanel.style.width = `${constrainedLeftWidth}%`;
                this.rightPanel.style.width = `${constrainedRightWidth}%`;
                
                animationId = null;
            });
        };
        
        const handleMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                if (animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
            }
        };
        
        this.resizer.onmousedown = (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };
    }
    

    

    
    filterSongs(query) {
        // Search inside the active browse context (playlist/category/all songs).
        const songsToSearch = this.getBrowseContextSongs();

        const normalizedQuery = this.normalizeSearchText(query);
        const queryTokens = this.tokenizeSearchText(normalizedQuery);

        if (!normalizedQuery) {
            this.filteredSongs = [...songsToSearch];
        } else {
            const { primaryThreshold, fallbackThreshold } = this.getSearchThresholds(normalizedQuery, queryTokens.length);
            const scored = songsToSearch.map(song => ({
                song,
                score: this.calculateRelevanceScore(song, normalizedQuery, queryTokens)
            }));

            const byScoreThenTitle = (a, b) => {
                if (Math.abs(a.score - b.score) < 0.01) {
                    return String(a.song?.title || '').localeCompare(String(b.song?.title || ''));
                }
                return b.score - a.score;
            };

            let matches = scored
                .filter(item => item.score >= primaryThreshold)
                .sort(byScoreThenTitle);

            // If strict filtering misses typo-heavy queries, fallback to strong close matches.
            if (matches.length === 0) {
                matches = scored
                    .filter(item => item.score >= fallbackThreshold)
                    .sort(byScoreThenTitle);
            }

            this.filteredSongs = matches.map(item => item.song);
        }

        this.displayFilteredSongs();
        this.renderQueuePanelIfVisible();
    }

    normalizeSearchText(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9\s&]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    tokenizeSearchText(text) {
        if (!text) return [];
        return text.split(' ').filter(Boolean);
    }

    getSongAlbumText(song) {
        return song?.album || song?.albumName || song?.albumTitle || song?.metadata?.album || '';
    }

    getSongSearchDoc(song) {
        if (!song) return null;
        const cached = this.songSearchDocCache?.get(song);
        if (cached) return cached;

        const titleText = this.normalizeSearchText(song.title || song.name || song.baseName || '');
        const artistText = this.normalizeSearchText(song.artist || song.albumArtist || '');
        const albumText = this.normalizeSearchText(this.getSongAlbumText(song));
        const fileText = this.normalizeSearchText(song.baseName || song.name || '');
        const combinedText = [titleText, artistText, albumText, fileText].filter(Boolean).join(' ').trim();

        const doc = {
            title: { text: titleText, tokens: this.tokenizeSearchText(titleText) },
            artist: { text: artistText, tokens: this.tokenizeSearchText(artistText) },
            album: { text: albumText, tokens: this.tokenizeSearchText(albumText) },
            file: { text: fileText, tokens: this.tokenizeSearchText(fileText) },
            combined: { text: combinedText, tokens: this.tokenizeSearchText(combinedText) }
        };

        if (this.songSearchDocCache) this.songSearchDocCache.set(song, doc);
        return doc;
    }

    getSearchThresholds(normalizedQuery, queryTokenCount) {
        const qLen = normalizedQuery.length;
        if (qLen <= 2) return { primaryThreshold: 0.62, fallbackThreshold: 0.48 };
        if (qLen <= 4) return { primaryThreshold: 0.52, fallbackThreshold: 0.38 };
        if (queryTokenCount >= 3) return { primaryThreshold: 0.4, fallbackThreshold: 0.29 };
        return { primaryThreshold: 0.45, fallbackThreshold: 0.32 };
    }

    calculateRelevanceScore(song, normalizedQuery, queryTokens) {
        const doc = this.getSongSearchDoc(song);
        if (!doc || !normalizedQuery || queryTokens.length === 0) return 0;

        const titleScore = this.scoreSearchField(doc.title, normalizedQuery, queryTokens);
        const artistScore = this.scoreSearchField(doc.artist, normalizedQuery, queryTokens);
        const albumScore = this.scoreSearchField(doc.album, normalizedQuery, queryTokens);
        const fileScore = this.scoreSearchField(doc.file, normalizedQuery, queryTokens);
        const combinedScore = this.scoreSearchField(doc.combined, normalizedQuery, queryTokens);

        const weightedScore =
            (titleScore * 0.5) +
            (artistScore * 0.24) +
            (albumScore * 0.16) +
            (fileScore * 0.1);

        const crossFieldCoverage = this.scoreQueryCoverage(queryTokens, doc.combined.tokens);
        let score = Math.max(weightedScore, combinedScore * 0.92);
        score = Math.max(score, (combinedScore * 0.82) + (crossFieldCoverage * 0.18));

        if (titleScore >= 0.98) score = Math.max(score, 0.995);
        else if (titleScore >= 0.92) score = Math.max(score, Math.min(1, score + 0.05));

        return Math.max(0, Math.min(1, score));
    }

    scoreSearchField(field, normalizedQuery, queryTokens) {
        if (!field || !field.text) return 0;
        const text = field.text;

        if (text === normalizedQuery) return 1;
        if (text.startsWith(normalizedQuery)) return 0.97;

        let score = 0;
        if (text.includes(normalizedQuery)) score = Math.max(score, 0.9);

        const coverage = this.scoreQueryCoverage(queryTokens, field.tokens);
        const order = this.scoreTokenOrder(queryTokens, field.tokens);
        score = Math.max(score, (coverage * 0.84) + (order * 0.16));

        return Math.max(0, Math.min(1, score));
    }

    scoreTokenOrder(queryTokens, candidateTokens) {
        if (!queryTokens.length || !candidateTokens.length) return 0;

        let matched = 0;
        let lastIndex = -1;

        for (const queryToken of queryTokens) {
            let foundIndex = -1;
            for (let i = lastIndex + 1; i < candidateTokens.length; i++) {
                const candidate = candidateTokens[i];
                if (candidate === queryToken || candidate.startsWith(queryToken)) {
                    foundIndex = i;
                    break;
                }
            }
            if (foundIndex !== -1) {
                matched++;
                lastIndex = foundIndex;
            }
        }

        return matched / queryTokens.length;
    }

    scoreQueryCoverage(queryTokens, candidateTokens) {
        if (!queryTokens.length || !candidateTokens.length) return 0;

        let total = 0;
        let strongMatches = 0;

        for (const queryToken of queryTokens) {
            let best = 0;
            for (const candidateToken of candidateTokens) {
                const similarity = this.scoreTokenSimilarity(queryToken, candidateToken);
                if (similarity > best) best = similarity;
                if (best >= 0.999) break;
            }

            total += best;
            const strongThreshold = queryToken.length <= 3 ? 0.87 : 0.8;
            if (best >= strongThreshold) strongMatches++;
        }

        const avg = total / queryTokens.length;
        const strongRatio = strongMatches / queryTokens.length;
        return (avg * 0.82) + (strongRatio * 0.18);
    }

    scoreTokenSimilarity(queryToken, candidateToken) {
        if (!queryToken || !candidateToken) return 0;
        if (queryToken === candidateToken) return 1;

        const qLen = queryToken.length;
        const cLen = candidateToken.length;
        const lenDiff = Math.abs(qLen - cLen);

        if (candidateToken.startsWith(queryToken)) {
            return Math.max(0, 0.96 - Math.min(0.14, lenDiff * 0.03));
        }
        if (queryToken.startsWith(candidateToken) && cLen >= 3) {
            return Math.max(0, 0.86 - Math.min(0.14, lenDiff * 0.04));
        }
        if (candidateToken.includes(queryToken)) {
            return Math.max(0, 0.83 - Math.min(0.12, lenDiff * 0.03));
        }
        if (queryToken.includes(candidateToken) && cLen >= 3) {
            return Math.max(0, 0.76 - Math.min(0.12, lenDiff * 0.03));
        }

        let best = 0;
        const dice = this.bigramDiceSimilarity(queryToken, candidateToken);
        if (dice >= 0.2) best = Math.max(best, dice * 0.86);

        if (lenDiff <= 2 && qLen <= 16 && cLen <= 16) {
            const maxEdits = qLen <= 4 ? 1 : (qLen <= 8 ? 2 : 3);
            const distance = this.boundedLevenshteinDistance(queryToken, candidateToken, maxEdits + 1);
            if (distance <= maxEdits) {
                const editScore = 1 - (distance / Math.max(qLen, cLen));
                best = Math.max(best, 0.58 + (editScore * 0.42));
            }
        }

        return Math.max(0, Math.min(0.95, best));
    }

    boundedLevenshteinDistance(a, b, maxDistance = 3) {
        if (a === b) return 0;
        const aLen = a.length;
        const bLen = b.length;
        if (aLen === 0) return bLen;
        if (bLen === 0) return aLen;
        if (Math.abs(aLen - bLen) > maxDistance) return maxDistance + 1;

        let previous = new Array(bLen + 1);
        let current = new Array(bLen + 1);

        for (let j = 0; j <= bLen; j++) previous[j] = j;

        for (let i = 1; i <= aLen; i++) {
            current[0] = i;
            let rowMin = current[0];

            for (let j = 1; j <= bLen; j++) {
                const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
                const insertion = current[j - 1] + 1;
                const deletion = previous[j] + 1;
                const substitution = previous[j - 1] + substitutionCost;
                const value = Math.min(insertion, deletion, substitution);
                current[j] = value;
                if (value < rowMin) rowMin = value;
            }

            if (rowMin > maxDistance) return maxDistance + 1;
            [previous, current] = [current, previous];
        }

        return previous[bLen];
    }

    bigramDiceSimilarity(a, b) {
        const aGrams = this.buildBigrams(a);
        const bGrams = this.buildBigrams(b);
        if (!aGrams.length || !bGrams.length) return 0;

        const counts = new Map();
        for (const gram of aGrams) counts.set(gram, (counts.get(gram) || 0) + 1);

        let intersection = 0;
        for (const gram of bGrams) {
            const count = counts.get(gram) || 0;
            if (count > 0) {
                intersection++;
                counts.set(gram, count - 1);
            }
        }

        return (2 * intersection) / (aGrams.length + bGrams.length);
    }

    buildBigrams(value) {
        if (!value) return [];
        if (value.length === 1) return [value];
        const grams = [];
        for (let i = 0; i < value.length - 1; i++) {
            grams.push(value.slice(i, i + 2));
        }
        return grams;
    }

    displaySearchNoResults(query) {
        this.resetSongCoverRenderQueue();
        const safeQuery = this.escapeHtml(query || '');
        this.songsDiv.innerHTML = `
            <div class="empty-library">
                <div class="empty-icon">🔎</div>
                <h3>No matches found</h3>
                <p>Try title, artist, or album keywords</p>
                ${safeQuery ? `<p class="sub-text">"${safeQuery}"</p>` : ''}
            </div>
        `;
    }

    resetSongCoverRenderQueue() {
        this.songCoverRenderToken += 1;
        this.songCoverRenderQueue = [];
        this.songCoverRenderScheduled = false;

        if (this.songCoverRenderRafId) {
            cancelAnimationFrame(this.songCoverRenderRafId);
            this.songCoverRenderRafId = 0;
        }
        if (this.songCoverRenderIdleId && typeof cancelIdleCallback === 'function') {
            cancelIdleCallback(this.songCoverRenderIdleId);
        }
        this.songCoverRenderIdleId = null;

        return this.songCoverRenderToken;
    }

    isSongCoverRenderTokenCurrent(token) {
        return token === this.songCoverRenderToken;
    }

    scheduleSongCoverRenderQueue() {
        if (this.songCoverRenderScheduled) return;
        this.songCoverRenderScheduled = true;

        const pump = (deadline) => {
            this.songCoverRenderScheduled = false;
            this.songCoverRenderRafId = 0;
            this.songCoverRenderIdleId = null;
            this.pumpSongCoverRenderQueue(deadline);
            if (this.songCoverRenderQueue.length > 0) {
                this.scheduleSongCoverRenderQueue();
            }
        };

        if (window.requestIdleCallback) {
            this.songCoverRenderIdleId = requestIdleCallback(pump, { timeout: 120 });
            return;
        }

        this.songCoverRenderRafId = requestAnimationFrame(() => pump());
    }

    pumpSongCoverRenderQueue(deadline) {
        const maxPerPump = 8;
        let processed = 0;

        while (this.songCoverRenderQueue.length > 0 && processed < maxPerPump) {
            if (
                deadline &&
                typeof deadline.timeRemaining === 'function' &&
                deadline.timeRemaining() < 1 &&
                processed > 0
            ) {
                break;
            }

            const task = this.songCoverRenderQueue.shift();
            if (!task) continue;

            const { coverDiv, picture, token } = task;
            if (!this.isSongCoverRenderTokenCurrent(token)) continue;
            if (!coverDiv || !coverDiv.isConnected) continue;

            let url = null;
            try {
                url = URL.createObjectURL(new Blob([picture]));
            } catch {
                continue;
            }

            const img = document.createElement('img');
            img.alt = 'Cover';
            const releaseUrl = () => {
                if (!url) return;
                URL.revokeObjectURL(url);
                url = null;
            };
            img.onload = releaseUrl;
            img.onerror = releaseUrl;

            coverDiv.innerHTML = '';
            coverDiv.appendChild(img);
            img.src = url;

            processed++;
        }
    }

    queueSongCoverRender(coverDiv, picture, token) {
        if (!coverDiv || !picture) return;
        if (!this.isSongCoverRenderTokenCurrent(token)) return;
        this.songCoverRenderQueue.push({ coverDiv, picture, token });
        this.scheduleSongCoverRenderQueue();
    }
    
    displayFilteredSongs() {
        const coverRenderToken = this.resetSongCoverRenderQueue();
        const hasActiveLibrarySearch =
            this.currentView !== 'download' &&
            this.searchInput &&
            typeof this.searchInput.value === 'string' &&
            this.searchInput.value.trim().length > 0;
        const songsToShow = this.getSongsForCurrentView();
        
        if (songsToShow.length === 0) {
            if (hasActiveLibrarySearch) {
                this.displaySearchNoResults(this.searchInput.value.trim());
                return;
            }
            this.displayContextEmptyState();
            return;
        }
        
        // Clear and show loading
        this.cachedSongItems = null;
        this.songsDiv.innerHTML = '<div class="loading">Loading songs...</div>';
        
        // Use requestIdleCallback for better performance
        const renderCallback = () => this.renderSongsBatch(songsToShow, 0, coverRenderToken);
        if (window.requestIdleCallback) {
            requestIdleCallback(renderCallback);
        } else {
            requestAnimationFrame(renderCallback);
        }
    }
    
    renderSongsBatch(songsToShow, startIndex, coverRenderToken = this.songCoverRenderToken) {
        if (!this.isSongCoverRenderTokenCurrent(coverRenderToken)) return;
        const batchSize = 200; // Larger batch for playlists
        const endIndex = Math.min(startIndex + batchSize, songsToShow.length);
        
        if (startIndex === 0) {
            if (!this.isSongCoverRenderTokenCurrent(coverRenderToken)) return;
            this.songsDiv.innerHTML = '';
            this.selectionAnchorDisplayIndex = null;
        }
        
        const fragment = document.createDocumentFragment();
        
        for (let i = startIndex; i < endIndex; i++) {
            if (!this.isSongCoverRenderTokenCurrent(coverRenderToken)) return;
            const song = songsToShow[i];
            const originalIndex = this.getSongIndexForSong(song);
            if (!Number.isInteger(originalIndex) || originalIndex < 0) continue;
             
            const div = document.createElement('div');
            div.className = 'song-item';
            if (originalIndex === this.currentSongIndex) div.classList.add('active');
            div.dataset.songIndex = `${originalIndex}`;
            div.dataset.displayIndex = `${i}`;
            if (this.selectedSongs.has(originalIndex)) div.classList.add('selected');
            
            const genreValue = Array.isArray(song.genre) ? song.genre[0] : song.genre;
            const rawDate = song.releaseDate || song.year || song.date || song.dateAdded;
            const dateValue = rawDate ? this.formatReleaseDate(rawDate) : '';
            const durationValue = song.duration ? this.formatDuration(song.duration) : '';
            const metaItems = [];
            if (genreValue) metaItems.push(this.escapeHtml(genreValue));
            if (dateValue) metaItems.push(this.escapeHtml(dateValue));
            if (durationValue) metaItems.push(this.escapeHtml(durationValue));
            const metaHtml = metaItems.length
                ? `<span class="song-meta-sep">•</span>${metaItems.map(item => `<span class="song-meta-item">${item}</span>`).join('<span class="song-meta-sep">•</span>')}`
                : '';
              
            // Defer image loading for faster initial render
            div.innerHTML = `
                <div class="song-checkbox">
                    <label class="song-select-wrap" title="Select song">
                        <input type="checkbox" class="song-select" data-song-index="${originalIndex}" ${this.selectedSongs.has(originalIndex) ? 'checked' : ''} aria-label="Select song">
                        <span class="song-check" aria-hidden="true"></span>
                    </label>
                </div>
                <div class="song-number">${i + 1}</div>
                <div class="song-cover">
                    <div class="cover-placeholder">🎵</div>
                </div>
                <div class="song-info-item">
                    <div class="song-name">${this.escapeHtml(song.title)}${this.getSongDetailDotHtml(song)}</div>
                    <div class="song-meta-line">
                        <span class="song-artist"><img src="icons/user.svg" alt="">${this.escapeHtml(song.artist)}</span>
                        ${metaHtml}
                    </div>
                </div>
                <div class="star-rating" data-song-index="${originalIndex}">
                    ${this.generateStars(song.rating || 0)}
                </div>
                <span class="quality-indicator">${this.getQualityIndicatorHtml(song)}</span>
            `;
            
            // Load cover image asynchronously
            if (song.picture) {
                const coverDiv = div.querySelector('.song-cover');
                if (coverDiv) {
                    this.queueSongCoverRender(coverDiv, song.picture, coverRenderToken);
                }
            }
             
            div.onclick = (e) => {
                if (e.target.closest('.song-checkbox')) return;
                if (e.target.classList.contains('star') || e.target.closest('.star-rating')) return;

                if (this.isVisualizerViewActive) this.disableVisualizerView(true);

                if (this.selectionMode) {
                    const hasAnchor = Number.isInteger(this.selectionAnchorDisplayIndex);
                    if (e.shiftKey && hasAnchor) {
                        if (!e.ctrlKey && !e.metaKey) this.selectedSongs.clear();
                        this.selectRangeInList(this.selectionAnchorDisplayIndex, i, songsToShow);
                    } else if (this.selectedSongs.has(originalIndex)) {
                        this.selectedSongs.delete(originalIndex);
                    } else {
                        this.selectedSongs.add(originalIndex);
                    }

                    this.selectionAnchorDisplayIndex = i;
                    this.syncSelectionDom();
                    this.updateSelectionUI();
                    return;
                }

                // Normal mode, play the song
                this.setPlaybackContextFromBrowseContext();
                this.selectSong(originalIndex);
            };
              
            // Handle checkbox selection
            const checkbox = div.querySelector('.song-select');
            checkbox.onchange = (e) => {
                e.stopPropagation();

                if (!this.selectionMode) {
                    this.enableSelectionMode(originalIndex, { keepExisting: false, showNotification: false, hideMenu: false });
                }

                const checked = !!e.target.checked;
                if (checked) {
                    this.selectedSongs.add(originalIndex);
                } else {
                    this.selectedSongs.delete(originalIndex);
                }

                div.classList.toggle('selected', checked);
                this.selectionAnchorDisplayIndex = i;
                this.updateSelectionUI();
            };
            
            div.oncontextmenu = (e) => {
                e.preventDefault();
                this.showSongContextMenu(e.clientX, e.clientY, originalIndex);
            };
            
            this.addStarEventListeners(div, originalIndex);
            fragment.appendChild(div);
        }

        if (!this.isSongCoverRenderTokenCurrent(coverRenderToken)) return;
        
        this.songsDiv.appendChild(fragment);
        this.updateSelectionHeaderState();
        
        if (endIndex < songsToShow.length) {
            requestAnimationFrame(() => {
                if (!this.isSongCoverRenderTokenCurrent(coverRenderToken)) return;
                this.renderSongsBatch(songsToShow, endIndex, coverRenderToken);
            });
        }
    }
    
    getAudioQualityLevel(song) {
        if (!song || song.isVideo) return 'normal';

        const losslessFlag = typeof song.lossless === 'boolean' ? song.lossless : null;
        if (losslessFlag !== true) return 'normal';

        const bitDepth = Number(song.bitDepth);
        const sampleRate = Number(song.sampleRate);
        const isHiRes =
            Number.isFinite(bitDepth) &&
            Number.isFinite(sampleRate) &&
            bitDepth >= 24 &&
            sampleRate > 44100;

        return isHiRes ? 'hires' : 'lossless';
    }

    getQualityIndicatorHtml(song) {
        const quality = this.getAudioQualityLevel(song);

        if (quality === 'hires') {
            return `<img class="quality-icon hires" src="icons/hi-res.png" alt="Hi-Res" title="High-Resolution Lossless">`;
        }

        if (quality === 'lossless') {
            return `<img class="quality-icon lossless" src="icons/lossless.png" alt="Lossless" title="Lossless">`;
        }

        return `<span class="quality-text" title="Normal (Lossy)">N</span>`;
    }

    getSongDetailDotHtml(song) {
        if (!song) return '';
        const lyricsAvailable = !!song.hasLyrics && !song.isVideo;
        const videoAvailable = !!song.isVideo || !!song.attachedVideo || !!song.youtubeVideo;
        const dotMode = lyricsAvailable && videoAvailable ? 'both' : lyricsAvailable ? 'has-lyrics' : videoAvailable ? 'video' : null;
        if (!dotMode) return '';

        const title =
            dotMode === 'both'
                ? 'Lyrics + Video available'
                : dotMode === 'lyrics'
                  ? 'Lyrics available'
                  : 'Video available';
        return `<span class="song-detail-dot ${dotMode}" title="${title}" aria-label="${title}"></span>`;
    }
    
    addStarEventListeners(songDiv, originalIndex) {
        const starRating = songDiv.querySelector('.star-rating');
        const stars = starRating.querySelectorAll('.star');
        
        stars.forEach((star, starIndex) => {
            let clickCount = 0;
            let clickTimer = null;
            
            star.onclick = (e) => {
                e.stopPropagation();
                const song = this.songs[originalIndex];
                
                if (starIndex === 0) {
                    const currentRating = song.rating || 0;
                    if (currentRating === 1) {
                        this.rateSong(originalIndex, 0);
                    } else if (currentRating > 1) {
                        clickCount++;
                        if (clickCount === 1) {
                            clickTimer = setTimeout(() => {
                                this.rateSong(originalIndex, 1);
                                clickCount = 0;
                            }, 300);
                        } else if (clickCount === 2) {
                            clearTimeout(clickTimer);
                            this.rateSong(originalIndex, 0);
                            clickCount = 0;
                        }
                    } else {
                        this.rateSong(originalIndex, 1);
                    }
                } else {
                    this.rateSong(originalIndex, starIndex + 1);
                }
            };
            
            star.onmouseenter = () => {
                stars.forEach((s, i) => {
                    s.style.color = i <= starIndex ? '#ffd700' : '#2a2a2a';
                    s.style.transform = i <= starIndex ? 'scale(1.4)' : 'scale(1)';
                });
            };
        });
        
        starRating.onmouseleave = () => {
            const rating = this.songs[originalIndex].rating || 0;
            stars.forEach((s, i) => {
                s.style.color = i < rating ? '#ffd700' : '#2a2a2a';
                s.style.transform = 'scale(1)';
            });
        };
    }
    
    toggleShuffle() {
        this.shuffleMode = !this.shuffleMode;
        this.settings.shuffleMode = this.shuffleMode;
        this.saveSettings();
        this.updateModeButtons();
        
        // Reset shuffle state when toggling
        if (this.shuffleMode) {
            this.generateShuffleQueue();
            this.pendingShuffleRegenerate = false;
        } else {
            this.shuffleHistory = [];
            this.shuffleQueue = [];
            this.pendingShuffleRegenerate = false;
        }

        this.renderQueuePanelIfVisible();
    }
    
    generateShuffleQueue() {
        // Create a queue based on current context (playlist or category)
        const availableSongs = [];
        const contextSongs = this.getContextSongs();
        
        for (let i = 0; i < contextSongs.length; i++) {
            const songIndex = this.songs.indexOf(contextSongs[i]);
            if (songIndex !== this.currentSongIndex && songIndex >= 0) {
                availableSongs.push(songIndex);
            }
        }
        
        // Fisher-Yates shuffle for true randomness
        for (let i = availableSongs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [availableSongs[i], availableSongs[j]] = [availableSongs[j], availableSongs[i]];
        }
        
        this.shuffleQueue = availableSongs;
        this.shuffleHistory = [];
    }
    
    getNextShuffleSong() {
        // If queue is empty, regenerate it
        if (this.shuffleQueue.length === 0) {
            this.generateShuffleQueue();
        }
        
        // Get next song from queue
        const nextIndex = this.shuffleQueue.shift();
        
        // Add current song to history
        if (this.currentSongIndex >= 0) {
            this.shuffleHistory.push(this.currentSongIndex);
            
            // Keep history limited to prevent memory issues
            if (this.shuffleHistory.length > this.songs.length) {
                this.shuffleHistory.shift();
            }
        }
        
        return nextIndex;
    }
    
    getPreviousShuffleSong() {
        if (this.shuffleHistory.length === 0) {
            return this.getPreviousSongInContext();
        }
        
        // Get last song from history
        const prevIndex = this.shuffleHistory.pop();
        
        // Add current song back to front of queue
        if (this.currentSongIndex >= 0) {
            this.shuffleQueue.unshift(this.currentSongIndex);
        }
        
        return prevIndex;
    }

    getBrowseContextDescriptor() {
        if (this.currentPlaylist) {
            return { type: 'playlist', playlistName: this.currentPlaylist, category: 'all' };
        }

        const category = this.currentCategory || 'all';
        if (category && category !== 'all') {
            return { type: 'category', playlistName: null, category };
        }

        return { type: 'all', playlistName: null, category: 'all' };
    }

    isSamePlaybackContext(next) {
        const a = this.playbackContext;
        const b = next;
        if (!a || !b) return false;
        if (a.type !== b.type) return false;

        if (a.type === 'playlist') return (a.playlistName || null) === (b.playlistName || null);
        if (a.type === 'category') return (a.category || 'all') === (b.category || 'all');

        return true;
    }

    setPlaybackContext(nextContext, { deferShuffleRegenerate = true } = {}) {
        const fallback = { type: 'all', playlistName: null, category: 'all' };
        const next = nextContext || fallback;

        if (this.isSamePlaybackContext(next)) return false;

        this.playbackContext = {
            type: next.type || 'all',
            playlistName: next.type === 'playlist' ? next.playlistName || null : null,
            category: next.type === 'category' ? next.category || 'all' : 'all'
        };

        if (this.shuffleMode) {
            // Prevent using stale shuffle state from a different context.
            this.shuffleHistory = [];
            this.shuffleQueue = [];
            this.pendingShuffleRegenerate = !!deferShuffleRegenerate;
        }

        this.renderQueuePanelIfVisible();
        return true;
    }

    setPlaybackContextFromBrowseContext({ deferShuffleRegenerate = true } = {}) {
        return this.setPlaybackContext(this.getBrowseContextDescriptor(), { deferShuffleRegenerate });
    }

    getSongsForCategory(category) {
        const cat = category || 'all';

        switch (cat) {
            case 'video':
                return this.songs.filter(song => song.isVideo || song.attachedVideo || song.youtubeVideo);
            case 'rated':
                return this.songs.filter(song => song.rating && song.rating > 0);
            case 'recent':
                return [...this.songs]
                    .filter(song => song.dateAdded)
                    .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
            case 'all':
            default:
                return this.songs;
        }
    }
    
    getContextSongs() {
        // Return songs based on playback context (not necessarily what's currently being browsed).
        const ctx = this.playbackContext || { type: 'all', playlistName: null, category: 'all' };

        if (ctx.type === 'playlist' && ctx.playlistName) {
            return this.getPlaylistSongs(ctx.playlistName);
        }

        if (ctx.type === 'category') {
            return this.getSongsForCategory(ctx.category);
        }

        return this.songs;
    }
    
    getNextSongInContext() {
        const contextSongs = this.getContextSongs();
        const currentSong = this.songs[this.currentSongIndex];
        const currentContextIndex = contextSongs.indexOf(currentSong);
        
        if (currentContextIndex === -1) {
            // Current song not in context, return first song of context
            return contextSongs.length > 0 ? this.songs.indexOf(contextSongs[0]) : null;
        }
        
        if (currentContextIndex < contextSongs.length - 1) {
            // Next song in context
            return this.songs.indexOf(contextSongs[currentContextIndex + 1]);
        } else {
            // At end of context
            if (this.repeatMode === 'all') {
                return contextSongs.length > 0 ? this.songs.indexOf(contextSongs[0]) : null;
            } else {
                return null; // Stop at end if no repeat
            }
        }
    }
    
    getPreviousSongInContext() {
        const contextSongs = this.getContextSongs();
        const currentSong = this.songs[this.currentSongIndex];
        const currentContextIndex = contextSongs.indexOf(currentSong);
        
        if (currentContextIndex === -1) {
            // Current song not in context, return last song of context
            return contextSongs.length > 0 ? this.songs.indexOf(contextSongs[contextSongs.length - 1]) : null;
        }
        
        if (currentContextIndex > 0) {
            // Previous song in context
            return this.songs.indexOf(contextSongs[currentContextIndex - 1]);
        } else {
            // At beginning of context, go to end
            return contextSongs.length > 0 ? this.songs.indexOf(contextSongs[contextSongs.length - 1]) : null;
        }
    }
    
    toggleRepeat() {
        const modes = ['none', 'all', 'one'];
        const currentIndex = modes.indexOf(this.repeatMode);
        this.repeatMode = modes[(currentIndex + 1) % modes.length];
        this.settings.repeatMode = this.repeatMode;
        this.saveSettings();
        this.updateModeButtons();
        this.renderQueuePanelIfVisible();
    }
    
    updateModeButtons() {
        this.shuffleBtn.classList.toggle('active', this.shuffleMode);
        
        if (this.repeatMode === 'one') {
            this.repeatBtn.innerHTML = '<img src="icons/repeat_one.png">';
            this.repeatBtn.title = 'Loop One';
        } else if (this.repeatMode === 'all') {
            this.repeatBtn.innerHTML = '<img src="icons/repeat_all.png">';
            this.repeatBtn.title = 'Loop All';
        } else {
            this.repeatBtn.innerHTML = '<img src="icons/repeat_all.png">';
            this.repeatBtn.title = 'Loop Off';
        }
        this.repeatBtn.classList.toggle('active', this.repeatMode !== 'none');
    }
    
    toggleTheme() {
        const currentTheme = this.settings.theme || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        this.settings.theme = newTheme;
        this.settings.themeMode = newTheme;
        this.saveSettings();
        this.applyTheme(newTheme);
    }
    
    applyTheme(theme) {
        document.body.classList.toggle('light-theme', theme === 'light');
        const img = this.themeToggle.querySelector('img');
        img.src = theme === 'dark' ? 'icons/day.png' : 'icons/night.png';
        this.themeToggle.title = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }

    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Prevent shortcuts when typing in input fields or when download panel is active
            const tag = e.target?.tagName;
            const isEditable =
                e.target?.isContentEditable ||
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                tag === 'SELECT';
            if (isEditable || this.currentView === 'download') return;
             
            // Block all Ctrl+zoom combinations
            if (e.ctrlKey && (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0' || 
                             e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || e.code === 'Numpad0')) {
                e.preventDefault();
                return;
            }

            if (e.code === 'Escape') {
                if (this.selectionMode) {
                    e.preventDefault();
                    this.disableSelectionMode();
                    return;
                }

                if (this.currentView === 'settings') {
                    e.preventDefault();
                    this.toggleSettings();
                    return;
                }
            }

            const isModifier = e.ctrlKey || e.metaKey;
            if (this.selectionMode && isModifier) {
                if (e.code === 'KeyA') {
                    e.preventDefault();
                    this.selectAllSongsInView();
                    return;
                }

                if (e.code === 'KeyI') {
                    e.preventDefault();
                    this.invertSelectionInView();
                    return;
                }

                if (e.code === 'KeyD') {
                    e.preventDefault();
                    this.clearSelectedSongs();
                    return;
                }
            }

            if (this.currentView === 'settings') return;
             
            switch(e.code) {
                case 'Space':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.playPrevious();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.playNext();
                    break;
            }
        });
    }
    
    loadSettings() {
        try {
            const saved = localStorage.getItem('vimusic-settings');
        this.settings = saved ? JSON.parse(saved) : {
                volume: 1,
                lastSongIndex: -1,
                lastCurrentTime: 0,
                floatingWindowPosition: { x: 100, y: 100 },
                theme: 'dark',
                themeMode: 'dark',
                shuffleMode: false,
                repeatMode: 'none',
                selectedCategory: 'all',
                resumeLastSong: true,
                settingsActiveTab: 'playback',
                visualizerFps: 'auto',
                lyricsVisible: true
            };
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = {
                volume: 1,
                lastSongIndex: -1,
                lastCurrentTime: 0,
                floatingWindowPosition: { x: 100, y: 100 },
                theme: 'dark',
                themeMode: 'dark',
                shuffleMode: false,
                repeatMode: 'none',
                selectedCategory: 'all',
                resumeLastSong: true,
                settingsActiveTab: 'playback',
                visualizerFps: 'auto',
                lyricsVisible: true
            };
        }

        // Migrate missing defaults without clobbering existing saved preferences
        if (!this.settings.themeMode) this.settings.themeMode = this.settings.theme || 'dark';
        if (this.settings.resumeLastSong === undefined) this.settings.resumeLastSong = true;
        if (!this.settings.settingsActiveTab) this.settings.settingsActiveTab = 'playback';
        if (!this.settings.visualizerFps) this.settings.visualizerFps = 'auto';
        if (this.settings.lyricsVisible === undefined) this.settings.lyricsVisible = true;
        this.currentCategory = this.normalizeCategory(this.settings.selectedCategory || this.currentCategory || 'all');
        this.settings.selectedCategory = this.currentCategory;
        this.updateCategorySelectionUi(this.currentCategory);
        
        this.shuffleMode = this.settings.shuffleMode;
        this.repeatMode = this.settings.repeatMode;
        this.updateModeButtons();
        this.applyThemeMode();
        // Load song offsets
        const savedOffsets = localStorage.getItem('vimusic-song-offsets');
        this.songOffsets = savedOffsets ? JSON.parse(savedOffsets) : {};
    }
    
    saveSettings() {
        try {
            localStorage.setItem('vimusic-settings', JSON.stringify(this.settings));
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }
    
    seekToLyric(index) {
        if (index >= 0 && index < this.lyrics.length && this.lyrics[index] && this.lyrics[index].time !== undefined) {
            let targetTime = this.lyrics[index].time;
            
            // Apply offset for video mode
            if (this.isVideoMode) {
                targetTime = targetTime - (this.lyricsOffset / 1000);
                targetTime = Math.max(0, targetTime); // Ensure non-negative
                this.videoElement.currentTime = targetTime;
            } else {
                this.smoothSeek(targetTime);
            }
        }
    }
    
    smoothSeek(targetTime) {
        // Check if audio is ready before seeking
        if (this.audio.readyState < 2) {
            this.audio.currentTime = targetTime;
            return;
        }
        
        const originalVolume = this.audio.volume;
        
        // Clear any existing fade interval
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }
        
        // Fade out
        this.audio.volume = 0;
        
        // Seek to position
        this.audio.currentTime = targetTime;
        
        // Fade in
        let currentVolume = 0;
        const fadeStep = originalVolume / 30; // 30 steps over 0.6s
        
        this.fadeInterval = setInterval(() => {
            currentVolume += fadeStep;
            if (currentVolume >= originalVolume) {
                this.audio.volume = originalVolume;
                clearInterval(this.fadeInterval);
                this.fadeInterval = null;
            } else {
                this.audio.volume = currentVolume;
            }
        }, 20); // 20ms intervals = 0.6s total
    }
    
    scrollToCurrentSong() {
        if (this.currentSongIndex < 0) return;
        
        const songItems = document.querySelectorAll('.song-item');
        
        // Find the displayed song item that matches current song
        let targetItem = null;
        const currentSong = this.songs[this.currentSongIndex];
        
        songItems.forEach(item => {
            const songName = item.querySelector('.song-name')?.textContent;
            if (songName === currentSong.title) {
                targetItem = item;
            }
        });
        
        if (targetItem) {
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    

    searchMusicOnline() {
        if (this.currentSongIndex < 0) {
            this.showNotification('No song selected', 'error');
            return;
        }
        
        const song = this.songs[this.currentSongIndex];
        const cleanArtist = song.artist.replace(/ - Topic$/, '');
        const searchQuery = `${song.title} ${cleanArtist}`;
        const encodedQuery = encodeURIComponent(searchQuery);
        const url = `https://lrclib.net/search/${encodedQuery}`;
        
        // Open in external browser
        require('electron').shell.openExternal(url);
    }
    
    showNotification(message, type = 'info') {
        // Remove existing notification to prevent stacking
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();
        
        // Create notification
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to DOM
        document.body.appendChild(notification);
        
        // Auto remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 3000);
    }
    
    async browseForVideo() {
        const song = this.songs[this.currentSongIndex];
        this.showNotification('Opening file browser...', 'info');
        
        try {
            const result = await ipcRenderer.invoke('browse-video-file');
            if (result && !result.canceled && result.filePaths.length > 0) {
                const videoPath = result.filePaths[0];
                const videoName = videoPath.split(/[\\/]/).pop();
                
                this.showNotification('Attaching video...', 'info');
                
                const success = await ipcRenderer.invoke('attach-video-to-song', song.baseName, videoPath);
                if (success) {
                    song.attachedVideo = {
                        name: videoName,
                        path: success.videoPath
                    };
                    
                    this.showNotification(`Video "${videoName}" attached to "attached_video" folder successfully!`, 'success');
                    this.selectSong(this.currentSongIndex, false);
                } else {
                    this.showNotification('Failed to attach video', 'error');
                }
            }
        } catch (error) {
            this.showNotification('Error: ' + error.message, 'error');
        }
    }
    
    showAttachedVideo(song) {
        const coverContainer = this.albumCoverMedia || this.albumCover;
        coverContainer.innerHTML = '';
        const videoEl = document.createElement('video');
        videoEl.src = `file:///${song.attachedVideo.path.replace(/\\/g, '/')}`;
        videoEl.style.width = '100%';
        videoEl.style.height = '100%';
        videoEl.style.objectFit = 'cover';
        videoEl.style.borderRadius = '8px';
        coverContainer.appendChild(videoEl);
        this.attachedVideoElement = videoEl;
    }
    
    setupAlbumCoverDragDrop() {
        // Remove existing handlers to prevent memory leaks
        if (this.albumCover.ondragover) this.albumCover.ondragover = null;
        if (this.albumCover.ondragleave) this.albumCover.ondragleave = null;
        if (this.albumCover.ondrop) this.albumCover.ondrop = null;
        if (this.albumCover.onclick) this.albumCover.onclick = null;
        if (this.albumCover.ondblclick) this.albumCover.ondblclick = null;
        
        this.albumCover.ondragover = (e) => {
            e.preventDefault();
            this.albumCover.style.border = '2px dashed #666';
        };
        
        this.albumCover.ondragleave = (e) => {
            e.preventDefault();
            this.albumCover.style.border = 'none';
        };
        
        this.albumCover.ondrop = (e) => {
            e.preventDefault();
            this.albumCover.style.border = 'none';
            this.handleVideoDrop(e.dataTransfer.files);
        };
        
        // Single click: scroll to current song
        this.albumCover.onclick = () => {
            this.scrollToCurrentSong();
        };
        
        // Double click: browse for video
        this.albumCover.ondblclick = () => {
            if (this.currentSongIndex >= 0) {
                this.browseForVideo();
            }
        };
    }
    
    async handleVideoDrop(files) {
        if (this.currentSongIndex < 0) {
            this.showNotification('Please select a song first', 'error');
            return;
        }
        
        const videoFiles = Array.from(files).filter(file => 
            /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i.test(file.name)
        );
        
        if (videoFiles.length === 0) {
            this.showNotification('Please drop a valid video file', 'error');
            return;
        }
        
        const videoFile = videoFiles[0];
        const song = this.songs[this.currentSongIndex];
        
        // Get the actual file path from the File object
        let videoPath;
        if (videoFile.path) {
            videoPath = videoFile.path;
        } else {
            this.showNotification('Cannot access file path. Try using file browser instead.', 'error');
            return;
        }
        
        this.showNotification('Attaching video...', 'info');
        
        try {
            const success = await ipcRenderer.invoke('attach-video-to-song', song.baseName, videoPath);
            if (success) {
                song.attachedVideo = {
                    name: videoFile.name,
                    path: success.videoPath
                };
                
                this.showNotification(`Video "${videoFile.name}" attached to "attached_video" folder successfully!`, 'success');
                this.selectSong(this.currentSongIndex, false);
            } else {
                this.showNotification('Failed to attach video', 'error');
            }
        } catch (error) {
            console.error('Error attaching video:', error);
            this.showNotification('Error attaching video: ' + error.message, 'error');
        }
    }
    
    handleVideoBuffering() {
        if (this.isVideoMode && this.isPlaying) {
            this.playPauseImg.src = 'icons/play.png';
        }
    }
    
    handleVideoReady() {
        if (this.isVideoMode && this.isPlaying) {
            this.playPauseImg.src = 'icons/pause.png';
        }
    }
    
    handleVideoError() {
        console.error('Video error occurred');
        if (this.isVideoMode) {
            this.switchToMusic();
            this.showNotification('Video error - switched to audio', 'error');
        }
    }
    
    handleVideoPause() {
        // Prevent browser from pausing video when window is hidden
        if (this.isVideoMode && this.isPlaying && document.hidden && this.canAutoResumePlayback()) {
            const transitionToken = this.mediaTransitionToken;
            setTimeout(() => {
                if (!this.isMediaTransitionCurrent(transitionToken)) return;
                if (!this.canAutoResumePlayback()) return;
                if (this.videoElement.paused && this.isVideoMode && this.isPlaying && document.hidden) {
                    this.videoElement.play();
                }
            }, 50);
        }
    }
    
    setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.isVideoMode && this.isPlaying) {
                    // Force video to continue playing in background
                    const transitionToken = this.mediaTransitionToken;
                    setTimeout(() => {
                        if (!this.isMediaTransitionCurrent(transitionToken)) return;
                        if (!this.canAutoResumePlayback()) return;
                        if (this.videoElement.paused && this.isPlaying && this.isVideoMode && document.hidden) {
                            this.videoElement.play();
                        }
                    }, 100);
                } else if (!this.isVideoMode && this.isPlaying) {
                    // Ensure audio keeps going when the app is minimized
                    const transitionToken = this.mediaTransitionToken;
                    setTimeout(() => {
                        if (!this.isMediaTransitionCurrent(transitionToken)) return;
                        if (!this.canAutoResumePlayback()) return;
                        if (this.audio.paused && this.isPlaying && !this.isVideoMode && document.hidden) {
                            this.audio.play().catch(() => {});
                        }
                    }, 100);
                }
            } else {
                this.resumeAudioContext();
                this.syncPlaybackProgress(true);
            }
        });
    }
    
    setupScrollbarTimeout() {
        const scrollableElements = [
            { element: this.leftPanel, name: 'leftPanel' },
            { element: this.musicList, name: 'musicList' },
            { element: this.queueList, name: 'queueList' }
        ];
        
        scrollableElements.forEach(({ element, name }) => {
            if (!element) return;
            
            // Show scrollbar on scroll
            element.addEventListener('scroll', () => {
                this.showScrollbar(element, name);
            });
            
            // Show scrollbar on hover
            element.addEventListener('mouseenter', () => {
                this.showScrollbar(element, name);
            });
            
            // Hide scrollbar when mouse leaves (with delay)
            element.addEventListener('mouseleave', () => {
                this.hideScrollbarWithDelay(element, name);
            });
        });
    }
    
    setupSettings() {
        this.settingsBtn.onclick = () => this.toggleSettings();
        
        // Setup tab switching
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.onclick = () => this.switchSettingsTab(tab.dataset.tab);
        });

        const closeBtn = document.getElementById('settingsCloseBtn');
        if (closeBtn) closeBtn.onclick = () => this.toggleSettings();

        const openStorageFolderBtn = document.getElementById('openStorageFolderBtn');
        if (openStorageFolderBtn) openStorageFolderBtn.onclick = () => this.viewStorageFolder();

        const resetTopBtn = document.getElementById('settingsResetBtn');
        const resetPreferencesBtn = document.getElementById('resetPreferencesBtn');
        const handleReset = async () => {
            const ok = await this.showConfirmDialog({
                title: 'Reset preferences?',
                message: 'This resets app preferences (playback, audio, theme, visualizer) to defaults. Your music library, playlists, and ratings are not deleted.',
                confirmText: 'Reset',
                kind: 'danger'
            });
            if (!ok) return;
            this.resetPreferencesToDefaults();
            this.showNotification('Preferences reset to defaults', 'success');
        };
        if (resetTopBtn) resetTopBtn.onclick = handleReset;
        if (resetPreferencesBtn) resetPreferencesBtn.onclick = handleReset;
        
        // Setup crossfade slider
        const crossfadeSlider = document.getElementById('crossfadeSlider');
        const crossfadeValue = document.getElementById('crossfadeValue');
        
        crossfadeSlider.oninput = () => {
            const value = parseFloat(crossfadeSlider.value);
            crossfadeValue.textContent = `${value.toFixed(1)} sec`;
            crossfadeSlider.style.setProperty('--progress', `${(value / 10) * 100}%`);
            this.settings.crossfadeDuration = value;
            this.saveSettings();
        };
        
        // Setup gapless playback toggle
        const gaplessToggle = document.getElementById('gaplessToggle');
        gaplessToggle.onchange = () => {
            this.settings.gaplessPlayback = gaplessToggle.checked;
            this.saveSettings();
        };

        // Resume last song toggle
        const resumeLastSongToggle = document.getElementById('resumeLastSongToggle');
        if (resumeLastSongToggle) {
            resumeLastSongToggle.onchange = () => {
                this.settings.resumeLastSong = resumeLastSongToggle.checked;
                this.saveSettings();
            };
        }

        // Native selects (keyboard-friendly)
        const bindSelect = (id, key, onChange) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.onchange = () => {
                this.settings[key] = el.value;
                this.saveSettings();
                if (id === 'visualizerFps') this.applyVisualizerFpsSetting();
                if (typeof onChange === 'function') onChange(el.value);
            };
        };
        bindSelect('outputDevice', 'outputDevice', (value) => this.applyOutputDeviceSelection(value));
        bindSelect('audioQuality', 'audioQuality');
        bindSelect('language', 'language');
        bindSelect('visualizerFps', 'visualizerFps');

        // Theme radio group
        document.querySelectorAll('input[name="themeMode"]').forEach(radio => {
            radio.onchange = () => {
                if (!radio.checked) return;
                const mode = radio.value;
                this.settings.themeMode = mode;
                if (mode === 'system') {
                    this.applyThemeMode();
                } else {
                    this.settings.theme = mode;
                    this.applyTheme(mode);
                }
                this.saveSettings();
            };
        });

        this.setupCustomSelects();
        this.setupAudioOutputDevices();
        this.setupSettingsScrollSpy();

        // React to OS theme changes when in system mode
        if (!this.systemThemeMql) {
            this.systemThemeMql = window.matchMedia?.('(prefers-color-scheme: light)') || null;
            if (this.systemThemeMql && typeof this.systemThemeMql.addEventListener === 'function') {
                this.systemThemeMql.addEventListener('change', () => {
                    if (this.settings.themeMode === 'system') this.applyThemeMode();
                });
            }
        }
        
        // Setup equalizer
        this.setupEqualizer();
        
        // Setup volume normalization
        const volumeNormalization = document.getElementById('volumeNormalization');
        
        volumeNormalization.onchange = () => {
            this.settings.volumeNormalization = volumeNormalization.checked;
            this.saveSettings();
        };
        
        // Setup equalizer toggle
        const equalizerToggle = document.getElementById('equalizerToggle');
        equalizerToggle.onchange = () => {
            this.settings.equalizerEnabled = equalizerToggle.checked;
            this.toggleEqualizer(equalizerToggle.checked);
            this.saveSettings();
        };
        
        // Load saved settings immediately
        this.loadAllSettings();

        // About version
        const versionEl = document.getElementById('settingsAppVersion');
        if (versionEl) {
            ipcRenderer.invoke('get-app-version').then(v => {
                if (v) versionEl.textContent = String(v);
            }).catch(() => {});
        }
    }

    setupCustomSelects() {
        if (this.customSelectsReady) return;
        this.customSelectsReady = true;

        const closeAllMenus = () => {
            document.querySelectorAll('.setting-select-menu.open').forEach(menu => {
                menu.classList.remove('open', 'open-up');
                const btn = menu.parentElement?.querySelector('.setting-select-btn');
                if (btn) btn.setAttribute('aria-expanded', 'false');
            });
        };

        document.addEventListener('click', () => closeAllMenus());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllMenus();
        });

        const selects = Array.from(document.querySelectorAll('.setting-select'));
        selects.forEach(select => {
            if (select.dataset.customized === 'true') return;
            select.dataset.customized = 'true';

            const wrapper = document.createElement('div');
            wrapper.className = 'setting-select-wrap';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'setting-select-btn';
            button.setAttribute('aria-haspopup', 'listbox');
            button.setAttribute('aria-expanded', 'false');

            const valueSpan = document.createElement('span');
            valueSpan.className = 'setting-select-value';
            const chevron = document.createElement('span');
            chevron.className = 'setting-select-chevron';
            chevron.textContent = '▾';

            button.append(valueSpan, chevron);

            const menu = document.createElement('div');
            menu.className = 'setting-select-menu';
            menu.setAttribute('role', 'listbox');

            const buildOptions = () => {
                menu.innerHTML = '';
                Array.from(select.options).forEach(opt => {
                    const optionBtn = document.createElement('button');
                    optionBtn.type = 'button';
                    optionBtn.className = 'setting-select-option';
                    optionBtn.setAttribute('role', 'option');
                    optionBtn.dataset.value = opt.value;
                    optionBtn.textContent = opt.textContent;
                    if (opt.disabled) {
                        optionBtn.disabled = true;
                        optionBtn.classList.add('disabled');
                    }
                    if (opt.selected) {
                        optionBtn.classList.add('selected');
                        optionBtn.setAttribute('aria-selected', 'true');
                    }
                    optionBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (opt.disabled) return;
                        select.value = opt.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        updateValue();
                        closeAllMenus();
                    });
                    menu.append(optionBtn);
                });
            };

            const updateValue = () => {
                const selected = select.selectedOptions?.[0];
                valueSpan.textContent = selected ? selected.textContent : '';
                Array.from(menu.children).forEach(child => {
                    const el = child;
                    if (!el || !el.dataset) return;
                    const isSelected = el.dataset.value === select.value;
                    el.classList.toggle('selected', isSelected);
                    el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                });
            };

            const positionMenu = () => {
                menu.classList.remove('open-up');
                const menuHeight = menu.scrollHeight;
                const rect = wrapper.getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                const spaceAbove = rect.top;
                if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
                    menu.classList.add('open-up');
                }
            };

            const toggleMenu = (e) => {
                e.stopPropagation();
                const isOpen = menu.classList.contains('open');
                closeAllMenus();
                if (isOpen) return;
                buildOptions();
                updateValue();
                menu.classList.add('open');
                button.setAttribute('aria-expanded', 'true');
                positionMenu();
            };

            button.addEventListener('click', toggleMenu);
            select.addEventListener('change', updateValue);

            select.parentNode.insertBefore(wrapper, select);
            wrapper.appendChild(select);
            wrapper.appendChild(button);
            wrapper.appendChild(menu);
            select.classList.add('setting-select-native');

            updateValue();
        });
    }

    setupScrollPerformanceHints() {
        const targets = [this.musicList, this.leftPanel].filter(Boolean);
        if (targets.length === 0) return;
        const body = document.body;
        if (!body) return;

        const nowFn =
            (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? () => performance.now()
                : () => Date.now();

        let rafId = 0;
        let hideTimeoutId = 0;
        let lastScrollAt = 0;
        let scrollHintActive = false;

        const activateScrollHint = () => {
            rafId = 0;
            if (scrollHintActive) return;
            scrollHintActive = true;
            body.classList.add('is-scrolling');
        };

        const scheduleHideCheck = () => {
            if (hideTimeoutId) return;
            const checkIdle = () => {
                const elapsed = nowFn() - lastScrollAt;
                if (elapsed < 140) {
                    hideTimeoutId = setTimeout(checkIdle, Math.max(0, 140 - elapsed));
                    return;
                }
                hideTimeoutId = 0;
                if (!scrollHintActive) return;
                scrollHintActive = false;
                body.classList.remove('is-scrolling');
            };
            hideTimeoutId = setTimeout(checkIdle, 140);
        };

        const handleScroll = () => {
            lastScrollAt = nowFn();
            if (!scrollHintActive && !rafId) {
                rafId = requestAnimationFrame(activateScrollHint);
            }
            scheduleHideCheck();
        };

        targets.forEach(el => {
            el.addEventListener('scroll', handleScroll, { passive: true });
        });
    }


    refreshCustomSelects() {
        const wraps = document.querySelectorAll('.setting-select-wrap');
        wraps.forEach(wrapper => {
            const select = wrapper.querySelector('select.setting-select');
            const valueEl = wrapper.querySelector('.setting-select-value');
            if (!select || !valueEl) return;
            const selected = select.selectedOptions?.[0];
            valueEl.textContent = selected ? selected.textContent : '';

            const menu = wrapper.querySelector('.setting-select-menu');
            if (!menu) return;
            Array.from(menu.children).forEach(child => {
                const el = child;
                if (!el || !el.dataset) return;
                const isSelected = el.dataset.value === select.value;
                el.classList.toggle('selected', isSelected);
                el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            });
        });
    }

    setupSettingsScrollSpy() {
        if (this.settingsScrollSpyReady) return;
        this.settingsScrollSpyReady = true;

        const container = document.querySelector('.settings-content');
        if (!container) return;

        const sections = Array.from(document.querySelectorAll('.settings-tab-content'));
        if (sections.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            if (this.currentView !== 'settings') return;

            const visible = entries.filter(entry => entry.isIntersecting);
            if (visible.length === 0) return;

            visible.sort((a, b) => {
                if (b.intersectionRatio !== a.intersectionRatio) {
                    return b.intersectionRatio - a.intersectionRatio;
                }
                return a.boundingClientRect.top - b.boundingClientRect.top;
            });

            const target = visible[0].target;
            const tabName = target.id?.replace('-content', '');
            if (tabName) {
                this.updateSettingsTabHighlight(tabName, { save: false, source: 'scroll' });
            }
        }, {
            root: container,
            rootMargin: '-25% 0px -60% 0px',
            threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
        });

        sections.forEach(section => observer.observe(section));
        this.settingsScrollSpy = observer;
    }

    updateSettingsTabHighlight(tabName, { save = true, source = 'click' } = {}) {
        const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
        if (!tabBtn) return;

        if (this.settingsActiveTab === tabName) return;
        this.settingsActiveTab = tabName;

        document.querySelectorAll('.settings-tab').forEach(tab => {
            const active = tab === tabBtn;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        if (save) {
            this.settings.settingsActiveTab = tabName;
            this.saveSettings();
        } else if (source === 'scroll') {
            this.queueSettingsActiveTabSave(tabName);
        }
    }

    queueSettingsActiveTabSave(tabName) {
        this.settings.settingsActiveTab = tabName;
        if (this.settingsActiveTabSaveTimer) {
            clearTimeout(this.settingsActiveTabSaveTimer);
        }
        this.settingsActiveTabSaveTimer = setTimeout(() => {
            this.saveSettings();
            this.settingsActiveTabSaveTimer = null;
        }, 350);
    }

    smoothScrollTo(container, targetTop, duration = 220) {
        if (!container) return;
        if (this.settingsScrollAnim) {
            cancelAnimationFrame(this.settingsScrollAnim);
            this.settingsScrollAnim = null;
        }

        const startTop = container.scrollTop;
        const delta = targetTop - startTop;
        if (Math.abs(delta) < 2 || duration <= 0) {
            container.scrollTop = targetTop;
            return;
        }

        const startTime = performance.now();
        const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const eased = easeOutCubic(progress);
            container.scrollTop = startTop + delta * eased;
            if (progress < 1) {
                this.settingsScrollAnim = requestAnimationFrame(step);
            } else {
                this.settingsScrollAnim = null;
            }
        };

        this.settingsScrollAnim = requestAnimationFrame(step);
    }



    async setupAudioOutputDevices() {
        this.outputDeviceSelect = document.getElementById('outputDevice');
        if (!this.outputDeviceSelect || !navigator.mediaDevices?.enumerateDevices) return;

        if (!this.audioOutputDevicesReady) {
            this.audioOutputDevicesReady = true;
            if (navigator.mediaDevices?.addEventListener) {
                navigator.mediaDevices.addEventListener('devicechange', () => {
                    void this.updateAudioOutputDevices();
                });
            }
        }

        await this.updateAudioOutputDevices();
    }

    async updateAudioOutputDevices() {
        const outputs = await this.getAudioOutputDevices();
        this.renderAudioOutputOptions(outputs);
    }

    async getAudioOutputDevices() {
        const enumerate = async () => {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(device => device.kind === 'audiooutput');
        };

        let outputs = [];
        try {
            outputs = await enumerate();
        } catch (error) {
            return outputs;
        }

        const hasLabels = outputs.some(device => (device.label || '').trim().length > 0);
        if (!hasLabels && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                outputs = await enumerate();
            } catch (error) {
                // Permission denied or not available; fall back to generic labels.
            }
        }

        return outputs;
    }

    renderAudioOutputOptions(outputs) {
        const select = this.outputDeviceSelect;
        if (!select) return;

        const current = this.settings.outputDevice || 'default';
        select.innerHTML = '';
        select.appendChild(new Option('System default', 'default'));

        let index = 1;
        outputs.forEach(device => {
            if (!device.deviceId || device.deviceId === 'default') return;
            const label = (device.label || '').trim() || `Output device ${index++}`;
            select.appendChild(new Option(label, device.deviceId));
        });

        const hasCurrent = Array.from(select.options).some(opt => opt.value === current);
        select.value = hasCurrent ? current : 'default';
        if (!hasCurrent && current !== 'default') {
            this.settings.outputDevice = 'default';
            this.saveSettings();
        }

        this.applyOutputDeviceSelection(select.value);
        this.refreshCustomSelects();
    }

    async applyOutputDeviceSelection(deviceId) {
        const targetId = deviceId || 'default';
        const applyTo = async (element) => {
            if (!element || typeof element.setSinkId !== 'function') return;
            try {
                await element.setSinkId(targetId);
            } catch (error) {
                console.warn('Failed to set output device:', error);
            }
        };

        await applyTo(this.audio);
        await applyTo(this.videoElement);
        await applyTo(this.nextAudio);
    }

    setupSongContextMenuDelegation() {
        if (!this.musicList) return;
        this.musicList.addEventListener('contextmenu', (e) => {
            const selectionActive = this.selectionMode && this.selectedSongs.size > 0;
            if (selectionActive) {
                e.preventDefault();
                const index = this.getFirstSelectedSongIndex();
                if (Number.isInteger(index)) {
                    this.showSongContextMenu(e.clientX, e.clientY, index, { forceMulti: true });
                }
                return;
            }

            const item = e.target.closest('.song-item');
            if (item && this.musicList.contains(item)) {
                e.preventDefault();
                const index = Number(item.dataset.songIndex);
                if (Number.isInteger(index)) {
                    this.showSongContextMenu(e.clientX, e.clientY, index);
                }
                return;
            }
            e.preventDefault();
            this.hideAllContextMenus();
        });
    }
    
    loadAllSettings() {
        const crossfadeSlider = document.getElementById('crossfadeSlider');
        const crossfadeValue = document.getElementById('crossfadeValue');
        const gaplessToggle = document.getElementById('gaplessToggle');
        const volumeNormalization = document.getElementById('volumeNormalization');
        const resumeLastSongToggle = document.getElementById('resumeLastSongToggle');
        const outputDevice = document.getElementById('outputDevice');
        const audioQuality = document.getElementById('audioQuality');
        const language = document.getElementById('language');
        const visualizerFps = document.getElementById('visualizerFps');
        
        const savedCrossfade = this.settings.crossfadeDuration || 0;
        crossfadeSlider.value = savedCrossfade;
        crossfadeValue.textContent = `${savedCrossfade.toFixed(1)} sec`;
        crossfadeSlider.style.setProperty('--progress', `${(savedCrossfade / 10) * 100}%`);
        gaplessToggle.checked = this.settings.gaplessPlayback || false;
        volumeNormalization.checked = this.settings.volumeNormalization || false;
        if (resumeLastSongToggle) resumeLastSongToggle.checked = this.settings.resumeLastSong !== false;
        if (outputDevice) outputDevice.value = this.settings.outputDevice || 'default';
        if (audioQuality) audioQuality.value = this.settings.audioQuality || 'high';
        if (language) language.value = this.settings.language || 'english';
        if (visualizerFps) visualizerFps.value = this.settings.visualizerFps || 'auto';
        this.applyVisualizerFpsSetting();
        this.applyOutputDeviceSelection(this.settings.outputDevice || 'default');

        this.refreshCustomSelects();

        // Theme radios
        const mode = this.settings.themeMode || this.settings.theme || 'dark';
        const radio = document.querySelector(`input[name="themeMode"][value="${mode}"]`);
        if (radio) radio.checked = true;
        
        // Load equalizer toggle state
        const equalizerEnabled = this.settings.equalizerEnabled !== false;
        document.getElementById('equalizerToggle').checked = equalizerEnabled;
        this.toggleEqualizer(equalizerEnabled);
    }
    
    toggleSettings() {
        const isSettingsVisible = window.getComputedStyle(this.settingsPanel).display !== 'none';
        
        if (isSettingsVisible) {
            if (this.settingsPrevPanelWidths) {
                this.leftPanel.style.width = this.settingsPrevPanelWidths.left || '';
                this.rightPanel.style.width = this.settingsPrevPanelWidths.right || '';
                this.settingsPrevPanelWidths = null;
            }
            this.showMusicView();
            this.settingsBtn.classList.remove('active');
        } else {
            if (this.selectionMode) this.disableSelectionMode();
            if (this.currentView === 'download') {
                this.restoreLibrarySearchBar();
            }
            this.hideAllPanels();
            this.settingsPanel.style.display = 'flex';
            this.settingsBtn.classList.add('active');
            this.leftPanel.classList.add('settings-active');
            document.body.classList.add('settings-open');
            this.currentView = 'settings';
            this.loadAllSettings();
            this.switchSettingsTab(this.settings.settingsActiveTab || 'playback', { skipSave: true });
            this.settingsPrevPanelWidths = {
                left: this.leftPanel.style.width,
                right: this.rightPanel.style.width
            };
            this.leftPanel.style.width = '';
            this.rightPanel.style.width = '';
        }
    }
    
    switchSettingsTab(tabName, options = {}) {
        const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
        const nextPanel = document.getElementById(`${tabName}-content`);
        if (!tabBtn || !nextPanel) return;

        this.updateSettingsTabHighlight(tabName, { save: !options.skipSave, source: 'click' });

        const scrollContainer = document.querySelector('.settings-content');
        if (scrollContainer) {
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            const top = Math.min(Math.max(nextPanel.offsetTop, 0), maxTop);
            if (reduce) {
                scrollContainer.scrollTop = top;
            } else {
                this.smoothScrollTo(scrollContainer, top, 220);
            }
        }

        if (options.skipSave) {
            this.settings.settingsActiveTab = tabName;
        }
    }

    applyThemeMode() {
        const mode = this.settings.themeMode || this.settings.theme || 'dark';
        let theme = mode;
        if (mode === 'system') {
            const isLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches;
            theme = isLight ? 'light' : 'dark';
        }
        this.settings.theme = theme;
        this.applyTheme(theme);
    }

    applyVisualizerFpsSetting() {
        if (!this.visualizer) return;
        const pref = this.settings.visualizerFps || 'auto';
        if (pref === 'auto') {
            if (typeof this.visualizer.setAutoTargetFps === 'function') this.visualizer.setAutoTargetFps(true);
            this.visualizer.setTargetFps(90);
        } else {
            if (typeof this.visualizer.setAutoTargetFps === 'function') this.visualizer.setAutoTargetFps(false);
            this.visualizer.setTargetFps(Number(pref) || 60);
        }
    }

    resetPreferencesToDefaults() {
        try {
            localStorage.removeItem('vimusic-settings');
            localStorage.removeItem('vimusic-lyrics-font-size');
            localStorage.removeItem('vimusic-floating-lyrics-font-size');
            localStorage.removeItem('vimusic-floating-lyrics-color');
        } catch (e) {}
        this.loadSettings();
        this.loadAllSettings();
        this.applyLyricsVisibilityPreference();
    }

    showConfirmDialog({ title, message, confirmText = 'OK', kind = 'primary' }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'playlist-modal-overlay';
            overlay.innerHTML = `
                <div class="playlist-modal" role="dialog" aria-modal="true">
                    <h3>${this.escapeHtml(String(title || 'Confirm'))}</h3>
                    <p style="margin: 0 0 18px 0; color: #888; font-size: 13px; line-height: 1.45;">${this.escapeHtml(String(message || ''))}</p>
                    <div class="modal-buttons">
                        <button id="confirmCancel">Cancel</button>
                        <button id="confirmOk"${kind === 'danger' ? ' style=\"background:#a83232;\"' : ''}>${this.escapeHtml(String(confirmText))}</button>
                    </div>
                </div>
            `;

            const cleanup = (value) => {
                document.removeEventListener('keydown', onKeyDown, true);
                overlay.remove();
                resolve(value);
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(false);
                }
            };

            document.addEventListener('keydown', onKeyDown, true);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(false);
            });

            document.body.appendChild(overlay);
            const okBtn = overlay.querySelector('#confirmOk');
            const cancelBtn = overlay.querySelector('#confirmCancel');
            if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
            if (okBtn) okBtn.onclick = () => cleanup(true);
            requestAnimationFrame(() => {
                if (okBtn && typeof okBtn.focus === 'function') okBtn.focus();
            });
        });
    }

    setupPlayerBarSizing() {
        const update = () => {
            const bar = document.querySelector('.bottom-controls');
            if (!bar) return;
            const height = Math.round(bar.getBoundingClientRect().height || 0);
            if (height > 0) {
                document.documentElement.style.setProperty('--player-bar-height', `${height}px`);
            }
        };

        update();
        window.addEventListener('resize', update);
        if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(update).catch(() => {});
        }
    }
    
    scheduleScrollbarHide(element, name, delayMs) {
        if (!element || !name) return;
        if (!this.scrollbarHideState) this.scrollbarHideState = {};

        const nowFn =
            (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? () => performance.now()
                : () => Date.now();

        let state = this.scrollbarHideState[name];
        if (!state) {
            state = { timerId: 0, hideAt: 0, nextFireAt: 0 };
            this.scrollbarHideState[name] = state;
        }

        state.hideAt = nowFn() + delayMs;

        const tick = () => {
            const remaining = state.hideAt - nowFn();
            if (remaining > 4) {
                state.timerId = setTimeout(tick, Math.max(0, remaining));
                state.nextFireAt = nowFn() + Math.max(0, remaining);
                this.scrollbarTimeouts[name] = state.timerId;
                return;
            }

            state.timerId = 0;
            state.nextFireAt = 0;
            if (element.classList.contains('show-scrollbar')) {
                element.classList.remove('show-scrollbar');
            }
            delete this.scrollbarTimeouts[name];
        };

        if (state.timerId) {
            if (state.hideAt + 1 < state.nextFireAt) {
                clearTimeout(state.timerId);
                const wait = Math.max(0, state.hideAt - nowFn());
                state.timerId = setTimeout(tick, wait);
                state.nextFireAt = nowFn() + wait;
                this.scrollbarTimeouts[name] = state.timerId;
            }
            return;
        }

        const wait = Math.max(0, state.hideAt - nowFn());
        state.timerId = setTimeout(tick, wait);
        state.nextFireAt = nowFn() + wait;
        this.scrollbarTimeouts[name] = state.timerId;
    }

    showScrollbar(element, name) {
        if (!element || !name) return;
        if (!element.classList.contains('show-scrollbar')) {
            element.classList.add('show-scrollbar');
        }
        this.scheduleScrollbarHide(element, name, 1000);
    }
    
    hideScrollbarWithDelay(element, name) {
        if (!element || !name) return;
        if (!element.classList.contains('show-scrollbar') && !this.scrollbarTimeouts[name]) return;
        this.scheduleScrollbarHide(element, name, 500);
    }
    
    applyCrossfadeIn(duration) {
        if (this.crossfadeInterval) {
            clearInterval(this.crossfadeInterval);
        }
        
        const steps = 50;
        const stepDuration = (duration * 1000) / steps;
        const volumeStep = this.originalVolume / steps;
        let currentStep = 0;
        
        this.crossfadeInterval = setInterval(() => {
            currentStep++;
            const newVolume = Math.min(volumeStep * currentStep, this.originalVolume);
            this.audio.volume = newVolume;
            this.videoElement.volume = newVolume;
            
            if (currentStep >= steps) {
                clearInterval(this.crossfadeInterval);
                this.crossfadeInterval = null;
            }
        }, stepDuration);
    }
    
    applyCrossfadeOut(timeLeft) {
        if (this.crossfadeInterval) {
            clearInterval(this.crossfadeInterval);
        }
        
        const steps = 50;
        const stepDuration = (timeLeft * 1000) / steps;
        const currentVolume = this.audio.volume;
        const volumeStep = currentVolume / steps;
        let currentStep = 0;
        
        this.crossfadeInterval = setInterval(() => {
            currentStep++;
            const newVolume = Math.max(currentVolume - (volumeStep * currentStep), 0);
            this.audio.volume = newVolume;
            this.videoElement.volume = newVolume;
            
            if (currentStep >= steps) {
                clearInterval(this.crossfadeInterval);
                this.crossfadeInterval = null;
            }
        }, stepDuration);
    }
    
    setupCustomDropdown(id, onChange) {
        const dropdown = document.getElementById(id);
        const selected = dropdown.querySelector('.dropdown-selected');
        const options = dropdown.querySelector('.dropdown-options');
        const optionElements = dropdown.querySelectorAll('.dropdown-option');
        
        selected.onclick = () => {
            dropdown.classList.toggle('open');
        };
        
        optionElements.forEach(option => {
            option.onclick = () => {
                const value = option.dataset.value;
                const text = option.textContent;
                
                selected.textContent = text;
                optionElements.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                dropdown.classList.remove('open');
                
                onChange(value);
            };
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });
    }
    
    setDropdownValue(id, value) {
        const dropdown = document.getElementById(id);
        const selected = dropdown.querySelector('.dropdown-selected');
        const option = dropdown.querySelector(`[data-value="${value}"]`);
        
        if (option) {
            selected.textContent = option.textContent;
            dropdown.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
        }
    }
    
    initializeAudioContext() {
        if (this.isEqInitialized) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
            this.gainNode = this.audioContext.createGain();
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 2048;
            this.analyserNode.smoothingTimeConstant = 0.0;
            
            // Create 15-band equalizer filters
            const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 10000, 12000, 14000, 16000, 18000, 20000];
            
            this.eqFilters = frequencies.map((freq, index) => {
                const filter = this.audioContext.createBiquadFilter();
                if (index === 0) {
                    filter.type = 'lowshelf';
                } else if (index === frequencies.length - 1) {
                    filter.type = 'highshelf';
                } else {
                    filter.type = 'peaking';
                    filter.Q.value = 1;
                }
                filter.frequency.value = freq;
                filter.gain.value = 0;
                return filter;
            });
            
            // Connect audio chain
            let previousNode = this.sourceNode;
            this.eqFilters.forEach(filter => {
                previousNode.connect(filter);
                previousNode = filter;
            });
            previousNode.connect(this.gainNode);
            this.gainNode.connect(this.analyserNode);
            this.analyserNode.connect(this.audioContext.destination);

            this.syncVisualizerAudioSource();
            
            this.isEqInitialized = true;
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
        }
    }
    
    setupEqualizer() {
        // Equalizer presets
        this.eqPresets = {
            flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            rock: [3, 2, -1, -2, -1, 1, 3, 4, 4, 4, 3, 2, 1, 0, 0],
            pop: [-1, 2, 4, 4, 2, 0, -1, -1, 0, 2, 3, 3, 2, 1, 0],
            jazz: [2, 1, 0, 1, 2, 2, 1, 0, 1, 2, 2, 1, 0, -1, -1],
            classical: [3, 2, 1, 0, -1, -1, 0, 1, 2, 3, 3, 2, 1, 0, 0],
            electronic: [4, 3, 1, 0, -1, 1, 2, 2, 1, 2, 3, 4, 4, 3, 2],
            'bass-boost': [6, 5, 4, 2, 1, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0],
            vocal: [-2, -1, 0, 1, 3, 4, 4, 3, 2, 1, 0, -1, -1, -2, -2]
        };
        
        // Setup preset select (native for accessibility)
        const presetSelect = document.getElementById('equalizerPresets');
        if (presetSelect) {
            presetSelect.onchange = () => {
                const preset = presetSelect.value;
                if (preset !== 'custom') {
                    this.applyEqPreset(preset);
                }
                this.settings.eqPreset = preset;
                this.saveSettings();
            };
        }
        
        // Setup individual sliders
        const sliders = document.querySelectorAll('.eq-slider');
        sliders.forEach((slider, index) => {
            const valueSpan = slider.parentElement.querySelector('.eq-value');
            
            slider.oninput = () => {
                const value = parseFloat(slider.value);
                this.updateEqSlider(slider, value);
                this.updateEqFilter(index, value);
                valueSpan.textContent = `${value > 0 ? '+' : ''}${value}dB`;
                if (!this.settings.eqValues) this.settings.eqValues = new Array(15).fill(0);
                this.settings.eqValues[index] = value;
                this.settings.eqPreset = 'custom';
                if (presetSelect) presetSelect.value = 'custom';
                this.updateEqGraph();
                this.saveSettings();
            };
            
            // Initialize slider visual
            this.updateEqSlider(slider, 0);
            valueSpan.textContent = '0dB';
        });
        
        // Reset button
        document.getElementById('resetEqualizer').onclick = () => {
            this.resetEqualizer();
        };
        
        // Load saved settings
        const savedPreset = this.settings.eqPreset || 'flat';
        const savedValues = this.settings.eqValues || this.eqPresets.flat;
        if (presetSelect) presetSelect.value = savedPreset;
        this.loadEqValues(savedValues);
        
        setTimeout(() => this.updateEqGraph(), 100);
        window.addEventListener('resize', () => setTimeout(() => this.updateEqGraph(), 100));
    }
    
    updateEqSlider(slider, value) {
        // For horizontal sliders, 0dB should be at 50% width
        const progress = ((value + 12) / 24) * 100;
        slider.style.setProperty('--progress', `${progress}%`);
    }
    
    updateEqFilter(index, value) {
        if (this.eqFilters && this.eqFilters[index]) {
            this.eqFilters[index].gain.value = value;
        }
    }
    
    applyEqPreset(preset) {
        if (this.eqPresets[preset]) {
            this.loadEqValues(this.eqPresets[preset]);
            // Apply to audio filters
            this.eqPresets[preset].forEach((value, index) => {
                this.updateEqFilter(index, value);
            });
            this.updateEqGraph();
        }
    }
    
    loadEqValues(values) {
        const sliders = document.querySelectorAll('.eq-slider');
        sliders.forEach((slider, index) => {
            const value = values[index] || 0;
            const valueSpan = slider.parentElement.querySelector('.eq-value');
            slider.value = value;
            this.updateEqSlider(slider, value);
            this.updateEqFilter(index, value);
            valueSpan.textContent = `${value > 0 ? '+' : ''}${value}dB`;
        });
        this.updateEqGraph();
    }
    
    resetEqualizer() {
        this.applyEqPreset('flat');
        const presetSelect = document.getElementById('equalizerPresets');
        if (presetSelect) presetSelect.value = 'flat';
        this.settings.eqPreset = 'flat';
        this.settings.eqValues = [...this.eqPresets.flat];
        this.updateEqGraph();
        this.saveSettings();
    }
    
    toggleEqualizer(enabled) {
        const equalizerControls = document.querySelector('.equalizer-controls');
        if (enabled) {
            equalizerControls.style.opacity = '1';
            equalizerControls.style.pointerEvents = 'auto';
            // Apply current EQ settings gradually
            if (this.eqFilters) {
                const currentValues = this.settings.eqValues || this.eqPresets.flat;
                currentValues.forEach((value, index) => {
                    if (this.eqFilters[index]) {
                        this.eqFilters[index].gain.setValueAtTime(value, this.audioContext.currentTime + 0.1);
                    }
                });
            }
        } else {
            equalizerControls.style.opacity = '0.5';
            equalizerControls.style.pointerEvents = 'none';
            // Reset all filters to 0 gradually
            if (this.eqFilters) {
                this.eqFilters.forEach(filter => {
                    filter.gain.setValueAtTime(0, this.audioContext.currentTime + 0.1);
                });
            }
        }
    }
    
    updateEqGraph() {
        // No graph visualization - just normal sliders
    }
    
    preloadNextSong() {
        let nextIndex;
        
        if (this.shuffleMode) {
            if (this.shuffleQueue.length > 0) {
                const nextSongIndex = this.songs.indexOf(this.songs[this.shuffleQueue[0]]);
                nextIndex = nextSongIndex >= 0 ? nextSongIndex : null;
            }
        } else {
            nextIndex = this.currentSongIndex < this.songs.length - 1 ? this.currentSongIndex + 1 : 
                       (this.repeatMode === 'all' ? 0 : null);
        }
        
        if (nextIndex !== null && nextIndex >= 0 && nextIndex < this.songs.length) {
            const nextSong = this.songs[nextIndex];
            if (this.nextAudio) {
                this.nextAudio.src = '';
            }
            this.nextAudio = new Audio(`file:///${nextSong.path.replace(/\\/g, '/')}`);
            this.applyOutputDeviceSelection(this.settings.outputDevice || 'default');
            this.nextAudio.preload = 'auto';
        }
    }
    
    async syncAttachedVideo(song, autoPlay) {
        const transitionToken = this.mediaTransitionToken;
        // Wait for both audio and video metadata to load
        await Promise.all([
            new Promise(resolve => {
                if (this.audio.readyState >= 1) resolve();
                else this.addOneTimeMediaListener(this.audio, 'loadedmetadata', resolve);
            }),
            new Promise(resolve => {
                if (this.videoElement.readyState >= 1) resolve();
                else this.addOneTimeMediaListener(this.videoElement, 'loadedmetadata', resolve);
            })
        ]);

        if (!this.isMediaTransitionCurrent(transitionToken)) return;
        
        const audioDuration = this.audio.duration;
        const videoDuration = this.videoElement.duration;
        const timeDiff = Math.abs(audioDuration - videoDuration);
        
        if (timeDiff <= 2) {
            // Durations match, sync with current audio time
            const currentTime = this.audio.currentTime;
            this.videoElement.currentTime = currentTime;
        } else {
            // Durations don't match, start from beginning
            this.videoElement.currentTime = 0;
            this.audio.currentTime = 0;
        }
        
        if (autoPlay) {
            this.playVideo();
        }
    }
}



// Window controls
window.minimize = () => ipcRenderer.send('window-minimize');
window.maximize = () => {
    ipcRenderer.send('window-maximize');
    // Toggle button visibility
    const maximizeBtn = document.querySelector('.window-control.maximize');
    const restoreBtn = document.querySelector('.window-control.restore');
    if (maximizeBtn.style.display === 'none') {
        maximizeBtn.style.display = 'flex';
        restoreBtn.style.display = 'none';
    } else {
        maximizeBtn.style.display = 'none';
        restoreBtn.style.display = 'flex';
    }
};
window.closeApp = () => ipcRenderer.send('window-close');

// Start app
const musicPlayer = new MusicPlayer();
window.player = musicPlayer; // Make globally accessible
