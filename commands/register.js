import 'dotenv/config';
import { supabase } from '../index.js';
import { ActionRowBuilder, StringSelectMenuBuilder, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } from 'discord.js';
import { setUserCollector, clearUserCollector, sendError, upsertUserScore } from '../commonFunc.js';

export default {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('문제 등록'),

    async execute(interaction) {
        const author = interaction.user;

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
                new StringSelectMenuBuilder()
                    .setCustomId('categorySelect')
                    .setPlaceholder('카테고리를 선택하세요!')
                    .addOptions(categoryOptions)
            );

            const cancelButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cancelAddQuestion')
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ content: "적절한 카테고리가 없다면, 관리자에게 문의해주세요.", components: [categoryMenu, cancelButton], flags: 64 });

            // 카테고리 선택 콜렉터 생성
            const collector = interaction.channel.createMessageComponentCollector({
                filter: (i) => i.user.id === author.id && (i.customId === 'categorySelect' || i.customId === 'cancelAddQuestion'),
                max: 1,
                time: 60000
            });
            setUserCollector(author.id, collector);

            // 카테고리 선택 또는 취소 버튼 클릭 시
            collector.on('collect', async (selectInteraction) => {
                try {
                    if (selectInteraction.customId === 'cancelAddQuestion') {
                        await selectInteraction.update({ content: '문제 등록이 취소되었습니다.', components: [], flags: 64 });
                        return;
                    }
                    const selectedCategory = selectInteraction.values[0];
                    await showQuestionModal(selectInteraction, interaction, selectedCategory);
                } catch (err) {
                    await sendError(`add_question.js Error: ${err?.stack || err}`);
                }
            });
            collector.on('end', () => {
                clearUserCollector(author.id);
            });
        } catch (err) {
            await sendError(`add_question.js Error: ${err?.stack || err}`);
            if (!interaction.replied) {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 });
            }
        }
    }
};

/**
 * 문제/정답 입력 모달 표시
 * @param {Interaction} selectInteraction - 카테고리 선택 인터랙션
 * @param {Interaction} originalInteraction - 원본 슬래시 커맨드 인터랙션
 * @param {string} selectedCategory - 선택된 카테고리 번호
 */
async function showQuestionModal(selectInteraction, originalInteraction, selectedCategory) {
    const modal = new ModalBuilder()
        .setCustomId(`questionModal_${selectedCategory}`)
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

    const firstRow = new ActionRowBuilder().addComponents(questionInput);
    const secondRow = new ActionRowBuilder().addComponents(answerInput);

    modal.addComponents(firstRow, secondRow);
    await selectInteraction.showModal(modal);

    try {
        // 모달 제출 대기 (최대시간 15분)
        const modalInteraction = await selectInteraction.awaitModalSubmit({
            filter: (i) => i.customId === `questionModal_${selectedCategory}` && i.user.id === selectInteraction.user.id,
            time: 900000
        });

        await originalInteraction.editReply({ content: '카테고리가 선택되었습니다.', components: [] });

        // 입력값 추출
        const questionText = modalInteraction.fields.getTextInputValue('questionText');
        const answerText = modalInteraction.fields.getTextInputValue('answerText');

        // 채점기준 선택 단계로 이동
        await showCriteriaSelect(modalInteraction, originalInteraction, selectedCategory, questionText, answerText);
    } catch (err) {
        if (err.code === 'InteractionCollectorError') {
            await selectInteraction.followUp({ content: '시간이 초과되었습니다.', flags: 64 });
        } else {
            throw err;
        }
    }
}

/**
 * 채점기준 선택 메뉴 표시 및 문제 저장
 * @param {Interaction} modalInteraction - 모달 제출 인터랙션
 * @param {Interaction} originalInteraction - 원본 슬래시 커맨드 인터랙션
 * @param {string} selectedCategory - 선택된 카테고리 번호
 * @param {string} questionText - 입력된 문제 텍스트
 * @param {string} answerText - 입력된 정답
 */
async function showCriteriaSelect(modalInteraction, originalInteraction, selectedCategory, questionText, answerText) {
    const { data: criteria, error: selectError } = await supabase.from('criteria').select('*');
    if (selectError) throw new Error(selectError);
    if (!criteria || criteria.length === 0) throw new Error("채점기준이 없습니다!");

    const criteriaOptions = criteria.map((type) => ({
        value: type.crit_no.toString(),
        label: type.crit_name,
    }));

    const criteriaMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('criteriaSelect')
            .setPlaceholder('채점기준을 선택하세요!')
            .addOptions(criteriaOptions)
    );

    const cancelButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('cancelCriteria')
            .setLabel('취소')
            .setStyle(ButtonStyle.Danger)
    );

    await modalInteraction.reply({ content: "적절한 채점 기준이 없다면, 관리자에게 문의해주세요.", components: [criteriaMenu, cancelButton], flags: 64 });

    // 채점기준 선택 콜렉터 생성
    const criteriaCollector = originalInteraction.channel.createMessageComponentCollector({
        filter: i => i.user.id === originalInteraction.user.id && (i.customId === 'criteriaSelect' || i.customId === 'cancelCriteria'),
        max: 1,
        time: 60000
    });
    setUserCollector(originalInteraction.user.id, criteriaCollector);

    // 채점기준 선택 또는 취소 버튼 클릭 시
    criteriaCollector.on('collect', async (criteriaInteraction) => {
        try {
            if (criteriaInteraction.customId === 'cancelCriteria') {
                await criteriaInteraction.update({ content: '문제 등록이 취소되었습니다.', components: [], flags: 64 });
                return;
            }

            const selectedCriteria = criteriaInteraction.values[0];

            // DB에 문제 저장
            const { data, error } = await supabase
                .from('questions')
                .insert([{
                    category: selectedCategory,
                    question_text: questionText.replace(/```/g, ''),
                    answer_text: answerText,
                    answer_type: selectedCriteria
                }])
                .select();

            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error("문제 추가에 실패했습니다!");

            // 카테고리의 add_point 값 조회
            const { data: categoryData, error: categoryError } = await supabase
                .from('category')
                .select('add_point')
                .eq('cate_no', selectedCategory)
                .single();
            
            const addPoint = categoryData?.add_point;
            var sendMessage = "문제가 성공적으로 추가되었습니다! ";
            const displayName = originalInteraction.member?.displayName || originalInteraction.user.username;

            if (addPoint) {
                await upsertUserScore(originalInteraction.guild.id, originalInteraction.user.id, displayName, addPoint);
                sendMessage += `${displayName}님 +${addPoint} 포인트 👏`;
            }
            await criteriaInteraction.update({ content: '채점 기준이 선택되었습니다.', components: [] });
            await originalInteraction.channel.send({ content: sendMessage });

        } catch (err) {
            await sendError(`add_question.js Error: ${err?.stack || err}`);
        } finally {
            criteriaCollector.stop();
        }
    });
    criteriaCollector.on('end', () => {
        clearUserCollector(originalInteraction.user.id);
    });
}