const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const outDir = path.join(__dirname, '..', 'build', 'icons')

const accent = '#7c5cbf'
const accentLight = '#a78bfa'

// Balão ocupa ~75% do quadrado, centralizado, com cauda apontando pra baixo-esquerda
function svgBalloon() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accentLight}"/>
      <stop offset="1" stop-color="${accent}"/>
    </linearGradient>
  </defs>
  <!-- Balão grande centralizado (75% do canvas) -->
  <path d="M512 80c-230 0-416 150-416 336 0 106 60 200 156 260-14 56-48 112-104 168-10 10-4 28 12 26 108-8 190-42 244-88 34 6 70 10 108 10 230 0 416-150 416-336S742 80 512 80z" fill="url(#g)"/>
  <!-- 3 pontinhos maiores e mais visíveis -->
  <circle cx="380" cy="380" r="48" fill="#fff" opacity="0.95"/>
  <circle cx="512" cy="380" r="48" fill="#fff" opacity="0.95"/>
  <circle cx="644" cy="380" r="48" fill="#fff" opacity="0.95"/>
</svg>`
}

// Balão + LUMA bem posicionados, texto com fonte robusta e sem clipping
function svgFull() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accentLight}"/>
      <stop offset="1" stop-color="${accent}"/>
    </linearGradient>
  </defs>
  <!-- Balão ocupando ~60% do canvas, centralizado no topo -->
  <path d="M512 64c-210 0-380 138-380 308 0 98 55 184 142 238-12 52-44 104-96 156-9 9-3 24 10 23 100-8 176-38 226-80 32 5 65 8 98 8 210 0 380-138 380-308S722 64 512 64z" fill="url(#g)"/>
  <!-- 3 pontinhos -->
  <circle cx="380" cy="340" r="44" fill="#fff" opacity="0.95"/>
  <circle cx="512" cy="340" r="44" fill="#fff" opacity="0.95"/>
  <circle cx="644" cy="340" r="44" fill="#fff" opacity="0.95"/>
  <!-- LUMA: fonte robusta (Arial, Helvetica, sans-serif), centralizado, sem clipping -->
  <text x="512" y="820" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="200" font-weight="900" letter-spacing="24" fill="${accent}">LUMA</text>
</svg>`
}

async function main() {
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(outDir, { recursive: true })

    const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

    for (const s of sizes) {
        const base = s <= 48 ? svgBalloon() : svgFull()
        const buf = Buffer.from(base)
        await sharp(buf)
            .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(path.join(outDir, `${s}x${s}.png`))
    }

    console.log('PNGs ok')
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
