// main.js - 页面初始化和播放位置持久化

let audioPlayer = null;

window.onload = () => {
    try {
        audioPlayer = new AudioPlayer();

        // 恢复播放位置
        restorePlayPosition();

        // 点击模态框外部关闭模态框
        window.onclick = (event) => {
            const modal = document.getElementById('playlist-modal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        };

        // 监听上一首/下一首按钮，保存播放位置
        const btnPrevious = document.getElementById('btn-previous');
        if (btnPrevious) {
            btnPrevious.addEventListener('click', () => savePlayPosition());
        }

        const btnNext = document.getElementById('btn-next');
        if (btnNext) {
            btnNext.addEventListener('click', () => savePlayPosition());
        }

        // 搜索/query 输入
        const queryInput = document.getElementById('query-input');
        const btnQuerySend = document.getElementById('btn-query-send');

        const sendQuery = () => {
            if (!queryInput || !audioPlayer) return;
            const query = queryInput.value.trim();
            if (!query) return;
            console.log('发送 query:', query);
            audioPlayer.fetchFromCloudWithQuery(query);
            queryInput.value = '';
        };

        if (btnQuerySend) {
            btnQuerySend.addEventListener('click', sendQuery);
        }
        if (queryInput) {
            queryInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') sendQuery();
            });
        }

        // 页面离开时保存播放位置
        window.addEventListener('beforeunload', () => savePlayPosition());
    } catch (error) {
        console.error('页面初始化时出错:', error);
    }
};

// 保存播放位置
function savePlayPosition() {
    if (!audioPlayer) return;

    const playPosition = {
        channelIndex: audioPlayer.currentChannelIndex,
        categoryIndex: audioPlayer.currentCategoryIndex,
        itemIndex: audioPlayer.currentItemIndex,
        currentTime: audioPlayer.audioElement.currentTime || 0
    };

    localStorage.setItem('playPosition', JSON.stringify(playPosition));
}

// 恢复播放位置
function restorePlayPosition() {
    if (!audioPlayer) return;

    const savedPosition = localStorage.getItem('playPosition');
    if (!savedPosition) return;

    try {
        const pos = JSON.parse(savedPosition);
        const channels = audioPlayer.audioData.channels;
        if (!channels || !channels.length) return;

        const chIdx = pos.channelIndex || 0;
        const catIdx = pos.categoryIndex || 0;
        const itemIdx = pos.itemIndex || 0;

        // 边界检查
        if (chIdx >= channels.length) return;
        if (catIdx >= channels[chIdx].categories.length) return;
        if (itemIdx >= channels[chIdx].categories[catIdx].items.length) return;

        audioPlayer.currentChannelIndex = chIdx;
        audioPlayer.currentCategoryIndex = catIdx;
        audioPlayer.currentItemIndex = itemIdx;

        const item = channels[chIdx].categories[catIdx].items[itemIdx];
        audioPlayer.updateAudioInfo(item);
        audioPlayer.updatePlaylistUI();

        // 恢复播放时间点
        if (pos.currentTime > 0) {
            audioPlayer.audioElement.addEventListener('loadedmetadata', function onMeta() {
                audioPlayer.audioElement.currentTime = pos.currentTime;
                audioPlayer.audioElement.removeEventListener('loadedmetadata', onMeta);
            });
        }
    } catch (error) {
        console.error('恢复播放位置时出错:', error);
    }
}

// 全局函数供 audioPlayer 调用
window.savePlayPosition = savePlayPosition;
