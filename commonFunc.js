import 'dotenv/config';
import { client } from './index.js';
import { supabase } from './index.js';
import { getCorrectAnswer, resetCorrectAnswer } from './commands/question.js';

/** DEV 봇 여부 (env에 NODE_ENV=DEV 또는 PROD) */
export function isDevBot() {
    return process.env.NODE_ENV === 'DEV';
}

/** DEV 봇일 때 Goofy만 사용 가능 */
export function canUseDevBot(userId) {
    if (!isDevBot()) return true;
    return process.env.GOOFY_ID === userId;
}

const userCollectors = new Map();
const guildConfigCache = new Map();

export async function getGuildConfig(guildId) {
    if (guildConfigCache.has(guildId)) {
        return guildConfigCache.get(guildId);
    }
    const { data, error } = await supabase
        .from('guilds')
        .select('*')
        .eq('guild_id', guildId)
        .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (data) guildConfigCache.set(guildId, data);
    return data;
}

export async function upsertGuildConfig(guildId, guildName, config = {}) {
    const { data, error } = await supabase
        .from('guilds')
        .upsert({
            guild_id: guildId,
            guild_name: guildName,
            ...config
        }, { onConflict: 'guild_id' })
        .select()
        .single();

    if (error) throw error;
    
    guildConfigCache.set(guildId, data);
    return data;
}

export function clearGuildConfigCache(guildId) {
    if (guildId) {
        guildConfigCache.delete(guildId);
    } else {
        guildConfigCache.clear();
    }
}

export async function getAllGuildConfigs() {
    const { data, error } = await supabase
        .from('guilds')
        .select('*');

    if (error) throw error;
    return data || [];
}

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
            const displayName = message.member?.displayName || message.author.username;
            var sendMessage = `${displayName}님 정답! `;

            if (answerPoint) {
                await upsertUserScore(message.guild.id, message.author.id, displayName, answerPoint);
                sendMessage += `+${answerPoint} 포인트 💯`;
            }
            return message.reply(sendMessage);

        } catch (err) {
            await sendError(`answer Error: ${err?.stack || err}`);
        }
    }
}

export async function sendError(content, guildId = null) {
    try {
        if (!client.isReady()) return;
        
        if (guildId) {
            const config = await getGuildConfig(guildId);
            if (config?.log_channel_id) {
                const logChannel = client.channels.cache.get(config.log_channel_id);
                if (logChannel) {
                    await logChannel.send(content);
                    return;
                }
            }
        }
        const guildConfigs = await getAllGuildConfigs();
        for (const config of guildConfigs) {
            if (config.log_channel_id) {
                const logChannel = client.channels.cache.get(config.log_channel_id);
                if (logChannel) {
                    await logChannel.send(content);
                    return;
                }
            }
        }
    } catch (err) {
        console.error('sendError failed:', err);
    }
}

export async function upsertUserScore(guildId, userId, username, score) {
    const { data: userRows, error: selectError } = await supabase
        .from('users')
        .select('total_score')
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .single();

    if (selectError && selectError.code !== 'PGRST116') throw selectError;

    if (userRows && userRows.total_score !== undefined) {
        score += userRows.total_score;
    }

    const { error: upsertError } = await supabase
        .from('users')
        .upsert(
            { guild_id: guildId, user_id: userId, username, total_score: score },
            { onConflict: 'guild_id,user_id' }
        );

    if (upsertError) throw new Error('점수 업데이트 실패..');
}
