const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    AttachmentBuilder,
    StringSelectMenuBuilder
} = require('discord.js');
const { QuickDB } = require('quick.db');
const { createCanvas, loadImage, registerFont } = require('canvas');
const ArabicReshaper = require('arabic-reshaper');
const bidi = require('bidi-js')();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Keep Alive Server
const http = require('http');
http.createServer((req, res) => {
    res.write('I am Alive!');
    res.end();
}).listen(process.env.PORT || 3000, () => {
    console.log(`Keep-alive server is running on port ${process.env.PORT || 3000}`);
});


// Register Arabic Font
const fontPath = path.join(__dirname, 'fonts', 'Cairo-Bold.ttf');
if (fs.existsSync(fontPath)) {
    registerFont(fontPath, { family: 'Cairo', weight: 'bold' });
}

function fixArabic(text) {
    if (!text) return '';
    // Use only reshaping (joining) for modern Cairo font compatibility
    return ArabicReshaper.convertArabic(text);
}

const db = new QuickDB();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// Default Config
const DEFAULT_CONFIG = {
    points: 10,
    duration: 60000, // 1 minute
    background: 'https://images.wallpaperscraft.com/image/single/mountains_lake_river_140924_1280x720.jpg',
    channelId: process.env.TOP_CHANNEL_ID || null,
    commandsChannelId: process.env.COMMANDS_CHANNEL_ID || null,
    pointsRoleId: process.env.POINTS_ROLE_ID || null,
    commandsRoleId: process.env.COMMANDS_ROLE_ID || null,
    logChannelId: process.env.LOG_CHANNEL_ID || null
};

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // --- AUTO-SYNC ON STARTUP ---
    console.log('🔄 Starting Voice Sync...');
    for (const guild of client.guilds.cache.values()) {
        const guildId = guild.id;
        const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;
        
        // Get all members currently in voice channels
        const voiceMembers = guild.voiceStates.cache;
        
        // 1. Handle members currently in voice
        for (const [userId, state] of voiceMembers) {
            if (state.channelId && !state.member.user.bot) {
                const joinTime = await db.get(`voice_join_time_${guildId}_${userId}`);
                if (!joinTime) {
                    // Member is in voice but no join time recorded (joined while bot was offline)
                    await db.set(`voice_join_time_${guildId}_${userId}`, Date.now());
                }
            }
        }

        // 2. Handle members who left while bot was offline
        // (Clean up join times for users who are no longer in voice)
        const allData = await db.all();
        for (const item of allData) {
            if (item.id.startsWith(`voice_join_time_${guildId}_`)) {
                const uid = item.id.split('_').pop();
                if (!voiceMembers.has(uid)) {
                    // User has a join time but is not in voice anymore
                    // We calculate their points up to "now" to be fair
                    const joinTime = item.value;
                    const timeInVoice = Date.now() - joinTime;
                    const points = Math.floor(timeInVoice / config.duration) * config.points;
                    
                    if (points > 0) {
                        await db.add(`voice_points_${guildId}_${uid}`, points);
                    }
                    await db.delete(item.id);
                }
            }
        }
    }
    console.log('✅ Voice Sync Completed!');
});

// --- Voice Point Tracking ---

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.member.user.bot) return;

    const guildId = newState.guild.id;
    const userId = newState.member.id;
    const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;

    // --- Case 1: Joining Voice (from nothing) ---
    if (!oldState.channelId && newState.channelId) {
        if (!config.pointsRoleId || !newState.member.roles.cache.has(config.pointsRoleId)) return;
        
        console.log(`[JOIN] ${newState.member.user.tag} joined voice.`);
        await db.set(`voice_join_time_${guildId}_${userId}`, Date.now());
    }

    // --- Case 2: Leaving Voice (completely) ---
    else if (oldState.channelId && !newState.channelId) {
        const joinTime = await db.get(`voice_join_time_${guildId}_${userId}`);
        if (!joinTime) return;

        const timeSpent = Date.now() - joinTime;
        const pointsToAdd = Math.floor(timeSpent / config.duration) * config.points;

        if (pointsToAdd > 0) {
            await db.add(`voice_points_${guildId}_${userId}`, pointsToAdd);
            const currentPoints = await db.get(`voice_points_${guildId}_${userId}`) || 0;
            const currentLevel = Math.floor(currentPoints / 500);
            await db.set(`voice_level_${guildId}_${userId}`, currentLevel);
            console.log(`[LEAVE] ${oldState.member.user.tag} left. Added ${pointsToAdd} points.`);

            // --- SEND LOG IMAGE ---
            if (config.logChannelId) {
                const logChannel = await oldState.guild.channels.fetch(config.logChannelId).catch(() => null);
                if (logChannel) {
                    const canvas = createCanvas(600, 450);
                    const ctx = canvas.getContext('2d');

                    // Background (Solid Black as requested)
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, 600, 450);

                    // Subtle Border
                    ctx.strokeStyle = '#333333';
                    ctx.lineWidth = 10;
                    ctx.strokeRect(0, 0, 600, 450);

                    // User Info
                    const user = oldState.member.user;
                    ctx.textAlign = 'center';
                    
                    // Avatar
                    try {
                        const avatarURL = user.displayAvatarURL({ extension: 'png', size: 128 });
                        const avatarImg = await loadImage(avatarURL);
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(300, 80, 50, 0, Math.PI * 2);
                        ctx.clip();
                        ctx.drawImage(avatarImg, 250, 30, 100, 100);
                        ctx.restore();
                        ctx.strokeStyle = '#FFFFFF';
                        ctx.lineWidth = 3;
                        ctx.stroke();
                    } catch (e) {}

                    // Name & ID
                    ctx.fillStyle = '#FFFFFF';
                    ctx.font = 'bold 30px Cairo';
                    ctx.fillText(user.username, 300, 170);
                    ctx.fillStyle = '#AAAAAA';
                    ctx.font = '20px Cairo';
                    ctx.fillText(`ID: ${user.id}`, 300, 200);

                    // Stats Layout (Vertical)
                    const totalMinutes = Math.floor(timeSpent / 60000);
                    const hours = Math.floor(totalMinutes / 60);
                    const minutes = totalMinutes % 60;
                    const timeString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

                    const stats = [
                        { label: 'النقاط المكتسبة', value: `+${pointsToAdd}`, color: '#00FF00' },
                        { name: '💰', label: 'مدة التواجد', value: timeString, color: '#FFFFFF' },
                        { name: '⏱️', label: 'الروم الصوتي', value: oldState.channel.name, color: '#FFFFFF' },
                        { name: '🔊', label: 'إجمالي النقاط', value: currentPoints, color: '#FFD700' }
                    ];

                    let currentY = 250;
                    ctx.textAlign = 'left';
                    for (const stat of stats) {
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                        ctx.roundRect(50, currentY - 25, 500, 40, 10);
                        ctx.fill();

                        ctx.fillStyle = '#FFFFFF';
                        ctx.font = '22px Cairo';
                        ctx.fillText(fixArabic(stat.label), 70, currentY + 3);

                        ctx.textAlign = 'right';
                        ctx.fillStyle = stat.color;
                        ctx.font = 'bold 22px Cairo';
                        ctx.fillText(fixArabic(stat.value.toString()), 530, currentY + 3);
                        ctx.textAlign = 'left';

                        currentY += 50;
                    }

                    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'log.png' });
                    await logChannel.send({ files: [attachment] }).catch(() => null);
                }
            }
        }
        await db.delete(`voice_join_time_${guildId}_${userId}`);
    }

    // --- Case 3: Switching Channels ---
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        // Do nothing, keep the original joinTime to continue the session
        console.log(`[MOVE] ${newState.member.user.tag} moved channels. Session continues.`);
    }
});

// --- Interaction Handler ---

client.on('interactionCreate', async interaction => {
    const guildId = interaction.guildId;
    const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;

    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // Check Commands Channel
        const isTopCommand = commandName === 'top' || commandName === 'توب';
        const isCommandsChannel = !config.commandsChannelId || interaction.channelId === config.commandsChannelId;
        const isTopChannel = config.channelId && interaction.channelId === config.channelId;

        if (!isCommandsChannel && !(isTopCommand && isTopChannel)) {
            return interaction.reply({ content: `❌ الأوامر مسموحة فقط في قناة الأوامر: <#${config.commandsChannelId}>`, ephemeral: true });
        }

        // Check Command Access Role (Allow Points Role too for /top)
        const hasCommandRole = config.commandsRoleId && interaction.member.roles.cache.has(config.commandsRoleId);
        const hasPointsRole = config.pointsRoleId && interaction.member.roles.cache.has(config.pointsRoleId);
        const isAdmin = interaction.member.permissions.has('Administrator');

        if (commandName === 'top' || commandName === 'توب') {
            if (!hasCommandRole && !hasPointsRole && !isAdmin) {
                return interaction.reply({ content: '❌ ليس لديك الرتبة المطلوبة لرؤية التوب!', ephemeral: true });
            }
            const guildId = interaction.guildId;
            const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;

            // Check if restricted to a specific channel
            if (config.channelId && interaction.channelId !== config.channelId) {
                return interaction.reply({ 
                    content: `❌ هذا الأمر مسموح به فقط في قناة: <#${config.channelId}>`, 
                    ephemeral: true 
                });
            }

            await interaction.deferReply();
            
            const allData = await db.all();
            
            // Filter points for this guild
            let leaderboard = [];
            for (const item of allData) {
                if (item.id.startsWith(`voice_points_${guildId}_`)) {
                    const userId = item.id.split('_').pop();
                    let points = item.value;

                    // LIVE CALCULATION: If user is currently in voice, add their pending points
                    const joinTime = await db.get(`voice_join_time_${guildId}_${userId}`);
                    if (joinTime) {
                        const timeInVoice = Date.now() - joinTime;
                        const pendingPoints = Math.floor(timeInVoice / config.duration) * config.points;
                        points += pendingPoints;
                    }

                    const level = Math.floor(points / 500);
                    leaderboard.push({ userId, points, level });
                }
            }

            // Also check users who are CURRENTLY in voice but HAVE NO POINTS YET
            const voiceStates = interaction.guild.voiceStates.cache;
            for (const [userId, state] of voiceStates) {
                if (leaderboard.find(u => u.userId === userId)) continue;

                const joinTime = await db.get(`voice_join_time_${guildId}_${userId}`);
                if (joinTime) {
                    const timeInVoice = Date.now() - joinTime;
                    const points = Math.floor(timeInVoice / config.duration) * config.points;
                    if (points > 0) {
                        const level = Math.floor(points / 500);
                        leaderboard.push({ userId, points, level });
                    }
                }
            }

            // Sort by points descending
            leaderboard.sort((a, b) => b.points - a.points);
            const top10 = leaderboard.slice(0, 10);

            // Generate Canvas Image (Wide and Long for Podium)
            const canvas = createCanvas(1000, 1200);
            const ctx = canvas.getContext('2d');

            // --- DRAW BACKGROUND ---
            if (config.background) {
                try {
                    const bgImg = await loadImage(config.background);
                    ctx.drawImage(bgImg, 0, 0, 1000, 1200);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(0, 0, 1000, 1200);
                } catch (e) {
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, 1000, 1200);
                }
            } else {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, 1000, 1200);
            }

            // Subtle Glass Stripes (More visible now)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            for (let i = 0; i < 2000; i += 60) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i - 500, 1200);
                ctx.lineTo(i - 440, 1200);
                ctx.lineTo(i + 60, 0);
                ctx.fill();
            }

            // Glass Container for List
            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.roundRect(40, 560, 920, 600, 25);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // --- DRAW TARGET INFO (Top Left) ---
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const targetRankIndex = leaderboard.findIndex(u => u.userId === targetUser.id);
            const targetRank = targetRankIndex !== -1 ? targetRankIndex + 1 : 'Unranked';

            ctx.beginPath();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.roundRect(20, 20, 250, 70, 15);
            ctx.fill();

            try {
                const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 64 });
                const avatarImg = await loadImage(avatarURL);
                ctx.save(); ctx.beginPath(); ctx.arc(55, 55, 25, 0, Math.PI * 2); ctx.clip();
                ctx.drawImage(avatarImg, 30, 30, 50, 50); ctx.restore();
            } catch (e) {}

            ctx.textAlign = 'left';
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 20px Cairo';
            ctx.fillText(fixArabic((targetMember ? targetMember.displayName : targetUser.username).slice(0, 10)), 90, 48);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.font = '16px Cairo';
            ctx.fillText(`Rank: #${targetRank}`, 90, 70);

            // --- DRAW SERVER INFO (Top Right) ---
            const guild = interaction.guild;
            ctx.textAlign = 'right';
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 28px Cairo';
            ctx.fillText(fixArabic(guild.name.slice(0, 25)), 870, 75);
            
            try {
                const guildIconURL = guild.iconURL({ extension: 'png', size: 128 });
                if (guildIconURL) {
                    const iconImg = await loadImage(guildIconURL);
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(920, 70, 40, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.drawImage(iconImg, 880, 30, 80, 80);
                    ctx.restore();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            } catch (e) {}

            // --- DRAW TOP 3 (PODIUM) ---
            const podiumConfig = [
                { x: 250, y: 300, rank: 2, color: '#C0C0C0', size: 60 }, // #2 Left
                { x: 500, y: 250, rank: 1, color: '#FFD700', size: 80 }, // #1 Center (Higher)
                { x: 750, y: 300, rank: 3, color: '#CD7F32', size: 60 }  // #3 Right
            ];

            for (const conf of podiumConfig) {
                const dataIndex = (conf.rank === 1) ? 0 : (conf.rank === 2) ? 1 : 2;
                const data = top10[dataIndex]; // Might be undefined
                
                let name = 'لا يوجد مستخدم';
                let levelText = 'LVL ---';
                let userObj = null;

                if (data) {
                    const user = await client.users.fetch(data.userId).catch(() => ({ username: '؟' }));
                    const member = await interaction.guild.members.fetch(data.userId).catch(() => null);
                    name = member ? member.displayName : user.username;
                    levelText = `LVL ${data.level}`;
                    userObj = user;
                }

                // Rank above
                ctx.fillStyle = conf.color;
                ctx.font = `bold ${conf.size - 20}px Cairo`;
                ctx.textAlign = 'center';
                ctx.fillText(`#${conf.rank}`, conf.x, conf.y - 120);

                // Avatar (Only if user exists)
                if (userObj) {
                    try {
                        const avatarURL = userObj.displayAvatarURL({ extension: 'png', size: 128 });
                        const avatarImg = await loadImage(avatarURL);
                        ctx.save(); ctx.beginPath();
                        ctx.arc(conf.x, conf.y - 20, conf.size, 0, Math.PI * 2, true);
                        ctx.closePath(); ctx.clip();
                        ctx.drawImage(avatarImg, conf.x - conf.size, conf.y - 20 - conf.size, conf.size * 2, conf.size * 2);
                        ctx.restore();
                        ctx.strokeStyle = conf.color; ctx.lineWidth = 5; ctx.stroke();
                    } catch (e) {}
                } else {
                    // Empty circle placeholder
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(conf.x, conf.y - 20, conf.size, 0, Math.PI * 2, true);
                    ctx.stroke();
                }

                // Name below
                ctx.fillStyle = userObj ? '#FFFFFF' : 'rgba(255, 255, 255, 0.3)';
                ctx.font = 'bold 30px Cairo';
                ctx.fillText(fixArabic(name.slice(0, 15)), conf.x, conf.y + conf.size + 40);

                // Level below name
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.font = '24px Cairo';
                ctx.fillText(fixArabic(levelText), conf.x, conf.y + conf.size + 80);

                // Progress Bar below level
                if (data) {
                    const progress = (data.points % 500) / 500;
                    const pBarWidth = 100;
                    const pBarHeight = 6;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.fillRect(conf.x - pBarWidth / 2, conf.y + conf.size + 100, pBarWidth, pBarHeight);
                    ctx.fillStyle = conf.color;
                    ctx.fillRect(conf.x - pBarWidth / 2, conf.y + conf.size + 100, pBarWidth * progress, pBarHeight);
                }
            }

            // --- DRAW REST (4-10) - Always show 7 slots ---
            for (let i = 0; i < 7; i++) {
                const data = top10[i + 3]; // Rank i+4
                const realRank = i + 4;
                const y = 600 + (i * 80);

                let displayName = 'لا يوجد مستخدم';
                let levelText = 'LVL ---';
                let userObj = null;
                let progress = 0;

                if (data) {
                    const user = await client.users.fetch(data.userId).catch(() => ({ username: '؟' }));
                    const member = await interaction.guild.members.fetch(data.userId).catch(() => null);
                    displayName = member ? member.displayName : user.username;
                    levelText = `LVL ${data.level}`;
                    userObj = user;
                    progress = (data.points % 500) / 500;
                }

                // Box
                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.roundRect(50, y - 30, 900, 70, 10);
                ctx.fill();

                // Level & Progress
                ctx.fillStyle = userObj ? '#FFFFFF' : 'rgba(255, 255, 255, 0.2)';
                ctx.font = 'bold 28px Cairo';
                ctx.textAlign = 'left';
                ctx.fillText(fixArabic(levelText), 80, y + 15);

                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.fillRect(200, y + 5, 150, 10);
                if (userObj) {
                    ctx.fillStyle = '#5865F2';
                    ctx.fillRect(200, y + 5, 150 * progress, 10);
                }

                // Name, Rank & Avatar
                ctx.textAlign = 'right';
                ctx.fillStyle = userObj ? '#FFFFFF' : 'rgba(255, 255, 255, 0.2)';
                ctx.font = '28px Cairo';
                ctx.fillText(fixArabic(displayName.slice(0, 15)), 750, y + 15);
                
                ctx.fillStyle = data ? '#FFFFFF' : 'rgba(255, 255, 255, 0.1)';
                ctx.font = 'bold 30px Cairo';
                ctx.fillText(`#${realRank}`, 850, y + 15);

                if (userObj) {
                    try {
                        const avatarURL = userObj.displayAvatarURL({ extension: 'png', size: 64 });
                        const avatarImg = await loadImage(avatarURL);
                        ctx.save(); ctx.beginPath();
                        ctx.arc(910, y + 5, 25, 0, Math.PI * 2, true);
                        ctx.closePath(); ctx.clip();
                        ctx.drawImage(avatarImg, 885, y - 20, 50, 50);
                        ctx.restore();
                    } catch (e) {}
                }
            }

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'top.png' });
            await interaction.editReply({ files: [attachment] });

        } else if (commandName === 'setup') {
            const guildId = interaction.guildId;
            const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;

            if (!isAdmin && (!config.commandsRoleId || !interaction.member.roles.cache.has(config.commandsRoleId))) {
                return interaction.reply({ content: '❌ عذراً، هذا الأمر للمشرفين فقط (أو أصحاب رتبة الأوامر)!', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('⚙️ إعدادات نظام نقاط الصوت')
                .setDescription(`اختر الإعداد الذي ترغب في تعديله من القائمة المنسدلة أدناه:`)
                .addFields(
                    { name: '💰 النقاط', value: `${config.points} نقطة`, inline: true },
                    { name: '⏱️ المدة', value: `${config.duration / 60000} دقيقة`, inline: true },
                    { name: '📺 قناة التوب', value: config.channelId ? `<#${config.channelId}>` : 'الكل', inline: true },
                    { name: '💬 قناة الأوامر', value: config.commandsChannelId ? `<#${config.commandsChannelId}>` : 'الكل', inline: true },
                    { name: '📜 قناة السجلات', value: config.logChannelId ? `<#${config.logChannelId}>` : 'غير محددة', inline: true },
                    { name: '🎖️ رتبة النقاط', value: config.pointsRoleId ? `<@&${config.pointsRoleId}>` : 'الجميع', inline: true },
                    { name: '🎮 رتبة الأوامر', value: config.commandsRoleId ? `<@&${config.commandsRoleId}>` : 'الجميع', inline: true }
                )
                .setColor('#5865F2');

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('setup_select')
                .setPlaceholder('اختر الإعداد المراد تعديله...')
                .addOptions([
                    { label: 'تعديل النقاط', value: 'set_points', emoji: '💰' },
                    { label: 'تعديل المدة', value: 'set_duration', emoji: '⏱️' },
                    { label: 'قناة التوب', value: 'set_channel', emoji: '📺' },
                    { label: 'قناة الأوامر', value: 'set_commands_channel', emoji: '💬' },
                    { label: 'قناة السجلات', value: 'set_log_channel', emoji: '📜' },
                    { label: 'رتبة حساب النقاط', value: 'set_points_role', emoji: '🎖️' },
                    { label: 'رتبة الأوامر', value: 'set_commands_role', emoji: '🎮' },
                    { label: 'تغيير الخلفية', value: 'set_bg', emoji: '🖼️' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({ embeds: [embed], components: [row] });
        } else if (commandName === 'تصفير_الكل') {
            if (!isAdmin && (!config.commandsRoleId || !interaction.member.roles.cache.has(config.commandsRoleId))) {
                return interaction.reply({ content: '❌ هذا الأمر مخصص فقط للمسؤولين (أصحاب رتبة الأوامر)!', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const allData = await db.all();
            let count = 0;
            for (const item of allData) {
                if (item.id.startsWith(`voice_points_${guildId}_`) || item.id.startsWith(`voice_level_${guildId}_`)) {
                    await db.delete(item.id);
                    count++;
                }
            }

            await interaction.editReply({ content: `✅ تم تصفير جميع النقاط واللفلات بنجاح لجميع الأعضاء (${count} سجل تم حذفه).` });
        }
    }

    // --- Select Menu Interaction ---
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'setup_select') {
            const selected = interaction.values[0];
            
            const modalId = selected === 'set_points' ? 'points_modal' :
                          selected === 'set_duration' ? 'duration_modal' :
                          selected === 'set_channel' ? 'channel_modal' :
                          selected === 'set_commands_channel' ? 'c_channel_modal' :
                          selected === 'set_log_channel' ? 'l_channel_modal' :
                          selected === 'set_points_role' ? 'p_role_modal' :
                          selected === 'set_commands_role' ? 'c_role_modal' : null;

            if (selected === 'set_bg') {
                await interaction.reply({ 
                    content: '📸 يرجى رفع صورة الخلفية الآن (أو إرسال رابطها) في هذه القناة...\n⏱️ **الوقت المتاح:** دقيقة واحدة.\n\n💡 **الأبعاد المطلوبة لتصميم مثالي:**\n📏 **العرض:** 1000 بكسل\n📐 **الطول:** 1200 بكسل', 
                    ephemeral: true 
                });

                const filter = m => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content.startsWith('http'));
                const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

                collector.on('collect', async m => {
                    const url = m.attachments.size > 0 ? m.attachments.first().url : m.content;
                    const guildId = interaction.guildId;
                    const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;
                    config.background = url;
                    await db.set(`guild_config_${guildId}`, config);
                    await m.reply('✅ تم تحديث صورة الخلفية بنجاح!');
                });

                collector.on('end', (collected, reason) => {
                    if (reason === 'time' && collected.size === 0) {
                        interaction.followUp({ content: '❌ **انتهى الوقت!** لم يتم إرسال أي صورة، يرجى المحاولة مرة أخرى إذا كنت ترغب في تغيير الخلفية.', ephemeral: true });
                    }
                });
                return;
            }

            if (!modalId) return;

            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle('تعديل إعدادات النظام');

            let label = 'أدخل القيمة الجديدة';
            if (selected === 'set_points') label = 'عدد النقاط (مثلاً: 10)';
            else if (selected === 'set_duration') label = 'المدة بالدقائق (مثلاً: 5)';
            else if (selected === 'set_channel') label = 'أيدي القناة (Channel ID)';
            else if (selected === 'set_log_channel') label = 'أيدي قناة السجلات (Log Channel ID)';
            else if (selected === 'set_points_role') label = 'أيدي رتبة حساب النقاط';
            else if (selected === 'set_points_role') label = 'أيدي رتبة حساب النقاط';
            else if (selected === 'set_commands_role') label = 'أيدي رتبة الأوامر';

            const input = new TextInputBuilder()
                .setCustomId('input_value')
                .setLabel(label)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('اكتب هنا...')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        const guildId = interaction.guildId;
        const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;
        const val = interaction.fields.getTextInputValue('input_value');

        if (interaction.customId === 'points_modal') {
            const num = parseInt(val);
            if (isNaN(num)) return interaction.reply({ content: 'يرجى إدخال رقم صحيح!', ephemeral: true });
            config.points = num;
        } else if (interaction.customId === 'duration_modal') {
            const num = parseInt(val);
            if (isNaN(num)) return interaction.reply({ content: 'يرجى إدخال رقم صحيح بالدقائق!', ephemeral: true });
            config.duration = num * 60000;
        } else if (interaction.customId === 'channel_modal') {
            const id = val.replace(/[<#>]/g, '');
            config.channelId = id;
        } else if (interaction.customId === 'c_channel_modal') {
            const id = val.replace(/[<#>]/g, '');
            config.commandsChannelId = id;
        } else if (interaction.customId === 'l_channel_modal') {
            const id = val.replace(/[<#>]/g, '');
            config.logChannelId = id;
        } else if (interaction.customId === 'p_role_modal') {
            const id = val.replace(/[<@&>]/g, '');
            config.pointsRoleId = id;
        } else if (interaction.customId === 'c_role_modal') {
            const id = val.replace(/[<@&>]/g, '');
            config.commandsRoleId = id;
        } else if (interaction.customId === 'bg_modal') {
            // Deprecated - handled by collector
        }

        await db.set(`guild_config_${guildId}`, config);
        await interaction.reply({ content: '✅ تم تحديث الإعدادات بنجاح!', ephemeral: true });
    }
});

// --- Message Handler (Prefix-less fallback) ---

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.toLowerCase().trim();
    if (content.startsWith('top') || content.startsWith('توب')) {
        const guildId = message.guildId;
        const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;

        // Check Channels
        const isCommandsChannel = !config.commandsChannelId || message.channelId === config.commandsChannelId;
        const isTopChannel = config.channelId && message.channelId === config.channelId;

        if (!isCommandsChannel && !isTopChannel) {
            return;
        }

        // Check Access Roles
        const hasCommandRole = config.commandsRoleId && message.member.roles.cache.has(config.commandsRoleId);
        const hasPointsRole = config.pointsRoleId && message.member.roles.cache.has(config.pointsRoleId);
        const isAdmin = message.member.permissions.has('Administrator');

        if (!hasCommandRole && !hasPointsRole && !isAdmin) return;

        // Check Channel Restriction
        if (config.channelId && message.channelId !== config.channelId) {
            return message.reply(`❌ هذا الأمر مسموح به فقط في قناة: <#${config.channelId}>`);
        }

        const allData = await db.all();
        let leaderboard = [];
        for (const item of allData) {
            if (item.id.startsWith(`voice_points_${guildId}_`)) {
                const userId = item.id.split('_').pop();
                let points = item.value;

                // LIVE CALCULATION
                const joinTime = await db.get(`voice_join_time_${guildId}_${userId}`);
                if (joinTime) {
                    const timeInVoice = Date.now() - joinTime;
                    const pendingPoints = Math.floor(timeInVoice / config.duration) * config.points;
                    points += pendingPoints;
                }

                const level = Math.floor(points / 500);
                leaderboard.push({ userId, points, level });
            }
        }

        // Check users who are currently in voice but have no saved points yet
        const voiceStates = message.guild.voiceStates.cache;
        for (const [userId, state] of voiceStates) {
            if (leaderboard.find(u => u.userId === userId)) continue;

            const joinTime = await db.get(`voice_join_time_${guildId}_${userId}`);
            if (joinTime) {
                const timeInVoice = Date.now() - joinTime;
                const points = Math.floor(timeInVoice / config.duration) * config.points;
                if (points > 0) {
                const level = Math.floor(points / 500);
                leaderboard.push({ userId, points, level });
                }
            }
        }

        leaderboard.sort((a, b) => b.points - a.points);
        const top10 = leaderboard.slice(0, 10);

        // Generate Canvas (Podium Style)
        const canvas = createCanvas(1000, 1200);
        const ctx = canvas.getContext('2d');
        // --- DRAW BACKGROUND ---
        if (config.background) {
            try {
                const bgImg = await loadImage(config.background);
                ctx.drawImage(bgImg, 0, 0, 1000, 1200);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.fillRect(0, 0, 1000, 1200);
            } catch (e) {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, 1000, 1200);
            }
        } else {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, 1000, 1200);
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        for (let i = 0; i < 2000; i += 60) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i - 500, 1200);
            ctx.lineTo(i - 440, 1200);
            ctx.lineTo(i + 60, 0);
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.roundRect(40, 560, 920, 600, 25);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // --- DRAW TARGET INFO (Top Left) ---
        const targetUser = message.mentions.users.first() || message.author;
        const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
        const targetRankIndex = leaderboard.findIndex(u => u.userId === targetUser.id);
        const targetRank = targetRankIndex !== -1 ? targetRankIndex + 1 : 'Unranked';

        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.roundRect(20, 20, 250, 70, 15);
        ctx.fill();

        try {
            const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 64 });
            const avatarImg = await loadImage(avatarURL);
            ctx.save(); ctx.beginPath(); ctx.arc(55, 55, 25, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(avatarImg, 30, 30, 50, 50); ctx.restore();
        } catch (e) {}

        ctx.textAlign = 'left';
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 20px Cairo';
        ctx.fillText(fixArabic((targetMember ? targetMember.displayName : targetUser.username).slice(0, 10)), 90, 48);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '16px Cairo';
        ctx.fillText(`Rank: #${targetRank}`, 90, 70);

        // --- DRAW SERVER INFO (Top Right) ---
        const guild = message.guild;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 28px Cairo';
        ctx.fillText(fixArabic(guild.name.slice(0, 25)), 870, 75);
        
        try {
            const guildIconURL = guild.iconURL({ extension: 'png', size: 128 });
            if (guildIconURL) {
                const iconImg = await loadImage(guildIconURL);
                ctx.save();
                ctx.beginPath();
                ctx.arc(920, 70, 40, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(iconImg, 880, 30, 80, 80);
                ctx.restore();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        } catch (e) {}

        // Top 3 Podium (Always show 3)
        const podiumConfig = [
            { x: 250, y: 300, rank: 2, color: '#C0C0C0', size: 60 },
            { x: 500, y: 250, rank: 1, color: '#FFD700', size: 80 },
            { x: 750, y: 300, rank: 3, color: '#CD7F32', size: 60 }
        ];

        for (const conf of podiumConfig) {
            const dataIndex = (conf.rank === 1) ? 0 : (conf.rank === 2) ? 1 : 2;
            const data = top10[dataIndex];
            
            let name = 'لا يوجد مستخدم';
            let levelText = 'LVL ---';
            let userObj = null;

            if (data) {
                const user = await client.users.fetch(data.userId).catch(() => ({ username: '؟' }));
                const member = await message.guild.members.fetch(data.userId).catch(() => null);
                name = member ? member.displayName : user.username;
                levelText = `LVL ${data.level}`;
                userObj = user;
            }

            ctx.fillStyle = conf.color; ctx.font = `bold ${conf.size - 20}px Cairo`; ctx.textAlign = 'center';
            ctx.fillText(`#${conf.rank}`, conf.x, conf.y - 120);

            if (userObj) {
                try {
                    const avatarURL = userObj.displayAvatarURL({ extension: 'png', size: 128 });
                    const avatarImg = await loadImage(avatarURL);
                    ctx.save(); ctx.beginPath(); ctx.arc(conf.x, conf.y - 20, conf.size, 0, Math.PI * 2, true); ctx.closePath(); ctx.clip();
                    ctx.drawImage(avatarImg, conf.x - conf.size, conf.y - 20 - conf.size, conf.size * 2, conf.size * 2); ctx.restore();
                    ctx.strokeStyle = conf.color; ctx.lineWidth = 5; ctx.stroke();
                } catch (e) {}
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(conf.x, conf.y - 20, conf.size, 0, Math.PI * 2, true); ctx.stroke();
            }

            ctx.fillStyle = userObj ? '#FFFFFF' : 'rgba(255, 255, 255, 0.3)'; ctx.font = 'bold 30px Cairo'; 
            ctx.fillText(fixArabic(name.slice(0, 15)), conf.x, conf.y + conf.size + 40);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.font = '24px Cairo'; 
            ctx.fillText(fixArabic(levelText), conf.x, conf.y + conf.size + 80);

            if (data) {
                const progress = (data.points % 500) / 500;
                const pBarWidth = 100; const pBarHeight = 6;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.fillRect(conf.x - pBarWidth / 2, conf.y + conf.size + 100, pBarWidth, pBarHeight);
                ctx.fillStyle = conf.color;
                ctx.fillRect(conf.x - pBarWidth / 2, conf.y + conf.size + 100, pBarWidth * progress, pBarHeight);
            }
        }

        // Rest 4-10 (Always show 7)
        for (let i = 0; i < 7; i++) {
            const data = top10[i + 3];
            const y = 600 + (i * 80);
            
            let displayName = 'لا يوجد مستخدم';
            let levelText = 'LVL ---';
            let userObj = null;
            let progress = 0;

            if (data) {
                const user = await client.users.fetch(data.userId).catch(() => ({ username: '؟' }));
                const member = await message.guild.members.fetch(data.userId).catch(() => null);
                displayName = member ? member.displayName : user.username;
                levelText = `LVL ${data.level}`;
                userObj = user;
                progress = (data.points % 500) / 500;
            }

            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.roundRect(50, y - 30, 900, 70, 10); ctx.fill();
            
            ctx.fillStyle = userObj ? '#FFFFFF' : 'rgba(255, 255, 255, 0.2)'; ctx.font = 'bold 28px Cairo'; ctx.textAlign = 'left';
            ctx.fillText(fixArabic(levelText), 80, y + 15);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.fillRect(200, y + 5, 150, 10);
            if (userObj) {
                ctx.fillStyle = '#5865F2';
                ctx.fillRect(200, y + 5, 150 * progress, 10);
            }

            ctx.textAlign = 'right'; ctx.fillStyle = userObj ? '#FFFFFF' : 'rgba(255, 255, 255, 0.2)'; ctx.font = '28px Cairo';
            ctx.fillText(fixArabic(displayName.slice(0, 15)), 750, y + 15);
            ctx.fillStyle = data ? '#FFFFFF' : 'rgba(255, 255, 255, 0.1)'; ctx.font = 'bold 30px Cairo';
            ctx.fillText(`#${i + 4}`, 850, y + 15);

            if (userObj) {
                try {
                    const avatarURL = userObj.displayAvatarURL({ extension: 'png', size: 64 });
                    const avatarImg = await loadImage(avatarURL);
                    ctx.save(); ctx.beginPath(); ctx.arc(910, y + 5, 25, 0, Math.PI * 2, true); ctx.closePath(); ctx.clip();
                    ctx.drawImage(avatarImg, 885, y - 20, 50, 50); ctx.restore();
                } catch (e) {}
            }
        }

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'top.png' });
        await message.reply({ files: [attachment] });
    } else if (content === 'تصفير الكل' || content === 'تصفير_الكل') {
        const guildId = message.guildId;
        const config = (await db.get(`guild_config_${guildId}`)) || DEFAULT_CONFIG;
        const isAdmin = message.member.permissions.has('Administrator');

        if (!isAdmin && (!config.commandsRoleId || !message.member.roles.cache.has(config.commandsRoleId))) {
            return message.reply('❌ هذا الأمر مخصص فقط للمسؤولين (أصحاب رتبة الأوامر)!');
        }

        const allData = await db.all();
        let count = 0;
        for (const item of allData) {
            if (item.id.startsWith(`voice_points_${guildId}_`) || item.id.startsWith(`voice_level_${guildId}_`)) {
                await db.delete(item.id);
                count++;
            }
        }
        await message.reply(`✅ تم تصفير جميع النقاط واللفلات بنجاح لجميع الأعضاء (${count} سجل تم حذفه).`);
    }
});

client.login(process.env.TOKEN);
