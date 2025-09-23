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
        this.selectedSongs = new Set();
        this.selectionMode = false;
        this.scrollbarTimeouts = {};
        this.shuffleHistory = [];
        this.shuffleQueue = [];
        this.currentCategory = 'all';
        this.crossfadeInterval = null;
        this.originalVolume = 1;
        this.nextAudio = null;
        this.spotdlServerRunning = false;
        
        // Audio context for equalizer
        this.audioContext = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.eqFilters = [];
        this.isEqInitialized = false;

        
        this.initElements();
        this.bindEvents();
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

    // Helper function to update song badge
    updateSongBadge(songIndex, hasLyrics) {
        // Use more efficient selector with caching
        const songItem = document.querySelector(`[data-song-index="${songIndex}"]`)?.closest('.song-item');
        if (!songItem) return;
        
        const badge = songItem.querySelector('.badge');
        const song = this.songs[songIndex];
        if (badge && song) {
            // Reset all classes
            badge.className = 'badge';
            
            if (hasLyrics && song.attachedVideo) {
                badge.classList.add('has-lyrics-video');
                badge.textContent = '♪';
            } else if (song.attachedVideo && !hasLyrics) {
                badge.classList.add('has-video');
                badge.textContent = '♫';
            } else if (hasLyrics) {
                badge.classList.add('has-lyrics');
                badge.textContent = '♪';
            } else {
                badge.textContent = '♫';
            }
        }
    }

    initElements() {
        this.initAudioElements();
        this.initControlElements();
        this.initDisplayElements();
        this.initPanelElements();
        
        this.playPauseBtn.disabled = true;
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
    }

    initDisplayElements() {
        this.timeDisplay = document.getElementById('time');
        this.albumCover = document.getElementById('albumCover');
        this.detailTitle = document.getElementById('detailTitle');
        this.detailArtist = document.getElementById('detailArtist');
        this.detailDuration = document.getElementById('detailDuration');
        this.detailFormat = document.getElementById('detailFormat');
        this.starRatingCurrent = document.getElementById('starRatingCurrent');
        this.videoPlayer = document.getElementById('videoPlayer');
        this.videoElement = document.getElementById('videoElement');
        this.videoBtn = document.getElementById('videoBtn');
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
            songsDiv: 'songs',
            lyricsDiv: 'lyrics',

            floatLyricsBtn: 'floatLyricsBtn',
            contextMenu: 'contextMenu',
            musicFileInput: 'musicFileInput',
            videoFileInput: 'videoFileInput',
            lyricsFileInput: 'lyricsFileInput',
            resizer: 'resizer'
        };
        
        Object.keys(elements).forEach(key => {
            this[key] = document.getElementById(elements[key]);
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
        this.audio.onended = () => this.playNext();
        this.audio.onloadedmetadata = () => this.updateDuration();
        
        // Video event handlers
        this.videoElement.ontimeupdate = () => this.updateTime();
        this.videoElement.onended = () => this.playNext();
        this.videoElement.onloadedmetadata = () => this.updateDuration();
        this.videoElement.ondblclick = () => this.toggleVideoAspectRatio();
        this.videoElement.onwaiting = () => this.handleVideoBuffering();
        this.videoElement.oncanplay = () => this.handleVideoReady();
        this.videoElement.onerror = () => this.handleVideoError();
        this.videoElement.onpause = () => this.handleVideoPause();
        
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
        this.setupPlaylists();
        this.setupVisibilityHandler();
        this.setupScrollbarTimeout();
        this.setupSettings();
        this.loadSettings();
        const volume = this.settings.volume || 1;
        this.audio.volume = volume;
        this.videoElement.volume = volume;
        this.updateVolumeDisplay(volume * 100);
    }

    async loadMusic() {
        this.musicList.innerHTML = '<div id="songs"></div>';
        this.songsDiv = document.getElementById('songs');
        
        try {
            const musicFiles = await ipcRenderer.invoke('get-music-files');
            const videoFiles = await ipcRenderer.invoke('get-video-files') || [];
            const lyricsFiles = await ipcRenderer.invoke('get-lyrics-files');
            
            // Combine music and video files
            const allFiles = [...musicFiles, ...videoFiles.map(video => ({
                ...video,
                isVideo: true
            }))];
            
            this.songs = allFiles.map((file, index) => {
                const song = {
                    ...file,
                    hasLyrics: !file.isVideo && (lyricsFiles.includes(file.baseName) || file.lyricsMatch !== null),
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
            
            this.loadRatings();
            // Sort by rating on refresh
            this.songs.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            

            
            // Restore current view state
            if (this.currentPlaylist) {
                this.loadPlaylist(this.currentPlaylist);
            } else {
                this.displaySongs();
            }
            
            this.showNotification(`Loaded ${this.songs.length} files`, 'success');
            
            // Resume last played song by finding it by name
            if (this.settings.lastSongName) {
                const songIndex = this.songs.findIndex(song => song.name === this.settings.lastSongName);
                if (songIndex >= 0) {
                    this.selectSong(songIndex, false); // false = don't auto-play
                    this.isPlaying = false;
                    this.playPauseImg.src = 'icons/play.png';
                    // Restore last playback position after audio loads
                    if (this.settings.lastCurrentTime) {
                        this.audio.onloadedmetadata = () => {
                            this.audio.currentTime = this.settings.lastCurrentTime;
                            this.updateDuration();
                            this.updateProgress();
                        };
                    }
                }
            }
        } catch (error) {
            this.musicList.innerHTML = '<div id="songs"></div><p class="error">Error loading music</p>';
            this.songsDiv = document.getElementById('songs');
            this.showNotification('Error loading music files', 'error');
        }
    }

    displaySongs() {
        this.currentPlaylist = null;
        this.hidePlaylistDetails();
        this.filteredSongs = [...this.songs];
        this.displayFilteredSongs();
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
        this.songsDiv.innerHTML = `
            <div class="empty-library">
                <div class="empty-icon">🎵</div>
                <h3>No music files found</h3>
                <p>Right-click to add music files</p>
                <p class="sub-text">Drag & drop music files or right-click to add</p>
                <p class="sub-text">Supported: MP3, WAV, OGG, M4A, FLAC</p>
                <p class="sub-text">Video: MP4, AVI, MKV, MOV, WMV, WEBM</p>
                <p class="sub-text">Add .lrc files for synchronized lyrics</p>
                <p class="sub-text tip">💡 Tip: Keep similar names for music and lyrics files for better auto-matching</p>
            </div>
        `;
    }

    async selectSong(index, autoPlay = true) {
        if (index < 0 || index >= this.songs.length) {
            console.error('Invalid song index:', index);
            return;
        }
        this.currentSongIndex = index;
        const song = this.songs[index];
        
        // Save last played song by name instead of index
        this.settings.lastSongIndex = index;
        this.settings.lastSongName = song.name;
        this.saveSettings();
        
        // Update UI
        document.querySelectorAll('.song-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        
        // Stop any playing video to prevent dual audio
        this.videoElement.pause();
        this.videoElement.src = '';
        
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
        
        // Check if we should start with video mode (if video button is active and video is available)
        const shouldStartWithVideo = this.videoBtn.classList.contains('active') && (song.isVideo || song.attachedVideo || song.youtubeVideo);
        
        if (shouldStartWithVideo) {
            // Setup video content first
            if (song.youtubeVideo) {
                this.videoPlayer.innerHTML = `<iframe src="${song.youtubeVideo.url}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>`;
            }
            this.showVideoPlayer();
            this.isVideoMode = true;
            // Load song-specific offset for video mode
            this.lyricsOffset = this.songOffsets[song.baseName] || 0;
        } else {
            this.hideVideoPlayer();
            this.isVideoMode = false;
            // Reset offset for music mode
            this.lyricsOffset = 0;
        }
        
        // Update details based on current mode
        this.updateSongDetails(song);
        
        // Update album cover with memory leak fix
        if (this.currentImageUrl) {
            URL.revokeObjectURL(this.currentImageUrl);
            this.currentImageUrl = null;
        }
        
        // Show album cover only if not in video mode
        if (!this.isVideoMode) {
            if (song.picture) {
                const blob = new Blob([song.picture]);
                this.currentImageUrl = URL.createObjectURL(blob);
                this.albumCover.innerHTML = '';
                this.albumCover.style.display = 'flex';
                this.albumCover.style.alignItems = 'center';
                this.albumCover.style.justifyContent = 'center';
                const img = document.createElement('img');
                img.src = this.currentImageUrl;
                img.alt = 'Album Cover';
                this.albumCover.appendChild(img);
            } else {
                this.albumCover.innerHTML = '<div class="cover-placeholder">🎵</div>';
                this.albumCover.style.display = 'flex';
                this.albumCover.style.alignItems = 'center';
                this.albumCover.style.justifyContent = 'center';
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
                            <li>Drop .lrc file here</li>
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

    togglePlayPause() {
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
        this.initializeAudioContext();
        
        const crossfadeDuration = this.settings.crossfadeDuration || 0;
        
        if (crossfadeDuration > 0) {
            this.originalVolume = this.audio.volume;
            this.audio.volume = 0;
            this.applyCrossfadeIn(crossfadeDuration);
        }
        
        this.audio.play().catch(error => {
            console.error('Playback failed:', error);
            this.isPlaying = false;
            this.playPauseImg.src = 'icons/play.png';
        });
        this.isPlaying = true;
        this.playPauseImg.src = 'icons/pause.png';
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
        
        // Clear crossfade interval
        if (this.crossfadeInterval) {
            clearInterval(this.crossfadeInterval);
            this.crossfadeInterval = null;
        }
    }
    
    playVideo() {
        if (this.videoElement.readyState >= 2) {
            this.videoElement.play().catch(error => {
                console.error('Video playback failed:', error);
                this.isPlaying = false;
                this.playPauseImg.src = 'icons/play.png';
            });
            this.isPlaying = true;
            this.playPauseImg.src = 'icons/pause.png';
        } else {
            this.videoElement.load();
            this.videoElement.oncanplay = () => {
                this.videoElement.play();
                this.isPlaying = true;
                this.playPauseImg.src = 'icons/pause.png';
            };
        }
    }
    
    pauseVideo() {
        this.videoElement.pause();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
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
        // Skip repeat one logic if manually clicked
        if (this.repeatMode === 'one' && !manual) {
            this.audio.currentTime = 0;
            this.play();
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
        
        // Handle crossfade out
        const crossfadeDuration = this.settings.crossfadeDuration || 0;
        if (crossfadeDuration > 0 && duration > 0 && !this.isVideoMode) {
            const timeLeft = duration - currentTime;
            if (timeLeft <= crossfadeDuration && timeLeft > 0 && !this.crossfadeInterval) {
                this.applyCrossfadeOut(timeLeft);
            }
        }
        
        // Save current time with throttling
        this.settings.lastCurrentTime = currentTime;
        if (!this.saveSettingsTimeout) {
            this.saveSettingsTimeout = setTimeout(() => {
                this.saveSettings();
                this.saveSettingsTimeout = null;
            }, 1000);
        }
        
        this.updateProgress();
        this.highlightLyrics(currentTime);
    }

    updateDuration() {
        const currentSong = this.songs[this.currentSongIndex];
        const duration = this.isVideoMode ? this.videoElement.duration : this.audio.duration;
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
        // Global click handler to hide context menus
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
                this.hideSongContextMenu();
                this.hideLyricsContextMenu();
                this.hidePlaylistContextMenu();
            }
        });
        
        document.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.song-item') && !e.target.closest('#lyrics') && !e.target.closest('.playlist-item')) {
                this.hideContextMenu();
                this.hideSongContextMenu();
                this.hideLyricsContextMenu();
                this.hidePlaylistContextMenu();
            }
        });
        
        document.onclick = () => {
            this.hideContextMenu();
            this.hideSongContextMenu();
            this.hideLyricsContextMenu();
            this.hidePlaylistContextMenu();
        };
        
        document.getElementById('addMusic').onclick = async () => {
            const result = await ipcRenderer.invoke('browse-music-files');
            if (result && !result.canceled && result.filePaths.length > 0) {
                await this.handleFileAdd(result.filePaths.map(path => ({path})), 'music');
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
        document.getElementById('addToQueue').onclick = () => this.addToQueue();
        document.getElementById('enableSelection').onclick = () => this.enableSelectionMode();
        document.getElementById('removeFromPlaylist').onclick = () => this.removeFromPlaylist();
        document.getElementById('removeLyrics').onclick = () => this.removeLyrics();
        document.getElementById('viewInFolder').onclick = () => this.viewInFolder();
        document.getElementById('deleteSong').onclick = () => this.deleteSong();
        

        
        // Remove video handler is now in HTML
        document.getElementById('removeVideo').onclick = () => this.removeVideo();
        
        // Lyrics context menu handlers
        document.getElementById('pasteLyrics').onclick = () => this.pasteLyrics();
        
        // Playlist context menu handlers
        document.getElementById('editPlaylist').onclick = () => this.editPlaylist();
        document.getElementById('mergePlaylist').onclick = () => this.mergePlaylist();
        document.getElementById('pinPlaylist').onclick = () => this.pinPlaylist();
        document.getElementById('deletePlaylist').onclick = () => this.deletePlaylistFromMenu();
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
        this.contextMenu.style.display = 'block';
        
        const menuRect = this.contextMenu.getBoundingClientRect();
        const adjustedX = Math.min(x, window.innerWidth - menuRect.width - 10);
        const adjustedY = Math.min(y, window.innerHeight - menuRect.height - 10);
        
        this.contextMenu.style.left = `${adjustedX}px`;
        this.contextMenu.style.top = `${adjustedY}px`;
    }
    
    hideContextMenu() {
        this.contextMenu.style.display = 'none';
    }
    
    showSongContextMenu(x, y, songIndex) {
        if (songIndex < 0 || songIndex >= this.songs.length) {
            console.error('Invalid song index for context menu:', songIndex);
            return;
        }
        this.selectedSongIndex = songIndex;
        const song = this.songs[songIndex];
        const songContextMenu = document.getElementById('songContextMenu');
        const addToQueueBtn = document.getElementById('addToQueue');
        const removeLyricsBtn = document.getElementById('removeLyrics');
        
        // Populate playlist submenu
        const playlistSubmenu = document.getElementById('playlistSubmenu');
        const playlistNames = Object.keys(this.playlists);
        
        playlistSubmenu.innerHTML = '';
        if (playlistNames.length === 0) {
            const item = document.createElement('div');
            item.className = 'menu-item disabled';
            item.textContent = 'No playlists available';
            playlistSubmenu.appendChild(item);
        } else {
            playlistNames.forEach(name => {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.textContent = name;
                item.onclick = () => {
                    this.addToPlaylist(name);
                    this.hideSongContextMenu();
                };
                playlistSubmenu.appendChild(item);
            });
        }
        
        // Hide Add to Queue for currently playing song
        if (songIndex === this.currentSongIndex) {
            addToQueueBtn.style.display = 'none';
        } else {
            addToQueueBtn.style.display = 'block';
        }
        
        // Update menu items based on context
        const removeFromPlaylistBtn = document.getElementById('removeFromPlaylist');
        if (this.currentPlaylist) {
            removeFromPlaylistBtn.style.display = 'block';
        } else {
            removeFromPlaylistBtn.style.display = 'none';
        }
        
        if (song.hasLyrics) {
            removeLyricsBtn.style.display = 'block';
        } else {
            removeLyricsBtn.style.display = 'none';
        }
        
        // Update remove video button based on video availability
        const removeVideoBtn = document.getElementById('removeVideo');
        if (song.attachedVideo) {
            removeVideoBtn.classList.remove('disabled');
        } else {
            removeVideoBtn.classList.add('disabled');
        }
        
        songContextMenu.style.display = 'block';
        
        const menuRect = songContextMenu.getBoundingClientRect();
        const adjustedX = Math.min(x, window.innerWidth - menuRect.width - 10);
        const adjustedY = Math.min(y, window.innerHeight - menuRect.height - 10);
        
        songContextMenu.style.left = `${adjustedX}px`;
        songContextMenu.style.top = `${adjustedY}px`;
    }
    
    hideSongContextMenu() {
        document.getElementById('songContextMenu').style.display = 'none';
    }
    
    addToQueue() {
        if (this.currentSongIndex >= 0 && this.isPlaying) {
            this.queue.push(this.selectedSongIndex);
        }
        this.hideSongContextMenu();
    }
    
    showLyricsContextMenu(x, y) {
        const lyricsContextMenu = document.getElementById('lyricsContextMenu');
        lyricsContextMenu.style.display = 'block';
        
        // Get menu dimensions
        const menuRect = lyricsContextMenu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // Adjust position to keep menu within window bounds
        const adjustedX = Math.min(x, windowWidth - menuRect.width - 10);
        const adjustedY = Math.min(y, windowHeight - menuRect.height - 10);
        
        lyricsContextMenu.style.left = `${adjustedX}px`;
        lyricsContextMenu.style.top = `${adjustedY}px`;
    }
    
    hideLyricsContextMenu() {
        document.getElementById('lyricsContextMenu').style.display = 'none';
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
    
    viewInFolder() {
        const song = this.songs[this.selectedSongIndex];
        ipcRenderer.send('view-song-in-folder', song.path);
        this.hideSongContextMenu();
    }
    
    deleteSong() {
        if (this.selectedSongIndex < 0 || this.selectedSongIndex >= this.songs.length) {
            this.showNotification('Invalid song selection', 'error');
            this.hideSongContextMenu();
            return;
        }
        const song = this.songs[this.selectedSongIndex];
        if (confirm(`Are you sure you want to delete "${song.title}"?`)) {
            this.showNotification('Deleting song...', 'info');
            ipcRenderer.invoke('delete-song', song.name).then((success) => {
                if (success) {
                    this.showNotification('Song deleted successfully', 'success');
                    this.loadMusic();
                } else {
                    this.showNotification('Failed to delete song', 'error');
                }
            }).catch(error => {
                this.showNotification('Error deleting song', 'error');
            });
        }
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
    
    async handleFileAdd(files, type) {
        const fileArray = Array.from(files);
        this.showNotification(`Adding ${fileArray.length} ${type} files...`, 'info');
        try {
            await ipcRenderer.invoke('add-files', fileArray.map(f => f.path), type);
            
            this.showNotification(`Added ${fileArray.length} ${type} files successfully`, 'success');
            
            // Switch to All Songs and refresh quickly for music files
            if (type === 'music' || type === 'video') {
                this.currentPlaylist = null;
                this.hidePlaylistDetails();
                this.searchInput.value = '';
                await this.loadMusic();
                this.selectCategory('all', 'All Songs');
            } else {
                await this.loadMusic();
            }
        } catch (error) {
            this.showNotification(`Failed to add ${type} files`, 'error');
        }
    }
    
    async handleFileDrop(files) {
        const musicFiles = [];
        const videoFiles = [];
        const lyricsFiles = [];
        
        Array.from(files).forEach(file => {
            const filePath = file.path || file.webkitRelativePath || file.name;
            if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name)) {
                musicFiles.push(filePath);
            } else if (/\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i.test(file.name)) {
                videoFiles.push(filePath);
            } else if (file.name.endsWith('.lrc')) {
                lyricsFiles.push(filePath);
            }
        });
        
        const totalFiles = musicFiles.length + videoFiles.length + lyricsFiles.length;
        if (totalFiles === 0) {
            this.showNotification('No supported files found', 'error');
            return;
        }
        
        this.showNotification(`Adding ${totalFiles} files...`, 'info');
        
        try {
            // Run file operations in parallel for better performance
            const promises = [];
            if (musicFiles.length > 0) {
                promises.push(ipcRenderer.invoke('add-files', musicFiles, 'music'));
            }
            if (videoFiles.length > 0) {
                promises.push(ipcRenderer.invoke('add-files', videoFiles, 'video'));
            }
            if (lyricsFiles.length > 0) {
                promises.push(ipcRenderer.invoke('add-files', lyricsFiles, 'lyrics'));
            }
            
            if (promises.length > 0) {
                await Promise.all(promises);
                this.showNotification(`Successfully added ${totalFiles} files`, 'success');
                
                // Switch to All Songs and refresh quickly
                this.currentPlaylist = null;
                this.hidePlaylistDetails();
                this.searchInput.value = '';
                await this.loadMusic();
                this.selectCategory('all', 'All Songs');
            }
        } catch (error) {
            this.showNotification('Failed to add some files', 'error');
        }
    }
    
    setupSearch() {
        this.searchInput.oninput = (e) => {
            if (this.searchTimeout) {
                clearTimeout(this.searchTimeout);
            }
            this.searchTimeout = setTimeout(() => {
                this.filterSongs(e.target.value);
            }, 150);
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
        this.fontSave.onclick = () => this.saveFontSettings();
        this.loadFontSettings();
        
        // Show font button if lyrics are already visible
        const lyricsVisible = this.lyricsToggleBtn.classList.contains('active') && this.lyricsDiv.style.display !== 'none';
        if (lyricsVisible) {
            this.lyricsFontBtn.style.display = 'flex';
        }
        
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
    
    toggleLyrics() {
        const isHidden = this.lyricsDiv.style.display === 'none';
        
        if (isHidden) {
            this.lyricsDiv.style.display = 'block';
            this.lyricsToggleBtn.classList.add('active');
            this.showNotification('Lyrics shown', 'info');
        } else {
            this.lyricsDiv.style.display = 'none';
            this.lyricsToggleBtn.classList.remove('active');
            this.lyricsFontControls.style.display = 'none';
            this.lyricsFontBtn.classList.remove('active');
            this.showNotification('Lyrics hidden', 'info');
        }
        this.updateFontButtonState();
    }
    
    updateFontButtonState() {
        const lyricsVisible = this.lyricsToggleBtn.classList.contains('active') && this.lyricsDiv.style.display !== 'none';
        this.lyricsFontBtn.disabled = !lyricsVisible;
        this.lyricsFontBtn.style.opacity = lyricsVisible ? '1' : '0.4';
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
        this.lyricsFontControls.style.display = 'none';
        this.lyricsFontBtn.classList.remove('active');
        localStorage.setItem('vimusic-lyrics-font-size', this.lyricsFontSize.toString());
        this.showNotification(`Lyrics font size saved: ${this.lyricsFontSize}px`, 'success');
    }
    
    loadFontSettings() {
        const saved = localStorage.getItem('vimusic-lyrics-font-size');
        if (saved) {
            this.lyricsFontSize = parseInt(saved) || 16;
        }
        this.updateFontDisplay();
    }
    
    toggleVideoMode() {
        if (this.currentSongIndex < 0) {
            this.showNotification('No song selected', 'error');
            return;
        }
        
        const currentSong = this.songs[this.currentSongIndex];
        if (!currentSong) {
            this.showNotification('Current song not found', 'error');
            return;
        }
        
        if (currentSong.isVideo || currentSong.attachedVideo) {
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
        const currentSong = this.songs[this.currentSongIndex];
        const wasPlaying = this.isPlaying;
        const currentTime = this.audio.currentTime;
        
        // Stop music completely
        this.audio.pause();
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
        
        this.showNotification('Switched to video', 'info');
    }
    
    switchToMusic() {
        const currentSong = this.songs[this.currentSongIndex];
        const wasPlaying = this.isPlaying;
        const currentTime = this.videoElement.currentTime;
        
        // Stop video completely and clear source
        this.videoElement.pause();
        this.videoElement.src = '';
        this.videoElement.load();
        this.isPlaying = false;
        this.playPauseImg.src = 'icons/play.png';
        
        // Setup music
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
        
        this.showNotification('Switched to music', 'info');
    }
    
    updateSongDetails(song) {
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
            this.detailFormat.textContent = song.name.split('.').pop().toUpperCase();
        }
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
        
        document.getElementById('viewStorageFolderBtn').onclick = () => this.viewStorageFolder();
        document.getElementById('addMusicFilesBtn').onclick = () => this.addMusicFiles();
        document.getElementById('downloadMusicBtn').onclick = () => this.showDownloadInterface();
        
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
    
    setupPlaylistNameEdit(playlistName) {
        const editIcon = document.getElementById('playlistEditIcon');
        const titleElement = document.getElementById('playlistTitle');
        const inputElement = document.getElementById('playlistTitleInput');
        
        // Remove existing handlers
        editIcon.onclick = null;
        inputElement.onkeydown = null;
        inputElement.onblur = null;
        
        editIcon.onclick = () => {
            titleElement.style.display = 'none';
            editIcon.style.display = 'none';
            inputElement.style.display = 'block';
            inputElement.value = playlistName;
            inputElement.focus();
            inputElement.select();
        };
        
        const saveEdit = () => {
            const newName = inputElement.value.trim();
            if (newName && newName !== playlistName) {
                if (this.playlists[newName]) {
                    this.showNotification('Playlist name already exists', 'error');
                    return;
                }
                this.renamePlaylist(playlistName, newName);
            }
            titleElement.style.display = 'block';
            editIcon.style.display = 'block';
            inputElement.style.display = 'none';
        };
        
        const cancelEdit = () => {
            titleElement.style.display = 'block';
            editIcon.style.display = 'block';
            inputElement.style.display = 'none';
        };
        
        inputElement.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        };
        
        inputElement.onblur = saveEdit;
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
        
        this.showPlaylistDetails(newName, (Array.isArray(playlistData) ? playlistData : playlistData.songs).length);
        this.showNotification(`Playlist renamed to "${newName}"`, 'success');
    }
    
    setupPlaylistBgEdit(playlistName) {
        const bgEditIcon = document.getElementById('playlistBgEditIcon');
        
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
        
        // Create playlist automatically
        this.playlists[name] = {
            songs: [],
            pinned: false,
            coverImage: 'icons/default-playlist.png'
        };
        
        this.playlistOrder.push(name);
        this.savePlaylists();
        this.displayPlaylists();
        this.showNotification(`Playlist "${name}" created`, 'success');
    }
    
    showPlaylistModal(editingName = null) {
        const isEditing = !!editingName;
        const playlistData = isEditing ? this.playlists[editingName] : null;
        
        const modal = document.createElement('div');
        modal.className = 'playlist-modal-overlay';
        modal.dataset.editing = isEditing;
        if (isEditing) modal.dataset.originalName = editingName;
        
        modal.innerHTML = `
            <div class="playlist-modal">
                <h3>${isEditing ? 'Edit Playlist' : 'Create Playlist'}</h3>
                <div class="modal-cover">
                    <img src="${isEditing ? this.getPlaylistCoverUrl(editingName) : 'icons/default-playlist.png'}" id="modalCoverImg">
                </div>
                <input type="text" id="modalPlaylistName" placeholder="Playlist name" maxlength="14" value="${editingName || ''}">
                <div class="modal-buttons">
                    <button id="modalCancel">Cancel</button>
                    <button id="modalDone">Done</button>
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
        
        // Force focus and style Done button
        setTimeout(() => {
            nameInput.focus();
            nameInput.select();
        }, 150);
        doneBtn.style.backgroundColor = '#2d5a2d';
        doneBtn.style.color = 'white';
        
        // Store reference to this for event handlers
        const player = this;
        
        nameInput.onkeydown = function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                player.createPlaylistFromModal(modal);
            }
        };
        
        document.getElementById('modalCancel').onclick = function() {
            modal.remove();
        };
        
        doneBtn.onclick = function() {
            player.createPlaylistFromModal(modal);
        };
        
        document.getElementById('modalCoverImg').onclick = function() {
            player.selectModalCover();
        };
        
        modal.onclick = function(e) {
            if (e.target === modal) modal.remove();
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
        const name = document.getElementById('modalPlaylistName').value.trim();
        const isEditing = modal.dataset.editing;
        const originalName = modal.dataset.originalName;
        
        if (!name) {
            this.showNotification('Playlist name cannot be empty', 'error');
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
                coverImage: coverPath || 'icons/default-playlist.png'
            };
            this.playlistOrder.push(name);
            this.showNotification(`Playlist "${name}" created`, 'success');
        }
        
        this.savePlaylists();
        this.displayPlaylists();
        // Update playlist details if currently viewing this playlist
        if (this.currentPlaylist === (isEditing ? originalName : name)) {
            this.showPlaylistDetails(isEditing ? name : name, (isEditing ? this.playlists[name] : this.playlists[name]).songs.length);
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
        if (!this.songs || this.songs.length === 0) {
            setTimeout(() => this.loadPlaylist(name), 100);
            return;
        }
        
        this.showMusicView();
        this.settingsBtn.classList.remove('active');
        
        // Clear search input when switching playlists
        this.searchInput.value = '';
        
        this.currentPlaylist = name;
        const playlistData = this.playlists[name];
        const songs = Array.isArray(playlistData) ? playlistData : (playlistData?.songs || []);
        
        // Update UI immediately without loading states
        this.showPlaylistDetails(name, songs.length);
        this.displayPlaylists();
        
        if (songs.length === 0) {
            this.filteredSongs = [];
            this.songsDiv.innerHTML = `
                <div class="empty-library">
                    <div class="empty-icon">📋</div>
                    <h3>Empty Playlist</h3>
                    <p>This playlist has no songs yet</p>
                    <p class="sub-text">Right-click on songs to add them to this playlist</p>
                </div>
            `;
        } else {
            const playlistSongs = this.getPlaylistSongs(name);
            this.filteredSongs = playlistSongs;
            this.displayFilteredSongs();
        }
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
    
    showPlaylistDetails(name, songCount) {
        const panel = document.getElementById('playlistDetailsPanel');
        const title = document.getElementById('playlistTitle');
        const stats = document.getElementById('playlistStats');
        const description = document.getElementById('playlistDescription');
        const cover = document.getElementById('playlistCover');
        const playlistData = this.playlists[name];
        
        // Update text content immediately
        title.textContent = name;
        stats.textContent = `${songCount} song${songCount !== 1 ? 's' : ''}`;
        description.textContent = songCount === 0 ? 'Empty playlist' : 'Custom playlist';
        panel.style.display = 'block';
        
        // Load images asynchronously to prevent blocking
        requestAnimationFrame(() => {
            const coverImage = Array.isArray(playlistData) ? null : (playlistData?.coverImage || null);
            const coverImg = document.querySelector('.playlist-cover-img');
            
            if (coverImage && !coverImage.startsWith('icons/')) {
                coverImg.src = `file:///${coverImage.replace(/\\/g, '/')}`;
                coverImg.style.width = '100%';
                coverImg.style.height = '100%';
                coverImg.style.objectFit = 'cover';
                coverImg.style.filter = 'none';
            } else {
                coverImg.src = 'icons/default-playlist.png';
                coverImg.style.width = '40px';
                coverImg.style.height = '40px';
                coverImg.style.objectFit = 'initial';
                coverImg.style.filter = 'none';
            }
            
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
            coverImg.style.width = '100%';
            coverImg.style.height = '100%';
            coverImg.style.objectFit = 'cover';
            coverImg.style.filter = 'none';
        } else {
            coverImg.src = 'icons/default-playlist.png';
            coverImg.style.width = '40px';
            coverImg.style.height = '40px';
            coverImg.style.objectFit = 'initial';
            coverImg.style.filter = 'none';
        }
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
    
    selectCategory(category, displayText) {
        // Close dropdown and update UI immediately
        document.getElementById('categoryDropdown').style.display = 'none';
        
        this.showMusicView();
        this.settingsBtn.classList.remove('active');
        
        // Clear search input when switching categories
        this.searchInput.value = '';
        
        // Track current category
        this.currentCategory = category;
        
        const selectedCategory = document.getElementById('selectedCategory');
        const iconMap = {
            'all': 'icons/all-song.png',
            'video': 'icons/video-songs.png', 
            'rated': 'icons/star-songs.png',
            'recent': 'icons/clock.png'
        };
        
        const iconPath = iconMap[category];
        if (iconPath) {
            selectedCategory.innerHTML = `<img src="${iconPath}"> ${displayText}`;
        } else {
            selectedCategory.textContent = displayText;
        }
        
        // Show loading immediately
        this.songsDiv.innerHTML = '<div class="loading">Filtering songs...</div>';
        
        // Process filtering asynchronously
        requestAnimationFrame(() => {
            this.currentPlaylist = null;
            this.hidePlaylistDetails();
            
            switch(category) {
                case 'all':
                    this.displaySongs();
                    this.showNotification('Showing all songs', 'info');
                    break;
                case 'video':
                    this.filteredSongs = this.songs.filter(song => song.isVideo || song.attachedVideo);
                    this.displayFilteredSongs();
                    this.showNotification('Showing video songs only', 'info');
                    break;
                case 'rated':
                    this.filteredSongs = this.songs.filter(song => song.rating && song.rating > 0);
                    this.displayFilteredSongs();
                    this.showNotification('Showing rated songs only', 'info');
                    break;
                case 'recent':
                    // Get recently added songs (top 50)
                    const recentSongs = [...this.songs]
                        .filter(song => song.dateAdded)
                        .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
                        .slice(0, 50);
                    this.filteredSongs = recentSongs;
                    this.displayFilteredSongs();
                    this.showNotification(`Showing ${recentSongs.length} recently added songs`, 'info');
                    break;

            }
            
            this.displayPlaylists();
        });
    }
    
    viewStorageFolder() {
        ipcRenderer.send('open-folder');
        this.showNotification('Opening storage folder', 'info');
    }
    
    async addMusicFiles() {
        try {
            const result = await ipcRenderer.invoke('browse-music-files');
            if (result && !result.canceled && result.filePaths.length > 0) {
                this.showNotification(`Adding ${result.filePaths.length} files...`, 'info');
                await ipcRenderer.invoke('add-files', result.filePaths, 'music');
                await this.loadMusic();
                this.showNotification(`Added ${result.filePaths.length} files successfully`, 'success');
            }
        } catch (error) {
            this.showNotification('Failed to add music files', 'error');
        }
    }
    
    async showDownloadInterface() {
        this.hideAllPanels();
        document.getElementById('downloadPanel').style.display = 'block';
        this.leftPanel.classList.add('download-active');
        this.currentView = 'download';
        
        const frame = document.getElementById('spotdlFrame');
        const loading = document.getElementById('downloadLoading');
        
        if (!this.spotdlServerRunning) {
            try {
                loading.style.display = 'flex';
                frame.style.display = 'none';
                
                const success = await ipcRenderer.invoke('start-spotdl-server');
                
                if (success) {
                    setTimeout(() => {
                        frame.src = 'http://127.0.0.1:8800';
                        frame.style.display = 'block';
                        loading.style.display = 'none';
                        this.spotdlServerRunning = true;
                        
                        // Fix iframe input handling
                        frame.onload = () => {
                            try {
                                frame.contentWindow.focus();
                            } catch (e) {
                                // Cross-origin, ignore
                            }
                        };
                        
                        // Ensure iframe can receive focus
                        frame.onclick = () => {
                            try {
                                frame.contentWindow.focus();
                            } catch (e) {
                                // Cross-origin, ignore
                            }
                        };
                    }, 3000);
                } else {
                    loading.innerHTML = '<p>Failed to start SpotDL server</p><p style="font-size: 12px; color: #666;">Make sure Python and SpotDL are installed</p>';
                }
            } catch (error) {
                loading.innerHTML = '<p>Error starting SpotDL server</p>';
            }
        } else {
            frame.style.display = 'block';
            loading.style.display = 'none';
        }
    }
    
    hideAllPanels() {
        document.getElementById('musicContainer').style.display = 'none';
        document.getElementById('downloadPanel').style.display = 'none';
        document.getElementById('settingsPanel').style.display = 'none';
        this.hidePlaylistDetails();
    }
    
    showMusicView() {
        this.hideAllPanels();
        document.getElementById('musicContainer').style.display = 'flex';
        this.leftPanel.classList.remove('download-active');
        this.currentView = 'music';
    }
    
    updateSelectionUI() {
        const selectedCount = this.selectedSongs.size;
        if (selectedCount > 0) {
            this.showSelectionActions(selectedCount);
        } else {
            this.hideSelectionActions();
        }
    }
    
    showSelectionActions(count) {
        let actionBar = document.getElementById('selectionActionBar');
        if (!actionBar) {
            actionBar = document.createElement('div');
            actionBar.id = 'selectionActionBar';
            actionBar.className = 'selection-action-bar';
            
            const removeFromPlaylistBtn = this.currentPlaylist ? 
                '<button class="action-btn" id="removeSelectedFromPlaylist">Remove from Playlist</button>' : '';
            
            actionBar.innerHTML = `
                <span class="selection-count">${count} selected</span>
                <button class="action-btn" id="addSelectedToPlaylist">Add to Playlist</button>
                ${removeFromPlaylistBtn}
                <button class="action-btn" id="clearSelection">Clear</button>
            `;
            document.querySelector('.music-container').appendChild(actionBar);
            
            // Cache button references to avoid repeated queries
            this.addSelectedBtn = document.getElementById('addSelectedToPlaylist');
            this.removeSelectedBtn = document.getElementById('removeSelectedFromPlaylist');
            this.clearSelectionBtn = document.getElementById('clearSelection');
            
            this.addSelectedBtn.onclick = () => this.showPlaylistSelectionMenu();
            if (this.removeSelectedBtn) {
                this.removeSelectedBtn.onclick = () => this.removeSelectedFromPlaylist();
            }
            this.clearSelectionBtn.onclick = () => this.clearSelection();
        } else {
            actionBar.querySelector('.selection-count').textContent = `${count} selected`;
            
            // Show/hide remove from playlist button based on context
            if (this.removeSelectedBtn) {
                this.removeSelectedBtn.style.display = this.currentPlaylist ? 'block' : 'none';
            }
        }
    }
    
    hideSelectionActions() {
        const actionBar = document.getElementById('selectionActionBar');
        if (actionBar) actionBar.remove();
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
    
    enableSelectionMode() {
        this.selectionMode = true;
        this.selectedSongs.add(this.selectedSongIndex);
        
        // Show all checkboxes
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.style.display = 'flex';
        });
        
        // Check the current song
        const currentCheckbox = document.querySelector(`[data-song-index="${this.selectedSongIndex}"]`);
        if (currentCheckbox) {
            currentCheckbox.checked = true;
        }
        
        this.updateSelectionUI();
        this.hideSongContextMenu();
        this.showNotification('Selection mode enabled', 'info');
    }
    
    disableSelectionMode() {
        this.selectionMode = false;
        this.selectedSongs.clear();
        
        // Hide all checkboxes
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.style.display = 'none';
        });
        
        // Uncheck all
        document.querySelectorAll('.song-select').forEach(cb => {
            cb.checked = false;
        });
        
        this.hideSelectionActions();
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
        pinMenuItem.textContent = isPinned ? 'Unpin Playlist' : 'Pin Playlist';
        
        // Populate merge submenu
        const mergeSubmenu = document.getElementById('mergeSubmenu');
        const otherPlaylists = Object.keys(this.playlists).filter(name => name !== playlistName);
        
        mergeSubmenu.innerHTML = '';
        if (otherPlaylists.length === 0) {
            const item = document.createElement('div');
            item.className = 'menu-item disabled';
            item.textContent = 'No other playlists';
            mergeSubmenu.appendChild(item);
        } else {
            otherPlaylists.forEach(name => {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.textContent = name;
                item.onclick = () => {
                    this.performPlaylistMerge(playlistName, name);
                    this.hidePlaylistContextMenu();
                };
                mergeSubmenu.appendChild(item);
            });
        }
        
        const playlistContextMenu = document.getElementById('playlistContextMenu');
        playlistContextMenu.style.display = 'block';
        
        const menuRect = playlistContextMenu.getBoundingClientRect();
        const adjustedX = Math.min(x, window.innerWidth - menuRect.width - 10);
        const adjustedY = Math.min(y, window.innerHeight - menuRect.height - 10);
        
        playlistContextMenu.style.left = `${adjustedX}px`;
        playlistContextMenu.style.top = `${adjustedY}px`;
    }
    
    hidePlaylistContextMenu() {
        document.getElementById('playlistContextMenu').style.display = 'none';
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
    
    sortSongs(type) {
        switch(type) {
            case 'title':
                this.songs.sort((a, b) => a.title.localeCompare(b.title));
                break;
            case 'artist':
                this.songs.sort((a, b) => a.artist.localeCompare(b.artist));
                break;
            case 'rating':
                this.songs.sort((a, b) => (b.rating || 0) - (a.rating || 0));
                break;
            case 'recent':
                this.songs.sort((a, b) => (b.loadIndex || 0) - (a.loadIndex || 0));
                break;
        }
        this.displaySongs();
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
        // Get the current song list to search within
        const songsToSearch = this.currentPlaylist ? 
            this.getPlaylistSongs(this.currentPlaylist) : this.songs;
        
        if (!query || typeof query !== 'string' || !query.trim()) {
            this.filteredSongs = [...songsToSearch];
        } else {
            const results = songsToSearch.map(song => ({
                song,
                score: this.calculateRelevanceScore(song, query)
            })).filter(item => item.score > 0.3)
              .sort((a, b) => b.score - a.score)
              .map(item => item.song);
            
            this.filteredSongs = results;
        }
        this.displayFilteredSongs();
    }
    
    calculateRelevanceScore(song, query) {
        const cleanQuery = this.cleanSearchText(query);
        const fields = [
            { text: this.cleanSearchText(song.title), weight: 0.5 },
            { text: this.cleanSearchText(song.artist), weight: 0.4 },
            { text: this.cleanSearchText(song.album), weight: 0.2 }
        ];
        
        let totalScore = 0;
        
        for (const field of fields) {
            if (field.text) {
                const score = this.advancedMatch(field.text, cleanQuery) * field.weight;
                totalScore += score;
            }
        }
        
        return totalScore;
    }
    
    cleanSearchText(text) {
        if (!text) return '';
        return text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    advancedMatch(text, query) {
        if (!text || !query) return 0;
        
        // Exact match gets highest score
        if (text === query) return 1.0;
        if (text.includes(query)) return 0.9;
        
        // Check if query matches start of text
        if (text.startsWith(query)) return 0.85;
        
        // Word boundary matching
        const words = text.split(' ');
        for (const word of words) {
            if (word === query) return 0.8;
            if (word.startsWith(query)) return 0.7;
            if (word.includes(query)) return 0.6;
        }
        
        // Jaro-Winkler similarity
        const jaroScore = this.jaroWinkler(text, query);
        if (jaroScore > 0.7) return jaroScore;
        
        // N-gram similarity
        const ngramScore = this.ngramSimilarity(text, query, 2);
        if (ngramScore > 0.5) return ngramScore * 0.7;
        
        // Word-level matching
        const wordScore = this.wordLevelMatch(text, query);
        
        return Math.max(jaroScore, ngramScore * 0.7, wordScore);
    }
    
    jaroWinkler(s1, s2) {
        const jaro = this.jaro(s1, s2);
        if (jaro < 0.7) return jaro;
        
        let prefix = 0;
        for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
            if (s1[i] === s2[i]) prefix++;
            else break;
        }
        
        return jaro + (0.1 * prefix * (1 - jaro));
    }
    
    jaro(s1, s2) {
        if (s1 === s2) return 1.0;
        
        const len1 = s1.length, len2 = s2.length;
        const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
        
        const s1Matches = new Array(len1).fill(false);
        const s2Matches = new Array(len2).fill(false);
        
        let matches = 0, transpositions = 0;
        
        for (let i = 0; i < len1; i++) {
            const start = Math.max(0, i - matchWindow);
            const end = Math.min(i + matchWindow + 1, len2);
            
            for (let j = start; j < end; j++) {
                if (s2Matches[j] || s1[i] !== s2[j]) continue;
                s1Matches[i] = s2Matches[j] = true;
                matches++;
                break;
            }
        }
        
        if (matches === 0) return 0.0;
        
        let k = 0;
        for (let i = 0; i < len1; i++) {
            if (!s1Matches[i]) continue;
            while (!s2Matches[k]) k++;
            if (s1[i] !== s2[k]) transpositions++;
            k++;
        }
        
        return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3.0;
    }
    
    ngramSimilarity(s1, s2, n) {
        const ngrams1 = this.getNgrams(s1, n);
        const ngrams2 = this.getNgrams(s2, n);
        
        const intersection = ngrams1.filter(gram => ngrams2.includes(gram)).length;
        const union = new Set([...ngrams1, ...ngrams2]).size;
        
        return union === 0 ? 0 : intersection / union;
    }
    
    getNgrams(str, n) {
        const ngrams = [];
        for (let i = 0; i <= str.length - n; i++) {
            ngrams.push(str.substr(i, n));
        }
        return ngrams;
    }
    
    wordLevelMatch(text, query) {
        const textWords = text.split(' ');
        const queryWords = query.split(' ');
        
        let totalScore = 0;
        for (const queryWord of queryWords) {
            let bestWordScore = 0;
            for (const textWord of textWords) {
                const score = Math.max(
                    this.jaroWinkler(textWord, queryWord),
                    textWord.includes(queryWord) ? 0.8 : 0,
                    queryWord.includes(textWord) ? 0.7 : 0
                );
                bestWordScore = Math.max(bestWordScore, score);
            }
            totalScore += bestWordScore;
        }
        
        return totalScore / queryWords.length;
    }
    
    displayFilteredSongs() {
        const songsToShow = this.filteredSongs.length > 0 ? this.filteredSongs : this.songs;
        
        if (songsToShow.length === 0) {
            this.displayEmptyState();
            return;
        }
        
        // Clear and show loading
        this.cachedSongItems = null;
        this.songsDiv.innerHTML = '<div class="loading">Loading songs...</div>';
        
        // Use requestIdleCallback for better performance
        const renderCallback = () => this.renderSongsBatch(songsToShow, 0);
        if (window.requestIdleCallback) {
            requestIdleCallback(renderCallback);
        } else {
            requestAnimationFrame(renderCallback);
        }
    }
    
    renderSongsBatch(songsToShow, startIndex) {
        const batchSize = 200; // Larger batch for playlists
        const endIndex = Math.min(startIndex + batchSize, songsToShow.length);
        
        if (startIndex === 0) {
            this.songsDiv.innerHTML = '';
        }
        
        const fragment = document.createDocumentFragment();
        
        for (let i = startIndex; i < endIndex; i++) {
            const song = songsToShow[i];
            const originalIndex = this.songs.indexOf(song);
            
            const div = document.createElement('div');
            div.className = 'song-item';
            if (originalIndex === this.currentSongIndex) div.classList.add('active');
            
            // Defer image loading for faster initial render
            div.innerHTML = `
                <div class="song-checkbox" style="display: none;">
                    <input type="checkbox" class="song-select" data-song-index="${originalIndex}">
                </div>
                <div class="song-number">${i + 1}</div>
                <div class="song-cover">
                    <div class="cover-placeholder">🎵</div>
                </div>
                <div class="song-info-item">
                    <div class="song-name">${this.escapeHtml(song.title)}</div>
                    <div class="song-artist">${this.escapeHtml(song.artist)}</div>
                </div>
                <div class="star-rating" data-song-index="${originalIndex}">
                    ${this.generateStars(song.rating || 0)}
                </div>
                <span class="badge ${this.getBadgeClass(song)}">${this.getBadgeText(song)}</span>
            `;
            
            // Load cover image asynchronously
            if (song.picture) {
                setTimeout(() => {
                    const coverDiv = div.querySelector('.song-cover');
                    if (coverDiv) {
                        coverDiv.innerHTML = `<img src="${URL.createObjectURL(new Blob([song.picture]))}" alt="Cover">`;
                    }
                }, i * 2); // Stagger image loading
            }
            
            div.onclick = (e) => {
                if (!e.target.classList.contains('star') && !e.target.classList.contains('song-select')) {
                    if (this.selectionMode) {
                        // In selection mode, clicking toggles selection
                        const checkbox = div.querySelector('.song-select');
                        checkbox.checked = !checkbox.checked;
                        if (checkbox.checked) {
                            this.selectedSongs.add(originalIndex);
                        } else {
                            this.selectedSongs.delete(originalIndex);
                        }
                        this.updateSelectionUI();
                    } else {
                        // Normal mode, play the song
                        this.selectSong(originalIndex);
                    }
                }
            };
            
            // Handle checkbox selection
            const checkbox = div.querySelector('.song-select');
            checkbox.onchange = (e) => {
                e.stopPropagation();
                if (e.target.checked) {
                    this.selectedSongs.add(originalIndex);
                } else {
                    this.selectedSongs.delete(originalIndex);
                }
                this.updateSelectionUI();
            };
            
            div.oncontextmenu = (e) => {
                e.preventDefault();
                this.showSongContextMenu(e.clientX, e.clientY, originalIndex);
            };
            
            this.addStarEventListeners(div, originalIndex);
            fragment.appendChild(div);
        }
        
        this.songsDiv.appendChild(fragment);
        
        if (endIndex < songsToShow.length) {
            requestAnimationFrame(() => {
                this.renderSongsBatch(songsToShow, endIndex);
            });
        }
    }
    
    getBadgeClass(song) {
        if (song.isVideo) return 'video';
        if (song.hasLyrics && song.attachedVideo) return 'has-lyrics-video';
        if (song.attachedVideo && !song.hasLyrics) return 'has-video';
        return song.hasLyrics ? 'has-lyrics' : '';
    }
    
    getBadgeText(song) {
        if (song.isVideo) return '🎬';
        if (song.hasLyrics && song.attachedVideo) return '♪';
        if (song.attachedVideo && !song.hasLyrics) return '♫';
        return song.hasLyrics ? '♪' : '♫';
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
        } else {
            this.shuffleHistory = [];
            this.shuffleQueue = [];
        }
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
    
    getContextSongs() {
        // Return songs based on current context (playlist or category)
        if (this.currentPlaylist) {
            return this.getPlaylistSongs(this.currentPlaylist);
        } else if (this.filteredSongs) {
            return this.filteredSongs;
        } else {
            return this.songs;
        }
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
        const newTheme = this.settings.theme === 'dark' ? 'light' : 'dark';
        this.settings.theme = newTheme;
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
            if (e.target.tagName === 'INPUT' || this.currentView === 'download') return;
            
            // Block all Ctrl+zoom combinations
            if (e.ctrlKey && (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0' || 
                             e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || e.code === 'Numpad0')) {
                e.preventDefault();
                return;
            }
            
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
                shuffleMode: false,
                repeatMode: 'none'
            };
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.settings = {
                volume: 1,
                lastSongIndex: -1,
                lastCurrentTime: 0,
                floatingWindowPosition: { x: 100, y: 100 },
                theme: 'dark',
                shuffleMode: false,
                repeatMode: 'none'
            };
        }
        
        this.shuffleMode = this.settings.shuffleMode;
        this.repeatMode = this.settings.repeatMode;
        this.updateModeButtons();
        this.applyTheme(this.settings.theme);
        
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
        this.albumCover.innerHTML = '';
        const videoEl = document.createElement('video');
        videoEl.src = `file:///${song.attachedVideo.path.replace(/\\/g, '/')}`;
        videoEl.style.width = '100%';
        videoEl.style.height = '100%';
        videoEl.style.objectFit = 'cover';
        videoEl.style.borderRadius = '8px';
        this.albumCover.appendChild(videoEl);
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
        if (this.isVideoMode && this.isPlaying && document.hidden) {
            setTimeout(() => {
                if (this.videoElement.paused) {
                    this.videoElement.play();
                }
            }, 50);
        }
    }
    
    setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (this.isVideoMode && this.isPlaying && document.hidden) {
                // Force video to continue playing in background
                setTimeout(() => {
                    if (this.videoElement.paused && this.isPlaying) {
                        this.videoElement.play();
                    }
                }, 100);
            }
        });
    }
    
    setupScrollbarTimeout() {
        const scrollableElements = [
            { element: this.leftPanel, name: 'leftPanel' },
            { element: this.musicList, name: 'musicList' }
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
        
        // Setup custom dropdowns
        this.setupCustomDropdown('outputDevice', (value) => {
            this.settings.outputDevice = value;
            this.saveSettings();
        });
        
        this.setupCustomDropdown('audioQuality', (value) => {
            this.settings.audioQuality = value;
            this.saveSettings();
        });
        
        this.setupCustomDropdown('language', (value) => {
            this.settings.language = value;
            this.saveSettings();
        });
        
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
    }
    
    loadAllSettings() {
        const crossfadeSlider = document.getElementById('crossfadeSlider');
        const crossfadeValue = document.getElementById('crossfadeValue');
        const gaplessToggle = document.getElementById('gaplessToggle');
        const volumeNormalization = document.getElementById('volumeNormalization');
        
        const savedCrossfade = this.settings.crossfadeDuration || 0;
        crossfadeSlider.value = savedCrossfade;
        crossfadeValue.textContent = `${savedCrossfade.toFixed(1)} sec`;
        crossfadeSlider.style.setProperty('--progress', `${(savedCrossfade / 10) * 100}%`);
        gaplessToggle.checked = this.settings.gaplessPlayback || false;
        this.setDropdownValue('outputDevice', this.settings.outputDevice || 'default');
        this.setDropdownValue('audioQuality', this.settings.audioQuality || 'high');
        this.setDropdownValue('language', this.settings.language || 'english');
        volumeNormalization.checked = this.settings.volumeNormalization || false;
        
        // Load equalizer toggle state
        const equalizerEnabled = this.settings.equalizerEnabled !== false;
        document.getElementById('equalizerToggle').checked = equalizerEnabled;
        this.toggleEqualizer(equalizerEnabled);
    }
    
    toggleSettings() {
        const isSettingsVisible = this.settingsPanel.style.display === 'block';
        
        if (isSettingsVisible) {
            this.showMusicView();
            this.settingsBtn.classList.remove('active');
        } else {
            this.hideAllPanels();
            this.settingsPanel.style.display = 'block';
            this.settingsBtn.classList.add('active');
            this.currentView = 'settings';
        }
    }
    
    switchSettingsTab(tabName) {
        // Remove active class from all tabs and content
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelectorAll('.settings-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        // Add active class to selected tab and content
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-content`).classList.add('active');
    }
    
    showScrollbar(element, name) {
        // Clear existing timeout
        if (this.scrollbarTimeouts[name]) {
            clearTimeout(this.scrollbarTimeouts[name]);
            delete this.scrollbarTimeouts[name];
        }
        
        // Show scrollbar
        element.classList.add('show-scrollbar');
        
        // Set timeout to hide after 1 second
        this.scrollbarTimeouts[name] = setTimeout(() => {
            element.classList.remove('show-scrollbar');
            delete this.scrollbarTimeouts[name];
        }, 1000);
    }
    
    hideScrollbarWithDelay(element, name) {
        // Clear existing timeout
        if (this.scrollbarTimeouts[name]) {
            clearTimeout(this.scrollbarTimeouts[name]);
        }
        
        // Set shorter timeout when mouse leaves
        this.scrollbarTimeouts[name] = setTimeout(() => {
            element.classList.remove('show-scrollbar');
            delete this.scrollbarTimeouts[name];
        }, 500);
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
            this.gainNode.connect(this.audioContext.destination);
            
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
        
        // Setup preset dropdown
        this.setupCustomDropdown('equalizerPresets', (preset) => {
            this.applyEqPreset(preset);
            this.settings.eqPreset = preset;
            this.saveSettings();
        });
        
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
                this.setDropdownValue('equalizerPresets', 'custom');
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
        this.setDropdownValue('equalizerPresets', savedPreset);
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
        this.setDropdownValue('equalizerPresets', 'flat');
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
            this.nextAudio.preload = 'auto';
        }
    }
    
    async syncAttachedVideo(song, autoPlay) {
        // Wait for both audio and video metadata to load
        await Promise.all([
            new Promise(resolve => {
                if (this.audio.readyState >= 1) resolve();
                else this.audio.onloadedmetadata = resolve;
            }),
            new Promise(resolve => {
                if (this.videoElement.readyState >= 1) resolve();
                else this.videoElement.onloadedmetadata = resolve;
            })
        ]);
        
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