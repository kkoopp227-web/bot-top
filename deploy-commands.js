const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('top')
        .setDescription('عرض قائمة المتصدرين (الأفضل 10)')
        .addUserOption(option => option.setName('user').setDescription('الشخص المراد رؤية ترتيبه')),
    new SlashCommandBuilder()
        .setName('توب')
        .setDescription('عرض قائمة المتصدرين (الأفضل 10)')
        .addUserOption(option => option.setName('user').setDescription('الشخص المراد رؤية ترتيبه')),
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('إعدادات نقاط الصوت والمدة والخلفية'),
    new SlashCommandBuilder()
        .setName('تصفير_الكل')
        .setDescription('حذف جميع نقاط ولفلات الأعضاء (للمسؤولين فقط)'),
]
    .map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;

        if (guildId) {
            // Register to a specific guild for instant updates (better for testing)
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );
            console.log('Successfully reloaded application (/) commands for GUILD.');
        } else {
            // Register globally
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
            console.log('Successfully reloaded application (/) commands GLOBALLY.');
        }

    } catch (error) {
        console.error(error);
    }
})();
