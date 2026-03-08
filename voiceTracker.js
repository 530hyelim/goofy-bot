import { supabase } from './index.js';
import { sendError, getGuildConfig, isDevBot } from './commonFunc.js';

const voiceSessions = new Map();

export async function handleVoiceStateUpdate(oldState, newState) {
    if (isDevBot()) return;
    const member = newState.member || oldState.member;
    const userId = member?.id;
    const guildId = newState.guild?.id || oldState.guild?.id;
    const displayName = member?.displayName || member?.user?.username;
    
    if (!userId || !guildId || member?.user?.bot) return;
    
    const guildConfig = await getGuildConfig(guildId);
    const studyRoomId = guildConfig?.study_room_id;
    
    if (!studyRoomId) return;
    
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;
    const wasInStudyRoom = oldChannel?.id === studyRoomId;
    const isInStudyRoom = newChannel?.id === studyRoomId;

    const sessionKey = `${guildId}_${userId}`;

    if (!wasInStudyRoom && isInStudyRoom) {
        voiceSessions.set(sessionKey, {
            joinTime: Date.now(),
            displayName: displayName,
            guildId: guildId
        });
    }
    else if (wasInStudyRoom && !isInStudyRoom) {
        const session = voiceSessions.get(sessionKey);
        if (session) {
            const duration = Date.now() - session.joinTime;
            await saveStudyTime(guildId, userId, session.displayName, duration);
            voiceSessions.delete(sessionKey);
        }
    }
}

async function saveStudyTime(guildId, userId, username, durationMs) {
    try {
        const durationSeconds = Math.floor(durationMs / 1000);
        if (durationSeconds < 1) return;
        const today = new Date().toISOString().split('T')[0];

        const { data: existing, error: selectError } = await supabase
            .from('study_time')
            .select('duration_seconds')
            .eq('guild_id', guildId)
            .eq('user_id', userId)
            .eq('study_date', today)
            .single();

        if (selectError && selectError.code !== 'PGRST116') throw selectError;
        const totalSeconds = (existing?.duration_seconds || 0) + durationSeconds;

        const { data, error: upsertError } = await supabase
            .from('study_time')
            .upsert({ 
                guild_id: guildId,
                user_id: userId, 
                username: username,
                study_date: today,
                duration_seconds: totalSeconds},
                { onConflict: 'guild_id,user_id,study_date' }
            )
            .select();

        if (upsertError) throw upsertError;
        
    } catch (err) {
        await sendError(`Study time save error: ${err?.stack || err}`);
    }
}

export async function getWeeklyStudyTime(guildId) {
    try {
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        const startDate = weekAgo.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('study_time')
            .select('user_id, username, duration_seconds')
            .eq('guild_id', guildId)
            .gte('study_date', startDate)
            .lte('study_date', endDate);

        if (error) throw error;

        const userTotals = new Map();
        for (const row of data || []) {
            const current = userTotals.get(row.user_id) || { 
                username: row.username, 
                totalSeconds: 0 
            };
            current.totalSeconds += row.duration_seconds;
            userTotals.set(row.user_id, current);
        }

        const sorted = Array.from(userTotals.entries())
            .map(([userId, data]) => ({
                userId,
                username: data.username,
                totalSeconds: data.totalSeconds
            }))
            .sort((a, b) => b.totalSeconds - a.totalSeconds);

        return sorted;

    } catch (err) {
        await sendError(`Weekly study time fetch error: ${err?.stack || err}`);
        return [];
    }
}

export function formatStudyTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}시간 ${mins}분 ${secs}초`;
    }
    if (mins > 0) {
        return `${mins}분 ${secs}초`;
    }
    return `${secs}초`;
}

export function getWeeklyStudyReport(studyData) {
    if (!studyData || studyData.length === 0) {
        return '📚 이번 주 독서실 이용 기록이 없습니다.';
    }

    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const formatDate = (date) => `${date.getMonth() + 1}/${date.getDate()}`;
    
    let report = `📚 **주간 독서실 이용 현황** (${formatDate(weekAgo)} ~ ${formatDate(today)})\n`;
    report += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const medals = ['🥇', '🥈', '🥉'];
    
    studyData.forEach((user, index) => {
        const rank = index < 3 ? medals[index] : `${index + 1}.`;
        const timeStr = formatStudyTime(user.totalSeconds);
        report += `${rank} **${user.username}** - ${timeStr}\n`;
    });

    const totalSeconds = studyData.reduce((sum, user) => sum + user.totalSeconds, 0);
    report += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📊 총 이용 시간: **${formatStudyTime(totalSeconds)}**\n`;
    report += `👥 이용자 수: **${studyData.length}명**`;

    return report;
}

export async function saveAllActiveSessions(guildId = null) {
    for (const [sessionKey, session] of voiceSessions.entries()) {
        if (guildId && session.guildId !== guildId) continue;
        
        const duration = Date.now() - session.joinTime;
        const [sessionGuildId, userId] = sessionKey.split('_');
        await saveStudyTime(sessionGuildId, userId, session.displayName, duration);
        voiceSessions.set(sessionKey, {
            ...session,
            joinTime: Date.now()
        });
    }
}
