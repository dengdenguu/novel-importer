// ===========================================================================
//  TXT小说对话导入器 - SillyTavern 1.18.0 Extension
//  功能：上传 txt，按“第X章/节”分割，奇偶章分配给两个角色，
//        保留原文换行与空行，大文件分批插入不卡界面
// ===========================================================================

import { extension_settings, saveSettingsDebounced } from '../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// 扩展唯一标识
const EXTENSION_ID = 'txt_novel_importer';

// 默认设置
const defaultSettings = {
    charA: '我',          // 奇数章发言者（基数）
    charB: '对方',        // 偶数章发言者
    chapterRegex: '第[零一二三四五六七八九十百千万0-9]+[章节卷]', // 可自定义
    batchSize: 5,         // 每批插入条数（防止大文件卡死）
};

// 初始化设置
function loadSettings() {
    if (!extension_settings[EXTENSION_ID]) {
        extension_settings[EXTENSION_ID] = JSON.parse(JSON.stringify(defaultSettings));
    }
    // 兼容旧版没有的字段
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[EXTENSION_ID][key] === undefined) {
            extension_settings[EXTENSION_ID][key] = defaultSettings[key];
        }
    }
}

// 保存设置
function saveSettings() {
    saveSettingsDebounced();
}

// ------------------- 核心功能：解析章节 -------------------
function parseChapters(text, regexStr) {
    const regex = new RegExp(regexStr, 'g');
    // 记录所有章节标题的位置
    const titles = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        titles.push({ index: match.index, title: match[0] });
    }

    const chapters = [];
    if (titles.length === 0) {
        // 没有匹配到任何标题，整篇作为一个章节
        if (text.trim()) chapters.push({ title: '', content: text });
        return chapters;
    }

    // 遍历标题，截取内容
    for (let i = 0; i < titles.length; i++) {
        const current = titles[i];
        const next = titles[i + 1];
        const contentStart = current.index + current.title.length;
        const contentEnd = next ? next.index : text.length;
        let content = text.slice(contentStart, contentEnd);
        // 去除首尾多余的空白，但保留内部格式
        content = content.replace(/^\n+/, '').replace(/\n+$/, '');
        chapters.push({ title: current.title, content: content });
    }

    // 如果第一章标题之前有内容，视为序言
    if (titles[0].index > 0) {
        const prologue = text.slice(0, titles[0].index).trim();
        if (prologue) {
            chapters.unshift({ title: '序言', content: prologue });
        }
    }

    return chapters;
}

// ------------------- 消息格式化 -------------------
function formatContent(rawContent) {
    // 将文本转换为 HTML：保留段落间的空行（两个换行），普通换行转 <br>
    const lines = rawContent.split('\n');
    let html = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
            // 空行，添加一个空段落（表现为空行）
            html += '<br>';
        } else {
            // 对行内特殊字符简单转义，防止破坏 HTML
            const safeLine = line
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            html += safeLine + '<br>';
        }
    }
    // 移除末尾多余的 <br>
    return html.replace(/(<br>)+$/, '');
}

// ------------------- 批量插入消息 -------------------
async function insertMessagesInBatches(messages, batchSize, charA, charB, statusCallback) {
    const context = getContext();
    const chat = context.chat;

    if (!Array.isArray(chat)) {
        toastr.error('当前没有可用的聊天');
        return;
    }

    let currentIndex = 0;
    const total = messages.length;

    // 使用 Promise 包裹 setTimeout 来控制批次
    function insertBatch() {
        return new Promise((resolve) => {
            const start = currentIndex;
            const end = Math.min(start + batchSize, total);
            for (let i = start; i < end; i++) {
                const msg = messages[i];
                // 构造标准消息对象（根据酒馆 1.18.0 结构）
                const message = {
                    name: msg.sender,
                    is_user: (msg.sender === charA), // 奇数章默认视为用户
                    is_system: false,
                    send_date: Date.now(),
                    mes: msg.formattedContent,
                    extra: {},
                };
                chat.push(message);
            }
            // 更新 UI（触发界面刷新）
            if (typeof context.saveChat === 'function') {
                context.saveChat();
            }
            $('#chat').trigger('scrollToBottom');

            currentIndex = end;
            if (currentIndex < total) {
                statusCallback(`已导入 ${currentIndex}/${total} 条...`);
                setTimeout(() => resolve(insertBatch()), 50); // 50ms 间隔
            } else {
                statusCallback(`导入完成！共 ${total} 条消息`);
                resolve();
            }
        });
    }

    await insertBatch();
}

// ------------------- UI 构建 -------------------
function addSettingsHtml() {
    const settings = extension_settings[EXTENSION_ID];
    const html = `
    <div id="txt_importer_container" class="txt-importer">
        <h4 class="margin0">📖 TXT 小说对话导入器</h4>
        <div class="flex-container flexFlowColumn">
            <div class="flex-container">
                <label class="checkbox_label width100p">
                    <span>奇数章角色（基数）</span>
                    <input id="txt_importer_charA" type="text" class="text_pole" value="${settings.charA}" placeholder="例如：我">
                </label>
            </div>
            <div class="flex-container">
                <label class="checkbox_label width100p">
                    <span>偶数章角色（偶数）</span>
                    <input id="txt_importer_charB" type="text" class="text_pole" value="${settings.charB}" placeholder="例如：对方">
                </label>
            </div>
            <div class="flex-container">
                <label class="checkbox_label width100p">
                    <span>章节识别正则</span>
                    <input id="txt_importer_regex" type="text" class="text_pole" value="${settings.chapterRegex}" placeholder="默认匹配第X章/节/卷">
                </label>
            </div>
            <div class="flex-container">
                <label class="checkbox_label width100p">
                    <span>每批插入条数（大文件降低数值）</span>
                    <input id="txt_importer_batch" type="number" class="text_pole" value="${settings.batchSize}" min="1" max="50">
                </label>
            </div>
            <div class="flex-container">
                <input type="file" id="txt_importer_file" accept=".txt" class="margin0">
            </div>
            <div class="flex-container">
                <button id="txt_importer_import_btn" class="menu_button_default">
                    <span>开始导入</span>
                </button>
            </div>
            <div id="txt_importer_status" class="margin0"></div>
        </div>
    </div>`;

    // 注入到扩展设置面板
    $('#extensions_settings').append(html);
}

// ------------------- 事件绑定 -------------------
function bindEvents() {
    const settings = extension_settings[EXTENSION_ID];

    // 设置项变更自动保存
    $('#txt_importer_charA').on('input', function () {
        settings.charA = $(this).val();
        saveSettings();
    });
    $('#txt_importer_charB').on('input', function () {
        settings.charB = $(this).val();
        saveSettings();
    });
    $('#txt_importer_regex').on('input', function () {
        settings.chapterRegex = $(this).val();
        saveSettings();
    });
    $('#txt_importer_batch').on('input', function () {
        const val = parseInt($(this).val(), 10);
        settings.batchSize = isNaN(val) || val < 1 ? 1 : val;
        $(this).val(settings.batchSize);
        saveSettings();
    });

    // 导入按钮
    $('#txt_importer_import_btn').on('click', async function () {
        const fileInput = document.getElementById('txt_importer_file');
        const file = fileInput.files[0];
        if (!file) {
            toastr.warning('请先选择一个 TXT 文件');
            return;
        }

        const reader = new FileReader();
        $('#txt_importer_status').text('读取文件中...');

        reader.onload = async function (e) {
            const text = e.target.result;
            const charA = settings.charA || '我';
            const charB = settings.charB || '对方';
            const regex = settings.chapterRegex || defaultSettings.chapterRegex;
            const batchSize = settings.batchSize || 5;

            $('#txt_importer_status').text('正在解析章节...');
            const chapters = parseChapters(text, regex);

            if (chapters.length === 0) {
                toastr.error('未检测到任何章节，请检查正则或文件内容');
                $('#txt_importer_status').text('');
                return;
            }

            // 构建消息列表，奇偶分配
            const messages = [];
            chapters.forEach((chapter, index) => {
                // 索引从0开始，0,2,4...为奇数章（基数）
                const sender = (index % 2 === 0) ? charA : charB;
                const formatted = formatContent(chapter.content);
                if (!formatted.trim()) return; // 跳过空章节
                messages.push({
                    sender: sender,
                    formattedContent: formatted,
                });
            });

            if (messages.length === 0) {
                toastr.error('所有章节均为空内容，无法导入');
                $('#txt_importer_status').text('');
                return;
            }

            // 开始分批插入
            $('#txt_importer_status').text(`准备导入 ${messages.length} 条消息...`);
            await insertMessagesInBatches(
                messages,
                batchSize,
                charA,
                charB,
                (status) => { $('#txt_importer_status').text(status); }
            );
        };

        reader.onerror = function () {
            toastr.error('文件读取失败');
        };

        reader.readAsText(file, 'UTF-8');
    });
}

// ------------------- 移动端样式适配（注入 CSS） -------------------
function injectStyles() {
    const style = `
    <style id="txt_importer_style">
        .txt-importer {
            margin-top: 1em;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 10px;
            padding: 15px;
            background: var(--SmartThemeBlurTintColor);
        }
        .txt-importer .flex-container {
            margin-bottom: 8px;
        }
        .txt-importer input[type="text"],
        .txt-importer input[type="number"] {
            width: 100%;
            box-sizing: border-box;
        }
        .txt-importer button {
            width: 100%;
        }
        @media screen and (max-width: 600px) {
            .txt-importer {
                padding: 10px;
            }
        }
    </style>`;
    $('head').append(style);
}

// ------------------- 扩展入口 -------------------
jQuery(async () => {
    loadSettings();
    injectStyles();
    addSettingsHtml();
    bindEvents();
    console.log('[TXT小说导入器] 扩展已加载');
});
