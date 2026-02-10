const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const mm = require('music-metadata');

let mainWindow;

const sanitizeTitle = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\\/g, '').trim();
};

ipcMain.handle('get-app-version', () => {
    try {
        return app.getVersion();
    } catch (e) {
        return null;
    }
});

// Allow Chromium to present above 60fps on high-refresh displays (e.g. 90Hz).
// This matters for WebGL animations (the visualizer); we still pace rendering in the renderer if needed.
app.commandLine.appendSwitch('disable-frame-rate-limit');

const APP_NAME = 'ViMusic';
const APP_ID = 'com.vishal.vimusic';
const DAB_DEFAULT_API_URL = 'https://dabmusic.xyz';

let dabProcess = null;
let dabProcessId = 0;

const getDabDataDir = () => path.join(app.getPath('userData'), 'dab-downloader');
const getDabConfigDir = () => path.join(getDabDataDir(), 'config');
const getDabConfigPath = () => path.join(getDabConfigDir(), 'config.json');
const getDabTokenPath = () => path.join(getDabConfigDir(), '.token');
const getDefaultDabDownloadDir = () => path.join(app.getPath('music'), 'ViMusic');

const ensureDirectory = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

const readJsonFile = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error('Failed to parse JSON:', filePath, error);
        return null;
    }
};

const writeJsonFile = (filePath, data) => {
    ensureDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const ensureDabConfig = (overrides = {}) => {
    const configDir = getDabConfigDir();
    ensureDirectory(configDir);

    const existing = readJsonFile(getDabConfigPath()) || {};
    const apiUrl = overrides.apiUrl || existing.APIURL || DAB_DEFAULT_API_URL;
    const downloadLocation = getDefaultDabDownloadDir();

    const config = {
        ...existing,
        APIURL: apiUrl,
        DownloadLocation: downloadLocation
    };

    if (!config.Parallelism) config.Parallelism = 5;
    if (!config.Format) config.Format = 'flac';
    if (!config.Bitrate) config.Bitrate = '320';
    if (!config.WarningBehavior) config.WarningBehavior = 'summary';
    if (!config.naming) {
        config.naming = {
            album_folder_mask: '{artist}/{artist} - {album} ({year})',
            ep_folder_mask: '{artist}/EPs/{artist} - {album} ({year})',
            single_folder_mask: '{artist}/Singles/{artist} - {album} ({year})',
            file_mask: '{track_number} - {artist} - {title}'
        };
    }

    writeJsonFile(getDabConfigPath(), config);
    return config;
};

const getDabToken = () => {
    const tokenPath = getDabTokenPath();
    if (!fs.existsSync(tokenPath)) return null;
    try {
        return fs.readFileSync(tokenPath, 'utf8').trim();
    } catch (error) {
        console.error('Failed to read DAB token:', error);
        return null;
    }
};

const deleteDabToken = () => {
    const tokenPath = getDabTokenPath();
    if (fs.existsSync(tokenPath)) {
        try {
            fs.unlinkSync(tokenPath);
        } catch (error) {
            console.error('Failed to delete DAB token:', error);
        }
    }
};

const resolveDabBinaryPath = () => {
    const platform = process.platform;
    const binaryName = platform === 'win32' ? 'dab-downloader.exe' : 'dab-downloader';
    const packagedPath = path.join(process.resourcesPath, 'bin', 'dab-downloader', 'bin', platform, binaryName);
    const devPath = path.join(__dirname, 'resources', 'bin', 'dab-downloader', 'bin', platform, binaryName);

    if (fs.existsSync(packagedPath)) return { path: packagedPath, found: true };
    if (fs.existsSync(devPath)) return { path: devPath, found: true };
    return { path: binaryName, found: false };
};

const requestJson = ({ url, method = 'GET', headers = {}, body }) => {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const client = target.protocol === 'https:' ? https : http;
        const options = {
            method,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: `${target.pathname}${target.search}`,
            headers
        };

        const req = client.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let data = null;
                if (raw) {
                    try {
                        data = JSON.parse(raw);
                    } catch (error) {
                        return resolve({ status: res.statusCode, headers: res.headers, data: raw });
                    }
                }
                resolve({ status: res.statusCode, headers: res.headers, data });
            });
        });

        req.on('error', reject);

        if (body) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body);
            req.write(payload);
        }

        req.end();
    });
};

app.setName(APP_NAME);
if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID);
}

function createWindow() {
    // Load saved window size and position
    const settingsPath = path.join(getUserDataPath(), 'settings.json');
    let windowSettings = { width: 1200, height: 800, x: undefined, y: undefined };
    
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings.windowSize) {
                windowSettings = { ...windowSettings, ...settings.windowSize };
            }
        } catch (error) {
            console.log('Could not load window settings');
        }
    }
    
    mainWindow = new BrowserWindow({
        width: windowSettings.width,
        height: windowSettings.height,
        x: windowSettings.x,
        y: windowSettings.y,
        title: APP_NAME,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            zoomFactor: 1.0,
            experimentalFeatures: true,
            enableBlinkFeatures: 'CSSColorSchemeUARendering'
        },
        frame: false,
        backgroundColor: '#0a0a0a',
        resizable: true,
        minWidth: 800,
        minHeight: 600,
        show: false,
        titleBarStyle: 'hidden'
    });

    mainWindow.loadFile('app.html');
    
    // Show window only when ready to prevent flickering
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Optimize after window is shown
        setTimeout(() => {
            mainWindow.webContents.setBackgroundThrottling(false);
        }, 1000);
    });
    
    // Save window size and position when changed
    const saveWindowSettings = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const bounds = mainWindow.getBounds();
            const settingsPath = path.join(getUserDataPath(), 'settings.json');
            let settings = {};
            
            if (fs.existsSync(settingsPath)) {
                try {
                    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                } catch (error) {
                    settings = {};
                }
            }
            
            settings.windowSize = {
                width: bounds.width,
                height: bounds.height,
                x: bounds.x,
                y: bounds.y
            };
            
            // Ensure directory exists before writing
            const settingsDir = path.dirname(settingsPath);
            if (!fs.existsSync(settingsDir)) {
                fs.mkdirSync(settingsDir, { recursive: true });
            }
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        }
    };
    
    mainWindow.on('resize', saveWindowSettings);
    mainWindow.on('move', saveWindowSettings);
    
    // Close floating window when main window is closed
    mainWindow.on('closed', () => {
        if (floatingWindow && !floatingWindow.isDestroyed()) {
            floatingWindow.close();
        }
    });
    
    // Enable zoom shortcuts with throttling
    let zoomTimeout = null;
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.type === 'keyDown') {
            if (zoomTimeout) return; // Throttle zoom operations
            
            const currentZoom = mainWindow.webContents.getZoomFactor();
            
            if (input.key === '=' || input.key === '+') {
                const newZoom = Math.min(currentZoom + 0.1, 2.0);
                mainWindow.webContents.setZoomFactor(newZoom);
            } else if (input.key === '-') {
                const newZoom = Math.max(currentZoom - 0.1, 0.5);
                mainWindow.webContents.setZoomFactor(newZoom);
            } else if (input.key === '0') {
                mainWindow.webContents.setZoomFactor(1.0);
            }
            
            // Throttle zoom operations
            zoomTimeout = setTimeout(() => {
                zoomTimeout = null;
            }, 100);
        }
    });
    

}

// Enable hardware acceleration for better performance
// app.disableHardwareAcceleration(); // Commented out to improve performance

app.whenReady().then(() => {
    createWindow();
    
    globalShortcut.register('CommandOrControl+Shift+L', () => {
        if (floatingWindow && !floatingWindow.isDestroyed()) {
            floatingWindow.webContents.send('toggle-interactive');
        }
    });
});
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());



// Window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close', () => mainWindow.close());

// Get user data directory - moved to top to avoid lazy loading
const getUserDataPath = () => {
    return path.join(app.getPath('userData'), 'storage');
};

const normalizeApiUrl = (value) => {
    if (!value) return DAB_DEFAULT_API_URL;
    let url = String(value).trim();
    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }
    return url.replace(/\/+$/, '');
};

const normalizeCoverUrl = (apiUrl, coverUrl) => {
    if (!coverUrl) return '';
    if (coverUrl.startsWith('http://') || coverUrl.startsWith('https://')) return coverUrl;
    if (coverUrl.startsWith('/')) return `${apiUrl}${coverUrl}`;
    return coverUrl;
};

const sendDabEvent = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
};

ipcMain.handle('dab-get-settings', () => {
    const config = ensureDabConfig();
    const token = getDabToken();
    return {
        apiUrl: config.APIURL,
        downloadPath: config.DownloadLocation,
        loggedIn: Boolean(token)
    };
});

ipcMain.handle('dab-set-settings', (event, settings) => {
    const apiUrl = normalizeApiUrl(settings?.apiUrl);
    const config = ensureDabConfig({ apiUrl });
    return {
        apiUrl: config.APIURL,
        downloadPath: config.DownloadLocation
    };
});

ipcMain.handle('dab-login', async (event, payload) => {
    try {
        const apiUrl = normalizeApiUrl(payload?.apiUrl);
        const email = payload?.email?.trim();
        const password = payload?.password ?? '';

        if (!email || !password) {
            return { ok: false, error: 'Email and password are required.' };
        }

        ensureDabConfig({ apiUrl });

        const { status, headers, data } = await requestJson({
            url: `${apiUrl}/api/auth/login`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'ViMusic'
            },
            body: { email, password }
        });

        if (status === 401) {
            return { ok: false, error: 'Invalid credentials.' };
        }
        if (status !== 200) {
            return { ok: false, error: `Login failed (${status}).` };
        }

        const setCookie = headers['set-cookie'] || [];
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        let token = '';
        for (const cookie of cookies) {
            if (typeof cookie !== 'string') continue;
            const parts = cookie.split(';')[0].split('=');
            if (parts[0] === 'session') {
                token = parts.slice(1).join('=');
                break;
            }
        }

        if (!token) {
            return { ok: false, error: 'Unable to read session token.' };
        }

        ensureDirectory(getDabConfigDir());
        fs.writeFileSync(getDabTokenPath(), token);
        return { ok: true };
    } catch (error) {
        console.error('DAB login failed:', error);
        return { ok: false, error: 'Login failed.' };
    }
});

ipcMain.handle('dab-logout', () => {
    deleteDabToken();
    return { ok: true };
});

ipcMain.handle('dab-search', async (event, payload) => {
    try {
        const config = ensureDabConfig({ apiUrl: payload?.apiUrl });
        const apiUrl = normalizeApiUrl(config.APIURL);
        const token = getDabToken();
        if (!token) {
            return { ok: false, error: 'Not logged in.' };
        }

        const query = payload?.query?.trim();
        const limit = Number(payload?.limit) || 20;
        const type = payload?.type || 'track';
        if (!query) {
            return { ok: false, error: 'Search query is required.' };
        }

        const searchUrl = `${apiUrl}/api/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&limit=${limit}`;
        const { status, data } = await requestJson({
            url: searchUrl,
            headers: {
                'User-Agent': 'ViMusic',
                'Cookie': `session=${token}`
            }
        });

        if (status === 401) {
            return { ok: false, error: 'Session expired. Please log in again.' };
        }
        if (status !== 200) {
            return { ok: false, error: `Search failed (${status}).` };
        }

        if (type === 'album') {
            const albums = Array.isArray(data?.albums) ? data.albums : Array.isArray(data?.results) ? data.results : [];
            const normalized = albums.map((album) => ({
                kind: 'album',
                id: album.id,
                title: album.title || 'Unknown Album',
                artist: album.artist || 'Unknown Artist',
                year: album.year || (album.releaseDate ? String(album.releaseDate).slice(0, 4) : ''),
                totalTracks: album.totalTracks || 0,
                coverUrl: normalizeCoverUrl(apiUrl, album.cover || album.albumCover || '')
            }));
            return { ok: true, results: normalized };
        }

        if (type === 'artist') {
            const artists = Array.isArray(data?.artists) ? data.artists : Array.isArray(data?.results) ? data.results : [];
            const normalized = artists.map((artist) => ({
                kind: 'artist',
                id: artist.id,
                name: artist.name || 'Unknown Artist',
                artistId: artist.id,
                coverUrl: normalizeCoverUrl(apiUrl, artist.picture || '')
            }));
            return { ok: true, results: normalized };
        }

        const tracks = Array.isArray(data?.tracks) ? data.tracks : Array.isArray(data?.results) ? data.results : [];
        const normalized = tracks.map((track) => {
            const albumTitle = track.album || track.albumTitle || '';
            return {
                kind: 'track',
                id: track.id,
                title: track.title || 'Unknown Title',
                artist: track.artist || 'Unknown Artist',
                album: albumTitle || 'Unknown Album',
                duration: track.duration || 0,
                albumId: track.albumId || '',
                coverUrl: normalizeCoverUrl(apiUrl, track.albumCover || track.cover || ''),
                isrc: track.isrc || track.ISRC || '',
                genre: track.genre || '',
                releaseDate: track.releaseDate || track.year || '',
                bitDepth: track.bitDepth || track.bitsPerSample || null,
                sampleRate: track.sampleRate || null
            };
        });

        return { ok: true, results: normalized };
    } catch (error) {
        console.error('DAB search failed:', error);
        return { ok: false, error: 'Search failed.' };
    }
});

ipcMain.handle('dab-stream-url', async (event, payload) => {
    try {
        const config = ensureDabConfig({ apiUrl: payload?.apiUrl });
        const apiUrl = normalizeApiUrl(config.APIURL);
        const token = getDabToken();
        if (!token) {
            return { ok: false, error: 'Not logged in.' };
        }

        const trackId = payload?.trackId;
        if (!trackId && trackId !== 0) {
            return { ok: false, error: 'Track ID is required.' };
        }

        const streamUrl = `${apiUrl}/api/stream?trackId=${encodeURIComponent(trackId)}&quality=27`;
        const { status, data } = await requestJson({
            url: streamUrl,
            headers: {
                'User-Agent': 'ViMusic',
                'Cookie': `session=${token}`
            }
        });

        if (status === 401) {
            return { ok: false, error: 'Session expired. Please log in again.' };
        }
        if (status !== 200) {
            return { ok: false, error: `Stream request failed (${status}).` };
        }

        return { ok: true, url: data?.url || data?.URL || '' };
    } catch (error) {
        console.error('DAB stream failed:', error);
        return { ok: false, error: 'Preview failed.' };
    }
});

ipcMain.handle('dab-download-track', (event, payload) => {
    if (dabProcess) {
        return { ok: false, error: 'A download is already running.' };
    }

    const apiUrl = normalizeApiUrl(payload?.apiUrl);
    const downloadLocation = getDefaultDabDownloadDir();
    const track = payload?.track || {};
    const kind = payload?.kind || track.kind || 'track';

    let args = [];

    if (kind === 'album') {
        const albumId = track.id || track.albumId;
        if (albumId) {
            args = ['album', String(albumId)];
        } else {
            const albumQuery = `${track.title || ''} - ${track.artist || ''}`.trim();
            if (!albumQuery) {
                return { ok: false, error: 'Album ID or query is required.' };
            }
            args = ['search', albumQuery, '--type', 'album', '--auto'];
        }
    } else if (kind === 'artist') {
        const artistId = track.id || track.artistId;
        if (!artistId) {
            return { ok: false, error: 'Artist ID is required.' };
        }
        args = ['artist', String(artistId), '--no-confirm'];
    } else {
        const query = track.isrc || track.query || `${track.title || ''} - ${track.artist || ''}`.trim();
        if (!query) {
            return { ok: false, error: 'Track query is required.' };
        }
        args = ['search', query, '--type', 'track', '--auto'];
    }

    const config = ensureDabConfig({ apiUrl, downloadLocation });
    ensureDirectory(config.DownloadLocation);

    const resolved = resolveDabBinaryPath();
    if (!resolved.found) {
        return {
            ok: false,
            error: `dab-downloader binary not found. Build it at resources/bin/dab-downloader/bin/${process.platform}/${process.platform === 'win32' ? 'dab-downloader.exe' : 'dab-downloader'}.`
        };
    }

    const dabBinary = resolved.path;
    const finalArgs = [
        '--api-url', config.APIURL,
        '--download-location', config.DownloadLocation,
        ...args
    ];

    const processId = ++dabProcessId;
    dabProcess = spawn(dabBinary, finalArgs, {
        cwd: getDabDataDir(),
        windowsHide: true
    });

    dabProcess.stdout.on('data', (data) => {
        sendDabEvent('dab-log', { id: processId, source: 'stdout', message: data.toString() });
    });
    dabProcess.stderr.on('data', (data) => {
        sendDabEvent('dab-log', { id: processId, source: 'stderr', message: data.toString() });
    });
    dabProcess.on('close', (code) => {
        sendDabEvent('dab-exit', { id: processId, code });
        dabProcess = null;
    });
    dabProcess.on('error', (error) => {
        sendDabEvent('dab-log', { id: processId, source: 'stderr', message: error.message });
        sendDabEvent('dab-exit', { id: processId, code: 1 });
        dabProcess = null;
    });

    return { ok: true, id: processId };
});

// Helper functions for manual attachments
const loadManualAttachments = () => {
    const manualPath = path.join(getUserDataPath(), 'manual-lyrics.json');
    if (fs.existsSync(manualPath)) {
        try {
            return JSON.parse(fs.readFileSync(manualPath, 'utf8'));
        } catch (error) {
            console.error('Error loading manual attachments:', error);
            return {};
        }
    }
    return {};
};

const saveManualAttachments = (attachments) => {
    const manualPath = path.join(getUserDataPath(), 'manual-lyrics.json');
    try {
        fs.writeFileSync(manualPath, JSON.stringify(attachments, null, 2));
    } catch (error) {
        console.error('Error saving manual attachments:', error);
    }
};

// Helper functions for watched folders
const getWatchedFolders = () => {
    const foldersPath = path.join(getUserDataPath(), 'watched-folders.json');
    if (fs.existsSync(foldersPath)) {
        try {
            return JSON.parse(fs.readFileSync(foldersPath, 'utf8'));
        } catch (error) {
            console.error('Error loading watched folders:', error);
            return [];
        }
    }
    return [];
};

const saveWatchedFolders = (folders) => {
    const foldersPath = path.join(getUserDataPath(), 'watched-folders.json');
    try {
        const storageDir = path.dirname(foldersPath);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        fs.writeFileSync(foldersPath, JSON.stringify(folders, null, 2));
    } catch (error) {
        console.error('Error saving watched folders:', error);
    }
};

const scanFolderRecursively = (folderPath) => {
    const files = [];
    try {
        const items = fs.readdirSync(folderPath);
        for (const item of items) {
            const fullPath = path.join(folderPath, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                files.push(...scanFolderRecursively(fullPath));
            } else if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(item)) {
                files.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error scanning folder ${folderPath}:`, error);
    }
    return files;
};

// Get music files from watched folders
ipcMain.handle('get-music-files', async () => {
    const watchedFolders = getWatchedFolders();
    if (watchedFolders.length === 0) {
        return [];
    }
    
    const allFiles = [];
    for (const folderPath of watchedFolders) {
        if (fs.existsSync(folderPath)) {
            const files = scanFolderRecursively(folderPath);
            allFiles.push(...files);
        }
    }
    
    // Load existing file timestamps
    const timestampsPath = path.join(getUserDataPath(), 'file-timestamps.json');
    let fileTimestamps = {};
    if (fs.existsSync(timestampsPath)) {
        try {
            fileTimestamps = JSON.parse(fs.readFileSync(timestampsPath, 'utf8'));
        } catch (error) {
            fileTimestamps = {};
        }
    }
    
    const musicFiles = [];
    
    for (const filePath of allFiles) {
        const file = path.basename(filePath);
        try {
            const metadata = await mm.parseFile(filePath);
            const common = metadata.common;
            const format = metadata.format || {};
             
            const musicTitle = sanitizeTitle(common.title || file.replace(/\.[^/.]+$/, ''));
            const genre = Array.isArray(common.genre) ? common.genre[0] : (common.genre || '');
            const releaseDate = common.date || common.year || common.originaldate || common.originalyear || '';
            
            // Get file stats for dateAdded
            const stats = fs.statSync(filePath);
            const dateAdded = fileTimestamps[file] || stats.birthtime || stats.mtime;
            
            const sampleRate = Number(format.sampleRate);
            const bitDepth = Number(format.bitsPerSample);

            musicFiles.push({
                name: file,
                baseName: file.replace(/\.[^/.]+$/, ''),
                path: filePath,
                title: musicTitle,
                artist: common.artist || 'Unknown Artist',
                album: common.album || 'Unknown Album',
                duration: metadata.format.duration || 0,
                genre: genre,
                year: common.year || '',
                releaseDate: releaseDate,
                lossless: typeof format.lossless === 'boolean' ? format.lossless : null,
                sampleRate: Number.isFinite(sampleRate) ? sampleRate : null,
                bitDepth: Number.isFinite(bitDepth) ? bitDepth : null,
                picture: common.picture && common.picture[0] ? common.picture[0].data : null,
                dateAdded: dateAdded
            });
        } catch (error) {
            // Fallback for files without metadata
            const musicTitle = sanitizeTitle(file.replace(/\.[^/.]+$/, ''));
            
            // Get file stats for dateAdded
            const stats = fs.statSync(filePath);
            const dateAdded = fileTimestamps[file] || stats.birthtime || stats.mtime;
            
            musicFiles.push({
                name: file,
                baseName: file.replace(/\.[^/.]+$/, ''),
                path: filePath,
                title: musicTitle,
                artist: 'Unknown Artist',
                album: 'Unknown Album',
                duration: 0,
                genre: '',
                year: '',
                releaseDate: '',
                lossless: null,
                sampleRate: null,
                bitDepth: null,
                picture: null,
                dateAdded: dateAdded
            });
        }
    }
    
    // Get all lyrics files for smart matching
    const lyricsDir = path.join(getUserDataPath(), 'lyrics');
    const allLyricsFiles = fs.existsSync(lyricsDir) ? 
        fs.readdirSync(lyricsDir)
            .filter(file => file.endsWith('.lrc'))
            .map(file => file.replace('.lrc', '')) : [];
    
    // Load manual attachments
    const manualAttachments = loadManualAttachments();
    
    // Load video attachments
    const videoAttachmentsPath = path.join(getUserDataPath(), 'video-attachments.json');
    let videoAttachments = {};
    if (fs.existsSync(videoAttachmentsPath)) {
        try {
            videoAttachments = JSON.parse(fs.readFileSync(videoAttachmentsPath, 'utf8'));
        } catch (error) {
            videoAttachments = {};
        }
    }
    
    // Apply matching to each music file
    musicFiles.forEach(musicFile => {
        // Check for manual attachment first
        if (manualAttachments[musicFile.baseName]) {
            musicFile.lyricsMatch = manualAttachments[musicFile.baseName];
        } else {
            // Only use automatic matching if no manual attachment exists
            const bestMatch = findBestLyricsMatch(musicFile.title, allLyricsFiles);
            musicFile.lyricsMatch = bestMatch;
        }
        
        // Check for attached video
        if (videoAttachments[musicFile.baseName]) {
            musicFile.attachedVideo = {
                path: videoAttachments[musicFile.baseName].videoPath,
                name: videoAttachments[musicFile.baseName].originalName
            };
        }
    });
    
    return musicFiles;
});

// Smart lyrics matching function
function findBestLyricsMatch(musicTitle, lyricsFiles) {
    if (lyricsFiles.length === 0) return null;
    
    const musicBaseName = musicTitle.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    // First try exact match
    for (const lyricsFile of lyricsFiles) {
        const lyricsBaseName = lyricsFile.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        if (musicBaseName === lyricsBaseName) {
            return lyricsFile;
        }
    }
    
    // Then try partial matching with stricter criteria
    let bestMatch = null;
    let bestScore = 0;
    const minRequiredScore = Math.max(2, Math.floor(musicBaseName.split(' ').length * 0.6));
    
    for (const lyricsFile of lyricsFiles) {
        const lyricsBaseName = lyricsFile.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        const musicWords = musicBaseName.split(' ').filter(w => w.length > 2);
        const lyricsWords = lyricsBaseName.split(' ').filter(w => w.length > 2);
        
        let matchCount = 0;
        
        for (const musicWord of musicWords) {
            if (lyricsWords.includes(musicWord)) {
                matchCount++;
            }
        }
        
        // Only consider matches that meet minimum threshold
        if (matchCount >= minRequiredScore && matchCount > bestScore) {
            bestScore = matchCount;
            bestMatch = lyricsFile;
        }
    }
    
    return bestMatch;
}

// Get video files
ipcMain.handle('get-video-files', async () => {
    const videoDir = path.join(getUserDataPath(), 'video');
    if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
        return [];
    }
    
    const files = fs.readdirSync(videoDir)
        .filter(file => /\.(mp4|avi|mkv|mov|wmv|flv|webm|m4v)$/i.test(file));
    
    // Load existing file timestamps
    const timestampsPath = path.join(getUserDataPath(), 'file-timestamps.json');
    let fileTimestamps = {};
    if (fs.existsSync(timestampsPath)) {
        try {
            fileTimestamps = JSON.parse(fs.readFileSync(timestampsPath, 'utf8'));
        } catch (error) {
            fileTimestamps = {};
        }
    }
    
    const videoFiles = [];
    
    for (const file of files) {
        const filePath = path.join(videoDir, file);
        const videoTitle = sanitizeTitle(file.replace(/\.[^/.]+$/, ''));
        
        // Get file stats for dateAdded
        const stats = fs.statSync(filePath);
        const dateAdded = fileTimestamps[file] || stats.birthtime || stats.mtime;
        
        videoFiles.push({
            name: file,
            baseName: file.replace(/\.[^/.]+$/, ''),
            path: filePath,
            title: videoTitle,
            artist: 'Video File',
            album: 'Videos',
            duration: 0,
            picture: null,
            isVideo: true,
            dateAdded: dateAdded
        });
    }
    
    return videoFiles;
});

// Get lyrics files
ipcMain.handle('get-lyrics-files', () => {
    const lyricsDir = path.join(getUserDataPath(), 'lyrics');
    if (!fs.existsSync(lyricsDir)) {
        fs.mkdirSync(lyricsDir, { recursive: true });
        return [];
    }
    
    return fs.readdirSync(lyricsDir)
        .filter(file => file.endsWith('.lrc'))
        .map(file => file.replace('.lrc', ''));
});

// Read lyrics
ipcMain.handle('read-lyrics', (event, baseName) => {
    const lyricsPath = path.join(getUserDataPath(), 'lyrics', `${baseName}.lrc`);
    return fs.existsSync(lyricsPath) ? fs.readFileSync(lyricsPath, 'utf8') : null;
});

// Add watched folders
ipcMain.handle('add-music-folders', async (event, folderPaths) => {
    const watchedFolders = getWatchedFolders();
    const newFolders = folderPaths.filter(folder => !watchedFolders.includes(folder));
    
    if (newFolders.length > 0) {
        watchedFolders.push(...newFolders);
        saveWatchedFolders(watchedFolders);
    }
    
    return newFolders.length;
});

// Remove watched folder
ipcMain.handle('remove-music-folder', async (event, folderPath) => {
    const watchedFolders = getWatchedFolders();
    const index = watchedFolders.indexOf(folderPath);
    if (index > -1) {
        watchedFolders.splice(index, 1);
        saveWatchedFolders(watchedFolders);
        return true;
    }
    return false;
});

// Get watched folders
ipcMain.handle('get-watched-folders', async () => {
    return getWatchedFolders();
});

// Open folder
ipcMain.on('open-folder', () => {
    const { shell } = require('electron');
    const storagePath = getUserDataPath();
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }
    shell.openPath(storagePath);
});

// View song in folder
ipcMain.on('view-song-in-folder', (event, filePath) => {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
});

// Floating lyrics window
let floatingWindow = null;



ipcMain.on('create-floating-lyrics', (event) => {
    if (floatingWindow) {
        floatingWindow.focus();
        return;
    }
    
    floatingWindow = new BrowserWindow({
        width: 1200,
        height: 180,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        type: 'toolbar',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        show: false
    });
    
    floatingWindow.setIgnoreMouseEvents(true, { forward: true });
    
    // Force always on top periodically with cleanup
    const alwaysOnTopInterval = setInterval(() => {
        if (floatingWindow && !floatingWindow.isDestroyed()) {
            floatingWindow.setAlwaysOnTop(true, 'screen-saver');
        } else {
            clearInterval(alwaysOnTopInterval);
        }
    }, 2000);
    
    floatingWindow.loadFile('floating-lyrics.html');
    
    // Show window after loading
    floatingWindow.once('ready-to-show', () => {
        floatingWindow.show();
    });
    
    // Notify main window that floating window is ready
    floatingWindow.webContents.once('did-finish-load', () => {
        event.sender.send('floating-window-ready');
    });
    
    // Load and set saved position
    const settingsPath = path.join(getUserDataPath(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings.floatingWindowPosition) {
                floatingWindow.setPosition(settings.floatingWindowPosition.x, settings.floatingWindowPosition.y);
            }
        } catch (error) {
            console.log('Could not load floating window position');
        }
    }
    
    // Save position when window is moved
    floatingWindow.on('moved', () => {
        if (floatingWindow && !floatingWindow.isDestroyed()) {
            const position = floatingWindow.getPosition();
            const settingsPath = path.join(getUserDataPath(), 'settings.json');
            let settings = {};
            
            if (fs.existsSync(settingsPath)) {
                try {
                    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                } catch (error) {
                    settings = {};
                }
            }
            
            settings.floatingWindowPosition = { x: position[0], y: position[1] };
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        }
    });
    
    floatingWindow.on('closed', () => {
        floatingWindow = null;
    });
});

ipcMain.on('update-floating-lyrics', (event, data) => {
    if (floatingWindow) {
        floatingWindow.webContents.send('update-lyric', data);
    }
});

ipcMain.on('update-floating-lyrics-style', (event, style) => {
    if (floatingWindow) {
        floatingWindow.webContents.send('update-style', style);
    }
});

ipcMain.on('set-click-through', (event, enabled) => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
        floatingWindow.setIgnoreMouseEvents(enabled);
    }
});

ipcMain.on('close-floating-lyrics', () => {
    if (floatingWindow) {
        floatingWindow.close();
    }
});

ipcMain.handle('is-floating-window-open', () => {
    return floatingWindow && !floatingWindow.isDestroyed();
});

// Song management handlers
ipcMain.handle('add-song-lyrics', async (event, baseName, lyricsPath) => {
    const targetPath = path.join(getUserDataPath(), 'lyrics', `${baseName}.lrc`);
    try {
        fs.copyFileSync(lyricsPath, targetPath);
        
        // Save manual attachment record
        const manualAttachments = loadManualAttachments();
        manualAttachments[baseName] = baseName;
        saveManualAttachments(manualAttachments);
        
        return true;
    } catch (error) {
        console.error('Error adding lyrics:', error);
        return false;
    }
});

ipcMain.handle('remove-lyrics', async (event, baseName) => {
    const lyricsPath = path.join(getUserDataPath(), 'lyrics', `${baseName}.lrc`);
    try {
        if (fs.existsSync(lyricsPath)) {
            fs.unlinkSync(lyricsPath);
        }
        
        // Remove manual attachment record
        const manualAttachments = loadManualAttachments();
        const { [baseName]: removed, ...updatedAttachments } = manualAttachments;
        saveManualAttachments(updatedAttachments);
        
        return true;
    } catch (error) {
        console.error('Error removing lyrics:', error);
        return false;
    }
});

ipcMain.handle('delete-song', async (event, fileName) => {
    const musicPath = path.join(getUserDataPath(), 'music', fileName);
    try {
        if (fs.existsSync(musicPath)) {
            fs.unlinkSync(musicPath);
        }
        return true;
    } catch (error) {
        console.error('Error deleting song:', error);
        return false;
    }
});

ipcMain.handle('save-pasted-lyrics', async (event, baseName, lyricsText) => {
    // Sanitize baseName to prevent path traversal
    const safeName = path.basename(baseName).replace(/[^a-zA-Z0-9\-_\s]/g, '').trim();
    if (!safeName) {
        console.error('Invalid file name provided');
        return false;
    }
    
    const targetPath = path.join(getUserDataPath(), 'lyrics', `${safeName}.lrc`);
    
    // Verify the resolved path is within the lyrics directory
    const lyricsDir = path.join(getUserDataPath(), 'lyrics');
    if (!targetPath.startsWith(lyricsDir)) {
        console.error('Path traversal attempt detected');
        return false;
    }
    
    try {
        fs.writeFileSync(targetPath, lyricsText, 'utf8');
        
        // Save manual attachment record using original baseName for proper lookup
        const manualAttachments = loadManualAttachments();
        manualAttachments[baseName] = safeName;
        saveManualAttachments(manualAttachments);
        
        return true;
    } catch (error) {
        console.error('Error saving pasted lyrics:', error);
        return false;
    }
});

// Attach video to song
ipcMain.handle('attach-video-to-song', async (event, songBaseName, videoPath) => {
    if (!videoPath || typeof videoPath !== 'string') {
        console.error('Invalid video path provided:', videoPath);
        return false;
    }
    
    const videoDir = path.join(getUserDataPath(), 'attached_video');
    if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
    }
    
    const videoFileName = path.basename(videoPath);
    const targetPath = path.join(videoDir, `${songBaseName}_${videoFileName}`);
    
    try {
        fs.copyFileSync(videoPath, targetPath);
        
        // Save attachment record
        const attachmentsPath = path.join(getUserDataPath(), 'video-attachments.json');
        let attachments = {};
        
        if (fs.existsSync(attachmentsPath)) {
            try {
                attachments = JSON.parse(fs.readFileSync(attachmentsPath, 'utf8'));
            } catch (error) {
                attachments = {};
            }
        }
        
        attachments[songBaseName] = {
            videoPath: targetPath,
            originalName: videoFileName
        };
        
        fs.writeFileSync(attachmentsPath, JSON.stringify(attachments, null, 2));
        
        return { videoPath: targetPath };
    } catch (error) {
        console.error('Error attaching video:', error);
        return false;
    }
});

// Browse for video file
ipcMain.handle('browse-video-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Video File',
        filters: [
            { name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v'] }
        ],
        properties: ['openFile']
    });
    return result;
});

// Browse for lyrics file
ipcMain.handle('browse-lyrics-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Lyrics File',
        filters: [
            { name: 'Lyrics Files', extensions: ['lrc'] }
        ],
        properties: ['openFile']
    });
    return result;
});

// Browse for music folders
ipcMain.handle('browse-music-folders', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Music Folders',
        properties: ['openDirectory', 'multiSelections']
    });
    return result;
});

// Browse for video files
ipcMain.handle('browse-video-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Video Files',
        filters: [
            { name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v'] }
        ],
        properties: ['openFile', 'multiSelections']
    });
    return result;
});

// Browse for lyrics files
ipcMain.handle('browse-lyrics-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Lyrics Files',
        filters: [
            { name: 'Lyrics Files', extensions: ['lrc'] }
        ],
        properties: ['openFile', 'multiSelections']
    });
    return result;
});

// Browse for font file
ipcMain.handle('browse-font-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Font File',
        filters: [
            { name: 'Font Files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }
        ],
        properties: ['openFile']
    });
    return result;
});

// Check if file exists
ipcMain.handle('file-exists', async (event, filePath) => {
    return fs.existsSync(filePath);
});

// Browse for image file
ipcMain.handle('browse-image-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Image File',
        filters: [
            { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
        ],
        properties: ['openFile']
    });
    return result;
});

// Remove attached video
ipcMain.handle('remove-attached-video', async (event, songBaseName) => {
    const attachmentsPath = path.join(getUserDataPath(), 'video-attachments.json');
    
    if (!fs.existsSync(attachmentsPath)) {
        return true;
    }
    
    try {
        const attachments = JSON.parse(fs.readFileSync(attachmentsPath, 'utf8'));
        
        if (attachments[songBaseName]) {
            const videoPath = attachments[songBaseName].videoPath;
            
            // Delete video file if it exists
            if (fs.existsSync(videoPath)) {
                fs.unlinkSync(videoPath);
            }
            
            // Remove from attachments record
            delete attachments[songBaseName];
            fs.writeFileSync(attachmentsPath, JSON.stringify(attachments, null, 2));
        }
        
        return true;
    } catch (error) {
        console.error('Error removing attached video:', error);
        return false;
    }
});
