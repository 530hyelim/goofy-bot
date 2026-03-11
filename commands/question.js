import 'dotenv/config';
import { supabase, client } from '../index.js';
import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { setUserCollector, clearUserCollector, sendError, getCriteriaHintForDisplay } from '../commonFunc.js';

let correctAnswer;
let questionExpiryTimeoutId = null;

/** 초 단위를 "N분" 또는 "N분 N초" 형식으로 반환 */
function formatValidSeconds(sec) {
    if (sec == null || sec < 0) return null;
    if (sec < 60) return `${sec}초`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (s === 0) return `${m}분`;
    return `${m}분 ${s}초`;
}

/** 남은 밀리초를 "N분 N초 남음" 형식으로 반환 */
function formatRemaining(remainingMs) {
    if (remainingMs <= 0) return null;
    const totalSec = Math.ceil(remainingMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}분 ${sec}초 남음`;
    return `${sec}초 남음`;
}

function formatRegisteredDate(isoString) {
    if (!isoString) return null;
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${y}년 ${m}월 ${day}일`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('question')
        .setDescription('문제 출제'),

    async execute(interaction) {
        try {
            const current = getCorrectAnswer();
            if (current) {
                const { data: cat } = await supabase
                    .from('category')
                    .select('question_valid_seconds')
                    .eq('cate_no', current.category)
                    .single();

                const validSeconds = cat?.question_valid_seconds;
                if (validSeconds != null) {
                    const elapsed = Date.now() - current.issuedAt;
                    const validMs = validSeconds * 1000;
                    if (elapsed >= validMs) {
                        resetCorrectAnswer();
                    } else {
                        const remaining = formatRemaining(validMs - elapsed);
                        await interaction.reply({
                            content: `이미 출제 중인 문제가 있습니다. (${remaining}) 정답을 맞추시거나 시간이 지난 후 다시 시도해 주세요.`,
                            flags: 64
                        });
                        return;
                    }
                } else {
                    await interaction.reply({
                        content: '이미 출제 중인 문제가 있습니다.',
                        flags: 64
                    });
                    return;
                }
            }

            // 카테고리 선택
            const { data: categories, error: categoryError } = await supabase.from('category').select('*');
            
            if (categoryError) throw new Error(categoryError);
            if (!categories || categories.length === 0) throw new Error("카테고리가 없습니다!");

            const categoryOptions = categories.map((category) => {
                const opt = {
                    value: category.cate_no.toString(),
                    label: category.cate_name,
                };
                const parts = [];
                if (category.answer_point != null) parts.push(`정답 +${category.answer_point}점`);
                if (category.question_valid_seconds != null) parts.push(`제한시간: ${formatValidSeconds(category.question_valid_seconds)}`);
                if (parts.length) opt.description = parts.join(' · ').slice(0, 100);
                return opt;
            });

            const categoryMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('questionCategorySelect')
                    .setPlaceholder('문제 카테고리를 선택하세요')
                    .addOptions(categoryOptions)
            );

            // 취소 버튼 생성
            const cancelButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cancelQuestion')
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ components: [categoryMenu, cancelButton], flags: 64 });

            // 카테고리 선택 콜렉터 생성
            const collector = interaction.channel.createMessageComponentCollector({
                filter: (i) => i.user.id === interaction.user.id && (i.customId === 'questionCategorySelect' || i.customId === 'cancelQuestion'),
                max: 1,
                time: 60000
            });
            setUserCollector(interaction.user.id, collector);

            // 카테고리 선택 또는 취소 버튼 클릭 시
            collector.on('collect', async (selectInteraction) => {
                try {
                    if (selectInteraction.customId === 'cancelQuestion') {
                        await selectInteraction.update({ content: '문제 출제가 취소되었습니다.', components: [] });
                        return;
                    }

                    const selectedCategory = selectInteraction.values[0];

                    // 해당 카테고리의 문제 가져오기
                    const { data: questions, error: qErr } = await supabase
                        .from('questions')
                        .select('*')
                        .eq('category', selectedCategory);

                    if (qErr) throw new Error(qErr);
                    if (!questions || questions.length === 0) {
                        await selectInteraction.update({ content: '문제가 없습니다. `/register` 를 통해 문제를 등록해주세요!', components: [] });
                        return;
                    }

                    // 랜덤 문제 선택
                    const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
                    const channelId = interaction.channel.id;
                    correctAnswer = {
                        type: randomQuestion.answer_type,
                        answer: randomQuestion.answer_text,
                        category: selectedCategory,
                        issuedAt: Date.now(),
                        channelId,
                    };

                    const { data: cat } = await supabase
                        .from('category')
                        .select('question_valid_seconds')
                        .eq('cate_no', selectedCategory)
                        .single();
                    if (questionExpiryTimeoutId) clearTimeout(questionExpiryTimeoutId);
                    const issuedAt = correctAnswer.issuedAt;
                    if (cat?.question_valid_seconds != null) {
                        const validMs = cat.question_valid_seconds * 1000;
                        questionExpiryTimeoutId = setTimeout(() => {
                            questionExpiryTimeoutId = null;
                            const current = getCorrectAnswer();
                            if (!current || current.issuedAt !== issuedAt || current.channelId !== channelId) return;
                            const channel = client.channels.cache.get(current.channelId);
                            if (channel) {
                                channel.send(`⏱ 시간이 만료되었습니다. **정답: ${current.answer}**`).catch(() => {});
                            }
                            resetCorrectAnswer();
                        }, validMs);
                    }

                    const authorLabel = randomQuestion.author_username || randomQuestion.author_id;
                    const registeredAt = randomQuestion.created_at
                        ? formatRegisteredDate(randomQuestion.created_at)
                        : null;
                    const footer = [authorLabel, registeredAt].filter(Boolean).join(' · ');
                    const criteriaLine = await getCriteriaHintForDisplay(randomQuestion.answer_type);
                    let problemContent = footer
                        ? "```" + randomQuestion.question_text + "```"
                                + criteriaLine + "\n출제자: " + footer
                        : "```" + randomQuestion.question_text + "```" + criteriaLine;

                    const reportBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`reportQuestion_${randomQuestion.question_id}`)
                            .setLabel('신고')
                            .setStyle(ButtonStyle.Secondary)
                    );

                    await selectInteraction.update({ content: '문제가 출제되었습니다.', components: [] });
                    await interaction.channel.send({ content: problemContent, components: [reportBtn] });

                } catch (err) {
                    await sendError(`⚠️ question.js Error: ${err?.stack || err}`, selectInteraction.guildId);
                }
            });
            collector.on('end', () => {
                clearUserCollector(interaction.user.id);
            });

        } catch (err) {
            await sendError(`⚠️ question.js Error: ${err?.stack || err}`, interaction.guildId);
            if (!interaction.replied) {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 });
            }
        }
    }
};

export function getCorrectAnswer() {
    return correctAnswer;
}

export function resetCorrectAnswer() {
    if (questionExpiryTimeoutId) {
        clearTimeout(questionExpiryTimeoutId);
        questionExpiryTimeoutId = null;
    }
    correctAnswer = null;
}
