const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class SpotDLSetup {
    constructor(appPath) {
        this.appPath = appPath;
        this.downloadDir = path.join(appPath, 'download');
        if (!fs.existsSync(this.downloadDir)) {
            fs.mkdirSync(this.downloadDir, { recursive: true });
        }
        this.ffmpegPath = path.join(appPath, 'ffmpeg', 'ffmpeg.exe');
    }

    async ensureFFmpeg() {
        return null;
    }

    async runSpotDLCommand(args) {
        return new Promise((resolve, reject) => {
            const childProcess = spawn('python', ['-m', 'spotdl', ...args], {
                cwd: this.downloadDir,
                stdio: 'pipe',
                env: { ...process.env, PYTHONPATH: this.downloadDir }
            });

            let output = '';
            let error = '';

            childProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            childProcess.stderr.on('data', (data) => {
                error += data.toString();
            });

            childProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`Process exited with code ${code}: ${error}`));
                }
            });

            childProcess.on('error', (err) => {
                reject(err);
            });
        });
    }

    async startServer(musicDir, ffmpegPath) {
        return new Promise((resolve, reject) => {
            const args = [
                path.join(this.appPath, 'no-browser.py'),
                'web',
                '--host', '127.0.0.1',
                '--port', '8800',
                '--output', musicDir || this.downloadDir
            ];

            const serverProcess = spawn('python', args, {
                stdio: 'pipe',
                env: { ...process.env, BROWSER: 'none', DISPLAY: '' },
                detached: false
            });

            let started = false;

            serverProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log('SpotDL:', output);
                if (output.includes('Uvicorn running') && !started) {
                    started = true;
                    resolve(serverProcess);
                }
            });

            serverProcess.stderr.on('data', (data) => {
                console.error('SpotDL error:', data.toString());
            });

            serverProcess.on('error', (error) => {
                console.error('SpotDL server error:', error);
                if (!started) reject(error);
            });

            serverProcess.on('exit', (code) => {
                console.log('SpotDL server exited with code:', code);
                if (!started && code !== 0) {
                    reject(new Error(`Server exited with code ${code}`));
                }
            });

            // Fallback timeout
            setTimeout(() => {
                if (!started) {
                    resolve(serverProcess);
                }
            }, 5000);
        });
    }
}

module.exports = SpotDLSetup;