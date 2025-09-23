const fs = require('fs');
const path = require('path');

console.log('Preparing build...');

// Ensure FFmpeg exists before building
const ffmpegPath = path.join(require('os').homedir(), '.spotdl', 'ffmpeg.exe');
if (!fs.existsSync(ffmpegPath)) {
    console.error('FFmpeg not found! Please run the app once to install FFmpeg before building.');
    process.exit(1);
}

// Create ffmpeg directory in project
const projectFFmpegDir = path.join(__dirname, 'ffmpeg');
if (!fs.existsSync(projectFFmpegDir)) {
    fs.mkdirSync(projectFFmpegDir, { recursive: true });
}

// Copy FFmpeg to project directory
const targetFFmpegPath = path.join(projectFFmpegDir, 'ffmpeg.exe');
if (!fs.existsSync(targetFFmpegPath)) {
    fs.copyFileSync(ffmpegPath, targetFFmpegPath);
    console.log('FFmpeg copied to project directory');
}

console.log('Build preparation complete');