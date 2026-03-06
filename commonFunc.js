import 'dotenv/config';
import { client } from './index.js';
import { supabase } from './index.js';
import { getCorrectAnswer, resetCorrectAnswer } from './commands/question.js';

const userCollectors = new Map();

export function setUserCollector(userId, collector) {
    const prev = userCollectors.get(userId);
    if (prev) prev.stop();
    userCollectors.set(userId, collector);
}

export function clearUserCollector(userId) {
    userCollectors.delete(userId);
}

export async function handleCommand(message) {
    if (message.author.bot) return;
    const content = message.content.trim();
    const correctAnswer = getCorrectAnswer();
    if (!correctAnswer) return;

    if (content.startsWith('.힌트')) {
        var hint = correctAnswer.answer.replace(/[0-9가-힣ㄱ-ㅎㅏ-ㅣA-Za-z]/g, '●');
        return message.reply(`힌트: ${hint}`);
    }

    if (content.startsWith('.정답')) {
        const userAnswer = content.slice(3).trim();
        if (!userAnswer) return;

        try {
            let 정답;
            const answerArr = correctAnswer.answer.replace(/[\s\W_]+/g, ' ').split(' ');

            switch(correctAnswer.type) {
                case 1: // 일치
                    if (userAnswer == correctAnswer.answer.trim()) 정답 = true;
                    else 정답 = false;
                    break;
                case 2: // 포함
                    정답 = true;
                    answerArr.forEach(answer => {
                        if (!userAnswer.includes(answer)) 정답 = false;
                    });
                    break;
                case 3: // 동순
                    정답 = true;
                    let order = new Array();
                    answerArr.forEach(answer => {
                        order.push(userAnswer.indexOf(answer));
                    });
                    for (let i = 0; i < order.length - 1; i++) {
                        if (order[i] > order[i + 1]) 정답 = false;
                    }
                    break;
            }

            if (!정답) return message.reply('땡!!!!');
            resetCorrectAnswer();

            // 카테고리의 answer_point 값 조회
            const { data: categoryData } = await supabase
                .from('category')
                .select('answer_point')
                .eq('cate_no', correctAnswer.category)
                .single();
            
            const answerPoint = categoryData?.answer_point;
            var sendMessage = `${message.author.username}님 정답! `;

            if (answerPoint) {
                await upsertUserScore(message.author.id, message.author.username, answerPoint);
                sendMessage += `+${answerPoint} 포인트 💯`;
            }
            return message.reply(sendMessage);

        } catch (err) {
            await sendError(`answer Error: ${err?.stack || err}`);
        }
    }
}

export async function sendError(content) {
    const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);

    if (logChannel) {
        await logChannel.send(content);
    } else {
        let admins = [];
        const guild = client.guilds.cache.get(process.env.GUILD_ID);

        if (guild) {
            admins = message.guild.members.cache.filter(member => member.permissions.has(process.env.ROLE_ADMIN_ID));

            if (!admins || admins.size === 0) {
                const members = await message.guild.members.fetch();
                admins = members.filter(member => member.permissions.has(process.env.ROLE_ADMIN_ID));
            }
        }

        for (const [id, member] of admins) {
            await member.send(content);
        }
    }
}

export async function upsertUserScore(userId, username, score) {
    const { data: userRows, error: selectError } = await supabase
        .from('users')
        .select('total_score')
        .eq('user_id', userId)
        .single();

    if (selectError && selectError.code !== 'PGRST116') throw selectError; // PGRST116: row not found

    if (userRows && userRows.total_score !== undefined) {
        score += userRows.total_score;
    }

    const { error: upsertError } = await supabase
        .from('users')
        .upsert(
            { user_id: userId, username, total_score: score },
            { onConflict: ['user_id'] }
        );

    if (upsertError) throw new Error('점수 업데이트 실패..');
}
