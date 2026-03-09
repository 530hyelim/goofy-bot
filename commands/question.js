import 'dotenv/config';
import { supabase } from '../index.js';
import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { setUserCollector, clearUserCollector, sendError } from '../commonFunc.js';

let correctAnswer;

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
            // 카테고리 선택
            const { data: categories, error: categoryError } = await supabase.from('category').select('*');
            
            if (categoryError) throw new Error(categoryError);
            if (!categories || categories.length === 0) throw new Error("카테고리가 없습니다!");

            const categoryOptions = categories.map((category) => ({
                value: category.cate_no.toString(),
                label: category.cate_name,
            }));

            const categoryMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('questionCategorySelect')
                    .setPlaceholder('카테고리를 선택하세요!')
                    .addOptions(categoryOptions)
            );

            // 취소 버튼 생성
            const cancelButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cancelQuestion')
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ content: '문제 카테고리를 선택하세요.', components: [categoryMenu, cancelButton], flags: 64 });

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
                    correctAnswer = {
                        type: randomQuestion.answer_type,
                        answer: randomQuestion.answer_text,
                        category: selectedCategory,
                    };

                    const authorLabel = randomQuestion.author_username || randomQuestion.author_id;
                    const registeredAt = randomQuestion.created_at
                        ? formatRegisteredDate(randomQuestion.created_at)
                        : null;
                    const footer = [authorLabel, registeredAt].filter(Boolean).join(' · ');
                    const problemContent = footer
                        ? "```" + randomQuestion.question_text + "```\n출제자: " + footer
                        : "```" + randomQuestion.question_text + "```";

                    const reportBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`reportQuestion_${randomQuestion.question_id}`)
                            .setLabel('신고')
                            .setStyle(ButtonStyle.Secondary)
                    );

                    await selectInteraction.update({ content: '문제가 출제되었습니다.', components: [] });
                    await interaction.channel.send({ content: problemContent, components: [reportBtn] });

                } catch (err) {
                    await sendError(`⚠️ question.js Error: ${err?.stack || err}`);
                }
            });
            collector.on('end', () => {
                clearUserCollector(interaction.user.id);
            });

        } catch (err) {
            await sendError(`⚠️ question.js Error: ${err?.stack || err}`);
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
    correctAnswer = null;
}
