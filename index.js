const fs = require('fs');
const path = require('path');
const Canvas = require('canvas');
const Perlin = require('perlin-noise-3d');
const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');

// Load config
const config = require('./config.json');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const excludedList = [
    'dripstone','flower','candle','lantern','sniffer_egg','stonecutter',
    'redstone_dust_line','nether_portal','ghast','pumpkin_stem',
    'mangrove_propagule_hanging','test','sculk_sensor_tendril_inactive',
    'sculk_sensor_tendril_active','debug'
];
// RAHH RACISM!!
function loadBlockList(listPath, allowExceptions = false) {
    const raw = fs.readFileSync(listPath);
    const json = JSON.parse(raw);
    return json.files.filter(f => {
        const base = path.basename(f, '.png').toLowerCase();
        if (/_top|_bottom|_side|_front|_back/.test(base)) return false;
        if (!allowExceptions && excludedList.some(ex => base.includes(ex))) return false;
        return true;
    });
}

async function loadTextures(folderPath, fileList) {
    const images = [];
    for (const f of fileList) {
        try {
            const img = await Canvas.loadImage(path.join(folderPath, f));
            images.push({ img, name: path.basename(f, '.png') });
        } catch {}
    }
    return images;
}

function rgbToHsv(r,g,b) {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s,v=max;
    const d=max-min;
    s=max===0?0:d/max;
    if(d===0) h=0;
    else if(max===r) h=((g-b)/d)%6;
    else if(max===g) h=((b-r)/d)+2;
    else h=((r-g)/d)+4;
    h=Math.round(h*60);
    if(h<0) h+=360;
    return {h,s,v};
}
// RAHH RACISM!!! PART TWO!!
function averageColor(img){
    const canvas=Canvas.createCanvas(img.width,img.height);
    const ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0,img.width,img.height);
    const data=ctx.getImageData(0,0,img.width,img.height).data;
    let r=0,g=0,b=0,count=0;
    for(let i=0;i<data.length;i+=4){r+=data[i];g+=data[i+1];b+=data[i+2];count++;}
    return {r:r/count,g:g/count,b:b/count};
}

function createAtlasSortedByColor(images,tileSize=16){
    const imagesWithColor=images.map(imgObj=>{
        const avg=averageColor(imgObj.img);
        const hsv=rgbToHsv(avg.r,avg.g,avg.b);
        return {...imgObj,hsv};
    });
    imagesWithColor.sort((a,b)=>{
        if(a.hsv.h!==b.hsv.h) return a.hsv.h-b.hsv.h;
        if(a.hsv.v!==b.hsv.v) return a.hsv.v-b.hsv.v;
        return a.hsv.s-b.hsv.s;
    });
    const cols=Math.ceil(Math.sqrt(imagesWithColor.length));
    const rows=Math.ceil(imagesWithColor.length/cols);
    const atlas=Canvas.createCanvas(cols*tileSize,rows*tileSize);
    const ctx=atlas.getContext('2d');
    imagesWithColor.forEach(({img},i)=>{
        const x=(i%cols)*tileSize;
        const y=Math.floor(i/cols)*tileSize;
        ctx.drawImage(img,x,y,tileSize,tileSize);
    });
    return {atlas,cols,rows,images:imagesWithColor};
}
// puts the textures into one whole big ol image called an atlas
function generatePaletteFromAtlas3D(atlasData, outputSize=5,tileSize=16,rowWidth=10,zValue=null){
    const { atlas, cols, rows, images }=atlasData;
    const perlin=new Perlin();
    perlin.noiseSeed(Math.random()*10000);
    if(zValue===null) zValue=Math.random()*10;
    const availableIndices=[...Array(images.length).keys()];
    const palette=[];
    const names=[];
    for(let i=0;i<outputSize && availableIndices.length>0;i++){
        const x=i%rowWidth;
        const y=Math.floor(i/rowWidth);
        const noiseVal=(perlin.get(x/2,y/2,zValue)+1)/2;
        const t=Math.floor(noiseVal*availableIndices.length);
        const idx=availableIndices.splice(t,1)[0];
        const atlasX=(idx%cols)*tileSize;
        const atlasY=Math.floor(idx/cols)*tileSize;
        const tempCanvas=Canvas.createCanvas(tileSize,tileSize);
        const tempCtx=tempCanvas.getContext('2d');
        tempCtx.drawImage(atlas,atlasX,atlasY,tileSize,tileSize,0,0,tileSize,tileSize);
        palette.push(tempCanvas);
        names.push(images[idx].name);
    }
    return {palette,names,zValue};
}

function drawPaletteImages(images,scale=6,maxPerRow=10){
    const tileSize=16;
    const rows=Math.ceil(images.length/maxPerRow);
    const cols=Math.min(images.length,maxPerRow);
    const width=cols*tileSize;
    const height=rows*tileSize;
    const canvas=Canvas.createCanvas(width,height);
    const ctx=canvas.getContext('2d');
    images.forEach((img,i)=>{
        const x=(i%maxPerRow)*tileSize;
        const y=Math.floor(i/maxPerRow)*tileSize;
        ctx.drawImage(img,x,y,tileSize,tileSize);
    });
    const scaled=Canvas.createCanvas(width*scale,height*scale);
    const scaledCtx=scaled.getContext('2d');
    scaledCtx.imageSmoothingEnabled=false;
    scaledCtx.drawImage(canvas,0,0,scaled.width,scaled.height);
    return scaled;
}

function drawNoiseSlice3D(perlin,width,height,z,scale=6){
    const canvas=Canvas.createCanvas(width,height);
    const ctx=canvas.getContext('2d');
    for(let y=0;y<height;y++){
        for(let x=0;x<width;x++){
            const val=(perlin.get(x/2,y/2,z)+1)/2;
            const shade=Math.floor(val*255);
            ctx.fillStyle=`rgb(${shade},${shade},${shade})`;
            ctx.fillRect(x,y,1,1);
        }
    }
    const scaled=Canvas.createCanvas(canvas.width*scale,canvas.height*scale);
    const scaledCtx=scaled.getContext('2d');
    scaledCtx.imageSmoothingEnabled=false;
    scaledCtx.drawImage(canvas,0,0,scaled.width,scaled.height);
    return scaled;
}
// this took me SO SO SO fucking long
// Slash commands
const commands=[
    new SlashCommandBuilder()
        .setName('mcbuild1')
        .setDescription('Generate a Minecraft palette from 3D Perlin noise.')
        .addIntegerOption(o=>o.setName('amount').setDescription('Number of blocks (default 5)').setRequired(false))
        .addBooleanOption(o=>o.setName('allowexceptions').setDescription('Ignore excluded blocks').setRequired(false))
        .addBooleanOption(o=>o.setName('shownoise').setDescription('Show 2D slice of noise').setRequired(false))
        .addNumberOption(o=>o.setName('noiseslice').setDescription('Set z-value for noise').setRequired(false)),
    new SlashCommandBuilder()
        .setName('mcatlas')
        .setDescription('Show the full atlas image.')
        .addBooleanOption(o=>o.setName('allowexceptions').setDescription('Ignore excluded blocks').setRequired(false)),
    new SlashCommandBuilder()
        .setName('excluded')
        .setDescription('Show list of excluded textures.')
].map(c=>c.toJSON());
// the horrors of shiryu
// Register commands
const rest=new REST({version:'10'}).setToken(config.token);
(async()=>{try{await rest.put(Routes.applicationGuildCommands(config.clientId,config.guildId),{body:commands});}catch(e){console.error(e);}})();

// Interaction handler
client.on('interactionCreate',async interaction=>{
    if(!interaction.isChatInputCommand()) return;
    const listPath=path.join(config.resourcesPath,'_list.json');
    const allowExceptions=interaction.options.getBoolean('allowexceptions')||false;
    const blockFiles=loadBlockList(listPath,allowExceptions);
    const textures=await loadTextures(config.resourcesPath,blockFiles);
    if(interaction.commandName==='excluded'){
        await interaction.reply(`Excluded textures:\n${excludedList.join(', ')}`);
        return;
    }
    if(textures.length===0){
        await interaction.reply('❌ No valid textures found.');
        return;
    }
    const atlasData=createAtlasSortedByColor(textures,16);

    if(interaction.commandName==='mcbuild1'){
        await interaction.deferReply();
        try{
            const amount=interaction.options.getInteger('amount')||5;
            const showNoise=interaction.options.getBoolean('shownoise')||false;
            let noiseZ=interaction.options.getNumber('noiseslice');
            if(noiseZ===null) noiseZ=Math.random()*10;
            const {palette,names}=generatePaletteFromAtlas3D(atlasData,amount,16,10);
            const paletteImage=drawPaletteImages(palette,6,10);
            const buffer=paletteImage.toBuffer('image/png');
            const attachment=new AttachmentBuilder(buffer,{name:'mc_palette.png'});
            const embed=new EmbedBuilder()
                .setTitle('Minecraft Build Palette (3D Perlin Noise)')
                .setDescription(`Blocks selected: ${names.join(', ')}`)
                .setColor(0x00ff00)
                .setImage('attachment://mc_palette.png');
            await interaction.editReply({embeds:[embed],files:[attachment]});

            if(showNoise){
                const perlin=new Perlin(); perlin.noiseSeed(Math.random()*10000);
                const noiseCanvas=drawNoiseSlice3D(perlin,50,50,noiseZ,6);
                const noiseBuffer=noiseCanvas.toBuffer('image/png');
                const noiseAttachment=new AttachmentBuilder(noiseBuffer,{name:'noise_map.png'});
                const noiseEmbed=new EmbedBuilder()
                    .setTitle(`3D Perlin Noise Slice (z=${noiseZ.toFixed(2)})`)
                    .setDescription('Slice of 3D Perlin noise used to select palette blocks.')
                    .setColor(0xffaa00)
                    .setImage('attachment://noise_map.png');
                await interaction.followUp({embeds:[noiseEmbed],files:[noiseAttachment]});
            }
        }catch(e){console.error(e); await interaction.editReply('❌ Error generating palette.');}
    }
// someone pleas hug me wat the fuck is thiss
    if(interaction.commandName==='mcatlas'){
        await interaction.deferReply();
        try{
            const scale=2;
            const scaledAtlas=Canvas.createCanvas(atlasData.atlas.width*scale,atlasData.atlas.height*scale);
            const ctx=scaledAtlas.getContext('2d');
            ctx.imageSmoothingEnabled=false;
            ctx.drawImage(atlasData.atlas,0,0,scaledAtlas.width,scaledAtlas.height);
            const buffer=scaledAtlas.toBuffer('image/png');
            const attachment=new AttachmentBuilder(buffer,{name:'mc_atlas.png'});
            const embed=new EmbedBuilder()
                .setTitle('Minecraft Block Atlas')
                .setDescription('All block textures merged and sorted by color.')
                .setColor(0x00ff00)
                .setImage('attachment://mc_atlas.png');
            await interaction.editReply({embeds:[embed],files:[attachment]});
        }catch{await interaction.editReply('❌ Error generating atlas.');}
    }
});

client.once('clientReady',()=>{console.log(`Logged in as ${client.user.tag}`);});
client.login(config.token);
