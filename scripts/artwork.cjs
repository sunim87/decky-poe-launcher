const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(__dirname, '..');
const source = path.resolve(root, 'launcher-source/src/renderer/assets');
(async () => {
  const out = path.join(root, 'assets');
  fs.mkdirSync(out, {recursive:true});
  const logo = await sharp(path.join(source, 'poe2/logo.png')).resize(800,400,{fit:'inside'}).png().toBuffer();
  const meta = await sharp(logo).metadata();
  const original = await sharp(path.join(source, 'poe2/bg-forest.webp')).metadata();
  let rawTotal = 0, total = 0;
  for (const [name,width,height] of [['capsule',600,900],['wide',920,430],['hero',1920,620]]) {
    const resizedLogo = await sharp(logo).resize(Math.round(width*.67),Math.round(height*.65),{fit:'inside'}).png().toBuffer();
    const lm = await sharp(resizedLogo).metadata();
    const composed = await sharp(path.join(source,'poe2/bg-forest.webp')).resize(width,height,{fit:'cover'}).composite([{input:resizedLogo,left:Math.round((width-lm.width)/2),top:Math.round((height-lm.height)/2)}]).png().toBuffer();
    rawTotal += composed.length;
    const file = path.join(out,name+'.png');
    await sharp(composed).png({palette:true,colours:256,compressionLevel:9,effort:10}).toFile(file);
    total += fs.statSync(file).size;
  }
  await sharp(logo).png({palette:true,colours:256,compressionLevel:9,effort:10}).toFile(path.join(out,'logo.png'));
  await sharp(logo).resize(128,128,{fit:'contain',background:'#00000000'}).png({palette:true,compressionLevel:9,effort:10}).toFile(path.join(out,'icon.png'));
  total += fs.statSync(path.join(out,'logo.png')).size + fs.statSync(path.join(out,'icon.png')).size;
  fs.writeFileSync(path.join(out,'compression.json'), JSON.stringify({sourceWidth:original.width,logoWidth:meta.width,rawComposites:rawTotal,compressedTotal:total},null,2));
  console.log({rawComposites:rawTotal,compressedTotal:total});
})();
