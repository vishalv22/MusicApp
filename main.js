const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mm = require('music-metadata');

let mainWindow;

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

app.whenReady().then(createWindow);
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

// Get music files with metadata
ipcMain.handle('get-music-files', async () => {
    const musicDir = path.join(getUserDataPath(), 'music');
    if (!fs.existsSync(musicDir)) {
        fs.mkdirSync(musicDir, { recursive: true });
        return [];
    }
    
    const files = fs.readdirSync(musicDir)
        .filter(file => /\.(mp3|wav|ogg|m4a|flac)$/i.test(file));
    
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
    
    for (const file of files) {
        const filePath = path.join(musicDir, file);
        try {
            const metadata = await mm.parseFile(filePath);
            const common = metadata.common;
            
            const musicTitle = common.title || file.replace(/\.[^/.]+$/, '');
            
            // Get file stats for dateAdded
            const stats = fs.statSync(filePath);
            const dateAdded = fileTimestamps[file] || stats.birthtime || stats.mtime;
            
            musicFiles.push({
                name: file,
                baseName: file.replace(/\.[^/.]+$/, ''),
                path: filePath,
                title: musicTitle,
                artist: common.artist || 'Unknown Artist',
                album: common.album || 'Unknown Album',
                duration: metadata.format.duration || 0,
                picture: common.picture && common.picture[0] ? common.picture[0].data : null,
                dateAdded: dateAdded
            });
        } catch (error) {
            // Fallback for files without metadata
            const musicTitle = file.replace(/\.[^/.]+$/, '');
            
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
        const videoTitle = file.replace(/\.[^/.]+$/, '');
        
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

// Add files
ipcMain.handle('add-files', async (event, filePaths, type) => {
    // Validate type parameter to prevent path traversal
    const allowedTypes = ['music', 'video', 'lyrics'];
    if (!allowedTypes.includes(type)) {
        console.error('Invalid directory type:', type);
        return;
    }
    
    const targetDir = path.join(getUserDataPath(), type);
    
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Load existing timestamps
    const timestampsPath = path.join(getUserDataPath(), 'file-timestamps.json');
    let fileTimestamps = {};
    if (fs.existsSync(timestampsPath)) {
        try {
            fileTimestamps = JSON.parse(fs.readFileSync(timestampsPath, 'utf8'));
        } catch (error) {
            fileTimestamps = {};
        }
    }
    
    const currentTime = new Date().toISOString();
    let newFilesAdded = false;
    
    for (const filePath of filePaths) {
        const fileName = path.basename(filePath);
        const targetPath = path.join(targetDir, fileName);
        
        try {
            if (fs.existsSync(targetPath)) continue;
            fs.copyFileSync(filePath, targetPath);
            
            // Track when this file was added (for music and video files)
            if (type === 'music' || type === 'video') {
                fileTimestamps[fileName] = currentTime;
                newFilesAdded = true;
            }
        } catch (error) {
            console.error(`Error copying ${fileName}:`, error);
        }
    }
    
    // Save updated timestamps if new music files were added
    if (newFilesAdded) {
        try {
            fs.writeFileSync(timestampsPath, JSON.stringify(fileTimestamps, null, 2));
        } catch (error) {
            console.error('Error saving file timestamps:', error);
        }
    }
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
        width: 700,
        height: 140,

        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        type: 'toolbar',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    // Force always on top periodically with cleanup
    const alwaysOnTopInterval = setInterval(() => {
        if (floatingWindow && !floatingWindow.isDestroyed()) {
            floatingWindow.setAlwaysOnTop(true, 'screen-saver');
        } else {
            clearInterval(alwaysOnTopInterval);
        }
    }, 2000);
    
    floatingWindow.loadFile('floating-lyrics.html');
    
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

// Browse for music files
ipcMain.handle('browse-music-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Music Files',
        filters: [
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }
        ],
        properties: ['openFile', 'multiSelections']
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

// SpotDL web server handler
const SpotDLSetup = require('./setup-spotdl');
let spotdlProcess = null;
let spotdlSetup = null;

ipcMain.handle('stop-spotdl-server', async () => {
    if (spotdlProcess) {
        spotdlProcess.kill();
        spotdlProcess = null;
        return true;
    }
    return false;
});

ipcMain.handle('start-spotdl-server', async () => {
    if (spotdlProcess) {
        return true;
    }
    
    try {
        if (!spotdlSetup) {
            spotdlSetup = new SpotDLSetup(__dirname);
        }
        
        // Ensure FFmpeg is available
        const ffmpegPath = await spotdlSetup.ensureFFmpeg();
        console.log('FFmpeg available at:', ffmpegPath);
        
        const musicDir = path.join(getUserDataPath(), 'music');
        
        // Start SpotDL server with FFmpeg path
        spotdlProcess = await spotdlSetup.startServer(musicDir, ffmpegPath);
        
        spotdlProcess.on('error', (error) => {
            console.error('SpotDL server error:', error);
            spotdlProcess = null;
        });
        
        spotdlProcess.on('exit', (code) => {
            console.log('SpotDL server exited with code:', code);
            spotdlProcess = null;
        });
        
        return true;
    } catch (error) {
        console.error('Failed to start SpotDL server:', error);
        return false;
    }
});