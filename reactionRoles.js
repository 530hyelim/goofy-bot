import 'dotenv/config';
import { EmbedBuilder } from 'discord.js';
import { supabase, client } from './index.js';
import { sendError, getGuildConfig, upsertGuildConfig, clearGuildConfigCache, isDevBot, canUseDevBot } from './commonFunc.js';

const reactionRolesCache = new Map();

async function getReactionRolesData(guildId) {
    const { data, error } = await supabase
        .from('reaction_roles')
        .select('emoji, role_id, description')
        .eq('guild_id', guildId);

    if (error) throw error;
    return data || [];
}

async function getReactionRoles(guildId) {
    if (reactionRolesCache.has(guildId)) {
        return reactionRolesCache.get(guildId);
    }

    const data = await getReactionRolesData(guildId);
    const rolesMap = {};
    for (const row of data) {
        rolesMap[row.emoji] = row.role_id;
    }

    reactionRolesCache.set(guildId, rolesMap);
    return rolesMap;
}

export function clearReactionRolesCache(guildId) {
    if (guildId) {
        reactionRolesCache.delete(guildId);
    } else {
        reactionRolesCache.clear();
    }
}

function buildRoleEmbed(rolesData) {
    const description = rolesData.map(r => `${r.emoji} ${r.description || '역할'}`).join('\n');
    
    return new EmbedBuilder()
        .setTitle('아래 이모지를 눌러 원하는 역할을 선택하세요!')
        .setDescription(description || '설정된 역할이 없습니다.')
        .setColor('#5865F2');
}

export async function updateRoleMessage(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const config = await getGuildConfig(guildId);
    if (!config?.role_channel_id) return;

    const channel = guild.channels.cache.get(config.role_channel_id);
    if (!channel) return;

    clearReactionRolesCache(guildId);
    const rolesData = await getReactionRolesData(guildId);
    const embed = buildRoleEmbed(rolesData);

    let message = null;
    if (config.role_message_id) {
        message = await channel.messages.fetch(config.role_message_id).catch(() => null);
    }

    if (message) {
        await message.edit({ embeds: [embed] });
        
        await message.reactions.removeAll();
        for (const role of rolesData) {
            await message.react(role.emoji);
        }
        
        sendError(`✅ ${guild.name}: 역할 메시지 업데이트 완료`, guildId);
    } else {
        message = await channel.send({ embeds: [embed] });
        
        for (const role of rolesData) {
            await message.react(role.emoji);
        }
        
        clearGuildConfigCache(guildId);
        await upsertGuildConfig(guildId, guild.name, { role_message_id: message.id });
        
        sendError(`✅ ${guild.name}: 새 역할 메시지 생성 (ID: ${message.id})`, guildId);
    }

    return message;
}

/**
 * 역할 선택 메시지 초기화 (모든 길드)
 */
export async function initReactionRoles(client) {
    for (const guild of client.guilds.cache.values()) {
        try {
            const config = await getGuildConfig(guild.id);
            if (!config?.role_channel_id) continue;

            if (config.role_message_id) {
                const channel = guild.channels.cache.get(config.role_channel_id);
                if (channel) {
                    const message = await channel.messages.fetch(config.role_message_id).catch(() => null);
                    if (message) {
                        continue;
                    }
                }
            }
            await updateRoleMessage(guild.id);
        } catch (err) {
            sendError(`⚠️ ${guild.name} 역할 초기화 오류: ${err?.stack || err}`);
        }
    }
}

/**
 * 리액션 역할 토글 (이모지 추가 시에만 처리, 토글 후 반응 제거)
 */
export async function handleReaction(reaction, user, add) {
    if (user.bot || isDevBot()) return;
    if (!add) return;
    
    if (reaction.partial) await reaction.fetch();

    const guild = reaction.message.guild;
    const config = await getGuildConfig(guild.id);
    
    if (config?.role_message_id !== reaction.message.id) return;
    
    const reactionRoles = await getReactionRoles(guild.id);
    if (!reactionRoles || Object.keys(reactionRoles).length === 0) return;
    
    const roleId = reactionRoles[reaction.emoji.name];
    if (!roleId) return;

    const member = await guild.members.fetch(user.id);

    try {
        const hasRole = member.roles.cache.has(roleId);
        
        if (hasRole) {
            await member.roles.remove(roleId);
        } else {
            await member.roles.add(roleId);
        }

        await reaction.users.remove(user.id);

        if (config?.log_channel_id) {
            const logChannel = guild.channels.cache.get(config.log_channel_id);
            if (logChannel) {
                const action = hasRole ? '역할 해제' : '역할 부여';
                logChannel.send(`${hasRole ? '❌' : '✅'} **${member.user.tag}**님이 ${reaction.emoji.name} ${action}`);
            }
        }
    } catch (err) {
        sendError(`역할 토글 오류: ${err?.stack || err}`, guild.id);
    }
}
