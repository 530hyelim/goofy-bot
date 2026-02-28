import 'dotenv/config';
import { supabase } from '../index.js';
import { ActionRowBuilder, SelectMenuBuilder } from 'discord.js';
import { setUserCollector, clearUserCollector } from '../commonFunc.js';

let correctAnswer;

export default {
    name: 'question',
    description: '문제 출제',
    async execute(message, args) {
        try {
            // 카테고리 선택
            const { data: categories, error: categoryError } = await supabase.from('category').select('*');
            
            if (categoryError) throw new Error(categoryError);
            if (!categories || categories.length === 0) throw new Error("카테고리가 없습니다!");

            const categoryOptions = categories.map((category) => ({
                value: category.cate_no.toString(),
                label: category.cate_name,
            }));

            const row = new ActionRowBuilder().addComponents(
                new SelectMenuBuilder()
                    .setCustomId('categorySelect')
                    .setPlaceholder('카테고리를 선택하세요!')
                    .addOptions(categoryOptions)
            );

            await message.reply({ components: [row] });
            const filter = (interaction) => interaction.user.id === message.author.id;

            const collector = message.channel.createMessageComponentCollector({
                filter,
            });
            setUserCollector(message.author.id, collector);

            // 문제 가져오기
            collector.on('collect', async (interaction) => {
                if (interaction.customId === 'categorySelect') {
                    const { data: questions, error: qErr } = await supabase
                        .from('questions').select('*').eq('category', interaction.values[0]);

                    if (qErr) throw new Error(qErr);
                    if (!questions || questions.length === 0) return interaction.reply("문제가 없습니다. !add_question 커맨드를 통해 문제를 등록해주세요!");

                    const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
                    correctAnswer = {
                        type: randomQuestion.answer_type,
                        answer: randomQuestion.answer_text, 
                    };
                    return interaction.reply(randomQuestion.question_text);
                }
            });
            collector.on('end', () => {
                clearUserCollector(message.author.id);
            });

        } catch (err) {
            const logChannel = message.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                logChannel.send(`question.js Error: ${err?.stack || err}`);
            } else {
                const members = await message.guild.members.fetch();
                const targetUsers = members.filter(member => member.permissions.has(process.env.ROLE_ADMIN_ID));

                for (const [id, member] of targetUsers) {
                    await member.send(`question.js Error: ${err?.stack || err}`);
                }
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
