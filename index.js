import fs from 'fs';
import express from 'express';
import { startCrons } from './crons.js';
import { sendError, handleCommand } from './commonFunc.js';
import { initReactionRoles, handleReaction } from './reactionRoles.js';
import { createClient } from '@supabase/supabase-js';
import { Client, GatewayIntentBits, Partials, ActivityType, Collection, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.slashCommands = new Collection();

// 설정
const PORT = process.env.PORT || 10000;
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

client.once('clientReady', async () => {
    sendError(`🤖 로그인 완료: ${client.user.tag} (PORT: ${process.env.PORT})`);

    client.user.setPresence({
        activities: [{ name: '🎮 Lost Ark', type: ActivityType.Playing }],
        status: 'online',
    });

    await initReactionRoles(client);
    await loadCommands();
    startCrons();
});

// 새 유저 입장 시 안내
client.on('guildMemberAdd', async (member) => {
    try {
        await member.send(
            `🎉 KH 자바스터디 G반 서버에 오신 것을 환영합니다!\n` +
            `역할 선택은 <#${process.env.ROLE_CHANNEL_ID}> 채널에서 가능합니다.\n` +
            `아래 메시지에서 원하는 역할의 이모지를 눌러주세요!`
        );
    } catch (err) {
        sendError(`⚠️ ${member.user.tag}님에게 DM을 보낼 수 없습니다.`, err);
    }
});

async function loadCommands() { 
    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js')); 
    const slashCommandsData = [];

    for (const file of commandFiles) { 
        try { 
            const { default: command } = await import(`./commands/${file}`); 
            if (command.data) {
                client.slashCommands.set(command.data.name, command);
                slashCommandsData.push(command.data.toJSON());
            }
        } catch (error) { 
            sendError(`⚠️ ${file} 명령어 로딩 오류:`, error); 
        } 
    }

    if (slashCommandsData.length === 0) return;
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: slashCommandsData }
        );
    } catch (error) {
        sendError(`⚠️ 슬래시 커맨드 등록 오류:`, error);
    }
}

client.on('messageCreate', (message) => handleCommand(message, client));
client.on('messageReactionAdd', (reaction, user) => handleReaction(reaction, user, true));
client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, false));

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = client.slashCommands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction);
        } catch (error) {
            sendError(`⚠️ 슬래시 커맨드 오류: ${error?.stack || error}`);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '오류가 발생했습니다.', flags: 64 });
            } else {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 });
            }
        }
    }
});

client.login(TOKEN);

const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Web server running!`));

export {supabase, client} ;