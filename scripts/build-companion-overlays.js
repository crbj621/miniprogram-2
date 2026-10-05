// Original vector accessories, rendered to PNG for WeChat's native image.
// Character illustrations are never recolored or rewritten by this script.
const fs = require('node:fs')
const path = require('node:path')
const sharp = require(process.env.CAMPUS_SHARP_PATH || 'sharp')
const output = path.resolve(__dirname, '../server/public/english/companions')
const star = (x, y, fill) => `<path d="M${x} ${y-24}l8 16 18 3-13 13 3 18-16-9-16 9 3-18-13-13 18-3z" fill="${fill}" stroke="#cc9277" stroke-width="3"/>`
async function render(name, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">${body}</svg>`
  fs.writeFileSync(path.join(output, name + '.svg'), svg)
  await sharp(Buffer.from(svg)).png().toFile(path.join(output, name + '.png'))
}
async function main() {
  for (const character of ['boy', 'girl']) {
    const x = character === 'boy' ? 600 : 594
    const y = character === 'boy' ? 706 : 691
    await render(character + '-star', `<circle cx="${x}" cy="${y}" r="29" fill="#fff5cb" stroke="#ba8d78" stroke-width="3"/>${star(x,y,'#ffdb75')}`)
    await render(character + '-heart', `<path d="M${x} ${y+22}C${x-70} ${y-12},${x-24} ${y-56},${x} ${y-22}C${x+24} ${y-56},${x+70} ${y-12},${x} ${y+22}Z" fill="#ffc9d9" stroke="#b9879a" stroke-width="4"/>`)
    const left = character === 'boy' ? 351 : 369
    const right = character === 'boy' ? 568 : 573
    const body = [left, right].map(x => `<g><path d="M${x+23} 1368Q${x+75} 1351 ${x+100} 1378L${x+135} 1457Q${x+136} 1492 ${x+109} 1500L${x+16} 1500Q${x-7} 1487 ${x+1} 1460Z" fill="#fffdf7" stroke="#7f8caa" stroke-width="5"/><path d="M${x+2} 1471Q${x+65} 1489 ${x+130} 1471L${x+131} 1492Q${x+70} 1516 ${x+10} 1494Z" fill="#cee8f5" stroke="#7f8caa" stroke-width="4"/><path d="M${x+35} 1402L${x+96} 1402M${x+28} 1420L${x+104} 1420" stroke="#a7c8de" stroke-width="8" stroke-linecap="round"/>${star(x+65,1455,'#e0d5fa')}</g>`).join('')
    await render(character + '-shoes', body)
  }
  console.log('6 original accessory / shoe SVG + PNG pairs rendered')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
