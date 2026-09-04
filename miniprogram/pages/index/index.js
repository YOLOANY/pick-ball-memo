// pages/index/index.js
// 首页：模块入口 + 「我需要赴约」section
// 注意：ball/list 是 tabBar 页面（app.json:40），必须用 switchTab；其他用 navigateTo
const TAB_BAR_PAGES = ['/pages/index/index', '/pages/ball/list', '/pages/mine/index'];
const { callCloud } = require('../../utils/cloud.js');

// 运动项目 → 中文 + emoji（与 list.js 保持一致）
const SPORT_MAP = {
  tennis:     { label: '网球',   emoji: '🎾' },
  basketball: { label: '篮球',   emoji: '🏀' },
  badminton:  { label: '羽毛球', emoji: '🏸' },
  football:   { label: '足球',   emoji: '⚽' },
  pingpong:   { label: '乒乓球', emoji: '🏓' },
  volleyball: { label: '排球',   emoji: '🏐' }
};

Page({
  data: {
    upcomingList: []
  },

  onLoad() {
    this._isLoaded = true;
  },

  // 每次回到首页都刷新一次（用户发布/入队/取消后回到首页能立刻看到）
  onShow() {
    if (this._isLoaded) this.fetchUpcoming();
  },

  // 拉取「我需要赴约」的 5 条
  async fetchUpcoming() {
    try {
      const r = await callCloud('ballAdd', { type: 'myUpcoming' });
      if (r.result && r.result.success) {
        const raw = r.result.data.list || [];
        const list = raw.map((it) => this._mapItem(it));
        this.setData({ upcomingList: list });
      } else {
        // 拉取失败时不清空已有数据，保持上一次结果（避免跳来跳去时闪）
      }
    } catch (e) {
      console.error('[index] fetchUpcoming failed', e);
    }
  },

  // 字段映射：补全 sportLabel / sportEmoji / 倒计时
  _mapItem(item) {
    const sport = SPORT_MAP[item.sport] || { label: item.sport || '运动', emoji: '🏅' };
    const ms = item.msUntil || 0;
    const countdownText = this._formatCountdown(ms);
    // 24h 内 → 紧急
    const urgent = ms < 24 * 60 * 60 * 1000;
    return Object.assign({}, item, {
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      countdownText,
      urgent
    });
  },

  _formatCountdown(ms) {
    if (!ms || ms <= 0) return '即将开始';
    const min = Math.floor(ms / 60000);
    if (min < 60) return `还有 ${min} 分钟开始`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h < 24) return `还有 ${h} 小时${m > 0 ? m + ' 分' : ''}开始`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `还有 ${d} 天${rh > 0 ? rh + ' 小时' : ''}开始`;
  },

  onNav(e) {
    const url = e.currentTarget.dataset.url;
    if (TAB_BAR_PAGES.includes(url)) {
      wx.switchTab({ url });
    } else {
      wx.navigateTo({ url });
    }
  },

  // 点击「我需要赴约」卡片 → 跳详情
  onTapUpcoming(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: '/pages/ball/detail?id=' + id });
  },

  // 「查看全部」→ 切到 ball/my 页面（我参与的）
  onGoMy() {
    wx.switchTab({ url: '/pages/ball/my' });
  }
});
