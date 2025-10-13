import express from 'express';
import { Client, GatewayIntentBits, Partials, EmbedBuilder, ActivityType } from 'discord.js';
import 'dotenv/config';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// 설정
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ROLE_CHANNEL_ID = process.env.ROLE_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
let roleMessageId = process.env.ROLE_MESSAGE_ID || '';

// 기본 이모지 → 역할 매핑
let reactionRoles = {
    '🎮': process.env.ROLE_GAME_ID,
    '💼': process.env.ROLE_STUDY_ID,
};
const description = '🎮 게이머\n💼 취준스터디';

// 봇 로그인
client.once('clientReady', async () => {
    console.log(`🤖 로그인 완료: ${client.user.tag}`);

    // "플레이중" 상태 설정
    client.user.setPresence({
        activities: [{ name: 'Lost Ark', type: ActivityType.Playing }],
        status: 'idle', // online, idle, dnd, invisible
    });

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.log('⚠️ 서버를 찾을 수 없습니다.');

    const channel = guild.channels.cache.get(ROLE_CHANNEL_ID);
    if (!channel) return console.log('⚠️ 역할 선택 채널을 찾을 수 없습니다.');

    // 역할 선택 메시지 생성 또는 가져오기
    let message;
    if (roleMessageId) {
        message = await channel.messages.fetch(roleMessageId).catch(() => null);
    }

    if (!message) {
        const embed = new EmbedBuilder()
            .setTitle('아래 이모지를 눌러 원하는 역할 (중복 가능)을 선택하세요!')
            .setDescription(description)
            .setColor('#5865F2');

        message = await channel.send({ embeds: [embed] });

        // 모든 이모지 추가
        for (const emoji of Object.keys(reactionRoles)) {
            await message.react(emoji);
        }

        roleMessageId = message.id;
        console.log(`✅ 역할 선택 메시지 생성 완료 (ID: ${roleMessageId})`);
    } else {
        console.log(`✅ 기존 역할 선택 메시지 사용 (ID: ${roleMessageId})`);
    }
});

// 새 유저 입장 시 안내
client.on('guildMemberAdd', async (member) => {
    try {
        // DM으로 안내
        await member.send(
            `🎉 KH 자바스터디 G반 서버에 오신 것을 환영합니다!\n` +
            `역할 선택은 <#${ROLE_CHANNEL_ID}> 채널에서 가능합니다.\n` +
            `아래 메시지에서 원하는 역할의 이모지를 눌러주세요!`
        );
    } catch (err) {
        console.log(`⚠️ ${member.user.tag}님에게 DM을 보낼 수 없습니다.`, err);
    }
});

// 리액션 역할 부여 / 제거 + 로그
async function handleReaction(reaction, user, add) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const roleId = reactionRoles[reaction.emoji.name];
    if (!roleId) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);

    if (add) await member.roles.add(roleId);
    else await member.roles.remove(roleId);

    // 로그 전송
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
        const action = add ? '역할 부여' : '역할 제거';
        logChannel.send(`${add ? '✅' : '❌'} **${member.user.tag}**님이 ${reaction.emoji.name}를 ${action}했습니다.`);
    }
}

client.on('messageReactionAdd', (reaction, user) => handleReaction(reaction, user, true));
client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, false));

client.login(TOKEN);

// Express 서버
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Web server running on port ${PORT}`));

// Self-ping
const REPL_URL = process.env.REPL_URL;
if (REPL_URL) {
    setInterval(() => {
        fetch(REPL_URL)
            .then(() => console.log('⏱ Pinged server to stay alive'))
            .catch(err => console.log('⚠️ Ping failed:', err));
    }, 60000); // 1분
}
