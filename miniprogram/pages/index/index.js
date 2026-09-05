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
    upcomingList: [],
    upcomingUrgentCount: 0,    // 24h 内需要赴约的数量（用于徽章）
    upcomingCriticalCount: 0,  // 2h 内需要赴约的数量（用于脉动提示）
    upcomingTotal: 0           // 后端返回的总数（用于"查看全部"）
  },

  onLoad() {
    // 关键：首页 onLoad 也调一次 fetchUpcoming，避免 onShow 守卫漏掉冷启动场景
    this.fetchUpcoming();
  },

  // 每次回到首页都刷新一次（用户发布/入队/取消后回到首页能立刻看到）
  onShow() {
    // 关键：marker，便于排查「待办提醒为什么不显示」
    console.log('[index] onShow fired, will fetchUpcoming');
    this.fetchUpcoming();
  },

  // 拉取「我需要赴约」的 5 条
  async fetchUpcoming() {
    try {
      console.log('[index] fetchUpcoming start');
      const r = await callCloud('ballAdd', { type: 'myUpcoming' });
      console.log('[index] fetchUpcoming resp:', JSON.stringify(r.result || r));
      if (r.result && r.result.success) {
        const raw = r.result.data.list || [];
        const list = raw.map((it) => this._mapItem(it));
        // 统计需要突出展示的紧急项数量（用于 section 顶部徽章）
        const urgentCount = list.filter((it) => it.urgentLevel !== 'normal').length;
        const criticalCount = list.filter((it) => it.urgentLevel === 'critical').length;
        // 关键：把 total 也打到控制台，方便判断"我有没有未来要去的约球"
        console.log('[index] upcomingList.length=' + list.length + ', total=' + (r.result.data.total || 0));
        this.setData({
          upcomingList: list,
          upcomingUrgentCount: urgentCount,
          upcomingCriticalCount: criticalCount,
          upcomingTotal: r.result.data.total || list.length
        });
      } else {
        // 拉取失败时不清空已有数据，保持上一次结果（避免跳来跳去时闪）
      }
    } catch (e) {
      console.error('[index] fetchUpcoming failed', e);
    }
  },

  // 字段映射：补全 sportLabel / sportEmoji / 倒计时 / 紧急度
  _mapItem(item) {
    const sport = SPORT_MAP[item.sport] || { label: item.sport || '运动', emoji: '🏅' };
    const ms = item.msUntil || 0;
    const countdownText = this._formatCountdown(ms);
    // 紧急度分级：<2h 极紧急，<24h 紧急，>=24h 一般
    const TWO_HOUR = 2 * 60 * 60 * 1000;
    const ONE_DAY  = 24 * 60 * 60 * 1000;
    let urgentLevel = 'normal';  // normal | urgent | critical
    if (ms > 0 && ms <= TWO_HOUR) urgentLevel = 'critical';
    else if (ms > 0 && ms <= ONE_DAY) urgentLevel = 'urgent';
    return Object.assign({}, item, {
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      countdownText,
      urgent: ms > 0 && ms < ONE_DAY,   // 兼容旧样式
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

  // 「查看全部」→ 跳到「我的」tab，里面有「我的发布」子 tab
  // 关键：pages/ball/my 不是 tabBar 页面，用 switchTab 会静默失败
  //       正确做法是切到 /pages/mine/index（tabBar 页面），里面「我的发布」tab
  //       调的是同一个 ballAdd.myPosts 云函数
  onGoMy() {
    wx.switchTab({ url: '/pages/mine/index' });
  }
});
