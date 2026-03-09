import cron from 'node-cron';
import { client } from './index.js';
import { supabase } from './index.js';
import { sendError, getAllGuildConfigs } from './commonFunc.js';
import { getRankString } from './commands/ranking.js';
import { getWeeklyStudyTime, getWeeklyStudyReport, saveAllActiveSessions } from './voiceTracker.js';

export function startCrons() {
    // 매월 1일 0시 0분 - 각 길드별 랭킹 발표 및 점수 초기화
    cron.schedule('0 0 1 * *', async () => {
        try {
            const guildConfigs = await getAllGuildConfigs();
            
            for (const config of guildConfigs) {
                try {
                    if (!config.general_channel_id) continue;
                    
                    const channel = client.channels.cache.get(config.general_channel_id);
                    if (!channel) continue;
                    
                    const result = await getRankString(config.guild_id);
                    await channel.send(result);

                    const { error } = await supabase
                        .from('users')
                        .update({ total_score: 0 })
                        .eq('guild_id', config.guild_id)
                        .neq('total_score', 0);
                    
                    if (error) throw new Error(error);
                } catch (err) {
                    await sendError(`[점수 초기화] guild_id: ${config.guild_id} (${config.guild_name || '-'})\n${err?.stack || err}`, config.guild_id);
                }
            }
            await sendError(`전체 길드 점수 초기화 완료!`);

        } catch (err) {
            await sendError(`점수 초기화 중 예외 발생 : ${err?.stack || err}`);
        }
    });

    // 매일 자정 직전 - 모든 활성 세션 저장
    cron.schedule('59 59 23 * * *', async () => {
        try {
            await saveAllActiveSessions();
        } catch (err) {
            await sendError(`자정 세션 저장 오류: ${err?.stack || err}`);
        }
    });

    // 매주 일요일 23시 0분 - 각 길드별 주간 리포트
    cron.schedule('0 23 * * 0', async () => {
        try {
            await saveAllActiveSessions();
            const guildConfigs = await getAllGuildConfigs();
            
            for (const config of guildConfigs) {
                try {
                    if (!config.general_channel_id || !config.study_room_id) continue;
                    
                    const channel = client.channels.cache.get(config.general_channel_id);
                    if (!channel) continue;
                    
                    const studyData = await getWeeklyStudyTime(config.guild_id);
                    const report = getWeeklyStudyReport(studyData);
                    await channel.send(report);
                } catch (err) {
                    await sendError(`[주간 리포트] guild_id: ${config.guild_id} (${config.guild_name || '-'})\n${err?.stack || err}`, config.guild_id);
                }
            }

        } catch (err) {
            await sendError(`주간 독서실 리포트 오류: ${err?.stack || err}`);
        }
    });
}
