# Luma Server

Standalone Luma voice & text chat server. Deploy this folder independently on any VPS, host, or local machine — no GUI required.

## Quick Start

### Windows
Double-click `start.bat` or run:
```
npm install
npm run build
npm start
```

### Linux / macOS
```bash
chmod +x start.sh
./start.sh
```

Or manually:
```bash
npm install
npm run build
npm start
```

## Configuration

The server creates a `data/config.json` file on first run with default settings:

```json
{
  "name": "Luma Server",
  "port": 3737,
  "password": ""
}
```

You can also configure via environment variable:
```bash
LUMA_SERVER_CONFIG='{"name":"My Server","port":3737,"password":"secret"}' node index.js
```

## Connecting

Share your server IP with friends. They connect using the Luma app:
- **Address**: `YOUR_IP:3737`
- **Password**: (if you set one)

## Data Storage

All data is stored in the `data/` folder:
- `config.json` — Server configuration
- `users.json` — User profiles
- `channels.json` — Channel list
- `messages.json` — Message history

## Requirements

- Node.js 18+ 
- npm
