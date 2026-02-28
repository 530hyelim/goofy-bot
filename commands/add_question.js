import 'dotenv/config';
import { supabase } from '../index.js';
import { EmbedBuilder, ActionRowBuilder, SelectMenuBuilder } from 'discord.js';
import { setUserCollector, clearUserCollector, sendError, upsertUserScore } from '../commonFunc.js';

export default {
    name: 'add_question',
    description: '문제 등록',
    async execute(message, args) {
        const author = message.author;
        let admins = message.guild.members.cache.filter(member => member.permissions.has(process.env.ROLE_ADMIN_ID));

        if (!admins || admins.size === 0) {
            const members = await message.guild.members.fetch();
            admins = members.filter(member => member.permissions.has(process.env.ROLE_ADMIN_ID));
        }
        if (!admins.some(admin => admin.id === author.id)) return message.reply("권한이 없습니다!");

        try {
            // 카테고리 불러오기
            const { data: categories, error: selectError } = await supabase.from('category').select('*');
            if (selectError) throw new Error(selectError);
            if (!categories || categories.length === 0) throw new Error("카테고리가 없습니다!");

            const categoryOptions = categories.map((category) => ({
                value: category.cate_no.toString(),
                label: category.cate_name,
            }));

            const categoryMenu = new ActionRowBuilder().addComponents(
                new SelectMenuBuilder()
                    .setCustomId('categorySelect')
                    .setPlaceholder('카테고리를 선택하세요!')
                    .addOptions(categoryOptions)
            );

            await message.reply({ components: [categoryMenu] });

            const interactionFilter = (interaction) => interaction.user.id === message.author.id;
            const messageFilter = (msg) => msg.author.id === message.author.id;

            // 카테고리 선택 콜렉터
            const collector = message.channel.createMessageComponentCollector({ filter: interactionFilter });
            setUserCollector(message.author.id, collector);

            collector.on('collect', async (interaction) => {
                try {
                    if (interaction.customId === 'categorySelect') {
                        await insertQuestion(interaction, message, messageFilter);
                    }
                } catch (err) {
                    await sendError(`add_question.js Error: ${err?.stack || err}`);
                } finally {
                    collector.stop();
                }
            });
            collector.on('end', () => {
                clearUserCollector(message.author.id);
            });
        } catch (err) {
            await sendError(`add_question.js Error: ${err?.stack || err}`);
        }
    }
};

async function insertQuestion(interaction, message, messageFilter) {
    let selectedCategory = interaction.values[0];

    // 문제 입력받기
    await interaction.reply({ content: '문제 텍스트를 입력하세요. (취소하려면 "취소" 입력)', flags: 64 });
    const collectedQuestion = await message.channel.awaitMessages({
        filter: messageFilter,
        max: 1,
        time: 60000
    }).then((collected) => collected.first()).catch(() => null);

    const collectedQuestionText = collectedQuestion?.content?.trim();
    if (!collectedQuestionText) return interaction.followUp({ content: '문제 텍스트를 입력하지 않았습니다.', flags: 64 });
    if (collectedQuestionText === '취소') {
        await collectedQuestion.delete();
        return interaction.followUp({ content: '문제 등록이 취소되었습니다.', flags: 64 });
    }
    await collectedQuestion.delete();

    // 정답 입력받기
    await interaction.followUp({ content: '정답을 입력하세요. (취소하려면 "취소" 입력)', flags: 64 });
    const collectedAnswer = await message.channel.awaitMessages({
        filter: messageFilter,
        max: 1,
        time: 60000
    }).then((collected) => collected.first()).catch(() => null);

    const collectedAnswerText = collectedAnswer?.content?.trim();
    if (!collectedAnswerText) return interaction.followUp({ content: '정답을 입력하지 않았습니다.', flags: 64 });
    if (collectedAnswerText === '취소') {
        await collectedAnswer.delete();
        return interaction.followUp({ content: '문제 등록이 취소되었습니다.', flags: 64 });
    }
    await collectedAnswer.delete();

    // 채점기준 불러오기
    const { data: criteria, error: selectError } = await supabase.from('criteria').select('*');
    if (selectError) throw new Error(selectError);
    if (!criteria || criteria.length === 0) throw new Error("채점기준이 없습니다!");

    const embed = new EmbedBuilder().setDescription('적절한 채점 기준이 없다면, 관리자에게 문의해주세요.');
    const criteriaOptions = criteria.map((type) => ({
        value: type.crit_no.toString(),
        label: type.crit_name,
    }));

    const criteriaMenu = new ActionRowBuilder().addComponents(
        new SelectMenuBuilder()
            .setCustomId('criteriaSelect')
            .setPlaceholder('채점기준을 선택하세요!')
            .addOptions(criteriaOptions)
    );

    await interaction.followUp({ embeds: [embed], components: [criteriaMenu] });

    // 채점기준 선택 콜렉터
    const criteriaCollector = message.channel.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, max: 1, time: 60000 });
    setUserCollector(message.author.id, criteriaCollector);
    criteriaCollector.on('collect', async (criteriaInteraction) => {
        try {
            if (criteriaInteraction.customId === 'criteriaSelect') {
                const selectedCriteria = criteriaInteraction.values[0];
                const { data, error } = await supabase
                    .from('questions')
                    .insert([{
                        category: selectedCategory,
                        question_text: collectedQuestionText,
                        answer_text: collectedAnswerText,
                        answer_type: selectedCriteria
                    }])
                    .select();

                if (error) throw new Error(error.message);
                if (!data || data.length === 0) throw new Error("문제 추가에 실패했습니다!");
                await upsertUserScore(message.author.id, message.author.username, 1);
                await criteriaInteraction.reply({ content: `문제가 성공적으로 추가되었습니다! ${message.author.username}님 +1 포인트`, flags: 64 });
            }
        } catch (err) {
            await sendError(`add_question.js Error: ${err?.stack || err}`);
        } finally {
            criteriaCollector.stop();
        }
    });
    criteriaCollector.on('end', () => {
        clearUserCollector(message.author.id);
    });
}