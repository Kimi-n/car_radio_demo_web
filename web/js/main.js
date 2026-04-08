// main.js - 页面初始化和播放位置持久化

var audioPlayer = null;

window.onload = function() {
    try {
        audioPlayer = new AudioPlayer();

        // 恢复播放位置
        restorePlayPosition();

        // 点击模态框外部关闭模态框
        window.onclick = function(event) {
            var modal = document.getElementById('playlist-modal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        };

        // 监听上一首/下一首按钮，保存播放位置
        var btnPrevious = document.getElementById('btn-previous');
        if (btnPrevious) {
            btnPrevious.addEventListener('click', function() {
                savePlayPosition();
            });
        }

        var btnNext = document.getElementById('btn-next');
        if (btnNext) {
            btnNext.addEventListener('click', function() {
                savePlayPosition();
            });
        }

        // 页面离开时保存播放位置
        window.addEventListener('beforeunload', function() {
            savePlayPosition();
        });
    } catch (error) {
        console.error('页面初始化时出错:', error);
    }
};

// 保存播放位置
function savePlayPosition() {
    if (!audioPlayer) return;

    var progressBar = document.getElementById('progress-bar');
    var playPosition = {
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

    var savedPosition = localStorage.getItem('playPosition');
    if (!savedPosition) return;

    try {
        var pos = JSON.parse(savedPosition);
        var channels = audioPlayer.audioData.channels;
        if (!channels || !channels.length) return;

        var chIdx = pos.channelIndex || 0;
        var catIdx = pos.categoryIndex || 0;
        var itemIdx = pos.itemIndex || 0;

        // 边界检查
        if (chIdx >= channels.length) return;
        if (catIdx >= channels[chIdx].categories.length) return;
        if (itemIdx >= channels[chIdx].categories[catIdx].items.length) return;

        audioPlayer.currentChannelIndex = chIdx;
        audioPlayer.currentCategoryIndex = catIdx;
        audioPlayer.currentItemIndex = itemIdx;

        var item = channels[chIdx].categories[catIdx].items[itemIdx];
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
