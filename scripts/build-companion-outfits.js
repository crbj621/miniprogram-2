'use strict'

// Original vector garments. All layers share the base character's 1024 × 1536 canvas.
const fs = require('node:fs')
const path = require('node:path')
const sharp = require(process.env.COMPANION_SHARP || 'sharp')
const output = path.resolve(__dirname, '../server/public/english/companions')
const stroke = '#947c87'
const pathOf = (shape, fill, extra = '') => `<path d="${shape}" fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round" ${extra}/>`
const flower = (x, y, size, color) => `<g transform="translate(${x} ${y}) scale(${size})" fill="${color}"><ellipse cy="-8" rx="5" ry="9"/><ellipse cy="-8" rx="5" ry="9" transform="rotate(72)"/><ellipse cy="-8" rx="5" ry="9" transform="rotate(144)"/><ellipse cy="-8" rx="5" ry="9" transform="rotate(216)"/><ellipse cy="-8" rx="5" ry="9" transform="rotate(288)"/><circle r="4" fill="#fff3c1"/></g>`
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536"><defs><linearGradient id="cloth" x2=".8" y2="1"><stop stop-color="#fffaf5"/><stop offset="1" stop-color="#f1dfe8"/></linearGradient><linearGradient id="peach" x2=".6" y2="1"><stop stop-color="#ffe0e9"/><stop offset="1" stop-color="#ddb2cd"/></linearGradient><linearGradient id="moon" x2=".4" y2="1"><stop stop-color="#d8e8fc"/><stop offset="1" stop-color="#9cbbde"/></linearGradient><linearGradient id="mint" x2=".8" y2="1"><stop stop-color="#d9efe2"/><stop offset="1" stop-color="#a5cabc"/></linearGradient></defs><g>${body}</g></svg>`

function hanfu(character) {
  const girl = character === 'girl', neck = girl ? 570 : 635
  const main = girl ? 'url(#peach)' : 'url(#moon)', belt = girl ? '#c88daa' : '#7395ba'
  return pathOf(`M438 ${neck} Q512 ${neck + 73} 596 ${neck} L680 ${neck + 68} Q715 744 776 838 L827 916 L784 952 Q719 936 662 865 L740 1072 Q740 1120 692 1155 Q705 1309 732 1410 Q532 1474 306 1410 L325 1110 L301 1077 L351 950 L389 868 Q327 947 264 952 L214 923 Q241 846 297 785 L353 ${neck + 72} Z`, main)
    + pathOf(`M438 ${neck + 3} L578 815 L478 865 L398 ${neck + 53} Z`, '#fff9f3')
    + pathOf(`M596 ${neck + 3} L467 863 L595 818 L645 ${neck + 42} Z`, 'url(#cloth)')
    + pathOf('M387 858 Q526 887 662 858 L669 905 Q520 935 381 901 Z', belt)
    + pathOf('M522 893 Q491 864 464 881 Q459 920 510 911 Q548 879 579 892 Q575 927 526 914 L525 1114 L499 1085 L508 920 L556 1062 L584 1044 L538 913', '#fff0d7')
    + `<path d="M369 974Q401 1170 357 1387M422 957L399 1430M599 956L630 1429M646 966Q636 1174 689 1388" fill="none" stroke="${belt}" stroke-width="5" opacity=".4"/>`
    + [flower(424, 1190, 1.7, '#fff6ee'), flower(623, 1328, 2.2, '#fff5ed'), flower(363, 1344, 1.3, '#fff3e6'), flower(661, 1085, 1.3, '#fff7f2')].join('')
    + `<path d="M255 928Q302 913 340 876M736 875Q773 923 793 933" fill="none" stroke="#fff5e7" stroke-width="12"/>`
}

function cape(character) {
  const girl = character === 'girl', top = girl ? 562 : 629, main = girl ? 'url(#mint)' : 'url(#moon)'
  return pathOf(`M434 ${top} Q527 ${top + 74} 598 ${top} Q727 ${top + 145} 843 935 L797 975 L673 871 L743 1059 Q743 1112 705 1140 Q703 1313 727 1417 Q514 1467 310 1417 L325 1112 L306 1082 L333 984 L381 870 L256 975 L205 935 Q308 ${top + 138} 434 ${top} Z`, main)
    + pathOf(`M434 ${top} Q472 ${top + 101} 524 ${top + 155} Q578 ${top + 69} 598 ${top} L666 ${top + 68} Q593 ${top + 151} 546 ${top + 188} L527 1396 L506 1396 L497 ${top + 188} Q442 ${top + 134} 374 ${top + 75} Z`, '#fff9e9')
    + `<path d="M354 1051Q520 1090 689 1051M327 1383Q519 1430 705 1383" stroke="#f7f2d8" stroke-width="20" fill="none"/>`
    + pathOf(`M524 ${top + 149} L501 ${top + 177} L524 ${top + 207} L547 ${top + 177} Z`, '#e3b465')
    + [flower(395, 1182, 2.1, '#fff3d5'), flower(637, 1260, 1.8, '#fff4dd'), flower(369, 1326, 1.2, '#fff9ec')].join('')
    + `<path d="M428 1012Q426 1213 379 1367M611 1016Q605 1201 657 1381" fill="none" stroke="#7fa69b" opacity=".35" stroke-width="5"/>`
}

function girlSchool() {
  return pathOf('M436 567Q512 629 591 567L652 622L708 735L797 858L817 925L779 951L649 840L653 952L689 1017L719 1076Q532 1140 322 1080L356 1009L388 950L405 836L265 952L218 922L245 858L313 764L367 642Z', 'url(#cloth)')
    + pathOf('M437 574L523 652L591 573L631 598L584 694L465 694L391 604Z', '#91aed0')
    + pathOf('M390 953Q521 975 652 953L716 1076Q528 1143 323 1080Z', '#8b9bbd')
    + `<path d="M409 972L379 1101M459 979L450 1112M518 982L516 1116M579 978L591 1110M629 973L660 1096" fill="none" stroke="#66779d" stroke-width="5"/>`
    + pathOf('M523 659Q474 623 465 667Q475 709 524 685Q566 711 581 667Q567 627 523 659Z', '#df9aba')
    + pathOf('M518 673L488 755L523 737L539 765L546 681Z', '#edb7cb')
    + `<path d="M395 608L465 682L579 682L624 607" fill="none" stroke="#f4fbff" stroke-width="8"/>`
    + pathOf('M223 917L266 901L296 934L267 958Z', '#a7bdd8')
    + pathOf('M770 902L819 918L797 947L775 956L746 927Z', '#a7bdd8')
    + flower(603, 763, .8, '#e6b36b')
}

function boySchool() {
  return pathOf('M438 633Q521 693 604 633L661 677L713 746L780 816L749 862L698 891L663 837L684 1010L702 1153Q619 1215 522 1190Q429 1211 330 1164L365 1005L389 835L350 895L285 844L283 815L373 704Z', 'url(#cloth)')
    + pathOf('M434 641L495 696L521 738L549 695L604 641L653 682L640 1004Q523 1030 369 998L395 684Z', 'url(#mint)')
    + pathOf('M365 998Q532 1031 684 1002L706 1157Q619 1210 530 1191L514 1070L499 1194Q416 1216 329 1161Z', '#a3b3c8')
    + pathOf('M439 638L514 688L471 718L404 671Z', '#fdf9ef')
    + pathOf('M602 638L526 688L576 720L646 670Z', '#fdf9ef')
    + pathOf('M508 687L535 689L544 714L525 840L498 807L503 715Z', '#8fa0c0')
    + `<path d="M391 722L382 974M639 721L651 977M521 1069L527 1189M344 1133Q426 1166 495 1145M546 1150Q628 1173 690 1131" stroke="#829eb0" stroke-width="5" fill="none"/>`
    + pathOf('M583 779L620 779L617 823L599 838L583 823Z', '#fff6dc')
    + `<path d="M591 800L610 800M600 790L600 810" stroke="#bd9d61" stroke-width="4"/>`
}

async function build() {
  const layers = { 'girl-peach-hanfu': hanfu('girl'), 'girl-mint-cape': cape('girl'), 'girl-campus-sailor': girlSchool(), 'boy-moon-hanfu': hanfu('boy'), 'boy-star-cape': cape('boy'), 'boy-campus-vest': boySchool() }
  for (const [name, body] of Object.entries(layers)) {
    const document = svg(body)
    fs.writeFileSync(path.join(output, name + '.svg'), document)
    await sharp(Buffer.from(document)).png().toFile(path.join(output, name + '.png'))
  }
  console.log('Built ' + Object.keys(layers).length + ' original garment layers; base character PNGs were not modified.')
}
build().catch(error => { console.error(error); process.exitCode = 1 })
