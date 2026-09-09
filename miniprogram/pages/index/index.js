// pages/index/index.js
// 首页：聚合预览 + 快速入口
// 注意：ball/list 和 equipment/list 是 tabBar 页面（app.json:40+），必须用 switchTab；其他用 navigateTo
const TAB_BAR_PAGES = ['/pages/index/index', '/pages/ball/list', '/pages/equipment/list', '/pages/mine/index'];
const { callCloud } = require('../../utils/cloud.js');

// 运动项目 → 中文 + emoji（与 ball 列表保持一致）
const SPORT_MAP = {
  tennis:     { label: '网球',   emoji: '🎾' },
  basketball: { label: '篮球',   emoji: '🏀' },
  badminton:  { label: '羽毛球', emoji: '🏸' },
  football:   { label: '足球',   emoji: '⚽' },
  pingpong:   { label: '乒乓球', emoji: '🏓' },
  volleyball: { label: '排球',   emoji: '🏐' }
};

const CATEGORY_MAP = {
  racket:  { label: '球拍类', emoji: '🏸' },
  ball:    { label: '球类',   emoji: '⚽' },
  shoe:    { label: '鞋服',   emoji: '👟' },
  other:   { label: '其他',   emoji: '🎽' }
};

Page({
  data: {
    // 待办提醒（保持原有功能）
    upcomingList: [],
    upcomingUrgentCount: 0,
    upcomingCriticalCount: 0,
    upcomingTotal: 0,
    // 公告栏（横向滚动）
    announcements: [
      { id: 'a1', emoji: '🎉', text: '新功能上线：出物共享支持出售啦' },
      { id: 'a2', emoji: '⛅', text: '周末天气晴，约球好时机' },
      { id: 'a3', emoji: '📢', text: '校园网球场地周末可预约' },
      { id: 'a4', emoji: '💡', text: '闲置出物共享，绿色校园' }
    ],
    // 快捷功能
    quickActions: [
      { id: 'venue',  emoji: '🏟️', name: '场地预约', desc: '网球场/羽毛球场', url: '/pages/venue/list' },
      { id: 'moment', emoji: '🏃', name: '运动打卡', desc: '分享运动时刻',   url: '/pages/moment/list' }
    ],
    // 预览：最新约球
    ballPreviews: [],
    ballTotal: 0,
    // 预览：热门共享出物
    equipPreviews: [],
    equipTotal: 0,
    // 快速发布弹窗
    showPublishModal: false
  },

  onLoad() {
    this.fetchUpcoming();
    this.fetchBallPreviews();
    this.fetchEquipPreviews();
  },

  onShow() {
    // 每次回到首页都刷新一次（发布/入队/取消后回到首页能立刻看到）
    this.fetchUpcoming();
  },

  // ============ 待办提醒 ============
  async fetchUpcoming() {
    try {
      const r = await callCloud('ballAdd', { type: 'myUpcoming' });
      if (r.result && r.result.success) {
        const raw = r.result.data.list || [];
        const list = raw.map((it) => this._mapUpcomingItem(it));
        const urgentCount = list.filter((it) => it.urgentLevel !== 'normal').length;
        const criticalCount = list.filter((it) => it.urgentLevel === 'critical').length;
        this.setData({
          upcomingList: list,
          upcomingUrgentCount: urgentCount,
          upcomingCriticalCount: criticalCount,
          upcomingTotal: r.result.data.total || list.length
        });
      }
    } catch (e) {
      console.error('[index] fetchUpcoming failed', e);
    }
  },

  _mapUpcomingItem(item) {
    const sport = SPORT_MAP[item.sport] || { label: item.sport || '运动', emoji: '🏅' };
    const ms = item.msUntil || 0;
    const countdownText = this._formatCountdown(ms);
    const TWO_HOUR = 2 * 60 * 60 * 1000;
    const ONE_DAY  = 24 * 60 * 60 * 1000;
    let urgentLevel = 'normal';
    if (ms > 0 && ms <= TWO_HOUR) urgentLevel = 'critical';
    else if (ms > 0 && ms <= ONE_DAY) urgentLevel = 'urgent';
    return Object.assign({}, item, {
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      countdownText,
      urgent: ms > 0 && ms < ONE_DAY,
      urgentLevel
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

  // ============ 最新约球预览 ============
  async fetchBallPreviews() {
    try {
      const r = await callCloud('ballAdd', { type: 'list', pageSize: 5 });
      if (r.result && r.result.success) {
        const raw = r.result.data.list || [];
        const list = raw.slice(0, 5).map((p) => {
          const sport = SPORT_MAP[p.sport] || { label: p.sport || '运动', emoji: '🏅' };
          return Object.assign({}, p, {
            sportLabel: sport.label,
            sportEmoji: sport.emoji,
            timeText: this._formatTime(p.time),
            currentCount: p.currentCount || 0,
            needCount: p.needCount || 0
          });
        });
        this.setData({ ballPreviews: list, ballTotal: r.result.data.total || list.length });
      }
    } catch (e) {
      console.error('[index] fetchBallPreviews failed', e);
    }
  },

  _formatTime(t) {
    if (!t) return '';
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  },

  // ============ 热门出物预览 ============
  async fetchEquipPreviews() {
    try {
      const r = await callCloud('equipment', { type: 'list' });
      if (r.result && r.result.success) {
        const raw = r.result.data.list || [];
        const list = raw.slice(0, 5).map((e) => {
          const isSell = e.tradeType === 'sell';
          const cat = CATEGORY_MAP[e.category] || {};
          return Object.assign({}, e, {
            categoryEmoji: cat.emoji || '🎽',
            tradeTypeLabel: isSell ? '出售' : '出租',
            tradeTypeClass: isSell ? 'tag--sell' : 'tag--rent',
            priceText: isSell
              ? `¥${e.salePrice || 0}`
              : (e.pricePerDay > 0 ? `¥${e.pricePerDay}/天` : '免费')
          });
        });
        this.setData({ equipPreviews: list, equipTotal: r.result.data.total || list.length });
      }
    } catch (e) {
      console.error('[index] fetchEquipPreviews failed', e);
    }
  },

  // ============ 导航 ============
  onNav(e) {
    const url = e.currentTarget.dataset.url;
    if (TAB_BAR_PAGES.includes(url)) {
      wx.switchTab({ url });
    } else {
      wx.navigateTo({ url });
    }
  },

  // 搜索框点击：弹出一个简短的提示，让用户去对应 tab 搜索
  onTapSearch() {
    wx.showActionSheet({
      itemList: ['🔍 搜约球', '🔍 搜出物', '🔍 看场地'],
      success: (res) => {
        if (res.tapIndex === 0) wx.switchTab({ url: '/pages/ball/list' });
        else if (res.tapIndex === 1) wx.switchTab({ url: '/pages/equipment/list' });
        else if (res.tapIndex === 2) wx.navigateTo({ url: '/pages/venue/list' });
      }
    });
  },

  // 公告点击：跳到对应模块
  onTapAnnouncement(e) {
    const id = e.currentTarget.dataset.id;
    if (id === 'a3') wx.navigateTo({ url: '/pages/venue/list' });
    else if (id === 'a1' || id === 'a4') wx.switchTab({ url: '/pages/equipment/list' });
    else wx.switchTab({ url: '/pages/ball/list' });
  },

  // 待办点击：跳详情
  onTapUpcoming(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: '/pages/ball/detail?id=' + id });
  },

  // 跳到我的 tab（"查看全部"）
  onGoMy() { wx.switchTab({ url: '/pages/mine/index' }); },

  // 约球预览点击
  onTapBallPreview(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: '/pages/ball/detail?id=' + id });
  },

  // 出物预览点击
  onTapEquipPreview(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: '/pages/equipment/detail?id=' + id });
  },

  // ============ 快速发布弹窗 ============
  openPublishModal() { this.setData({ showPublishModal: true }); },
  closePublishModal() { this.setData({ showPublishModal: false }); },
  onSelectPublishType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ showPublishModal: false });
    // 跳到对应发布页；约球和出物都不是首页同 tab
    if (type === 'ball') {
      wx.navigateTo({ url: '/pages/ball/publish' });
    } else if (type === 'equipment') {
      // 出物发布页默认出租
      wx.navigateTo({ url: '/pages/equipment/publish?type=rent' });
    }
  }
});
