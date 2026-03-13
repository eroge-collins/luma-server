/**
 * Luma Server - Entry Point
 * Auto-starts the server immediately on launch
 */

import { LumaServer } from './server'
import * as path from 'path'

// pkg stores assets in snapshot, use process.cwd() for writable data
const dataDir = path.join(process.cwd(), 'data')

// In pkg, __dirname points to snapshot where ui/ is embedded
// In dev, __dirname is dist/ and ui is at ../ui
const uiDir = path.join(__dirname, '..', 'ui')

const server = new LumaServer(dataDir, uiDir)

server.start().then((result) => {
    if (!result.success) {
        console.error(`\x1b[31mFailed to start server: ${result.error}\x1b[0m`)
        process.exit(1)
    }
})

// Graceful shutdown
const shutdown = () => {
    server.stop().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
