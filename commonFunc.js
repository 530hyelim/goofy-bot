import 'dotenv/config';
import { client } from './index.js';
import { supabase } from './index.js';

const userCollectors = new Map();

export function setUserCollector(userId, collector) {
    const prev = userCollectors.get(userId);
    if (prev) prev.stop();
    userCollectors.set(userId, collector);
}

export function clearUserCollector(userId) {
    userCollectors.delete(userId);
}

export async function handleCommand(message, client) {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args);
    } catch (error) {
        console.error(error);
        message.reply('명령어 실행 중 오류가 발생했습니다.');
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
