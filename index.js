// index.js
(function() {
    const pluginName = 'novel-importer';
    
    // 插件初始化
    function init() {
        // 添加导入按钮到顶部工具栏
        const toolbar = document.querySelector('#rm_button_panel') || document.querySelector('.drawer-content');
        if (toolbar) {
            const importBtn = document.createElement('div');
            importBtn.id = 'novel_import_button';
            importBtn.className = 'menu_button';
            importBtn.title = '导入小说';
            importBtn.innerHTML = '<i class="fa-solid fa-book"></i> 导入小说';
            importBtn.addEventListener('click', showImportDialog);
            toolbar.appendChild(importBtn);
        }
    }
    
    // 显示导入对话框
    function showImportDialog() {
        const dialogHTML = `
            <div id="novel_import_dialog" class="novel-import-overlay">
                <div class="novel-import-container">
                    <div class="novel-import-header">
                        <h2>导入TXT小说</h2>
                        <button class="novel-close-btn" onclick="document.getElementById('novel_import_dialog').remove()">×</button>
                    </div>
                    <div class="novel-import-body">
                        <div class="import-section">
                            <label>选择小说文件 (TXT)</label>
                            <input type="file" id="novel_file_input" accept=".txt" />
                        </div>
                        
                        <div class="import-section">
                            <label>章节分隔符 (正则表达式)</label>
                            <input type="text" id="chapter_separator" 
                                   value="第[\\d零一二三四五六七八九十百千万]+[章节回]|Chapter \\d+" 
                                   placeholder="例如: 第.*章" />
                            <small>默认匹配 "第X章"、"第X节"、"Chapter X" 等格式</small>
                        </div>
                        
                        <div class="import-section">
                            <label>
                                <input type="checkbox" id="alternate_speakers" checked />
                                交替说话者（奇数章为用户，偶数章为角色）
                            </label>
                        </div>
                        
                        <div class="import-section">
                            <label>每次导入章节数</label>
                            <input type="number" id="chapters_per_batch" value="10" min="1" max="50" />
                            <small>一次导入太多可能卡顿，建议10-20章</small>
                        </div>
                        
                        <div class="import-preview" id="preview_area" style="display:none;">
                            <h3>预览前3章</h3>
                            <div id="preview_content"></div>
                        </div>
                    </div>
                    <div class="novel-import-footer">
                        <button id="preview_btn" class="menu_button">预览章节</button>
                        <button id="import_btn" class="menu_button" disabled>开始导入</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', dialogHTML);
        
        // 绑定事件
        document.getElementById('preview_btn').addEventListener('click', previewChapters);
        document.getElementById('import_btn').addEventListener('click', importNovel);
    }
    
    let parsedChapters = [];
    
    // 预览章节
    async function previewChapters() {
        const fileInput = document.getElementById('novel_file_input');
        const separatorInput = document.getElementById('chapter_separator');
        
        if (!fileInput.files[0]) {
            toastr.warning('请先选择小说文件');
            return;
        }
        
        const file = fileInput.files[0];
        const text = await file.text();
        
        // 解析章节
        parsedChapters = parseNovel(text, separatorInput.value);
        
        if (parsedChapters.length === 0) {
            toastr.error('未能识别章节，请调整分隔符');
            return;
        }
        
        // 显示预览
        const previewArea = document.getElementById('preview_area');
        const previewContent = document.getElementById('preview_content');
        
        const preview = parsedChapters.slice(0, 3).map((chapter, idx) => {
            const speaker = (idx % 2 === 0) ? '用户' : '角色';
            return `
                <div class="chapter-preview">
                    <strong>${chapter.title}</strong> <span class="speaker-tag">[${speaker}]</span>
                    <p>${chapter.content.substring(0, 200)}${chapter.content.length > 200 ? '...' : ''}</p>
                </div>
            `;
        }).join('');
        
        previewContent.innerHTML = preview;
        previewArea.style.display = 'block';
        
        document.getElementById('import_btn').disabled = false;
        toastr.success(`识别到 ${parsedChapters.length} 章节`);
    }
    
    // 解析小说
    function parseNovel(text, separator) {
        const regex = new RegExp(separator, 'gm');
        const chapters = [];
        
        const matches = [...text.matchAll(regex)];
        
        for (let i = 0; i < matches.length; i++) {
            const startIdx = matches[i].index;
            const endIdx = matches[i + 1]?.index || text.length;
            const chapterTitle = matches[i][0];
            const chapterContent = text.substring(startIdx + chapterTitle.length, endIdx).trim();
            
            if (chapterContent.length > 0) {
                chapters.push({
                    title: chapterTitle,
                    content: chapterContent
                });
            }
        }
        
        return chapters;
    }
    
    // 导入小说到聊天
    async function importNovel() {
        const alternate = document.getElementById('alternate_speakers').checked;
        const batchSize = parseInt(document.getElementById('chapters_per_batch').value);
        
        if (parsedChapters.length === 0) {
            toastr.error('请先预览章节');
            return;
        }
        
        const totalChapters = parsedChapters.length;
        let imported = 0;
        
        // 分批导入
        for (let i = 0; i < totalChapters; i += batchSize) {
            const batch = parsedChapters.slice(i, i + batchSize);
            
            for (let j = 0; j < batch.length; j++) {
                const chapter = batch[j];
                const globalIdx = i + j;
                const isUser = alternate ? (globalIdx % 2 === 0) : true;
                
                // 调用 SillyTavern 的消息添加函数
                await addMessageToChat(chapter.title, chapter.content, isUser);
                imported++;
            }
            
            toastr.info(`已导入 ${imported}/${totalChapters} 章节`);
            
            // 避免卡顿，分批延迟
            if (i + batchSize < totalChapters) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        toastr.success(`导入完成！共 ${imported} 章节`);
        document.getElementById('novel_import_dialog').remove();
    }
    
    // 添加消息到聊天（适配 SillyTavern API）
    async function addMessageToChat(title, content, isUser) {
        const message = `**${title}**\n\n${content}`;
        
        // SillyTavern 的标准消息添加方式
        if (typeof addOneMessage === 'function') {
            addOneMessage({
                name: isUser ? 'You' : getCharacterName(),
                is_user: isUser,
                mes: message,
                send_date: Date.now()
            });
        } else {
            console.error('SillyTavern API 不可用');
        }
    }
    
    // 获取当前角色名称
    function getCharacterName() {
        return this_chid !== undefined ? characters[this_chid]?.name || 'Character' : 'Character';
    }
    
    // jQuery ready
    jQuery(async () => {
        init();
    });
})();