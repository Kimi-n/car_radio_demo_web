// 完全重写的AudioPlayer类
// 确保没有任何可能导致播放速度变快的问题

class AudioPlayer {
    constructor() {
        try {
            console.log('AudioPlayer构造函数开始执行');
            this.audioElement = new Audio();
            console.log('创建audioElement:', this.audioElement);
            this.currentChannelIndex = 0;
            this.currentCategoryIndex = 0;
            this.currentItemIndex = 0;
            this.isPlaying = false;
            console.log('初始化属性完成');
            
            this.audioData = this.loadAudioList();
            console.log('加载音频数据完成:', this.audioData);
            
            this.setupEventListeners();
            console.log('设置事件监听器完成');
            
            // 延迟调用fetchFromCloud，确保DOM元素完全加载
            setTimeout(() => {
                console.log('调用fetchFromCloud');
                this.fetchFromCloud();
                console.log('fetchFromCloud调用完成');
            }, 1000); // 增加延迟时间，确保DOM元素完全加载
            
            console.log('AudioPlayer构造函数执行完成');
        } catch (error) {
            console.error('AudioPlayer构造函数执行失败:', error);
        }
    }

    loadAudioList() {
        // 默认返回空数据，实际数据将通过fetchFromCloud方法从云侧获取
        return {
            channels: []
        };
    }

    // 将下游服务响应转换为前端内部的 channels 结构
    // 顶层: channels = [{ name: '新闻资讯', categories: [...] }, { name: '播客', categories: [...] }]
    // 每个 category: { name: '时政', items: [...] }
    transformDownstreamData(data) {
        const channels = [];

        if (data.news && Array.isArray(data.news) && data.news.length > 0) {
            channels.push({
                name: '新闻资讯',
                categories: data.news.map(cat => ({
                    name: cat.category || '',
                    items: cat.items || []
                }))
            });
        }

        if (data.podcasts && Array.isArray(data.podcasts) && data.podcasts.length > 0) {
            channels.push({
                name: '播客',
                categories: data.podcasts.map(cat => ({
                    name: cat.category || '',
                    items: cat.items || []
                }))
            });
        }

        return { channels };
    }

    // 生成唯一的 sessionId
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    }

    // 从云侧获取音频数据
    async fetchFromCloud() {
        try {
            console.log('从云侧获取音频数据');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            // 生成或复用 sessionId
            if (!this.sessionId) {
                this.sessionId = this.generateSessionId();
            }

            const response = await fetch('http://localhost:3000/api/audio-data', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ sessionId: this.sessionId })
            });
            clearTimeout(timeoutId);

            console.log('获取响应:', response);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('从云侧获取音频数据成功:', data);

            // 将下游服务的 news/podcasts 格式转换为内部 channels 格式
            this.audioData = this.transformDownstreamData(data);
            console.log('转换后的audioData:', this.audioData);

            // 检查audioData是否有数据
            if (this.audioData && this.audioData.channels && this.audioData.channels.length > 0) {
                console.log('audioData有数据，更新播放列表UI');
                this.updatePlaylistUI();
                console.log('初始化播放第一首音频');
                this.playAudio(0, 0, 0);
            } else {
                console.error('audioData没有数据');
                this.useLocalFallbackData();
            }
        } catch (error) {
            console.error('从云侧获取音频数据失败:', error);
            this.useLocalFallbackData();
        }
    }
    
    // 使用本地备用数据（已适配下游服务字段格式）
    useLocalFallbackData() {
        console.log('使用本地备用数据');
        this.audioData = {
            channels: [
                {
                    name: '新闻资讯',
                    categories: [
                        {
                            name: '时政',
                            items: [
                                {
                                    docId: 'news1',
                                    title: '2026年2月12日早间新闻',
                                    siteName: '新闻播客',
                                    image: '',
                                    content: '今天是2026年2月12日，星期三。欢迎收听早间新闻播报。首先来看国内新闻。据国家统计局最新数据，2026年1月份，全国居民消费价格同比上涨1.5%。',
                                    publishTime: '2026-02-12',
                                    aiStatement: ''
                                }
                            ]
                        },
                        {
                            name: '科技',
                            items: [
                                {
                                    docId: 'news2',
                                    title: '量子计算领域取得重大突破',
                                    siteName: '科技日报',
                                    image: '',
                                    content: '中国科学院宣布，我国科学家在量子计算领域取得重大突破，成功构建了66比特量子计算原型机。',
                                    publishTime: '2026-02-10',
                                    aiStatement: ''
                                }
                            ]
                        }
                    ]
                },
                {
                    name: '播客',
                    categories: [
                        {
                            name: '今日大事',
                            items: [
                                {
                                    docId: 'podcast1',
                                    title: '今日要闻速览',
                                    siteName: '每日播客',
                                    image: '',
                                    content: '欢迎收听今日大事播客，为您带来最新的重要资讯。',
                                    publishTime: '2026-02-12',
                                    aiStatement: ''
                                }
                            ]
                        }
                    ]
                }
            ]
        };
        this.updatePlaylistUI();
        this.playAudio(0, 0, 0);
    }

    setupEventListeners() {
        try {
            // 控制按钮事件
            document.getElementById('btn-play-pause').addEventListener('click', () => this.togglePlayPause());
            document.getElementById('btn-previous').addEventListener('click', () => this.playPrevious());
            document.getElementById('btn-next').addEventListener('click', () => this.playNext());

            // 进度条事件
            document.getElementById('progress-bar').addEventListener('input', (e) => this.seek(e.target.value));

            // 功能按钮事件
            document.getElementById('btn-playlist').addEventListener('click', () => this.showPlaylist());
            if (document.getElementById('btn-audio-text')) {
                document.getElementById('btn-audio-text').addEventListener('click', () => this.showAudioText());
            }
            document.getElementById('btn-voice-control').addEventListener('click', () => this.startVoiceControl());

            // 关闭按钮事件
            if (document.getElementById('close-audio-text')) {
                document.getElementById('close-audio-text').addEventListener('click', () => this.hideAudioText());
            }
            if (document.getElementById('close-playlist')) {
                document.getElementById('close-playlist').addEventListener('click', () => this.hidePlaylist());
            }

            // 音频元素真实事件
            this.audioElement.addEventListener('timeupdate', () => this.onTimeUpdate());
            this.audioElement.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
            this.audioElement.addEventListener('ended', () => this.onEnded());
            this.audioElement.addEventListener('play', () => {
                this.isPlaying = true;
                this.updatePlayPauseIcon();
            });
            this.audioElement.addEventListener('pause', () => {
                this.isPlaying = false;
                this.updatePlayPauseIcon();
            });
        } catch (error) {
            console.error('设置事件监听器时出错:', error);
        }
    }

    // 判断音频总时长是否已知
    isDurationKnown() {
        const duration = this.audioElement.duration;
        return duration && isFinite(duration) && duration > 0;
    }

    // 更新进度条的可拖动状态
    updateProgressBarState() {
        const progressBar = document.getElementById('progress-bar');
        if (!progressBar) return;

        if (this.isDurationKnown()) {
            progressBar.disabled = false;
            progressBar.style.opacity = '1';
            progressBar.style.cursor = 'pointer';
        } else {
            progressBar.disabled = true;
            progressBar.style.opacity = '0.5';
            progressBar.style.cursor = 'not-allowed';
        }
    }

    // 音频时间更新 - 驱动进度条和时间显示
    onTimeUpdate() {
        const currentTime = this.audioElement.currentTime;
        const currentTimeEl = document.getElementById('current-time');
        if (currentTimeEl) currentTimeEl.textContent = this.formatTime(currentTime);

        const progressBar = document.getElementById('progress-bar');
        const totalTimeEl = document.getElementById('total-time');

        if (this.isDurationKnown()) {
            const duration = this.audioElement.duration;
            const progress = (currentTime / duration) * 100;
            if (progressBar) progressBar.value = progress;
            if (totalTimeEl) totalTimeEl.textContent = this.formatTime(duration);
            this.updateSubtitleHighlight(progress);
        } else {
            // 时长未知，进度条不动，总时长显示 --:--
            if (progressBar) progressBar.value = 0;
            if (totalTimeEl) totalTimeEl.textContent = '--:--';
        }

        this.updateProgressBarState();
    }

    // 音频元数据加载完成 - 显示总时长，解锁进度条
    onLoadedMetadata() {
        const totalTimeEl = document.getElementById('total-time');
        if (totalTimeEl && this.isDurationKnown()) {
            totalTimeEl.textContent = this.formatTime(this.audioElement.duration);
        }
        this.updateProgressBarState();
    }

    // 音频播放结束 - 自动切下一首
    onEnded() {
        this.playNext();
        this.play();
    }

    // 根据播放进度高亮字幕段落并滚动
    updateSubtitleHighlight(progress) {
        const subtitleContent = document.getElementById('audio-text-content');
        if (!subtitleContent) return;

        const paragraphs = subtitleContent.querySelectorAll('.subtitle-paragraph');
        if (paragraphs.length === 0) return;

        const currentIndex = Math.min(
            Math.floor((progress / 100) * paragraphs.length),
            paragraphs.length - 1
        );

        paragraphs.forEach(p => p.classList.remove('current'));

        const currentParagraph = paragraphs[currentIndex];
        if (currentParagraph) {
            currentParagraph.classList.add('current');
            const containerHeight = subtitleContent.clientHeight;
            const scrollTo = Math.max(0,
                currentParagraph.offsetTop - (containerHeight / 2) + (currentParagraph.clientHeight / 2)
            );
            subtitleContent.scrollTo({ top: scrollTo, behavior: 'smooth' });
        }
    }

    playAudio(channelIndex, categoryIndex, itemIndex) {
        try {
            console.log('playAudio被调用，channelIndex:', channelIndex, 'categoryIndex:', categoryIndex, 'itemIndex:', itemIndex);
            if (window.savePlayPosition) {
                window.savePlayPosition();
            }

            const channels = this.audioData.channels;
            if (channelIndex < 0 || channelIndex >= channels.length) return;
            const channel = channels[channelIndex];
            if (categoryIndex < 0 || categoryIndex >= channel.categories.length) return;
            const category = channel.categories[categoryIndex];
            if (itemIndex < 0 || itemIndex >= category.items.length) return;

            this.currentChannelIndex = channelIndex;
            this.currentCategoryIndex = categoryIndex;
            this.currentItemIndex = itemIndex;
            const audioItem = category.items[itemIndex];
            // 通过 docId 加载音频流
            if (audioItem.docId) {
                this.audioElement.src = `http://localhost:3000/api/audio-stream?docId=${encodeURIComponent(audioItem.docId)}`;
                this.audioElement.load();
            }
            this.updateAudioInfo(audioItem);
            this.updatePlaylistUI();

            // 重置进度条和时间显示
            const progressBar = document.getElementById('progress-bar');
            const currentTimeEl = document.getElementById('current-time');
            const totalTimeEl = document.getElementById('total-time');
            if (progressBar) progressBar.value = 0;
            if (currentTimeEl) currentTimeEl.textContent = '00:00';
            if (totalTimeEl) totalTimeEl.textContent = '--:--';
            // 流式音频加载中，禁用进度条拖动
            this.updateProgressBarState();
        } catch (error) {
            console.error('playAudio执行失败:', error);
        }
    }

    updateAudioInfo(audioItem) {
        document.getElementById('audio-title').textContent = audioItem.title;
        document.getElementById('audio-subtitle').textContent = audioItem.siteName || '';

        // 更新字幕区内容，将文本分割为段落
        const audioTextContent = document.getElementById('audio-text-content');
        audioTextContent.innerHTML = '';

        // 将内容按句分割为段落
        const sentences = audioItem.content.split('。').filter(s => s.trim() !== '');
        sentences.forEach((sentence, index) => {
            const paragraph = document.createElement('p');
            paragraph.className = 'subtitle-paragraph';
            paragraph.textContent = sentence + '。';
            paragraph.dataset.index = index;
            audioTextContent.appendChild(paragraph);
        });
    }

    updatePlaylistUI() {
        try {
            const tabButtonsContainer = document.getElementById('tab-buttons');
            const tabContentsContainer = document.getElementById('tab-contents');

            if (!tabButtonsContainer || !tabContentsContainer) {
                console.error('播放列表容器元素不存在');
                return;
            }

            tabButtonsContainer.innerHTML = '';
            tabContentsContainer.innerHTML = '';

            if (!this.audioData || !this.audioData.channels) {
                console.error('音频数据不存在');
                return;
            }

            // 第一层：栏目 tab（新闻资讯 / 播客）
            this.audioData.channels.forEach((channel, channelIndex) => {
                const channelTab = document.createElement('button');
                channelTab.className = 'tab-button';
                channelTab.textContent = channel.name;
                if (channelIndex === this.currentChannelIndex) {
                    channelTab.classList.add('active');
                }

                channelTab.addEventListener('click', () => {
                    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                    channelTab.classList.add('active');
                    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
                    document.querySelector(`.tab-content[data-channel-index="${channelIndex}"]`).style.display = 'block';
                });

                tabButtonsContainer.appendChild(channelTab);

                // 栏目内容区
                const channelContent = document.createElement('div');
                channelContent.className = 'tab-content';
                channelContent.dataset.channelIndex = channelIndex;
                channelContent.style.display = channelIndex === this.currentChannelIndex ? 'block' : 'none';

                // 第二层：分类 tab（时政、科技... / 今日大事、订阅...）
                const categoryTabsContainer = document.createElement('div');
                categoryTabsContainer.className = 'category-tabs';

                const categoryContentsContainer = document.createElement('div');
                categoryContentsContainer.className = 'category-contents';

                channel.categories.forEach((category, categoryIndex) => {
                    // 分类 tab 按钮
                    const catTab = document.createElement('button');
                    catTab.className = 'category-tab';
                    catTab.textContent = category.name;
                    if (channelIndex === this.currentChannelIndex && categoryIndex === this.currentCategoryIndex) {
                        catTab.classList.add('active');
                    }

                    catTab.addEventListener('click', () => {
                        categoryTabsContainer.querySelectorAll('.category-tab').forEach(btn => btn.classList.remove('active'));
                        catTab.classList.add('active');
                        categoryContentsContainer.querySelectorAll('.category-content').forEach(c => c.style.display = 'none');
                        categoryContentsContainer.querySelector(`.category-content[data-category-index="${categoryIndex}"]`).style.display = 'block';
                    });

                    categoryTabsContainer.appendChild(catTab);

                    // 分类内容：item 列表
                    const catContent = document.createElement('div');
                    catContent.className = 'category-content';
                    catContent.dataset.categoryIndex = categoryIndex;
                    const isActiveCat = channelIndex === this.currentChannelIndex && categoryIndex === this.currentCategoryIndex;
                    catContent.style.display = isActiveCat ? 'block' : 'none';

                    const audioList = document.createElement('ul');
                    audioList.className = 'audio-list';

                    category.items.forEach((item, itemIndex) => {
                        const listItem = document.createElement('li');
                        listItem.className = 'audio-item';

                        if (channelIndex === this.currentChannelIndex &&
                            categoryIndex === this.currentCategoryIndex &&
                            itemIndex === this.currentItemIndex) {
                            listItem.classList.add('active');
                        }

                        listItem.addEventListener('click', () => {
                            this.playAudio(channelIndex, categoryIndex, itemIndex);
                            if (this.isPlaying) {
                                this.play();
                            }
                        });

                        const audioInfo = document.createElement('div');
                        audioInfo.className = 'audio-item-info';

                        const audioTitle = document.createElement('h4');
                        audioTitle.textContent = item.title;

                        const audioSource = document.createElement('p');
                        audioSource.textContent = item.siteName || '';

                        audioInfo.appendChild(audioTitle);
                        audioInfo.appendChild(audioSource);
                        listItem.appendChild(audioInfo);
                        audioList.appendChild(listItem);
                    });

                    catContent.appendChild(audioList);
                    categoryContentsContainer.appendChild(catContent);
                });

                channelContent.appendChild(categoryTabsContainer);
                channelContent.appendChild(categoryContentsContainer);
                tabContentsContainer.appendChild(channelContent);
            });
        } catch (error) {
            console.error('更新播放列表UI时出错:', error);
        }
    }

    togglePlayPause() {
        console.log('togglePlayPause被调用，当前isPlaying状态:', this.isPlaying);
        if (this.isPlaying) {
            console.log('当前正在播放，调用pause()');
            this.pause();
        } else {
            console.log('当前正在暂停，调用play()');
            this.play();
        }
    }

    play() {
        this.audioElement.play().catch(error => {
            console.error('音频播放失败:', error);
        });
    }

    pause() {
        this.audioElement.pause();
    }

    // 获取当前分类的 items
    getCurrentCategory() {
        return this.audioData.channels[this.currentChannelIndex].categories[this.currentCategoryIndex];
    }

    playPrevious() {
        const category = this.getCurrentCategory();
        if (this.currentItemIndex > 0) {
            // 当前分类内切到上一条
            this.playAudio(this.currentChannelIndex, this.currentCategoryIndex, this.currentItemIndex - 1);
        } else {
            // 切到上一个分类的最后一条（在同一栏目内循环）
            const channel = this.audioData.channels[this.currentChannelIndex];
            const newCatIndex = (this.currentCategoryIndex - 1 + channel.categories.length) % channel.categories.length;
            const newCat = channel.categories[newCatIndex];
            this.playAudio(this.currentChannelIndex, newCatIndex, newCat.items.length - 1);
        }
        if (this.isPlaying) {
            this.play();
        }
    }

    playNext() {
        const category = this.getCurrentCategory();
        if (this.currentItemIndex < category.items.length - 1) {
            // 当前分类内切到下一条
            this.playAudio(this.currentChannelIndex, this.currentCategoryIndex, this.currentItemIndex + 1);
        } else {
            // 切到下一个分类的第一条（在同一栏目内循环）
            const channel = this.audioData.channels[this.currentChannelIndex];
            const newCatIndex = (this.currentCategoryIndex + 1) % channel.categories.length;
            this.playAudio(this.currentChannelIndex, newCatIndex, 0);
        }
        if (this.isPlaying) {
            this.play();
        }
    }

    seek(value) {
        if (!this.isDurationKnown()) return;
        this.audioElement.currentTime = this.audioElement.duration * (value / 100);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    updatePlayPauseIcon() {
        const playPauseBtn = document.getElementById('btn-play-pause');
        if (!playPauseBtn) return;

        const icon = playPauseBtn.querySelector('i');
        if (!icon) return;

        icon.className = this.isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }

    showPlaylist() {
        const playlistModal = document.getElementById('playlist-modal');
        playlistModal.style.display = 'block';
    }

    hidePlaylist() {
        const playlistModal = document.getElementById('playlist-modal');
        playlistModal.style.display = 'none';
    }

    showAudioText() {
        const audioTextContainer = document.getElementById('audio-text-container');
        audioTextContainer.style.display = 'block';
    }

    hideAudioText() {
        const audioTextContainer = document.getElementById('audio-text-container');
        audioTextContainer.style.display = 'none';
    }

    startVoiceControl() {
        // 模拟语音控制
        const voiceControlHint = document.getElementById('voice-control-hint');
        voiceControlHint.style.display = 'block';
        
        // 3秒后隐藏提示
        setTimeout(() => {
            voiceControlHint.style.display = 'none';
        }, 3000);
    }
}