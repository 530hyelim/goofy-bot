import 'dotenv/config';
import { supabase } from '../index.js';
import { ActionRowBuilder, StringSelectMenuBuilder, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } from 'discord.js';
import { setUserCollector, clearUserCollector, sendError, upsertUserScore } from '../commonFunc.js';

const MODAL_CUSTOM_ID = 'questionModal_register';

export default {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('문제 등록'),

    async execute(interaction) {
        const author = interaction.user;

        try {
            const modal = new ModalBuilder()
                .setCustomId(MODAL_CUSTOM_ID)
                .setTitle('문제 등록');

            const questionInput = new TextInputBuilder()
                .setCustomId('questionText')
                .setLabel('문제 텍스트')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('문제를 입력하세요')
                .setRequired(true);

            const answerInput = new TextInputBuilder()
                .setCustomId('answerText')
                .setLabel('정답')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('정답을 입력하세요')
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(questionInput),
                new ActionRowBuilder().addComponents(answerInput)
            );

            await interaction.showModal(modal);

            const modalInteraction = await interaction.awaitModalSubmit({
                filter: (i) => i.customId === MODAL_CUSTOM_ID && i.user.id === author.id,
                time: 900000
            }).catch((err) => {
                if (err.code === 'InteractionCollectorError') return null;
                throw err;
            });

            if (!modalInteraction) {
                return;
            }

            const questionText = modalInteraction.fields.getTextInputValue('questionText');
            const answerText = modalInteraction.fields.getTextInputValue('answerText');

            await showCategorySelect(modalInteraction, author.id, questionText, answerText);
        } catch (err) {
            await sendError(`⚠️ register.js Error: ${err?.stack || err}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 }).catch(() => {});
            }
        }
    }
};

/**
 * 1단계: 카테고리 선택
 */
async function showCategorySelect(modalInteraction, authorId, questionText, answerText) {
    const { data: categories, error: catError } = await supabase.from('category').select('*');
    if (catError) throw new Error(catError);
    if (!categories?.length) throw new Error("카테고리가 없습니다!");

    const categoryMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('categorySelect')
            .setPlaceholder('카테고리를 선택하세요')
            .addOptions(categories.map((c) => ({ value: c.cate_no.toString(), label: c.cate_name })))
    );

    const cancelButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('cancelAddQuestion')
            .setLabel('취소')
            .setStyle(ButtonStyle.Danger)
    );

    await modalInteraction.reply({
        content: '카테고리 추가 요청은 `/report` 로 부탁드립니다.',
        components: [categoryMenu, cancelButton],
        flags: 64
    });

    const channel = modalInteraction.channel;

    const collector = channel.createMessageComponentCollector({
        filter: (i) => i.user.id === authorId && (i.customId === 'categorySelect' || i.customId === 'cancelAddQuestion'),
        max: 1,
        time: 60000
    });
    setUserCollector(authorId, collector);

    collector.on('collect', async (selectInteraction) => {
        try {
            if (selectInteraction.customId === 'cancelAddQuestion') {
                await selectInteraction.update({ content: '문제 등록이 취소되었습니다.', components: [], flags: 64 });
                return;
            }
            const selectedCategory = selectInteraction.values[0];
            await showCriteriaSelect(selectInteraction, channel, authorId, selectedCategory, questionText, answerText);
        } catch (err) {
            await sendError(`⚠️ register.js Error: ${err?.stack || err}`);
            await selectInteraction.update({ content: '오류가 발생했습니다.', components: [], flags: 64 }).catch(() => {});
        }
    });

    collector.on('end', () => clearUserCollector(authorId));
}

/**
 * 2단계: 채점기준 선택 후 저장
 */
async function showCriteriaSelect(selectInteraction, channel, authorId, selectedCategory, questionText, answerText) {
    const { data: criteria, error: critError } = await supabase.from('criteria').select('*');
    if (critError) throw new Error(critError);
    if (!criteria?.length) throw new Error("채점기준이 없습니다!");

    const criteriaMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('criteriaSelect')
            .setPlaceholder('채점기준을 선택하세요')
            .addOptions(criteria.map((c) => ({ value: c.crit_no.toString(), label: c.crit_name })))
    );

    const cancelButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('cancelAddQuestion')
            .setLabel('취소')
            .setStyle(ButtonStyle.Danger)
    );

    await selectInteraction.update({
        content: '채점기준 추가 요청은 `/report` 로 부탁드립니다.',
        components: [criteriaMenu, cancelButton],
        flags: 64
    });

    const guildId = selectInteraction.guild?.id;
    const member = selectInteraction.member;

    const collector = channel.createMessageComponentCollector({
        filter: (i) => i.user.id === authorId && (i.customId === 'criteriaSelect' || i.customId === 'cancelAddQuestion'),
        max: 1,
        time: 60000
    });
    setUserCollector(authorId, collector);

    collector.on('collect', async (criteriaInteraction) => {
        try {
            if (criteriaInteraction.customId === 'cancelAddQuestion') {
                await criteriaInteraction.update({ content: '문제 등록이 취소되었습니다.', components: [], flags: 64 });
                return;
            }

            const selectedCriteria = criteriaInteraction.values[0];
            const authorUsername = criteriaInteraction.user.username;

            const { data, error } = await supabase
                .from('questions')
                .insert([{
                    category: selectedCategory,
                    question_text: questionText.replace(/```/g, ''),
                    answer_text: answerText,
                    answer_type: selectedCriteria,
                    author_username: authorUsername
                }])
                .select();

            if (error) throw new Error(error.message);
            if (!data?.length) throw new Error("문제 추가에 실패했습니다!");

            const { data: categoryData } = await supabase
                .from('category')
                .select('add_point')
                .eq('cate_no', selectedCategory)
                .single();

            let sendMessage = "문제가 성공적으로 추가되었습니다! ";
            const displayName = member?.displayName ?? criteriaInteraction.user.username;

            if (categoryData?.add_point) {
                await upsertUserScore(guildId, authorId, displayName, categoryData.add_point);
                sendMessage += `${displayName}님 +${categoryData.add_point} 포인트 👏`;
            }

            await criteriaInteraction.update({ content: sendMessage, components: [], flags: 64 });
        } catch (err) {
            await sendError(`⚠️ register.js Error: ${err?.stack || err}`);
            await criteriaInteraction.update({ content: '오류가 발생했습니다.', components: [], flags: 64 }).catch(() => {});
        }
    });

    collector.on('end', () => clearUserCollector(authorId));
}