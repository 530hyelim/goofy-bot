import 'dotenv/config';
import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, StringSelectMenuBuilder, parseEmoji
} from 'discord.js';
import { supabase } from '../index.js';
import { sendError, getGuildConfig, upsertGuildConfig, clearGuildConfigCache } from '../commonFunc.js';
import { updateRoleMessage, clearReactionRolesCache } from '../reactionRoles.js';

function isValidEmoji(str) {
    const parsed = parseEmoji(str);
    if (parsed && parsed.id) {
        return true;
    }
    const emojiRegex = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Extended_Pictographic})*$/u;
    if (emojiRegex.test(str)) {
        return true;
    }
    return false;
}

function isSingleEmoji(str) {
    const trimmed = str.trim();
    if (!trimmed) return false;
    const parsed = parseEmoji(trimmed);
    if (parsed && parsed.id) {
        return /^<a?:\w+:\d+>$/i.test(trimmed);
    }
    const oneOnly = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F|\u200D|\p{Emoji_Modifier})*$/u;
    return oneOnly.test(trimmed);
}

function isOwner(interaction) {
    return interaction.guild.ownerId === interaction.user.id;
}

export default {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('서버 설정 패널 열기')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!isOwner(interaction)) {
            return interaction.reply({ content: '❌ 서버 설정은 서버장만 할 수 있습니다.', flags: 64 });
        }
        await showMainMenu(interaction);
    }
};

async function showMainMenu(interaction, isUpdate = false) {
    const guildId = interaction.guild.id;
    const config = await getGuildConfig(guildId);

    const studyRoom = config?.study_room_id ? `<#${config.study_room_id}>` : '❌ 미설정';
    const generalChannel = config?.general_channel_id ? `<#${config.general_channel_id}>` : '❌ 미설정';
    const logChannel = config?.log_channel_id ? `<#${config.log_channel_id}>` : '❌ 미설정';
    const roleChannel = config?.role_channel_id ? `<#${config.role_channel_id}>` : '❌ 미설정';

    const content = `**⚙️ ${interaction.guild.name} 서버 설정**\n\n` +
        `💬 공지사항 채널: ${generalChannel}\n` +
        `🎭 역할선택 채널: ${roleChannel}\n` +
        `📝 로그 채널: ${logChannel}\n` +
        `🔊 독서실 채널: ${studyRoom}\n\n` +
        `아래 버튼을 눌러 설정을 변경하세요.`;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup_channels')
            .setLabel('📺 채널 설정')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('setup_roles')
            .setLabel('🎭 리액션 역할')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('setup_close')
            .setLabel('닫기')
            .setStyle(ButtonStyle.Secondary)
    );
    const options = { content, components: [row1], flags: 64 };
    if (isUpdate) await interaction.update(options);
    else await interaction.reply(options);
}

export async function handleSetupInteraction(interaction) {
    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;

    if (!isOwner(interaction)) {
        return interaction.reply({ content: '❌ 서버 설정은 서버장만 할 수 있습니다.', flags: 64 });
    }

    try {
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'setup_channels':
                    return await showChannelMenu(interaction);
                case 'setup_roles':
                    return await showRoleMenu(interaction);
                case 'setup_close':
                    return await interaction.update({ content: '설정 패널이 닫혔습니다.', components: [] });
                case 'setup_back':
                    return await showMainMenu(interaction, true);
                case 'setup_role_add':
                    return await showRoleAddModal(interaction);
                case 'setup_role_remove':
                    return await showRoleRemoveMenu(interaction);
            }
        }

        if (interaction.isChannelSelectMenu()) {
            const channelId = interaction.values[0];
            let field = null;
            let label = '';

            switch (interaction.customId) {
                case 'select_study_room':
                    field = 'study_room_id';
                    label = '독서실';
                    break;
                case 'select_general_channel':
                    field = 'general_channel_id';
                    label = '공지사항 채널';
                    break;
                case 'select_log_channel':
                    field = 'log_channel_id';
                    label = '로그 채널';
                    break;
                case 'select_role_channel':
                    field = 'role_channel_id';
                    label = '역할선택 채널';
                    break;
            }

            if (field) {
                await upsertGuildConfig(guildId, guildName, { [field]: channelId });
                clearGuildConfigCache(guildId);
                
                if (field === 'role_channel_id') {
                    clearReactionRolesCache(guildId);
                    await updateRoleMessage(guildId);
                }

                await interaction.update({
                    content: `✅ ${label} 설정됨: <#${channelId}>\n\n⬅️ 뒤로가기를 눌러 메인으로 돌아가세요.`,
                    components: [backButtonRow()]
                });
                return;
            }
        }

        if (interaction.isRoleSelectMenu() && interaction.customId === 'select_role_for_add') {
            const roleId = interaction.values[0];
            const role = interaction.guild.roles.cache.get(roleId);
            
            interaction.client.setupTempData = interaction.client.setupTempData || new Map();
            interaction.client.setupTempData.set(`${guildId}_role`, { roleId, roleName: role.name });
            
            return await showEmojiInputModal(interaction, role.name);
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'select_role_to_remove') {
            const emoji = interaction.values[0];
            
            await interaction.deferUpdate();

            await supabase
                .from('reaction_roles')
                .delete()
                .eq('guild_id', guildId)
                .eq('emoji', emoji);

            clearReactionRolesCache(guildId);
            await updateRoleMessage(guildId);

            await interaction.editReply({
                content: `✅ 리액션 역할 삭제됨: ${emoji}\n\n⬅️ 뒤로가기를 눌러 메인으로 돌아가세요.`,
                components: [backButtonRow()]
            });
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_role_emoji') {
            const emoji = interaction.fields.getTextInputValue('emoji_input').trim();
            const description = interaction.fields.getTextInputValue('description_input').trim();
            
            const tempData = interaction.client.setupTempData?.get(`${guildId}_role`);
            if (!tempData) {
                return await interaction.reply({ content: '세션이 만료되었습니다. 다시 시도해주세요.', flags: 64 });
            }

            if (!isValidEmoji(emoji)) {
                return await interaction.update({ 
                    content: `❌ 유효한 이모지가 아닙니다.\n\n` +
                        `**입력 방법:**\n` +
                        `• 유니코드 이모지: 이모지를 직접 입력 (예: 🎮, 💼, 📚)\n` +
                        `• 커스텀 이모지: \`<:이름:아이디>\` 형식으로 입력\n\n` +
                        `• \`:emoji:\` 같은 숏코드는 지원되지 않습니다.\n` +
                        `Windows: Win+. / Mac: Cmd+Ctrl+Space 로 이모지 선택창을 열 수 있습니다.`,
                    components: []
                });
            }
            if (!isSingleEmoji(emoji)) {
                return await interaction.update({
                    content: '❌ **한 개의 이모지만** 입력해주세요. 리액션 역할은 이모지 하나당 역할 하나만 등록할 수 있습니다.',
                    components: []
                });
            }

            await interaction.deferReply({ flags: 64 });

            await supabase
                .from('reaction_roles')
                .upsert({
                    guild_id: guildId,
                    emoji: emoji,
                    role_id: tempData.roleId,
                    description: description || tempData.roleName
                }, { onConflict: 'guild_id,emoji' });

            interaction.client.setupTempData.delete(`${guildId}_role`);
            clearReactionRolesCache(guildId);
            await updateRoleMessage(guildId);

            await interaction.editReply({
                content: `✅ 리액션 역할 추가됨: ${emoji} → <@&${tempData.roleId}>\n\n💡 이모지가 동작하지 않으면 **서버 설정 → 역할**에서 봇 역할을 이 역할보다 **위**로 올려 주세요.`
            });
            return;
        }

    } catch (err) {
        await sendError(`⚠️ setup interaction error: ${err?.stack || err}`, guildId);
        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: '오류가 발생했습니다.' });
            } else if (!interaction.replied) {
                await interaction.reply({ content: '오류가 발생했습니다.', flags: 64 });
            }
        } catch (e) {
            console.error('인터랙션 응답 실패:', e.message);
        }
    }
}

function backButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup_back')
            .setLabel('⬅️ 뒤로가기')
            .setStyle(ButtonStyle.Secondary)
    );
}

async function showChannelMenu(interaction) {
    const row1 = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('select_general_channel')
            .setPlaceholder('💬 공지사항 채널 선택')
            .setChannelTypes(ChannelType.GuildText)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('select_role_channel')
            .setPlaceholder('🎭 역할선택 채널 선택')
            .setChannelTypes(ChannelType.GuildText)
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('select_log_channel')
            .setPlaceholder('📝 로그 채널 선택')
            .setChannelTypes(ChannelType.GuildText)
    );
    const row4 = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('select_study_room')
            .setPlaceholder('🔊 독서실 채널 선택')
            .setChannelTypes(ChannelType.GuildVoice)
    );

    await interaction.update({
        content: '**아래 메뉴에서 각 채널을 선택하세요.',
        components: [row1, row2, row3, row4, backButtonRow()]
    });
}

async function showRoleMenu(interaction) {
    const guildId = interaction.guild.id;
    
    const { data } = await supabase
        .from('reaction_roles')
        .select('emoji, role_id, description')
        .eq('guild_id', guildId);

    let roleList = '등록된 리액션 역할이 없습니다.';
    if (data && data.length > 0) {
        roleList = data.map(r => `${r.emoji} → <@&${r.role_id}> (${r.description})`).join('\n');
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setup_role_add')
            .setLabel('➕ 역할 추가')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('setup_role_remove')
            .setLabel('➖ 역할 삭제')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('setup_back')
            .setLabel('⬅️ 뒤로가기')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
        content: `**현재 등록된 역할:**\n${roleList}\n\u200b\n`,
        components: [row]
    });
}

async function showRoleAddModal(interaction) {
    const row = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('select_role_for_add')
            .setPlaceholder('역할 선택')
    );

    await interaction.update({
        content: '**추가할 역할을 선택하세요.\n💡 봇이 부여할 수 있는 역할은 **역할 목록에서 봇 역할보다 아래**에 있어야 합니다.',
        components: [row, backButtonRow()]
    });
}

async function showEmojiInputModal(interaction, roleName) {
    const modal = new ModalBuilder()
        .setCustomId('modal_role_emoji')
        .setTitle('리액션 역할 추가');

    const emojiInput = new TextInputBuilder()
        .setCustomId('emoji_input')
        .setLabel('이모지 (직접 입력, :emoji: 숏코드 불가)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('🎮 (Win+. 또는 Cmd+Ctrl+Space)')
        .setRequired(true)
        .setMaxLength(50);

    const descInput = new TextInputBuilder()
        .setCustomId('description_input')
        .setLabel('설명')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(roleName)
        .setRequired(false)
        .setMaxLength(50);

    modal.addComponents(
        new ActionRowBuilder().addComponents(emojiInput),
        new ActionRowBuilder().addComponents(descInput)
    );

    await interaction.showModal(modal);
}

async function showRoleRemoveMenu(interaction) {
    const guildId = interaction.guild.id;
    
    const { data } = await supabase
        .from('reaction_roles')
        .select('emoji, role_id, description')
        .eq('guild_id', guildId);

    if (!data || data.length === 0) {
        return await interaction.update({
            content: '삭제할 리액션 역할이 없습니다.',
            components: [backButtonRow()]
        });
    }

    const options = data.map(r => ({
        label: `${r.emoji} - ${r.description}`,
        value: r.emoji,
        description: `역할: ${r.description}`
    }));

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_role_to_remove')
            .setPlaceholder('삭제할 역할 선택')
            .addOptions(options)
    );

    await interaction.update({
        content: '**➖ 역할 삭제**\n삭제할 역할을 선택하세요.',
        components: [row, backButtonRow()]
    });
}
