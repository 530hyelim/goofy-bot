import fs from 'fs';
import express from 'express';
import { startCrons } from './services/crons.js';
import { sendError, handleCommand, upsertGuildConfig, getGuildConfig, clearGuildConfigCache } from './utils/commonFunc.js';
import { initReactionRoles, handleReaction } from './services/reactionRoles.js';
import { handleSetupInteraction } from './commands/setup.js';
import { handleReportInteraction } from './commands/report.js';
import { handleVoiceStateUpdate } from './services/voiceTracker.js';
import { createClient } from '@supabase/supabase-js';
import { Client, GatewayIntentBits, Partials, Collection, REST, Routes, ChannelType, PermissionFlagsBits, OverwriteType } from 'discord.js';
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
    console.log(`🤖 로그인 완료: ${client.user.tag} (PORT: ${process.env.PORT})`);

    client.user.setPresence({
        status: 'online',
    });

    await initReactionRoles(client);
    await loadCommands();
    startCrons();
});

// 봇이 새 서버에 추가될 때
client.on('guildCreate', async (guild) => {
    try {
        await registerCommandsForGuild(guild.id);
        await upsertGuildConfig(guild.id, guild.name);
        const config = await getGuildConfig(guild.id);

        const requiredIds = [config?.log_channel_id, config?.general_channel_id, config?.study_room_id].filter(Boolean);
        const allChannelsExist = requiredIds.length === 3 && requiredIds.every((id) => guild.channels.cache.has(id));

        if (!allChannelsExist) {
            try {
                const category = await guild.channels.create({
                    name: 'Goofy Bot',
                    type: ChannelType.GuildCategory,
                });
                const textChannelOverwrites = [
                    { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.SendMessages] },
                    { id: client.user.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.SendMessages] },
                ];
                const voiceDenyOverwrites = [
                    { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.Speak, PermissionFlagsBits.UseSoundboard] },
                ];
                const [generalCh, logCh, studyRoomCh] = await Promise.all([
                    guild.channels.create({
                        name: '공지사항',
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites: textChannelOverwrites,
                    }),
                    guild.channels.create({
                        name: '로그',
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites: textChannelOverwrites,
                    }),
                    guild.channels.create({
                        name: '독서실',
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        permissionOverwrites: voiceDenyOverwrites,
                    }),
                ]);
                await upsertGuildConfig(guild.id, guild.name, {
                    general_channel_id: generalCh.id,
                    log_channel_id: logCh.id,
                    study_room_id: studyRoomCh.id,
                });
                clearGuildConfigCache(guild.id);
                sendError(`🤖: 저를 ${guild.name}에 초대해주셔서 감사해요!`, guild.id);
            } catch (channelErr) {
                sendError(`⚠️ ${guild.name} 채널 자동 생성 실패 (권한 확인): ${channelErr?.stack || channelErr}`, guild.id);
            }
        } else {
            sendError(`🤖: 다시 만나서 반가워요!`, guild.id);
        }
    } catch (err) {
        sendError(`⚠️ 서버 설정 저장 실패: ${err?.stack || err}`, guild.id);
    }
});

// 새 유저 입장 시 안내
client.on('guildMemberAdd', async (member) => {
    try {
        const config = await getGuildConfig(member.guild.id);
        let welcomeMessage = `🎉 **${member.guild.name}** 서버에 오신 것을 환영합니다!`;
        const roleChannelExists = config?.role_channel_id && member.guild.channels.cache.has(config.role_channel_id);
        if (roleChannelExists && config.role_message_id) {
            const roleLink = `https://discord.com/channels/${member.guild.id}/${config.role_channel_id}/${config.role_message_id}`;
            welcomeMessage += `\n\n🎭 [여기를 클릭](${roleLink})하여 역할을 선택해주세요!`;
        } else if (roleChannelExists) {
            welcomeMessage += `\n\n🎭 <#${config.role_channel_id}> 채널에서 역할을 선택해주세요!`;
        }
        await member.send(welcomeMessage);
    } catch (err) {
        sendError(`⚠️ ${member.user.tag}님에게 DM을 보낼 수 없습니다.`, member.guild.id);
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
            sendError(`⚠️ 슬래시 커맨드 등록 오류: ${error?.stack || error}`, guild.id);
        }
    }
}

/** 새로 추가된 길드에 슬래시 커맨드 등록 (guildCreate에서 호출) */
async function registerCommandsForGuild(guildId) {
    const slashCommandsData = Array.from(client.slashCommands.values()).map((c) => c.data.toJSON());
    if (slashCommandsData.length === 0) return;
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: slashCommandsData });
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
        if (customId.startsWith('report')) {
            await handleReportInteraction(interaction);
            return;
        }
        if (customId.startsWith('setup') || customId.startsWith('select_') || customId.startsWith('modal_role')) {
            await handleSetupInteraction(interaction);
            return;
        }
    } catch (error) {
        sendError(`⚠️ 인터랙션 오류: ${error?.stack || error}`, interaction.guildId);
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