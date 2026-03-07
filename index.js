import fs from 'fs';
import express from 'express';
import { startCrons } from './crons.js';
import { sendError, handleCommand, upsertGuildConfig } from './commonFunc.js';
import { initReactionRoles, handleReaction } from './reactionRoles.js';
import { handleSetupInteraction } from './commands/setup.js';
import { handleVoiceStateUpdate } from './voiceTracker.js';
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
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.slashCommands = new Collection();

// 설정
const PORT = process.env.PORT;
const TOKEN = process.env.TOKEN;
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

// 봇이 새 서버에 추가될 때
client.on('guildCreate', async (guild) => {
    try {
        await upsertGuildConfig(guild.id, guild.name);
        sendError(`✅ 새 서버 추가: ${guild.name} (${guild.id})`);
    } catch (err) {
        sendError(`⚠️ 서버 설정 저장 실패: ${err?.stack || err}`);
    }
});

// 새 유저 입장 시 안내
client.on('guildMemberAdd', async (member) => {
    try {
        await member.send(
            `🎉 ${member.guild.name} 서버에 오신 것을 환영합니다!`
        );
    } catch (err) {
        sendError(`⚠️ ${member.user.tag}님에게 DM을 보낼 수 없습니다.`);
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

    // 모든 길드에 슬래시 커맨드 등록
    for (const guild of client.guilds.cache.values()) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: slashCommandsData }
            );
            // DB에 길드 설정이 없으면 생성
            await upsertGuildConfig(guild.id, guild.name);
        } catch (error) {
            sendError(`⚠️ ${guild.name} 슬래시 커맨드 등록 오류:`, error);
        }
    }
}

client.on('messageCreate', (message) => handleCommand(message, client));
client.on('messageReactionAdd', (reaction, user) => handleReaction(reaction, user, true));
client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, false));
client.on('voiceStateUpdate', (oldState, newState) => handleVoiceStateUpdate(oldState, newState));

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const command = client.slashCommands.get(interaction.commandName);
            if (!command) return;
            await command.execute(interaction);
            return;
        }
        const customId = interaction.customId || '';
        if (customId.startsWith('setup') || customId.startsWith('select_') || customId.startsWith('modal_role')) {
            await handleSetupInteraction(interaction);
            return;
        }
    } catch (error) {
        sendError(`⚠️ 인터랙션 오류: ${error?.stack || error}`);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 }).catch(() => {});
        }
    }
});

client.login(TOKEN);

const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Web server running!`));

export {supabase, client} ;