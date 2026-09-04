// pages/ball/list.js
// 约球广场列表页
// 职责：
//   1. 拉取 ball_posts 集合中所有 open 状态帖子，按 createdAt 倒序
//   2. 在前端做轻量字段映射（sportLabel / sportEmoji / statusLabel / progress / timeAgo）
//   3. 点击卡片跳转 detail
//   4. 右下角悬浮按钮跳转 publish

const SPORT_MAP = {
  tennis:     { label: '网球',   emoji: '🎾' },
  basketball: { label: '篮球',   emoji: '🏀' },
  badminton:  { label: '羽毛球', emoji: '🏸' },
  football:   { label: '足球',   emoji: '⚽' },
  pingpong:   { label: '乒乓球', emoji: '🏓' },
  volleyball: { label: '排球',   emoji: '🏐' }
};

const STATUS_MAP = {
  open:   '招募中',
  closed: '已截止'
};

const SCOPE_MAP = {
  all:     '全校',
  college: '本院',
  grade:   '同年级'
};

Page({
  data: {
    list: [],
    loading: true,
    noMore: false,
    defaultAvatar: '/images/icons/avatar.png'
  },

  onLoad() {
    this._isLoaded = true;
    this.fetchList();
  },

  // 每次回到列表都刷新一次（发布后切回 tab、详情取消入队后回退都能看到最新）
  // 关键：tabBar 页面 switchTab 不会触发 onLoad，必须靠 onShow 刷新
  // 用 _isLoaded 标记避免每次重复闪一下 loading
  onShow() {
    if (this._isLoaded) {
      this.fetchList(true);
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.fetchList(true).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 拉取列表
  async fetchList(silent = false) {
    if (!silent) this.setData({ loading: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'list', pageSize: 50 }
      });
      if (resp.result && resp.result.success) {
        const raw = resp.result.data.list || [];
        const list = raw.map((item) => this._mapItem(item));
        this.setData({
          list,
          loading: false,
          noMore: list.length < 50
        });
      } else {
        this.setData({ loading: false });
        wx.showToast({
          title: (resp.result && resp.result.errMsg) || '加载失败',
          icon: 'none'
        });
      }
    } catch (e) {
      // 关键：把真实错误打印到控制台 + 用 showModal 显示，方便定位
      console.error('[ball list] fetch failed 真实错误:', e);
      this.setData({ loading: false });
      const realErr = (e && (e.errMsg || e.message)) || JSON.stringify(e);
      wx.showModal({
        title: '云函数调用失败',
        content: '真实错误：\n' + realErr + '\n\n常见原因：\n1. cloudfunctions/ballAdd 没上传\n2. ball_posts 集合未创建\n3. env ID 填错',
        showCancel: false,
        confirmText: '我知道了'
      });
    }
  },

  // 字段映射：把后端原始数据转成前端展示用字段
  _mapItem(item) {
    const sport = SPORT_MAP[item.sport] || { label: item.sport, emoji: '🏅' };
    const statusLabel = STATUS_MAP[item.status] || '招募中';
    const progress = Math.min(
      Math.round(((item.currentCount || 1) / (item.needCount || 1)) * 100),
      100
    );
    return {
      ...item,
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      statusLabel,
      progress,
      scopeLabel: SCOPE_MAP[item.scope] || '全校',
      timeAgo: this._timeAgo(item.createdAt)
    };
  },

  // 简单的相对时间
  _timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}小时前`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()}`;
  },

  // 点击卡片：跳详情
  // 用 eventChannel 把列表里已有的 item 传过去，详情页可以立即渲染不用等云函数
  onTapItem(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find((p) => p._id === id);
    wx.navigateTo({
      url: `/pages/ball/detail?id=${id}`,
      success: (res) => {
        if (item && res.eventChannel) {
          res.eventChannel.emit('post', item);
        }
      }
    });
  },

  // 点击悬浮按钮：跳发布
  onTapPublish() {
    wx.navigateTo({ url: '/pages/ball/publish' });
  }
});
