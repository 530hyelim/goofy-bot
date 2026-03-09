import 'dotenv/config';
import {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { getGuildConfig, sendError } from '../commonFunc.js';
import { client } from '../index.js';

const REPORT_TYPE = {
    CATEGORY: 'category',
    CRITERIA: 'criteria',
    BUG: 'bug',
    OTHER: 'other',
};

/** 모든 리포트를 받을 로그 서버 */
const REPORT_LOG_GUILD_ID = '1378367135230984252';

/** 문제 신고 버튼 클릭 → 모달 표시 */
async function showQuestionReportModal(interaction) {
    const questionId = interaction.customId.replace('reportQuestion_', '');

    const modal = new ModalBuilder()
        .setCustomId(`reportQuestionModal_${questionId}`)
        .setTitle('문제 신고');

    const reasonInput = new TextInputBuilder()
        .setCustomId('reportReason')
        .setLabel('신고 사유')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('이상한 점이나 오류를 간단히 적어주세요.')
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
}

/** 문제 신고 모달 제출 → 로그 채널로 전송 */
async function handleQuestionReportSubmit(interaction) {
    const match = interaction.customId.match(/^reportQuestionModal_(.*)$/);
    const questionId = match ? match[1] : '';
    const reason = interaction.fields.getTextInputValue('reportReason');

    const embedContent =
        `📛 **문제 신고**\n` +
        `질문 ID: ${questionId || '(없음)'}\n` +
        `신고자: ${interaction.user.tag} (${interaction.user.id})\n` +
        `사유: ${reason}`;

    await sendReportToLog(interaction.guildId, embedContent);
    await interaction.reply({ content: '신고가 접수되었습니다. 검토 후 조치하겠습니다.', flags: 64 });
}

/** 문의(/report) 실행: 타입 선택 메뉴 표시 */
async function showReportTypeMenu(interaction) {
    const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reportTypeSelect')
            .setPlaceholder('문의 유형을 선택하세요')
            .addOptions(
                { value: REPORT_TYPE.CATEGORY, label: '카테고리 추가 요청' },
                { value: REPORT_TYPE.CRITERIA, label: '채점기준 추가 요청' },
                { value: REPORT_TYPE.BUG, label: '버그 신고' },
                { value: REPORT_TYPE.OTHER, label: '기타' }
            )
    );
    await interaction.reply({ components: [menu], flags: 64 });
}

const REPORT_TYPE_LABELS = {
    [REPORT_TYPE.CATEGORY]: '카테고리',
    [REPORT_TYPE.CRITERIA]: '채점기준',
    [REPORT_TYPE.BUG]: '버그 신고',
    [REPORT_TYPE.OTHER]: '기타',
};

/** 문의 유형 선택 후 모달 표시 */
async function showReportRequestModal(interaction) {
    const reportType = interaction.values[0];
    const label = REPORT_TYPE_LABELS[reportType] || reportType;
    const isBug = reportType === REPORT_TYPE.BUG;
    const isOther = reportType === REPORT_TYPE.OTHER;
    const modalTitle = isBug ? '버그 신고' : isOther ? '기타 문의' : `${label} 추가 요청`;
    const inputLabel = isBug ? '버그 내용 (가능하면 로그 채널 에러 로그를 복사해주세요)' : isOther ? '문의 내용' : `추가를 원하는 ${label} 이름 또는 설명`;
    const placeholder = isBug ? '발생 상황, 재현 방법, 에러 로그 등을 적어주세요.' : isOther ? '문의하실 내용을 입력해주세요.' : '예: 새 카테고리명 또는 채점기준 설명';

    const modal = new ModalBuilder()
        .setCustomId(`reportRequestModal_${reportType}`)
        .setTitle(modalTitle);

    const input = new TextInputBuilder()
        .setCustomId('requestContent')
        .setLabel(inputLabel)
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(placeholder)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

/** 문의 모달 제출 → 로그 채널로 전송 */
async function handleReportRequestSubmit(interaction) {
    const match = interaction.customId.match(/^reportRequestModal_(.+)$/);
    const reportType = match ? match[1] : 'unknown';
    const typeLabel = REPORT_TYPE_LABELS[reportType] || reportType;
    const isBug = reportType === REPORT_TYPE.BUG;
    const isOther = reportType === REPORT_TYPE.OTHER;
    const title = isBug ? '버그 신고' : isOther ? '기타 문의' : `${typeLabel} 추가 요청`;

    const content = interaction.fields.getTextInputValue('requestContent');

    const embedContent =
        `📋 **${title}**\n` +
        `유형: ${typeLabel}\n` +
        `요청자: ${interaction.user.tag} (${interaction.user.id})\n` +
        `내용: ${content}`;

    await sendReportToLog(interaction.guildId, embedContent);
    await interaction.reply({ content: '요청이 접수되었습니다. 검토 후 반영하겠습니다.', flags: 64 });
}

async function sendReportToLog(sourceGuildId, content) {
    try {
        if (!client.isReady()) return;

        const config = await getGuildConfig(REPORT_LOG_GUILD_ID);
        const logChannel = config?.log_channel_id && client.channels.cache.get(config.log_channel_id);
        const withSource = sourceGuildId ? `\n발생 서버 ID: ${sourceGuildId}` : '';

        if (logChannel) {
            await logChannel.send(content + withSource);
        } else {
            await sendError(`[Report] 로그 채널이 설정되지 않았습니다. (guild: ${REPORT_LOG_GUILD_ID})\n${content}`, sourceGuildId);
        }
    } catch (err) {
        await sendError(`⚠️ report.js sendReportToLog: ${err?.stack || err}`, sourceGuildId);
    }
}

export async function handleReportInteraction(interaction) {
    const id = interaction.customId || '';

    if (id.startsWith('reportQuestion_') && !id.startsWith('reportQuestionModal_')) {
        await showQuestionReportModal(interaction);
        return;
    }
    if (id.startsWith('reportQuestionModal_')) {
        await handleQuestionReportSubmit(interaction);
        return;
    }
    if (id === 'reportTypeSelect') {
        await showReportRequestModal(interaction);
        return;
    }
    if (id.startsWith('reportRequestModal_')) {
        await handleReportRequestSubmit(interaction);
        return;
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('문의사항'),

    async execute(interaction) {
        try {
            await showReportTypeMenu(interaction);
        } catch (err) {
            await sendError(`⚠️ report.js execute: ${err?.stack || err}`, interaction.guildId);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 }).catch(() => {});
            }
        }
    },
};
