const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Store active streams
const activeStreams = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Get stream status
app.get('/api/streams', (req, res) => {
  const streams = Array.from(activeStreams.entries()).map(([id, info]) => ({
    id,
    status: info.status,
    startTime: info.startTime,
    destinations: info.destinations
  }));
  res.json(streams);
});

// Extract stream from URL using yt-dlp
app.post('/extract-stream', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(200).json({ success: false, message: 'URL required' });
  }

  console.log('Extracting stream for:', url); // Add logging
const ytDlpArgs = url.includes('youtube.com') || url.includes('youtu.be') 
    ? `yt-dlp --extractor-args "youtube:player_client=web" -g -f "best[height<=720]" "${url}"`
  // Create child process with timeout
  const child = exec(`yt-dlp -g -f "best[height<=720]" "${url}"`, { 
    timeout: 25000, // 25 second timeout
    maxBuffer: 1024 * 1024 // 1MB buffer
  }, (error, stdout, stderr) => {
    console.log('yt-dlp finished:', { error: !!error, stdout: stdout?.length, stderr: stderr?.length });
    
    if (error) {
      console.error('yt-dlp error:', error.message, stderr);
      return res.status(200).json({ 
        success: false,
        message: 'Extraction failed: ' + (stderr || error.message || 'Unknown error')
      });
    }

    const streamUrl = stdout.trim();
    if (!streamUrl || streamUrl.includes('ERROR')) {
      return res.status(200).json({ 
        success: false, 
        message: 'No stream found for this URL'
      });
    }

    console.log('Stream extracted:', streamUrl.substring(0, 100) + '...');
    res.json({ 
      success: true, 
      stream_url: streamUrl,
      original_url: url
    });
  });

  // SAFETY: Force timeout response after 25s even if callback doesn't fire
  const timeoutId = setTimeout(() => {
    console.log('Extraction timeout for:', url);
    child.kill('SIGTERM');
    if (!res.headersSent) {
      res.status(200).json({ 
        success: false, 
        message: 'Extraction timeout (25s limit)' 
      });
    }
  }, 25000);

  // Clear timeout if process finishes first
  child.on('close', () => clearTimeout(timeoutId));
});


// Start streaming
app.post('/stream/start', (req, res) => {
  const { sourceUrl, destinations, settings } = req.body;
  const streamId = Date.now().toString();

  if (!sourceUrl || !destinations || destinations.length === 0) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Build FFmpeg command
  let cmd = `ffmpeg -re -i "${sourceUrl}" `;
  
  // Video encoding
  cmd += `-c:v libx264 -preset ${settings.preset || 'veryfast'} `;
  cmd += `-b:v ${settings.videoBitrate || 2500}k `;
  cmd += `-maxrate ${settings.videoBitrate || 2500}k `;
  cmd += `-bufsize ${(settings.videoBitrate || 2500) * 2}k `;
  cmd += `-s ${settings.resolution || '1280x720'} `;
  cmd += `-r ${settings.framerate || 30} `;
  cmd += `-g ${(settings.framerate || 30) * 2} `;
  
  // Audio encoding
  cmd += `-c:a aac -b:a ${settings.audioBitrate || 128}k `;
  cmd += `-ar 44100 -ac 2 `;

  // Add destinations
  destinations.forEach(dest => {
    if (dest.enabled && dest.rtmpUrl && dest.streamKey) {
      cmd += `-f flv "${dest.rtmpUrl}/${dest.streamKey}" `;
    }
  });

  // Add recording output
  if (settings.recording) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cmd += `-f flv "/recordings/stream-${timestamp}.flv"`;
  }

  cmd += ' -loglevel verbose 2>&1';

  console.log('Starting stream:', streamId);
  
  const process = exec(cmd, (error, stdout, stderr) => {
    if (error && error.code !== 0) {
      console.error('Stream error:', error);
      activeStreams.delete(streamId);
      broadcastUpdate('stream_error', { streamId, error: error.message });
    }
  });

  // Stream FFmpeg output for stats
  let lastStats = '';
  process.stdout.on('data', (data) => {
    lastStats = data.toString();
    // Parse and broadcast stats
    const stats = parseFFmpegStats(lastStats);
    if (stats) {
      broadcastUpdate('stream_stats', { streamId, stats });
    }
  });

  activeStreams.set(streamId, {
    status: 'active',
    startTime: new Date(),
    destinations,
    process,
    settings
  });

  res.json({ 
    success: true, 
    streamId,
    message: 'Stream started'
  });
});

// Stop streaming
app.post('/stream/stop', (req, res) => {
  const { streamId } = req.body;

  if (!activeStreams.has(streamId)) {
    return res.status(404).json({ error: 'Stream not found' });
  }

  const stream = activeStreams.get(streamId);
  stream.process.kill('SIGTERM');
  activeStreams.delete(streamId);

  broadcastUpdate('stream_stopped', { streamId });

  res.json({ 
    success: true,
    message: 'Stream stopped'
  });
});

// Get recordings
app.get('/api/recordings', (req, res) => {
  const recordingsDir = '/recordings';
  
  if (!fs.existsSync(recordingsDir)) {
    return res.json({ recordings: [] });
  }

  const recordings = fs.readdirSync(recordingsDir)
    .filter(f => f.endsWith('.flv'))
    .map(f => ({
      name: f,
      path: `/recordings/${f}`,
      size: fs.statSync(path.join(recordingsDir, f)).size,
      created: fs.statSync(path.join(recordingsDir, f)).birthtime
    }));

  res.json({ recordings });
});

// WebSocket for real-time updates
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to MultiStream Studio'
  }));

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

function parseFFmpegStats(output) {
  const bitrateMatch = output.match(/bitrate=\s*([\d.]+)kbits\/s/);
  const fpsMatch = output.match(/fps=\s*(\d+)/);
  const timeMatch = output.match(/time=(\d+:\d+:\d+)/);

  if (bitrateMatch || fpsMatch) {
    return {
      bitrate: bitrateMatch ? parseFloat(bitrateMatch[1]) : 0,
      fps: fpsMatch ? parseInt(fpsMatch[1]) : 0,
      time: timeMatch ? timeMatch[1] : '00:00:00'
    };
  }
  return null;
}

function broadcastUpdate(type, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, ...data }));
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`MultiStream Backend running on port ${PORT}`);
});

