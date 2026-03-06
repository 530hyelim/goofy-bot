import 'dotenv/config';
import { EmbedBuilder } from 'discord.js';
import { sendError } from './commonFunc.js';

// 이모지 → 역할 매핑
const reactionRoles = {
    '🎮': process.env.ROLE_GAME_ID,
    '💼': process.env.ROLE_STUDY_ID,
};
const description = '🎮 게이머\n💼 취준스터디';

let roleMessageId = process.env.ROLE_MESSAGE_ID || '';

/**
 * 역할 선택 메시지 초기화
 */
export async function initReactionRoles(client) {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return sendError('⚠️ 서버를 찾을 수 없습니다.');

    const channel = guild.channels.cache.get(process.env.ROLE_CHANNEL_ID);
    if (!channel) return sendError('⚠️ 역할 선택 채널을 찾을 수 없습니다.');

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
        sendError(`✅ 역할 선택 메시지 생성 완료 (ID: ${roleMessageId})`);
    } else {
        sendError(`✅ 기존 역할 선택 메시지 사용 (ID: ${roleMessageId})`);
    }
}

/**
 * 리액션 역할 부여 / 제거
 */
export async function handleReaction(reaction, user, add) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const roleId = reactionRoles[reaction.emoji.name];
    if (!roleId) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);

    if (add) await member.roles.add(roleId);
    else await member.roles.remove(roleId);

    // 로그 전송
    const logChannel = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
    if (logChannel) {
        const action = add ? '역할 부여' : '역할 제거';
        logChannel.send(`${add ? '✅' : '❌'} **${member.user.tag}**님이 ${reaction.emoji.name}를 ${action}했습니다.`);
    }
}
