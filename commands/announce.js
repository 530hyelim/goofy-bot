import 'dotenv/config';
import {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} from 'discord.js';
import { client } from '../index.js';
import { getAllGuildConfigs, sendError } from '../utils/commonFunc.js';

const BROADCAST_MODAL_ID = 'announcementModal';

function isSuperAdmin(userId) {
    return userId == '1363221777278304577';
}

/** 이 명령은 서버장이 최고관리자인 길드에만 슬래시로 등록됨 */
export default {
    ownerOnly: true,
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('전체 공지'),

    async execute(interaction) {
        if (!isSuperAdmin(interaction.user.id)) {
            return interaction.reply({ content: '❌ 이 명령은 최고 관리자만 사용할 수 있습니다.', flags: 64 });
        }

        const modal = new ModalBuilder()
            .setCustomId(BROADCAST_MODAL_ID)
            .setTitle('전체 공지사항');

        const titleInput = new TextInputBuilder()
            .setCustomId('announcementTitle')
            .setLabel('제목')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('전체 공지사항')
            .setRequired(false)
            .setMaxLength(256);

        const contentInput = new TextInputBuilder()
            .setCustomId('announcementContent')
            .setLabel('내용')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('공지 내용을 입력하세요.')
            .setRequired(true)
            .setMaxLength(4000);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(contentInput)
        );
        await interaction.showModal(modal);
    },
};

/** 모달 제출 시 공지 전송 (임베드로 전송) */
export async function handleBroadcastModal(interaction) {
    if (!interaction.isModalSubmit() || interaction.customId !== BROADCAST_MODAL_ID) return;
    if (!isSuperAdmin(interaction.user.id)) {
        return interaction.reply({ content: '❌ 권한이 없습니다.', flags: 64 });
    }

    const title = interaction.fields.getTextInputValue('announcementTitle')?.trim() || '전체 공지사항';
    const content = interaction.fields.getTextInputValue('announcementContent')?.trim();
    if (!content) {
        return interaction.reply({ content: '❌ 공지 내용을 입력해주세요.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    try {
        const configs = await getAllGuildConfigs();
        const configByGuild = new Map(configs.map((c) => [c.guild_id, c]));

        const message = `## 📢 **${title}**\n\n${content}`;
        let sent = 0;
        const failed = [];

        for (const guild of client.guilds.cache.values()) {
            const config = configByGuild.get(guild.id);
            const channelId = config?.general_channel_id;
            if (!channelId) {
                failed.push({ name: guild.name, reason: '공지 채널 미설정' });
                continue;
            }
            const channel = client.channels.cache.get(channelId);
            if (!channel) {
                failed.push({ name: guild.name, reason: '채널을 찾을 수 없음' });
                continue;
            }
            try {
                await channel.send(message);
                sent++;
            } catch (err) {
                failed.push({ name: guild.name, reason: err?.message || '전송 실패' });
                await sendError(`announce 실패 (${guild.name}): ${err?.message || err}`, guild.id);
            }
        }

        let reply = `✅ **공지 전송 완료**\n전송: **${sent}**개 서버`;
        if (failed.length > 0) {
            reply += `\n실패: **${failed.length}**개 서버\n`;
            reply += failed.slice(0, 10).map((f) => `• ${f.name}: ${f.reason}`).join('\n');
            if (failed.length > 10) reply += `\n… 외 ${failed.length - 10}개`;
        }
        reply += '.';

        return interaction.editReply(reply);
    } catch (err) {
        await sendError(`⚠️ announce Error: ${err?.stack || err}`, interaction.guildId);
        return interaction.editReply('공지 전송 중 오류가 발생했습니다.').catch(() => {});
    }
}
