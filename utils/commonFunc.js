import 'dotenv/config';
import { client } from '../index.js';
import { supabase } from '../index.js';
import { getCorrectAnswer, resetCorrectAnswer } from '../commands/question.js';

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

/** 문제 출제 시 표시할 채점 기준 문구 */
export async function getCriteriaHintForDisplay(answerType) {
    const type = Math.min(4, Math.max(1, parseInt(answerType, 10) || 1));
    const { data: critRow } = await supabase
        .from('criteria')
        .select('crit_name, criteria_hint')
        .eq('crit_no', type)
        .single();
    const name = critRow?.crit_name?.trim() || '';
    const hintText = (critRow?.criteria_hint && critRow.criteria_hint.trim()) ? critRow.criteria_hint.trim() : '';
    if (!name || !hintText) return '';
    return `채점 기준 (${name}): ${hintText}`;
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
        const userAnswer = content.replace(/^\.정답\s*/, '').trim();
        if (!userAnswer) return;

        try {
            let 정답 = false;
            const correct = String(correctAnswer.answer ?? '').trim();
            const user = String(userAnswer).trim();
            const answerType = Math.min(4, Math.max(1, parseInt(correctAnswer.type, 10) || 1));

            switch (answerType) {
                case 1: { // 일치: 공백 제외한 모든 글자 일치
                    const corrNorm = correct.replace(/\s/g, '');
                    const userNorm = user.replace(/\s/g, '');
                    정답 = corrNorm === userNorm;
                    break;
                }
                case 2: { // 포함: 정답 단어 중 하나가 유저 답에서 '단어 전체'로 있고, 유저 단어는 전부 정답에 있어야 함
                    const toWords = (s) => String(s).replace(/[^\s0-9가-힣ㄱ-ㅎㅏ-ㅣA-Za-z]/g, ' ').split(/\s+/).filter(Boolean);
                    const correctWords = toWords(correct);
                    const userWords = toWords(user);
                    const hasCorrectWord = correctWords.some((cw) => userWords.includes(cw));
                    const onlyCorrectWords = userWords.every((uw) => correctWords.includes(uw));
                    정답 = hasCorrectWord && onlyCorrectWords;
                    break;
                }
                case 3: { // 동순: 유저 토큰이 정답 토큰 시퀀스의 접두사여야 함 + 정답에 없는 글자 있으면 땡
                    const toTokens = (s) =>
                        String(s)
                            .replace(/[^\s0-9가-힣ㄱ-ㅎㅏ-ㅣA-Za-z]/g, ' ')
                            .split(/\s+/)
                            .filter(Boolean);
                    const correctTokens = toTokens(correct);
                    const userTokens = toTokens(user);
                    const prefixMatch =
                        userTokens.length <= correctTokens.length &&
                        userTokens.every((t, i) => t === correctTokens[i]);
                    const noExtraChar = [...user].every((ch) => correct.includes(ch));
                    정답 = prefixMatch && noExtraChar;
                    break;
                }
                case 4: { // 서술: 정답의 모든 단어가 유저 답에 포함되어야 함
                    const toWords = (s) => String(s).replace(/[^\s0-9가-힣ㄱ-ㅎㅏ-ㅣA-Za-z]/g, ' ').split(/\s+/).filter(Boolean);
                    const correctWords = toWords(correct);
                    정답 = correctWords.length > 0 && correctWords.every((w) => user.includes(w));
                    break;
                }
                default:
                    정답 = false;
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
            await sendError(`answer Error: ${err?.stack || err}`, message.guild?.id);
        }
    }
}

/** 길드 없음/전역 작업 시 로그를 보낼 고정 길드 */
const DEFAULT_LOG_GUILD_ID = '1378367135230984252';

export async function sendError(content, guildId = null) {
    try {
        if (!client.isReady()) return;

        const targetGuildId = guildId || DEFAULT_LOG_GUILD_ID;
        const config = await getGuildConfig(targetGuildId);
        if (config?.log_channel_id) {
            const logChannel = client.channels.cache.get(config.log_channel_id);
            if (logChannel) {
                await logChannel.send(content);
                return;
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
